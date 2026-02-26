// lib/credentials-utils.ts
// Shared constants and utilities for credential validation

// Coupled miner types
export const LINKED_MINER_TYPES: Record<string, string[]> = {
  ISM: ['OSM'],
  OSM: ['ISM'],
  IDM: ['ODM'],
  ODM: ['IDM'],
};

// Map miner type → portal *key* (not collection). Collection is derived below.
export const MINER_PORTAL_KEY: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  // air
  ['OHAQM', 'IHAQM', 'ILAQM', 'IMAQM', 'OMAQM'].forEach(t => (map[t] = 'air'));
  // camera
  ['AOWSCM', 'AOWCM', 'AIWCM', 'AOSCM', 'AISCM', 'AOTCM', 'AITCM', 'AIWSCM'].forEach(t => (map[t] = 'camera'));
  // weather
  ['HWM', 'LWM'].forEach(t => (map[t] = 'weather'));
  // water
  ['OLWQM', 'OHWQM'].forEach(t => (map[t] = 'water'));
  // energy, radiation, aem (aem → hardware)
  map['EM'] = 'energy';
  map['IRM'] = 'radiation';
  map['AEM'] = 'aem'; // not a named collection → hardware
  // misc passthroughs (will land in hardware)
  ['IDM', 'ODM', 'ISM', 'OSM', 'BM', 'CN', 'RDN', 'SDN', 'SVN'].forEach(t => (map[t] = t.toLowerCase()));
  return map;
})();

export const NAMED_COLLECTIONS = new Set(['air', 'camera', 'energy', 'weather', 'water', 'radiation']);

export const getMinerType = (miner_key?: string) => (miner_key ? String(miner_key).split('-')[0] : '');
export const portalKeyFromMiner = (mk?: string) => MINER_PORTAL_KEY[getMinerType(mk)] ?? '';

// Ecowitt device types that are supported for discovery (subset of portal keys)
export const SUPPORTED_ECOWITT_TYPES = new Set(['air', 'weather', 'energy', 'water']);

export const getEcowittDeviceType = (miner_key?: string): string | null => {
  const portalKey = portalKeyFromMiner(miner_key);
  return SUPPORTED_ECOWITT_TYPES.has(portalKey) ? portalKey : null;
};

/** Deterministic collection:
 *  - if portal_type ∈ {air, camera, energy, weather, water, radiation} → that collection
 *  - else infer portal key from miner_key; if in set → that collection
 *  - else → 'hardware'
 */
export const collectionFor = (opts: { miner_key?: string; portalType?: string }) => {
  const { miner_key, portalType } = opts;
  const fromPortal = portalType ? String(portalType).toLowerCase() : '';
  if (NAMED_COLLECTIONS.has(fromPortal)) return fromPortal;
  const inferred = portalKeyFromMiner(miner_key);
  if (NAMED_COLLECTIONS.has(inferred)) return inferred;
  return 'hardware';
};