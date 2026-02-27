import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { Layer, NavigationControl, Source, type MapRef } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
// MapLibre event types keep click handling aligned with the maplibre map instance.
import type { MapLayerMouseEvent } from 'maplibre-gl';
import { useTheme } from 'next-themes';
import { cellToBoundary, latLngToCell } from 'h3-js';
import {
  buildSelectedHexFeature,
  buildWalletHexGeoJSON,
  buildWalletHexLabelGeoJSON,
  GLOBAL_HEX_LAYER_CONFIGS,
  getGlobalHexLayer,
  getGlobalHexOutlineLayer,
  getGlobalHexLabelLayer,
  getGlobalHexResolutionForZoom,
  getSelectedHexLayer,
  getWalletFillLayer,
  getWalletGlowLayer,
  getWalletLabelLayer,
  getWalletOutlineLayer,
  normalizeWalletHexesForResolution,
  type WalletHexSummary
} from './mapLayers';

interface ExplorerMapProps {
  walletHexes: WalletHexSummary[];
  selectedHex: string | null;
  onSelectHex: (hexId: string | null) => void;
  tilesUrl: string | null;
  // Optional focus target for list-driven jumps to a specific hex.
  focusHexId?: string | null;
  onFocusComplete?: () => void;
  // Allow the parent to pause globe spin while a hex is selected.
  spinEnabled?: boolean;
}

