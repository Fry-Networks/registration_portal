import { cellToBoundary, cellToLatLng, cellToParent, getResolution, latLngToCell } from 'h3-js';
import type { FeatureCollection, Polygon, Point, Feature } from 'geojson';
// MapLibre uses LayerSpecification types instead of Mapbox's FillLayer/LineLayer names.
import type {
  FillLayerSpecification as FillLayer,
  LineLayerSpecification as LineLayer,
  SymbolLayerSpecification as SymbolLayer
} from 'maplibre-gl';

export type MapHexStatus = 'registered' | 'unregistered' | 'offline';

export type WalletHexSummary = {
  hexId: string;
  count: number;
  status: MapHexStatus;
  statusCounts: {
    registered: number;
    unregistered: number;
    offline: number;
  };
};

// Centralize explorer colors so the legend and layers stay in sync.
export const EXPLORER_STATUS_COLORS: Record<MapHexStatus, string> = {
  registered: '#10b981',
  unregistered: '#9ca3af',
  offline: '#ef4444'
};

export type GlobalHexLayerConfig = {
  id: string;
  labelId: string;
  sourceLayer: string;
  labelSourceLayer: string;
  resolution: number;
  minZoom: number;
  maxZoom: number;
};

type GlobalHexLabelOptions = {
  idSuffix: string;
  minZoom: number;
  maxZoom: number;
  allowOverlap: boolean;
  ignorePlacement: boolean;
};

// Match Helium-style zoom progression by stepping through multiple H3 resolutions.
// Use ~1.4 zoom steps (log2 of H3 scale) and offset the bands so r2 stays visible longer.
export const GLOBAL_HEX_LAYER_CONFIGS: GlobalHexLayerConfig[] = [
  // Use polygon layers for labels to guarantee counts render even if label layers are missing.
  { id: 'global-hexes-r2', labelId: 'global-hexes-r2-labels', sourceLayer: 'hex_grid_r2', labelSourceLayer: 'hex_grid_r2', resolution: 2, minZoom: 0, maxZoom: 3.2 },
  { id: 'global-hexes-r3', labelId: 'global-hexes-r3-labels', sourceLayer: 'hex_grid_r3', labelSourceLayer: 'hex_grid_r3', resolution: 3, minZoom: 3.2, maxZoom: 4.6 },
  { id: 'global-hexes-r4', labelId: 'global-hexes-r4-labels', sourceLayer: 'hex_grid_r4', labelSourceLayer: 'hex_grid_r4', resolution: 4, minZoom: 4.6, maxZoom: 6.0 },
  { id: 'global-hexes-r5', labelId: 'global-hexes-r5-labels', sourceLayer: 'hex_grid_r5', labelSourceLayer: 'hex_grid_r5', resolution: 5, minZoom: 6.0, maxZoom: 7.4 },
  { id: 'global-hexes-r6', labelId: 'global-hexes-r6-labels', sourceLayer: 'hex_grid_r6', labelSourceLayer: 'hex_grid_r6', resolution: 6, minZoom: 7.4, maxZoom: 8.8 },
  { id: 'global-hexes-r7', labelId: 'global-hexes-r7-labels', sourceLayer: 'hex_grid_r7', labelSourceLayer: 'hex_grid_r7', resolution: 7, minZoom: 8.8, maxZoom: 10.2 },
  { id: 'global-hexes-r8', labelId: 'global-hexes-r8-labels', sourceLayer: 'hex_grid_r8', labelSourceLayer: 'hex_grid_r8', resolution: 8, minZoom: 10.2, maxZoom: 11.6 },
  { id: 'global-hexes-r9', labelId: 'global-hexes-r9-labels', sourceLayer: 'hex_grid_r9', labelSourceLayer: 'hex_grid_r9', resolution: 9, minZoom: 11.6, maxZoom: 12 }
];

export const getGlobalHexResolutionForZoom = (zoom: number): number => {
  // Use the resolution tied to the visible zoom band so fallback clicks stay aligned with tiles.
  const match = GLOBAL_HEX_LAYER_CONFIGS.find((config) => zoom >= config.minZoom && zoom < config.maxZoom);
  return match?.resolution ?? GLOBAL_HEX_LAYER_CONFIGS[GLOBAL_HEX_LAYER_CONFIGS.length - 1].resolution;
};

// Build a GeoJSON collection of wallet hex polygons without exposing lat/lng.
export const buildWalletHexGeoJSON = (hexes: WalletHexSummary[]): FeatureCollection<Polygon> => {
  const features: Feature<Polygon>[] = hexes.map((hex) => {
    const boundary = cellToBoundary(hex.hexId, true);
    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [boundary]
      },
      properties: {
        hexId: hex.hexId,
        count: hex.count,
        status: hex.status
      }
    };
  });

  return {
    type: 'FeatureCollection',
    features
  };
};

