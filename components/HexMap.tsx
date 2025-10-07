import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import dynamic from 'next/dynamic';

// MapClickCatcher must be in its own file and dynamically imported:
const MapClickCatcher = dynamic(() => import('./MapClickCatcher').then((m) => m.default), { ssr: false });

import {
  latLngToCell,
  cellToBoundary,
  gridDisk,
  cellToLatLng,
  isValidCell,
  getResolution,
} from 'h3-js';

type LatLng = [number, number];

// Dynamically load only React-Leaflet components (client-side)
const MapContainer = dynamic(
  () => import('react-leaflet').then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import('react-leaflet').then((m) => m.TileLayer),
  { ssr: false }
);
const Polygon = dynamic(
  () => import('react-leaflet').then((m) => m.Polygon),
  { ssr: false }
);

interface HexMapProps {
  resolution?: number; // optional static resolution override
  center: LatLng; // [lat, lng]
  selectedCell?: string;
  neighborsK?: number; // rings around center cell to draw
  onSelect: (cell: string, lat: number, lng: number) => void;
  className?: string;
  height?: number | string;
  initialZoom?: number;
  zoom?: number;
  // new props:
  autoResolution?: boolean; // derive display resolution from map zoom
  // called when the currently-displayed hex (based on zoom/area) changes:
  onDisplayCellChange?: (cell: string | null, resolution: number) => void;
}