export default function ExplorerMap({
  walletHexes,
  selectedHex,
  onSelectHex,
  tilesUrl,
  focusHexId,
  onFocusComplete,
  spinEnabled = true
}: ExplorerMapProps) {
  const { resolvedTheme } = useTheme();
  // Keep the base map style synced with the dashboard theme.
  const isDark = resolvedTheme !== 'light';
  // Track the underlying map instance for focus + globe controls.
  const mapRef = useRef<MapRef | null>(null);
  // Track when the map has finished loading its style.
  const [mapReady, setMapReady] = useState(false);
  // Track zoom so wallet hexes follow the same resolution bands as global tiles.
  const [mapZoom, setMapZoom] = useState(2.2);
  // Pause globe spin while the user is interacting with the map.
  const isUserInteractingRef = useRef(false);
  const spinTimeoutRef = useRef<number | null>(null);
  // Track whether the idle globe spin should run.
  const spinEnabledRef = useRef(spinEnabled);

  // Snap wallet hexes to the current zoom's H3 resolution so they stay a consistent size.
  const walletResolution = useMemo(() => getGlobalHexResolutionForZoom(mapZoom), [mapZoom]);
  const resolvedWalletHexes = useMemo(
    () => normalizeWalletHexesForResolution(walletHexes, walletResolution),
    [walletHexes, walletResolution]
  );
  const walletGeoJSON = useMemo(() => buildWalletHexGeoJSON(resolvedWalletHexes), [resolvedWalletHexes]);
  const walletLabelGeoJSON = useMemo(() => buildWalletHexLabelGeoJSON(resolvedWalletHexes), [resolvedWalletHexes]);
  const selectedGeoJSON = useMemo(() => buildSelectedHexFeature(selectedHex), [selectedHex]);
  const focusBounds = useMemo(() => {
    if (!focusHexId) return null;
    // Use the hex boundary to build bounds for a list-driven focus zoom.
    const boundary = cellToBoundary(focusHexId, true);
    let minLng = Number.POSITIVE_INFINITY;
    let minLat = Number.POSITIVE_INFINITY;
    let maxLng = Number.NEGATIVE_INFINITY;
    let maxLat = Number.NEGATIVE_INFINITY;

    boundary.forEach(([lng, lat]) => {
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    });

    if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) {
      return null;
    }

    return [
      [minLng, minLat],
      [maxLng, maxLat]
    ] as [[number, number], [number, number]];
  }, [focusHexId]);

  // Allow an env override for global hex resolution when a tile feature id is missing.
  const fallbackGlobalResolution = Number(process.env.NEXT_PUBLIC_EXPLORER_GLOBAL_HEX_RESOLUTION ?? 0);

  const baseStyleLight =
    process.env.NEXT_PUBLIC_EXPLORER_STYLE_LIGHT ??
    'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
  const baseStyleDark =
    process.env.NEXT_PUBLIC_EXPLORER_STYLE_DARK ??
    'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

  const mapStyle = isDark ? baseStyleDark : baseStyleLight;

  // Only register interactive layers that are actually present.
  const interactiveLayerIds = tilesUrl
    ? [
        ...GLOBAL_HEX_LAYER_CONFIGS.flatMap((config) => [
          config.id,
          `${config.labelId}-low`,
          `${config.labelId}-high`
        ]),
        'wallet-hexes',
        'wallet-hexes-labels'
      ]
    : ['wallet-hexes', 'wallet-hexes-labels'];

  const handleMapClick = useCallback(
    (event: MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const props = feature?.properties as { id?: string; hexId?: string } | undefined;
      const hexId = props?.hexId || props?.id || '';

      if (hexId) {
        onSelectHex(String(hexId));
        return;
      }

      // Fall back to deriving a hex from the click coordinates if the tile lacks ids.
      if (event.lngLat) {
        const map = mapRef.current?.getMap();
        const zoom = map ? map.getZoom() : null;
        // Align fallback resolution with the active zoom band unless explicitly overridden.
        const resolvedFallback =
          fallbackGlobalResolution > 0 && Number.isFinite(fallbackGlobalResolution)
            ? fallbackGlobalResolution
            : getGlobalHexResolutionForZoom(zoom ?? 0);
        const derived = latLngToCell(event.lngLat.lat, event.lngLat.lng, resolvedFallback);
        onSelectHex(derived);
      }
    },
    [fallbackGlobalResolution, onSelectHex]
  );

  useEffect(() => {
    // Stop any active spin animation whenever the parent disables spinning.
    spinEnabledRef.current = spinEnabled;
    if (!spinEnabled) {
      const map = mapRef.current?.getMap();
      if (map) {
        map.stop();
      }
    }
  }, [spinEnabled]);

  useEffect(() => {
    if (mapReady) return;
    const mapRefCurrent = mapRef.current;
    if (!mapRefCurrent) return;
    // Set ready if the style is already loaded (covers early-load cases).
    if (mapRefCurrent.getMap().isStyleLoaded()) {
      setMapReady(true);
    }
  }, [mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const mapRefCurrent = mapRef.current;
    if (!mapRefCurrent) return;
    const map = mapRefCurrent.getMap();

    // Enable globe projection + atmospheric fog when supported by MapLibre.
    if (typeof (map as any).setProjection === 'function') {
      (map as any).setProjection({ type: 'globe' });
    }
    if (typeof (map as any).setFog === 'function') {
      (map as any).setFog({
        // Subtle atmosphere without the left shadow band.
        range: [0.5, 10],
        color: isDark ? 'rgba(10, 21, 35, 0.9)' : 'rgba(220, 240, 255, 0.85)',
        'horizon-blend': 0.12,
        'space-color': isDark ? '#020617' : '#0b1220',
        'star-intensity': isDark ? 0.12 : 0.06
      });
    }

    const handleInteractionStart = () => {
      isUserInteractingRef.current = true;
    };
    const handleInteractionEnd = () => {
      isUserInteractingRef.current = false;
    };

    map.on('dragstart', handleInteractionStart);
    map.on('mousedown', handleInteractionStart);
    map.on('touchstart', handleInteractionStart);
    map.on('wheel', handleInteractionStart);
    map.on('moveend', handleInteractionEnd);
    map.on('zoomend', handleInteractionEnd);
    // Update wallet hex resolution whenever the map finishes a zoom or programmed fit.
    const handleZoomUpdate = () => {
      setMapZoom(map.getZoom());
    };
    map.on('moveend', handleZoomUpdate);
    map.on('zoomend', handleZoomUpdate);
    handleZoomUpdate();

    // Keep a gentle globe spin running when idle.
    const secondsPerRevolution = 140;
    const maxSpinZoom = 5;
    const slowSpinZoom = 3;
    const spinGlobe = () => {
      if (!spinEnabledRef.current) return;
      if (isUserInteractingRef.current) return;
      const zoom = map.getZoom();
      if (zoom > maxSpinZoom) return;
      let distancePerSecond = 360 / secondsPerRevolution;
      if (zoom > slowSpinZoom) {
        const zoomDiff = (maxSpinZoom - zoom) / (maxSpinZoom - slowSpinZoom);
        distancePerSecond *= Math.max(0, zoomDiff);
      }
      const center = map.getCenter();
      center.lng -= distancePerSecond;
      map.easeTo({ center, duration: 1000, easing: (n: number) => n });
    };

    const scheduleSpin = () => {
      spinTimeoutRef.current = window.setTimeout(() => {
        spinGlobe();
        scheduleSpin();
      }, 1000);
    };

    scheduleSpin();

    return () => {
      map.off('dragstart', handleInteractionStart);
      map.off('mousedown', handleInteractionStart);
      map.off('touchstart', handleInteractionStart);
      map.off('wheel', handleInteractionStart);
      map.off('moveend', handleInteractionEnd);
      map.off('zoomend', handleInteractionEnd);
      map.off('moveend', handleZoomUpdate);
      map.off('zoomend', handleZoomUpdate);
      if (spinTimeoutRef.current !== null) {
        window.clearTimeout(spinTimeoutRef.current);
        spinTimeoutRef.current = null;
      }
    };
  }, [isDark, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const mapRefCurrent = mapRef.current;
    if (!mapRefCurrent) return;
    const map = mapRefCurrent.getMap();
    let animationFrame: number | null = null;
    const pulseDurationMs = 2500;

    const animateGlow = () => {
      const layerId = 'wallet-hexes-glow';
      if (map.getLayer(layerId)) {
        // Pulse opacity to create a subtle breathing glow.
        const now = performance.now();
        const phase = (now % pulseDurationMs) / pulseDurationMs;
        const eased = 0.5 - 0.5 * Math.cos(Math.PI * 2 * phase);
        const opacity = 0.25 + eased * 0.25;
        map.setPaintProperty(layerId, 'line-opacity', opacity);
      }
      animationFrame = window.requestAnimationFrame(animateGlow);
    };

    animateGlow();

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [mapReady]);

  useEffect(() => {
    if (!focusBounds) return;
    const mapRefCurrent = mapRef.current;
    if (!mapRefCurrent) return;
    const map = mapRefCurrent.getMap();
    if (!mapReady && !map.isStyleLoaded()) return;
    // Focus the map when a device is selected from the list.
    mapRefCurrent.fitBounds(focusBounds, {
      padding: 96,
      duration: 1000,
      maxZoom: 9
    });
    onFocusComplete?.();
  }, [focusBounds, mapReady, onFocusComplete]);

  return (
    <div className="absolute inset-0">
      <Map
        // Use MapLibre to avoid Mapbox token requirements for open basemap styles.
        mapLib={maplibregl}
        mapStyle={mapStyle}
        // Start closer to keep r2 hexes visible at the preferred mid-size scale.
        initialViewState={{ longitude: 0, latitude: 20, zoom: 2.2 }}
        // Force the map to fill its container so the explorer stays full-height.
        style={{ width: '100%', height: '100%' }}
        onClick={handleMapClick}
        interactiveLayerIds={interactiveLayerIds}
        dragRotate={false}
        maxPitch={0}
        reuseMaps
        // Track map readiness for globe + spin initialization.
        onLoad={() => setMapReady(true)}
        ref={mapRef}
      >
        {/* Global hex coverage tiles from the external tile service. */}
        {tilesUrl && (
          <Source
            id="global-hexes"
            type="vector"
            tiles={[`${tilesUrl}/data/hex_grid/{z}/{x}/{y}.pbf`]}
            minzoom={0}
            // Match the tileserver max zoom to prevent 404s at higher zoom levels.
            maxzoom={12}
            // MapLibre vector sources don't accept tileSize; tileserver-gl serves default 512 tiles.
          >
            {GLOBAL_HEX_LAYER_CONFIGS.map((config) => (
              <Layer key={config.id} {...getGlobalHexLayer(isDark, config)} />
            ))}
            {/* Add a thin outline so global hex coverage reads at low zoom. */}
            {GLOBAL_HEX_LAYER_CONFIGS.map((config) => (
              <Layer key={`${config.id}-outline`} {...getGlobalHexOutlineLayer(isDark, config)} />
            ))}
            {GLOBAL_HEX_LAYER_CONFIGS.flatMap((config) => {
              // Split the label band so low zoom always shows counts without hiding others.
              const splitZoom = config.minZoom + (config.maxZoom - config.minZoom) / 2;
              return [
                <Layer
                  key={`${config.labelId}-low`}
                  {...getGlobalHexLabelLayer(isDark, config, {
                    idSuffix: 'low',
                    minZoom: config.minZoom,
                    maxZoom: splitZoom,
                    allowOverlap: true,
                    ignorePlacement: true
                  })}
                />,
                <Layer
                  key={`${config.labelId}-high`}
                  {...getGlobalHexLabelLayer(isDark, config, {
                    idSuffix: 'high',
                    minZoom: splitZoom,
                    maxZoom: config.maxZoom,
                    allowOverlap: false,
                    ignorePlacement: false
                  })}
                />
              ];
            })}
          </Source>
        )}

        {/* Wallet hexes rendered locally to avoid exposing lat/lng. */}
        <Source id="wallet-hexes" type="geojson" data={walletGeoJSON}>
          <Layer {...getWalletFillLayer()} />
          {/* Glow halo goes under the crisp outline so it reads as a soft highlight. */}
          <Layer {...getWalletGlowLayer()} />
          <Layer {...getWalletOutlineLayer(isDark)} />
        </Source>
        {/* Wallet labels use a point-only source to avoid duplicate counts when zoomed in. */}
        <Source id="wallet-hex-labels" type="geojson" data={walletLabelGeoJSON}>
          <Layer {...getWalletLabelLayer(isDark)} />
        </Source>

        {/* Selected hex outline for context. */}
        {selectedGeoJSON && (
          <Source id="selected-hex" type="geojson" data={selectedGeoJSON}>
            <Layer {...getSelectedHexLayer(isDark)} />
          </Source>
        )}

        {/* Standard map controls for zooming while keeping the map lock-down. */}
        <NavigationControl position="bottom-right" showCompass={false} />
      </Map>
    </div>
  );
}