// Build a point-only GeoJSON collection so wallet labels render once per hex.
export const buildWalletHexLabelGeoJSON = (hexes: WalletHexSummary[]): FeatureCollection<Point> => {
  const features: Feature<Point>[] = hexes.map((hex) => {
    const [lat, lng] = cellToLatLng(hex.hexId);
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [lng, lat]
      },
      properties: {
        hexId: hex.hexId,
        count: hex.count,
        status: hex.status
      }
    };
  });

  return {
    type: 'FeatureCollection',
    features
  };
};

// Normalize wallet hexes to the active H3 resolution so their size tracks the global hex tiles.
export const normalizeWalletHexesForResolution = (
  hexes: WalletHexSummary[],
  targetResolution: number
): WalletHexSummary[] => {
  if (hexes.length === 0) return [];
  const clampedResolution = Math.max(0, Math.min(15, Math.round(targetResolution)));
  const normalized = new Map<string, WalletHexSummary>();

  hexes.forEach((hex) => {
    const sourceResolution = getResolution(hex.hexId);
    let resolvedHexId = hex.hexId;

    if (Number.isFinite(sourceResolution) && sourceResolution > clampedResolution) {
      resolvedHexId = cellToParent(hex.hexId, clampedResolution);
    }

    if (Number.isFinite(sourceResolution) && sourceResolution < clampedResolution) {
      // Use the hex centroid to keep privacy while shrinking the polygon at higher zooms.
      const [lat, lng] = cellToLatLng(hex.hexId);
      resolvedHexId = latLngToCell(lat, lng, clampedResolution);
    }

    if (!resolvedHexId) return;

    const existing = normalized.get(resolvedHexId);
    if (!existing) {
      normalized.set(resolvedHexId, {
        hexId: resolvedHexId,
        count: hex.count,
        status: hex.status,
        statusCounts: { ...hex.statusCounts }
      });
      return;
    }

    existing.count += hex.count;
    existing.statusCounts.registered += hex.statusCounts.registered;
    existing.statusCounts.unregistered += hex.statusCounts.unregistered;
    existing.statusCounts.offline += hex.statusCounts.offline;
    // Recompute the rollup color after merging counts.
    existing.status = existing.statusCounts.offline
      ? 'offline'
      : existing.statusCounts.unregistered
        ? 'unregistered'
        : 'registered';
  });

  return Array.from(normalized.values()).sort((a, b) => b.count - a.count);
};

// Build a GeoJSON feature for a selected hex so we can outline it.
export const buildSelectedHexFeature = (hexId: string | null): FeatureCollection<Polygon> | null => {
  if (!hexId) return null;
  const boundary = cellToBoundary(hexId, true);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [boundary]
        },
        properties: { hexId }
      }
    ]
  };
};

// Layer styling for anonymized global hex coverage tiles.
export const getGlobalHexLayer = (isDark: boolean, config: GlobalHexLayerConfig): FillLayer => ({
  id: config.id,
  type: 'fill',
  source: 'global-hexes',
  'source-layer': config.sourceLayer,
  minzoom: config.minZoom,
  maxzoom: config.maxZoom,
  paint: {
    // Use a blue-to-orange density ramp to avoid confusion with online/offline outline colors.
    'fill-color': [
      'interpolate',
      ['linear'],
      ['to-number', ['get', 'count'], 0],
      0,
      isDark ? '#0b1220' : '#f1f5f9',
      1,
      isDark ? '#1e40af' : '#bfdbfe',
      5,
      isDark ? '#2563eb' : '#93c5fd',
      20,
      isDark ? '#0ea5e9' : '#67e8f9',
      50,
      isDark ? '#f59e0b' : '#fbbf24',
      200,
      isDark ? '#f97316' : '#fb923c'
    ],
    // Fade out true-zero buckets while keeping low-count coverage visible.
    'fill-opacity': [
      'interpolate',
      ['linear'],
      ['to-number', ['get', 'count'], 0],
      0,
      0,
      1,
      isDark ? 0.55 : 0.5,
      20,
      isDark ? 0.6 : 0.55
    ]
  }
});

export const getGlobalHexOutlineLayer = (isDark: boolean, config: GlobalHexLayerConfig): LineLayer => ({
  id: `${config.id}-outline`,
  type: 'line',
  source: 'global-hexes',
  'source-layer': config.sourceLayer,
  minzoom: config.minZoom,
  maxzoom: config.maxZoom,
  paint: {
    // Outline encodes telemetry presence so online/offline is visible globally.
    'line-color': [
      'case',
      ['>', ['to-number', ['get', 'offline_count'], 0], 0],
      isDark ? '#ef4444' : '#dc2626',
      ['>', ['to-number', ['get', 'online_count'], 0], 0],
      isDark ? '#22c55e' : '#16a34a',
      isDark ? '#e2e8f0' : '#0f172a'
    ],
    // Boost outline contrast so hex shapes remain visible as they get smaller.
    'line-opacity': ['interpolate', ['linear'], ['zoom'], config.minZoom, 0.32, config.maxZoom, 0.65],
    'line-width': ['interpolate', ['linear'], ['zoom'], config.minZoom, 0.35, config.maxZoom, 1.2]
  }
});

