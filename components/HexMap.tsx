import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const mapRef = useRef<any | null>(null);

  if (typeof window === 'undefined') {
    return <div className={className} style={{ height: typeof height === 'number' ? `${height}px` : height }} />;
  }

  // internalResolution: if user provided a static resolution prop, we prefer that.
  const [internalResolution, setInternalResolution] = useState<number>(resolution ?? 4);
  const [cells, setCells] = useState<string[]>([]);

  // Zoom-to-resolution mapping helpers (tweak values to taste)
  const resToZoom = (res: number) => {
    // approximate leaflet zoom for each H3 resolution
    const map: number[] = [1.5, 2.5, 4, 5, 6.2, 7.4, 9, 11]; // index = resolution
    return map[Math.min(Math.max(res, 0), map.length - 1)];
  };
  const zoomToRes = (z: number) => {
    if (z < 2) return 0;
    if (z < 3.5) return 1;
    if (z < 4.5) return 2;
    if (z < 5.5) return 3;
    if (z < 6.8) return 4;
    if (z < 8) return 5;
    if (z < 10) return 6;
    return 7;
  };

  // derive the diskCells from the active resolution
  const diskCells = useMemo(() => {
    const baseCell =
      selectedCell && isValidCell(selectedCell)
        ? selectedCell
        : latLngToCell(center[0], center[1], internalResolution);
    return Array.from(gridDisk(baseCell, neighborsK));
  }, [center, selectedCell, neighborsK, internalResolution]);

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

  // selected polygon helper
  const selectedPoly = useMemo(() => {
    if (selectedCell && isValidCell(selectedCell)) {
      return { cell: selectedCell, boundary: cellToBoundary(selectedCell) as LatLng[] };
    }
    return null;
  }, [selectedCell]);

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
  function MapZoomSync() {
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
              onDisplayCellChange && onDisplayCellChange(cell, r);
            } catch (e) {
              onDisplayCellChange && onDisplayCellChange(null, r);
            }
            return r;
          }
          // still notify with same resolution (in case center moved)
          try {
            const centerLatLng = map.getCenter();
            const cell = latLngToCell(centerLatLng.lat, centerLatLng.lng, r);
            onDisplayCellChange && onDisplayCellChange(cell, r);
          } catch (e) {
            onDisplayCellChange && onDisplayCellChange(null, r);
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
    }, [map]);
    return null;
  }

  // Fit bounds to polygons / selected
  function FitBounds({ polygons, selected }: { polygons: { cell: string; boundary: LatLng[] }[]; selected?: { cell: string; boundary: LatLng[] } | null }) {
    const map = useMap();
    useEffect(() => {
      if (!map) return;
      const coords: LatLng[] = selected && selected.boundary && selected.boundary.length > 0
        ? selected.boundary
        : polygons.flatMap((p) => p.boundary || []);

      if (!coords || coords.length === 0) return;
      try {
        map.fitBounds(coords as any, { padding: [40, 40], maxZoom: 16, animate: true });
      } catch (e) {
        const avgLat = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        const avgLng = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        map.setView([avgLat, avgLng]);
      }
    }, [polygons, selected, map]);
    return null;
  }

  // helper to wait for the next leaflet event once
  const onceAsync = (obj: any, ev: string) =>
    new Promise<void>((resolve) => {
      obj.once(ev, () => resolve());
    });

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

    // start drill from current derived resolution to target res 7
    // determine starting resolution from map zoom (or internalResolution)
    let startRes = internalResolution;
    if (typeof startRes !== 'number') startRes = 4;
    const targetRes = 7;

    // We'll iterate resolution by resolution, compute the cell at that resolution at the clicked lat/lng
    // fit the map bounds to that cell and wait for the animation to finish before increasing the resolution.
    for (let r = startRes; r <= targetRes; r++) {
      try {
        const cell = latLngToCell(latlng[0], latlng[1], r);
        const boundary = cellToBoundary(cell) as LatLng[];
        // set selected cell (visual highlight)
        // update local state (so polygons will update next render)
        setInternalResolution(r);
        setCells(Array.from(gridDisk(cell, neighborsK)));
        // notify parent of the intermediate display hex
        onDisplayCellChange && onDisplayCellChange(cell, r);

        // fit to the hex boundary
        try {
          map.fitBounds(boundary as any, { padding: [40, 40], maxZoom: 16, animate: true });
          // wait for moveend (cover both zoom and pan)
          await onceAsync(map, 'moveend');
        } catch (e) {
          // fallback to setting view and waiting for zoomend
          map.setView([latlng[0], latlng[1]], resToZoom(r), { animate: true });
          await onceAsync(map, 'zoomend');
        }

        // small delay to give the user perceivable step (optional)
        await new Promise((res) => setTimeout(res, 150));

      } catch (err) {
        // if anything goes wrong, break and fallback to selecting the last computed cell
        break;
      }
    }

    // final selection: compute final cell at res 7 and call onSelect
    const finalCell = latLngToCell(latlng[0], latlng[1], targetRes);
    const [fLat, fLng] = cellToLatLng(finalCell);
    onSelect(finalCell, fLat, fLng);
  };

  const containerStyle: React.CSSProperties = { height: typeof height === 'number' ? `${height}px` : height };

  const initialLeafletZoom = typeof initialZoom === 'number' ? initialZoom : (typeof zoom === 'number' ? zoom : 1.5);

  return (
    <div className={className} style={containerStyle}>
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
        <MapZoomSync />

        {/* Fit bounds to polygons or selected cell so drawn hex cluster is visible */}
        <FitBounds polygons={polygons} selected={selectedPoly} />

        {/* Sync external zoom changes */}
        <ZoomSync zoom={zoom} />
      </MapContainer>
    </div>
  );
}