export default function HexMap({
  resolution,
  center,
  selectedCell,
  neighborsK = 1,
  onSelect,
  className,
  height = '100%',
  initialZoom,
  zoom,
  autoResolution = true,
  onDisplayCellChange,
}: HexMapProps) {
  // Avoid SSR Leaflet imports
  const isBrowser = typeof window !== 'undefined';
  const mapRef = useRef<any | null>(null);

  // internalResolution: if user provided a static resolution prop, we prefer that.
  const [internalResolution, setInternalResolution] = useState<number>(resolution ?? 2);
  const [cells, setCells] = useState<string[]>([]);

  const notifyDisplayCellChange = useCallback(
    (cell: string | null, res: number) => {
      if (!onDisplayCellChange) return;
      // Defer to the microtask queue to avoid triggering parent state updates during render
      Promise.resolve().then(() => {
        onDisplayCellChange(cell, res);
      });
    },
    [onDisplayCellChange]
  );

  // Zoom-to-resolution mapping helpers (tweak values to taste)
  const resToZoom = useCallback((res: number) => {
    // approximate leaflet zoom for each H3 resolution
    const map: number[] = [1.5, 2.5, 4, 5, 6.2, 7.4, 9, 11]; // index = resolution
    return map[Math.min(Math.max(res, 0), map.length - 1)];
  }, []);
  const zoomToRes = useCallback((z: number) => {
    if (z < 2) return 0;
    if (z < 3.5) return 1;
    if (z < 4.5) return 2;
    if (z < 5.5) return 3;
    if (z < 6.8) return 4;
    if (z < 8) return 5;
    if (z < 10) return 6;
    return 7;
  }, []);

  // derive the diskCells from the active resolution
  const resolvedSelectedCell = useMemo(() => {
    if (selectedCell && isValidCell(selectedCell)) {
      const selectedRes = getResolution(selectedCell);
      if (selectedRes === internalResolution) {
        return selectedCell;
      }
      const [sLat, sLng] = cellToLatLng(selectedCell);
      return latLngToCell(sLat, sLng, internalResolution);
    }
    return latLngToCell(center[0], center[1], internalResolution);
  }, [selectedCell, center, internalResolution]);

  const diskCells = useMemo(
    () => Array.from(gridDisk(resolvedSelectedCell, neighborsK)),
    [resolvedSelectedCell, neighborsK]
  );

  useEffect(() => {
    setCells(diskCells);
  }, [diskCells]);

  const polygons = useMemo(
    () =>
      cells.map((c) => ({
        cell: c,
        boundary: cellToBoundary(c) as LatLng[],
      })),
    [cells]
  );

  // selected polygon helper (render at current resolution)
  const selectedPoly = useMemo(() => {
    return resolvedSelectedCell
      ? { cell: resolvedSelectedCell, boundary: cellToBoundary(resolvedSelectedCell) as LatLng[] }
      : null;
  }, [resolvedSelectedCell]);

  // Keep external zoom prop in sync with map instance
  function ZoomSync({ zoom }: { zoom?: number }) {
    const map = useMap();
    useEffect(() => {
      if (!map) return;
      if (typeof zoom === 'number' && Number.isFinite(zoom)) {
        map.setZoom(zoom);
      }
    }, [zoom, map]);
    return null;
  }

  // Set mapRef when Map is ready (replacement for whenCreated prop)
  function SetMapRef() {
    const map = useMap();
    useEffect(() => {
      mapRef.current = map;
      return () => {
        // optional cleanup
        mapRef.current = null;
      };
    }, [map]);
    return null;
  }

  // When the map zoom changes, optionally set internalResolution and notify parent of the current display cell
  function MapZoomSync({
    autoResolution,
    notifyDisplayCellChange,
    zoomToRes,
  }: {
    autoResolution: boolean;
    notifyDisplayCellChange: (cell: string | null, res: number) => void;
    zoomToRes: (zoom: number) => number;
  }) {
    const map = useMap();
    useEffect(() => {
      if (!autoResolution) return;
      const handler = () => {
        const z = map.getZoom();
        const r = zoomToRes(z);
        // only update if changed
        setInternalResolution((prev) => {
          if (prev !== r) {
            // notify parent about new "display hex" computed at this resolution at the map center
            try {
              const centerLatLng = map.getCenter();
              const cell = latLngToCell(centerLatLng.lat, centerLatLng.lng, r);
              notifyDisplayCellChange(cell, r);
            } catch (e) {
              notifyDisplayCellChange(null, r);
            }
            return r;
          }
          // still notify with same resolution (in case center moved)
          try {
            const centerLatLng = map.getCenter();
            const cell = latLngToCell(centerLatLng.lat, centerLatLng.lng, r);
            notifyDisplayCellChange(cell, r);
          } catch (e) {
            notifyDisplayCellChange(null, r);
          }
          return prev;
        });
      };

      // initialize
      handler();
      map.on('zoomend moveend', handler);
      return () => {
        map.off('zoomend moveend', handler);
      };
    }, [autoResolution, map, notifyDisplayCellChange, zoomToRes]);
    return null;
  }

  // Fit bounds to polygons / selected
  // helper to wait for the next leaflet event once
  const onceAsync = (obj: any, ev: string) =>
    new Promise<void>((resolve) => {
      obj.once(ev, () => resolve());
    });

  // If parent sets `selectedCell`, ensure the map recenters and zooms to it.
  useEffect(() => {
    if (!selectedCell) return;
    if (!isValidCell(selectedCell)) return;
    const map = mapRef.current;
    if (!map) return;
    try {
      const targetRes = getResolution(selectedCell);
      const boundary = cellToBoundary(selectedCell) as LatLng[];
      // update internal resolution and displayed cells
      setInternalResolution(targetRes);
      setCells(Array.from(gridDisk(selectedCell, neighborsK)));
      notifyDisplayCellChange(selectedCell, targetRes);
      // fit bounds to the cell boundary
      try {
        map.fitBounds(boundary as any, { padding: [40, 40], maxZoom: 16, animate: true });
      } catch (e) {
        // fallback: set view to cell center with approximate zoom
        const [lat, lng] = cellToLatLng(selectedCell);
        map.setView([lat, lng], resToZoom(targetRes), { animate: true });
      }
    } catch (err) {
      // ignore fit errors
    }
  }, [selectedCell]);

  // handle a user click: drill progressively from current displayed resolution down to 7
  const handleClick = async (latlng: LatLng) => {
    // if user passed a static resolution prop, use it (no drill)
    if (typeof resolution === 'number') {
      const cell = latLngToCell(latlng[0], latlng[1], resolution);
      const [cLat, cLng] = cellToLatLng(cell);
      onSelect(cell, cLat, cLng);
      return;
    }

    const map = mapRef.current;
    if (!map) {
      // fallback: compute cell at internalResolution and call onSelect
      const cell = latLngToCell(latlng[0], latlng[1], internalResolution);
      const [cLat, cLng] = cellToLatLng(cell);
      onSelect(cell, cLat, cLng);
      return;
    }

    // compute next resolution (increment by one each click, clamped to 7)
    let startRes = internalResolution;
    if (typeof startRes !== 'number') startRes = 4;
    const nextRes = Math.min(startRes + 1, 7);

    try {
      const cell = latLngToCell(latlng[0], latlng[1], nextRes);
      const boundary = cellToBoundary(cell) as LatLng[];
      setInternalResolution(nextRes);
      setCells(Array.from(gridDisk(cell, neighborsK)));
      notifyDisplayCellChange(cell, nextRes);

      try {
        map.fitBounds(boundary as any, { padding: [40, 40], maxZoom: 16, animate: true });
        await onceAsync(map, 'moveend');
      } catch (e) {
        map.setView([latlng[0], latlng[1]], resToZoom(nextRes), { animate: true });
        await onceAsync(map, 'zoomend');
      }

      const [cLat, cLng] = cellToLatLng(cell);
      onSelect(cell, cLat, cLng);
    } catch (err) {
      // fallback if the next resolution can't be computed
      const fallbackCell = latLngToCell(latlng[0], latlng[1], startRes);
      const [cLat, cLng] = cellToLatLng(fallbackCell);
      notifyDisplayCellChange(fallbackCell, startRes);
      onSelect(fallbackCell, cLat, cLng);
    }
  };

  const containerStyle: React.CSSProperties = { height: typeof height === 'number' ? `${height}px` : height };

  const computeStartingZoom = () => {
    if (typeof zoom === 'number') return zoom;
    if (selectedCell && isValidCell(selectedCell)) {
      return 9; // start closer when we already know the selected hex
    }
    const [centerLat, centerLng] = center;
    if (Number.isFinite(centerLat) && Number.isFinite(centerLng) && (centerLat !== 0 || centerLng !== 0)) {
      return 6; // zoom into the general vicinity if we have coordinates
    }
    return 2.5; // fallback world view
  };

  const initialLeafletZoom = typeof initialZoom === 'number' ? initialZoom : computeStartingZoom();

  return (
    <div className={className} style={containerStyle}>
      {isBrowser ? (
        <MapContainer
          center={center}
          zoom={initialLeafletZoom}
          scrollWheelZoom
          style={{ height: '100%', width: '100%', borderRadius: '0.75rem' }}
        >
          {/* Set mapRef via a child component instead of whenCreated (avoids type issues across react-leaflet versions) */}
          <SetMapRef />
          <MapClickCatcher onClick={(latlng: LatLng) => handleClick(latlng)} />

          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />

          {polygons.map(({ cell, boundary }) => (
            <Polygon
              key={cell}
              positions={boundary}
              pathOptions={{ weight: 1, opacity: 0.7, fillOpacity: 0.05 }}
            />
          ))}

          {selectedPoly && (
            <Polygon
              key={`selected-${selectedPoly.cell}`}
              positions={selectedPoly.boundary}
              pathOptions={{ weight: 3, opacity: 1, fillOpacity: 0.15, color: '#ff3333' }}
            />
          )}

          {/* keep zoom->resolution in sync and report displayed cell */}
          <MapZoomSync
            autoResolution={autoResolution}
            notifyDisplayCellChange={notifyDisplayCellChange}
            zoomToRes={zoomToRes}
          />

          {/* Sync external zoom changes */}
          <ZoomSync zoom={zoom} />
        </MapContainer>
      ) : null}
    </div>
  );
}
