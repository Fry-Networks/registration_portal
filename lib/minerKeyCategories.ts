// Shared miner key prefix groupings for explorer stats and dashboard categorization.
export const NODE_PREFIXES = new Set(['RDN', 'SDN', 'SVN']);
// Prefixes that currently ship the PoC device health software (AEM, BM, Nodes).
// Avoid Set spreading to keep compatibility with downlevel targets.
export const DEVICE_HEALTH_PREFIXES = new Set(['RDN', 'SDN', 'SVN', 'AEM', 'BM']);

const WEATHER_PREFIXES = new Set(['HWM', 'LWM']);
const AIR_PREFIXES = new Set(['IHAQM', 'ILAQM', 'OMAQM', 'IMAQM', 'OHAQM']);
const WATER_PREFIXES = new Set(['OLWQM', 'OHWQM']);
const RADIATION_PREFIXES = new Set(['IRM']);
const CAMERA_PREFIXES = new Set([
  'AOWSCM',
  'AOWCM',
  'AIWCM',
  'AOSCM',
  'AISCM',
  'AOTCM',
  'AITCM',
  'AIWSCM'
]);
const ENERGY_PREFIXES = new Set(['EM']);
const HARDWARE_PREFIXES = new Set(['ISM', 'OSM', 'BM', 'IDM', 'ODM', 'SDN', 'SVN', 'RDN', 'CN', 'AEM']);

export type MinerCategory =
  | 'nodes'
  | 'aem'
  | 'bm'
  | 'camera'
  | 'weather'
  | 'water'
  | 'air'
  | 'radiation'
  | 'energy'
  | 'hardware'
  | 'unknown';

// Normalize a prefix into a category for explorer stats.
export const categorizeMinerPrefix = (prefix: string): MinerCategory => {
  const normalized = prefix.trim().toUpperCase();
  if (!normalized) return 'unknown';
  if (NODE_PREFIXES.has(normalized)) return 'nodes';
  if (normalized === 'AEM') return 'aem';
  if (normalized === 'BM') return 'bm';
  if (CAMERA_PREFIXES.has(normalized)) return 'camera';
  if (WEATHER_PREFIXES.has(normalized)) return 'weather';
  if (WATER_PREFIXES.has(normalized)) return 'water';
  if (AIR_PREFIXES.has(normalized)) return 'air';
  if (RADIATION_PREFIXES.has(normalized)) return 'radiation';
  if (ENERGY_PREFIXES.has(normalized)) return 'energy';
  if (HARDWARE_PREFIXES.has(normalized)) return 'hardware';
  return 'unknown';
};

// Quick helper for UI/API guards so unsupported device types do not expose PoC health data.
export const isDeviceHealthSupported = (minerKey: string): boolean => {
  const prefix = minerKey.split('-')[0]?.trim().toUpperCase() ?? '';
  return DEVICE_HEALTH_PREFIXES.has(prefix);
};

// Categories that sit under the "Other" breakdown in explorer stats.
export const OTHER_BREAKDOWN_ORDER: MinerCategory[] = [
  'camera',
  'weather',
  'water',
  'air',
  'radiation',
  'energy',
  'hardware',
  'unknown'
];

// Limit the breakdown payload to non-primary categories under "Other".
export type OtherBreakdownCategory = (typeof OTHER_BREAKDOWN_ORDER)[number];