export const getGlobalHexLabelLayer = (
  isDark: boolean,
  config: GlobalHexLayerConfig,
  options: GlobalHexLabelOptions
): SymbolLayer => ({
  id: `${config.labelId}-${options.idSuffix}`,
  type: 'symbol',
  source: 'global-hexes',
  // Use the configured label source layer; defaults to polygon layers for reliability.
  'source-layer': config.labelSourceLayer,
  minzoom: options.minZoom,
  maxzoom: options.maxZoom,
  layout: {
    // Count labels are pre-formatted server-side to keep MapLibre expressions simple.
    'text-field': ['get', 'count_label'],
    // Scale text up so counts read at world zooms.
    'text-size': ['interpolate', ['linear'], ['zoom'], config.minZoom, 12, config.maxZoom, 16],
    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
    'symbol-placement': 'point',
    // Prevent duplicate labels when the same hex spans multiple tiles.
    'symbol-avoid-edges': true,
    // Allow overlap for the low-zoom label layer so every hex shows a count.
    'text-allow-overlap': options.allowOverlap,
    'text-ignore-placement': options.ignorePlacement
  },
  paint: {
    'text-color': isDark ? '#f8fafc' : '#111827',
    'text-halo-color': isDark ? '#0f172a' : '#f8fafc',
    'text-halo-width': 1.2
  }
});

// Wallet hexes should remain the most visible layer for owners.
export const getWalletFillLayer = (): FillLayer => ({
  id: 'wallet-hexes',
  type: 'fill',
  source: 'wallet-hexes',
  paint: {
    'fill-color': [
      'match',
      ['get', 'status'],
      'offline',
      EXPLORER_STATUS_COLORS.offline,
      'unregistered',
      EXPLORER_STATUS_COLORS.unregistered,
      'registered',
      EXPLORER_STATUS_COLORS.registered,
      EXPLORER_STATUS_COLORS.unregistered
    ],
    // Increase opacity as users zoom in so global labels do not show through wallet hexes.
    'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 6, 1]
  }
});

// Add a soft glow halo so wallet hexes are easy to spot against dense global tiles.
export const getWalletGlowLayer = (): LineLayer => ({
  id: 'wallet-hexes-glow',
  type: 'line',
  source: 'wallet-hexes',
  paint: {
    'line-color': [
      'match',
      ['get', 'status'],
      'offline',
      EXPLORER_STATUS_COLORS.offline,
      'unregistered',
      EXPLORER_STATUS_COLORS.unregistered,
      'registered',
      EXPLORER_STATUS_COLORS.registered,
      EXPLORER_STATUS_COLORS.unregistered
    ],
    // Use a wider, zoom-scaled blur so the glow stays visible at all zoom levels.
    'line-opacity': 0.35,
    'line-width': ['interpolate', ['linear'], ['zoom'], 2, 8, 6, 12, 10, 16],
    'line-blur': ['interpolate', ['linear'], ['zoom'], 2, 6, 6, 8, 10, 12]
  }
});

// Outline the wallet hexes for contrast over the global layer.
export const getWalletOutlineLayer = (isDark: boolean): LineLayer => ({
  id: 'wallet-hexes-outline',
  type: 'line',
  source: 'wallet-hexes',
  paint: {
    'line-color': isDark ? '#f8fafc' : '#111827',
    'line-opacity': 0.45,
    // Add a soft glow so hexes stand out over the atmospheric overlay.
    'line-blur': 0.8,
    'line-width': 1.6
  }
});

// Label wallet hexes with device counts to show density without pins.
export const getWalletLabelLayer = (isDark: boolean): SymbolLayer => ({
  id: 'wallet-hexes-labels',
  type: 'symbol',
  // Use a point-only source to prevent duplicate labels on large hexes.
  source: 'wallet-hex-labels',
  // Keep labels to a single placement per hex to avoid duplicates at higher zooms.
  // Only show wallet labels once the hex polygon is visible at this zoom level.
  minzoom: 6,
  layout: {
    'text-field': ['to-string', ['get', 'count']],
    'text-size': 12,
    'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
    'symbol-placement': 'point',
    'text-allow-overlap': false,
    'text-ignore-placement': false
  },
  paint: {
    'text-color': isDark ? '#f8fafc' : '#111827',
    'text-halo-color': isDark ? '#0f172a' : '#f8fafc',
    'text-halo-width': 1
  }
});

// Outline the currently-selected hex for context.
export const getSelectedHexLayer = (isDark: boolean): LineLayer => ({
  id: 'selected-hex-outline',
  type: 'line',
  source: 'selected-hex',
  paint: {
    'line-color': isDark ? '#facc15' : '#d97706',
    // Emphasize selection with a brighter, slightly blurred outline.
    'line-width': 3,
    'line-opacity': 0.95,
    'line-blur': 1
  }
});
