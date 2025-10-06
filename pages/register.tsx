import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Sidebar from '../components/Sidebar';
import { ChevronRightIcon } from '@heroicons/react/outline';
import { Device, Product } from '../lib/types';
import { getSession, useSession } from 'next-auth/react';
import clientPromise from '../lib/mongoclient';
import { useToastContext } from '../hooks/ToastContext';
import { isNodeStakingNeeded, isRegistrationNeeded } from '../lib/utils';
import { findProductByMinerKey } from './devices';
import SectionBanner from '../components/SectionBanner';
import PasteAddress from '../components/PasteAddress';
import bgImg from '../assets/background.png';
import Image, { StaticImageData } from 'next/image';
import airthingsLogo from '../assets/portals/air-things.png';
import ambientLogo from '../assets/portals/ambient.png';
import atmotubeLogo from '../assets/portals/atmotube.png';
import awairLogo from '../assets/portals/awair.svg';
import ecowittLogo from '../assets/portals/ecowitt.png';
import gmcmapLogo from '../assets/portals/GMCMap.png';
import goveeLogo from '../assets/portals/govee.png';
import iopoolLogo from '../assets/portals/iopool.png';
import kaiterraLogo from '../assets/portals/kaiterra.png';
import lacrosseLogo from '../assets/portals/lacrosse.jpg';
import nrfLogo from '../assets/portals/nrf.png';
import pebbleLogo from '../assets/portals/pebble.svg';
import purpleairLogo from '../assets/portals/purple-air.png';
import RTSPLogo from '../assets/portals/RTSP.jpg';
import sensecapLogo from '../assets/portals/sensecap.webp';
import shellyLogo from '../assets/portals/shelly.png';
import switchbotLogo from '../assets/portals/switchbot.png';
import tapoLogo from '../assets/portals/tapo.png';
import tempestLogo from '../assets/portals/tempest.png';
import weatherxmLogo from '../assets/portals/weatherxm.png';

import * as h3 from 'h3-js';
import { isValidCell } from "h3-js";
import dynamic from 'next/dynamic';
import mapboxgl, { LngLat, Map } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { deviceValidatorRegistry } from '../lib/validators';
const MapboxAutocomplete = dynamic(() => import('react-mapbox-autocomplete'), {  ssr: false});
const HexMap = dynamic(() => import('../components/HexMap'), { ssr: false });
mapboxgl.accessToken ='REDACTED_ROTATE_ME';

// =============================
// Regexes & Validation Helpers
// =============================

// Core regexes (global defaults)

export const MAC_ADDRESS_REGEX = /^(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const NAME_REGEX = /^[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F' \-\.]{1,64}$/; // letters + accents + ' - .
export const NICKNAME_REGEX = /^.{0,64}$/;                     // optional, up to 64
export const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
export const ALGO_ADDRESS_REGEX = /^(?:[A-Z2-7]{58}|[A-Z2-7]{59})$/; // Algorand address (58 or 59 chars)
export const IMEI_REGEX = /^\d{15}$/;                          // 15 digits
export const HEX_STRING_16PLUS = /^[A-Fa-f0-9]{16,}$/;         // token/secret (>=16 hex) - default
export const DEVICE_ID_REGEX = /^[A-Za-z0-9:_-]{3,64}$/;       // generic device ID
export const HTTP_URL_REGEX = /^https?:\/\/[^\s]+$/i;
export const USERNAME_REGEX = /^\S.{0,63}$/;                   // at least 1 non-space
export const PASSWORD_REGEX = /^.{6,}$/;                       // 6+ any chars
export const STATION_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
export const API_KEY_REGEX = /^[A-Za-z0-9_\-]{16,}$/;          // lenient (hex/base64url-like)
export const RTSP_URL_REGEX = /^rtsps?:\/\/[^\s]+$/i;
export const GMCMAP_ID_REGEX = /^\d{3,9}$/;                    // numeric id
export const LAT_REGEX = /^-?([1-8]?\d(\.\d+)?|90(\.0+)?)$/;
export const LNG_REGEX = /^-?(180(\.0+)?|1[0-7]\d(\.\d+)?|\d{1,2}(\.\d+)?)$/;

// Global map of field -> regex (fallback when no subtype override exists)

export const FIELD_REGEX: Record<string, RegExp> = {
  // Credentials (by subtype fields)
  imei: IMEI_REGEX,
  token: HEX_STRING_16PLUS,
  secret: HEX_STRING_16PLUS,
  deviceId: DEVICE_ID_REGEX,
  serverUrl: HTTP_URL_REGEX,
  auth_key: HEX_STRING_16PLUS,   // legacy; not used by Shelly anymore
  api_key: API_KEY_REGEX,
  username: USERNAME_REGEX,
  password: PASSWORD_REGEX,
  station: STATION_ID_REGEX,
  rtsp_url: RTSP_URL_REGEX,
  mac_address: MAC_ADDRESS_REGEX,
  gmcmap_id: GMCMAP_ID_REGEX,

  // Device Info / Wallet / Map
  email: EMAIL_REGEX,
  firstName: NAME_REGEX,
  lastName: NAME_REGEX,
  nickname: NICKNAME_REGEX,
  reward_wallet: ALGO_ADDRESS_REGEX,
  latitude: LAT_REGEX,
  longitude: LNG_REGEX,
};

// Optional human hints (global)
export const FIELD_HINT: Record<string, string> = {
  imei: '15 digits (IMEI)',
  token: 'At least 16 hex characters',
  secret: 'At least 16 hex characters',
  deviceId: '3–64 chars: letters/digits/_-:',
  serverUrl: 'Must start with http:// or https://',
  username: 'At least 1 visible character',
  password: 'At least 6 characters',
  station: 'Letters/digits/_-',
  api_key: 'At least 16 URL-safe characters',
  rtsp_url: 'Must start with rtsp:// or rtsps://',
  mac_address: 'Example: AA:BB:CC:DD:EE:FF',
  gmcmap_id: '3–9 digits',
  email: 'example@domain.tld',
  firstName: 'Only letters, accents, hyphen, apostrophe, dot',
  lastName: 'Only letters, accents, hyphen, apostrophe, dot',
  reward_wallet: '58-character string (Algorand address)',
  latitude: '–90 to 90',
  longitude: '–180 to 180',
};

// --- Subtype-specific regex overrides ---
// Only applied when that subtype is selected.
const SWITCHBOT_TOKEN_REGEX = /^[A-Za-z0-9]{96}$/;      // exactly 96 alnum
const SWITCHBOT_SECRET_REGEX = /^[A-Za-z0-9]{32}$/;     // exactly 32 alnum
const SWITCHBOT_DEVICE_ID_REGEX = /^[A-Fa-f0-9]{12}$/;  // e.g., "404CCAA60FFA"

const AWAIR_TOKEN_REGEX = /^[A-Za-z0-9_-]{32,128}$/;
const AWAIR_DEVICE_ID_REGEX = /^\d{3,12}$/;             // often numeric IDs

const ATMOTUBE_TOKEN_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
const ATMOTUBE_DEVICE_ID_REGEX = /^[A-Za-z0-9:_-]{3,64}$/;

const KAITERRA_TOKEN_REGEX = /^[A-Za-z0-9]{32,128}$/;
const KAITERRA_DEVICE_ID_REGEX = /^[A-Za-z0-9:_-]{3,64}$/;

const TEMPEST_TOKEN_REGEX = /^[A-Za-z0-9]{16,64}$/;

const SHELLY_AUTH_KEY_REGEX = /^[A-Za-z0-9]{92}$/;                        // exactly 92 alphanumeric
const SHELLY_SERVER_URL_REGEX = /^https:\/\/shelly[^\s/]*\.shelly\.cloud$/i; // starts https://shelly-*** ends .shelly.cloud (no path)
const SHELLY_DEVICE_ID_REGEX = /^[A-Fa-f0-9]{12}$/;                      // MAC w/o colons

// keys we override per subtype
type SubtypeFieldKey = 'token' | 'secret' | 'deviceId' | 'serverUrl' | 'auth_key';

// Map: subtype -> per-field overrides
const REGEX_BY_SUBTYPE: Record<string, Partial<Record<SubtypeFieldKey, RegExp>>> = {
  switchbot: {
    token: SWITCHBOT_TOKEN_REGEX,
    secret: SWITCHBOT_SECRET_REGEX,
    deviceId: SWITCHBOT_DEVICE_ID_REGEX,
  },
  awair: {
    token: AWAIR_TOKEN_REGEX,
    deviceId: AWAIR_DEVICE_ID_REGEX,
  },
  atmotube: {
    token: ATMOTUBE_TOKEN_REGEX,
    deviceId: ATMOTUBE_DEVICE_ID_REGEX,
  },
  kaiterra: {
    token: KAITERRA_TOKEN_REGEX,
    deviceId: KAITERRA_DEVICE_ID_REGEX,
  },
  tempest: {
    token: TEMPEST_TOKEN_REGEX,
  },
  shelly: {
    auth_key: SHELLY_AUTH_KEY_REGEX,
    serverUrl: SHELLY_SERVER_URL_REGEX,
    deviceId: SHELLY_DEVICE_ID_REGEX,
  },
};

// Optional: subtype-specific hints for overrides
const HINTS_BY_SUBTYPE: Record<string, Partial<Record<SubtypeFieldKey, string>>> = {
  switchbot: {
    token: 'Exactly 96 alphanumeric characters',
    secret: 'Exactly 32 alphanumeric characters',
    deviceId: '12 hex characters (e.g., 404CCAA60FFA)',
  },
  awair: {
    token: '32–128 characters (letters, digits, _ or -)',
    deviceId: 'Numeric ID (3–12 digits)',
  },
  atmotube: {
    token: '16–128 characters (letters, digits, _ or -)',
    deviceId: 'Device ID (3–64: letters/digits/_-:)',
  },
  kaiterra: {
    token: '32–128 alphanumeric characters',
    deviceId: 'Device ID (3–64: letters/digits/_-:)',
  },
  tempest: {
    token: '16–64 alphanumeric characters',
  },
  shelly: {
    auth_key: 'Exactly 92 alphanumeric characters',
    serverUrl: 'Must be like https://shelly-***.shelly.cloud',
    deviceId: '12 hex characters (MAC without colons)',
  },
};
// --- formatters ---
function formatMacWithColons(raw: string): string {
  const hex = (raw || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase().slice(0, 12);
  return (hex.match(/.{1,2}/g) || []).join(':');
}

function sanitizeImei(raw: string): string {
  return (raw || '').replace(/\D/g, '').slice(0, 15);
}

// =============================
// Constants & helpers
// =============================

// Module-level portal helper/constants moved here to ensure initialization before component usage
export const PORTAL_DISPLAY_NAMES: Record<string, string> = {
  air: 'Air Portal',
  camera: 'Camera Portal',
  energy: 'Energy Portal',
  weather: 'Weather Portal',
  hardware: 'Hardware Portal',
  radiation: 'Radiation Portal'
};

export const FIELD_LABELS: Record<string, string> = {
  imei: 'IMEI',
  token: 'Token',
  secret: 'Secret',
  deviceId: 'Device ID',
  serverUrl: 'Server URL',
  auth_key: 'Auth Key',
  username: 'Username',
  password: 'Password',
  station: 'Station',
  api_key: 'API Key',
  app_key: 'APP Key',
  rtsp_url: 'RTSP URL',
  mac_address: 'MAC Address',
  gmcmap_id: 'GMCMap ID',
  sensorId: 'Sensor ID',
  readKey: 'Read Key',
  IP: 'Public IP Address',
};

export const PORTAL_SUBTYPES: Record<string, { id: string; name: string; sub_types?: string[] }[]> = {
  air: [
    { id: 'ambient', name: 'Ambient', sub_types: ['api_key'] },
    { id: 'ecowitt', name: 'Ecowitt', sub_types: ['app_key', 'api_key'] },
    { id: 'pebble', name: 'Pebble', sub_types: ['imei'] },
    { id: 'airthings', name: 'Airthings', sub_types: ['token', 'deviceId'] },
    { id: 'purpleair', name: 'PurpleAir', sub_types: ['sensorId', 'readKey'] },
    { id: 'awair', name: 'Awair', sub_types: ['token', 'deviceId'] },
    { id: 'kaiterra', name: 'Kaiterra', sub_types: ['token', 'deviceId'] },
    { id: 'atmotube', name: 'Atmotube', sub_types: ['token', 'deviceId'] },
    { id: 'govee', name: 'Govee', sub_types: ['api_key', 'deviceId'] },
    { id: 'nrf', name: 'NRF', sub_types: ['token', 'deviceId'] },
    { id: 'sensecap', name: 'SenseCAP', sub_types: ['token', 'api_key', 'deviceId'] }
  ],
  energy: [
    { id: 'switchbot', name: 'SwitchBot', sub_types: ['token', 'secret', 'deviceId'] },
    { id: 'shelly', name: 'Shelly', sub_types: ['serverUrl', 'auth_key', 'deviceId'] },
    { id: 'tapo', name: 'TP-Link Tapo', sub_types: ['username', 'password', 'IP'] },
    { id: 'ecowitt', name: 'Ecowitt', sub_types: ['app_key', 'api_key']}
  ],
  weather: [
    { id: 'ambient', name: 'Ambient', sub_types: ['api_key'] },
    { id: 'ecowitt', name: 'Ecowitt', sub_types: ['app_key', 'api_key'] },
    { id: 'weather-xm', name: 'Weather-XM', sub_types: ['username', 'password'] },
    { id: 'tempest', name: 'Tempest', sub_types: ['station', 'token'] },
    { id: 'lacrosse', name: 'LaCrosse', sub_types: ['api_key'] },
    { id: 'sensecap', name: 'SenseCAP', sub_types: ['token', 'api_key', 'deviceId'] }
  ],
  water: [
    { id: 'iopool', name: 'Iopool', sub_types: ['api_key'] },
    { id: 'ecowitt', name: 'Ecowitt', sub_types: ['app_key', 'api_key'] }
  ],
  camera: [{ id: 'rtsp', name: 'RTSP', sub_types: ['rtsp_url'] }],
  hardware: [{ id: 'hardware', name: 'MAC Address', sub_types: ['mac_address'] }],
  radiation: [{ id: 'GMCMap', name: 'GMCMap', sub_types: ['gmcmap_id'] }]
};

export const portalKeyFromMiner = (mk?: string) => {
  if (!mk) return '';
  const minerType = String(mk).split('-')[0];

  if (['OHAQM', 'IHAQM', 'ILAQM', 'IMAQM', 'OMAQM'].includes(minerType)) return 'air';
  if (['AOWSCM', 'AOWCM', 'AIWCM', 'AOSCM', 'AISCM', 'AOTCM', 'AITCM', 'AIWSCM'].includes(minerType)) return 'camera';
  if (['HWM', 'LWM'].includes(minerType)) return 'weather';
  if (['OLWQM', 'OHWQM'].includes(minerType)) return 'water';
  if (minerType === 'EM') return 'energy';
  if (minerType === 'IRM') return 'radiation'; 
  if (['IDM', 'ODM', 'ISM', 'OSM', 'BM', 'CN', 'RDN', 'SDN', 'SVN', 'AEM'].includes(minerType)) return minerType.toLowerCase();

  return '';
};

export default function RegisterPage({ products }: { products: Product[] }) {
  const router = useRouter();
  type NextRoute = Parameters<typeof router.push>[0];
  const [displayedHex, setDisplayedHex] = useState<string | null>(null);
  const [displayedHexRes, setDisplayedHexRes] = useState<number | null>(null);
  const [currentSection, setCurrentSection] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState(false);
  const [locationStatus, setLocationStatus] = useState(false);
  const [walletStatus, setWalletStatus] = useState(false);
  const { minerKey, clickable, type } = router.query;
  const isEditingExisting = useMemo(() => {
    if (typeof clickable === 'string') {
      const normalized = clickable.toLowerCase();
      return normalized === 'true' || normalized === '1';
    }

    if (Array.isArray(clickable)) {
      return clickable.some((value) => {
        if (typeof value !== 'string') return false;
        const normalized = value.toLowerCase();
        return normalized === 'true' || normalized === '1';
      });
    }
    return Boolean(clickable);
  }, [clickable]);
  const hasFetchedRef = useRef(false);
  const savingRef = useRef(false);
  const lastAttemptRef = useRef<string | null>(null);
  const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();
  const resolvedMinerKey = useMemo(() => {
    if (typeof minerKey === 'string') return minerKey;
    if (Array.isArray(minerKey) && minerKey.length > 0) return minerKey[0];
    return undefined;
  }, [minerKey]);

  // Note: we derive any explicit `type` query inside effectivePortalKey below.
  const [device, setDevice] = useState<Device | undefined>(undefined);
  const [product, setProduct] = useState<Product | undefined>(undefined);
  const toast = useToastContext();
  const { data: session } = useSession();

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // credentials state kept in memory until final submit
  const [selectedSubtype, setSelectedSubtype] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [credentialsValidated, setCredentialsValidated] = useState(false);

  // Check if credentials are needed based on env variable
  const credentialsNotNeeded = useMemo(() => {
    const credentialsNeeded = process.env.NEXT_PUBLIC_CREDENTIALS_NEEDED;
    if (!credentialsNeeded || !resolvedMinerKey) return true; // Default to not needing creds if env not set
    
    const deviceTypes = credentialsNeeded.split(',').map(type => type.trim().toUpperCase());
    const minerType = resolvedMinerKey.split('-')[0]?.toUpperCase();
    
    return !deviceTypes.includes(minerType); // Invert: true if NOT in the list
  }, [resolvedMinerKey]);

  // Auto-set credentialsValidated when credentials aren't needed
  useEffect(() => {
    if (credentialsNotNeeded) {
      setCredentialsValidated(true);
    }
  }, [credentialsNotNeeded]);

  function validateField(
    key: string,
    value: string,
    currentSubtype: string | null
  ): string | null {
  
    const sub = (currentSubtype || '').toLowerCase();

    // 1) Subtype-specific overrides take precedence
    const subRegex = REGEX_BY_SUBTYPE[sub]?.[key as SubtypeFieldKey];
    if (subRegex) {
      if (!value) return 'This field is required';
      if (!subRegex.test(value)) {
        return (HINTS_BY_SUBTYPE[sub]?.[key as SubtypeFieldKey]) || FIELD_HINT[key] || 'Invalid value';
        }
      return null;
    }

    // 2) Fall back to global rules
    const regex = FIELD_REGEX[key];
    if (!regex) return null; // no specific regex; treat as OK
    if (!value) return 'This field is required';
    if (!regex.test(value)) return FIELD_HINT[key] || 'Invalid value';
    return null;
  }

  // subtype-aware constraints for HTML attributes
  function getSubtypeConstraints(
    field: string,
    currentSubtype: string | null
  ): { pattern?: string; maxLength?: number; placeholder?: string } {

    const sub = (currentSubtype || '').toLowerCase();
    const rx = REGEX_BY_SUBTYPE[sub]?.[field as SubtypeFieldKey];
    if (!rx) return {};

    const src = rx.source.replace(/^\^/, '').replace(/\$$/, '');
    let maxLength: number | undefined;
    const exactLen = src.match(/\{(\d+)\}$/);

    if (exactLen) maxLength = parseInt(exactLen[1], 10);

    const placeholder = (HINTS_BY_SUBTYPE[sub]?.[field as SubtypeFieldKey]) || FIELD_HINT[field];
    return { pattern: src, maxLength, placeholder };
  }

  // update + validate a single credential field (with masks)
  function setCredAndValidate(k: string, v: string) {
    let value = v || '';

    if (k === 'mac_address') {
      value = formatMacWithColons(value);
    } else if (k === 'imei') {
      value = sanitizeImei(value);
    } else if (k === 'rtsp_url' || k === 'serverUrl') {
      value = value.trim();
    }

    setCredentials((prev) => ({ ...prev, [k]: value }));
    const err = validateField(k, value, selectedSubtype);
    setFieldErrors((prev) => ({ ...prev, [k]: err ?? '' }));

  }

  function validateCredentialsGroup(keys: string[]): string[] {
    const missingOrBad: string[] = [];
    const nextErrors: Record<string, string> = { ...fieldErrors };
    for (const k of keys) {
      const v = credentials[k] ?? '';
      const err = validateField(k, v, selectedSubtype);
      nextErrors[k] = err ?? '';
      if (err) missingOrBad.push(k);
    }

    setFieldErrors(nextErrors);
    return missingOrBad;
  }

  // use module-level helpers: portalKeyFromMiner, PORTAL_DISPLAY_NAMES, FIELD_LABELS, PORTAL_SUBTYPES
  const effectivePortalKey = useMemo(() => {
    if (device?.registered_portal_model) return device.registered_portal_model;

    // derive explicit `type` query (if any) and map to a portal key
    const queryType = typeof type === 'string' ? type : Array.isArray(type) && type.length > 0 ? type[0] : null;
    if (queryType) {
      const t = String(queryType).toLowerCase();
      if (PORTAL_SUBTYPES[t]) return t;
      for (const [portalKey, subtypeList] of Object.entries(PORTAL_SUBTYPES)) {
        if (subtypeList.some((s) => String(s.id).toLowerCase() === t)) {
          return portalKey;
        }
      }
    }

    const derived = portalKeyFromMiner(resolvedMinerKey);
    return derived || '';
  }, [device?.registered_portal_model, type, resolvedMinerKey]);

  const displayPortalTitle = useMemo(() => {
    return PORTAL_DISPLAY_NAMES[effectivePortalKey] ?? (effectivePortalKey ? `${effectivePortalKey[0].toUpperCase()}${effectivePortalKey.slice(1)} Portal` : null);
  }, [effectivePortalKey]);

  useEffect(() => {
    if (!resolvedMinerKey || !session?.user?.address) return;

    hasFetchedRef.current = false; // reset when identity changes
    (async () => {
      try {
        const res = await fetch(`/api/devices/${resolvedMinerKey}`, {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ address: session.user.address }),
        });
        if (res.ok) {
          const data = await res.json();
          setDevice(data.device as Device);
        } else {
          setDevice(undefined);
        }
      } catch (e) {
        console.error(e);
        setDevice(undefined);
      } finally {
        hasFetchedRef.current = true; // <-- important
      }
    })();
  }, [resolvedMinerKey, session?.user?.address]);


  // Note: automatic portal-type sync removed. Portal type will be saved explicitly
  // by the final save/register flows (persistCredentials + save-portal-type calls).


  const findProduct = useCallback((minerKey: string) => {
    const key = minerKey.split('-')[0];
    const specificProduct = products.find((product) => product.key === key);
    return specificProduct;
  }, [products]);

  // State for each form's data
  const [personalInfoData, setPersonalInfoData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    nickname: '',
    reward_wallet: ''
  });

  const [mapInfoData, setMapInfoData] = useState({
    latitude: '',
    longitude: '',
    h3Index: '' // NEW: track selected hex
  });

  const [hexSynced, setHexSynced] = useState(false);
  const mapCenter = useMemo<[number, number]>(() => {
    const lat = mapInfoData?.latitude ? Number(mapInfoData.latitude) : 0;
    const lng = mapInfoData?.longitude ? Number(mapInfoData.longitude) : 0;
    return [lat, lng];
  }, [mapInfoData?.latitude, mapInfoData?.longitude]);
  const [existingCredentials, setExistingCredentials] = useState<{
    portal: string | null;
    collection: string | null;
    api_type: string | null;
    credentials: Record<string, string>
  } | null>(null);
  const [credentialsPrefilled, setCredentialsPrefilled] = useState(false);
  const [credentialActionLoading, setCredentialActionLoading] = useState(false);
  const [loadingStoredCredentials, setLoadingStoredCredentials] = useState(false);
  // Track whether credentials were just updated (to show Save & Exit)
  const [credentialsJustUpdated, setCredentialsJustUpdated] = useState(false);

  // derive available portal subtype options for the query `type` (if present) or product
  const availableSubtypes = useMemo(() => {
    const queryType = typeof type === 'string' ? type : Array.isArray(type) && type.length > 0 ? type[0] : null;
    const key = effectivePortalKey || queryType || '';
    const normalized = String(key).toLowerCase();
    const options = PORTAL_SUBTYPES[normalized] ?? [];
    if (['node', 'aem', 'hardware'].includes(normalized)) {
      return options.filter((option) => option.id !== 'mac');
    }
    return options;
  }, [effectivePortalKey, type]);

  // Determine if current form values differ from stored existing credentials
  const credentialsChanged = useMemo(() => {
    if (!existingCredentials) return true;
    if (!selectedSubtype) return true;
    const match = availableSubtypes.find((s) => s.id === selectedSubtype);
    const keys = (match?.sub_types ?? []).slice();
    if (!keys.length) return true;
    return keys.some((k) => (credentials[k] ?? '') !== (existingCredentials.credentials[k] ?? ''));
  }, [credentials, existingCredentials, selectedSubtype, availableSubtypes]);

  // If user edits credentials after an update, clear the "just updated" flag
  useEffect(() => {
    if (credentialsJustUpdated) setCredentialsJustUpdated(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials]);

  useEffect(() => {
  if (device === undefined || !session || !session.user) {
    return;
  }

  setProduct(findProduct(device.miner_key));

  if (clickable) {
    setPersonalInfoData({
      email: (device as any).email ?? '',
      firstName: device.names?.first_name ?? '',
      lastName: device.names?.last_name ?? '',
      nickname: device.nickname ?? '',
      reward_wallet: (device as any).reward_wallet ?? ''
    });

    setMapInfoData({
      latitude: device.position?.lat?.toString?.() ?? '',
      longitude: device.position?.lng?.toString?.() ?? '',
      h3Index:
        device.position?.lat && device.position?.lng
          ? h3.latLngToCell(Number(device.position.lat), Number(device.position.lng), 9)
          : ''
    });

    setHexSynced(device.position?.lat != null && device.position?.lng != null);
    setDeviceStatus(true);
    setWalletStatus(true);
    setLocationStatus(true);
  } else {

    setPersonalInfoData({
      email: (session.user as any).email ?? '',
      firstName: (session.user as any).first_name ?? '',
      lastName: (session.user as any).last_name ?? '',
      nickname: '',
      reward_wallet: ''
    });
    setHexSynced(false);
  }
}, [device, session, clickable, findProduct]);
  
  useEffect(() => {
    if (!isEditingExisting || !resolvedMinerKey || !session?.user?.address) {
      setExistingCredentials(null);
      setCredentialsPrefilled(false);
      setLoadingStoredCredentials(false);
      return;
    }
    let cancelled = false;
    setLoadingStoredCredentials(true);

    (async () => {
      try {
        const res = await fetch('/api/credentials/get', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ miner_key: resolvedMinerKey }),
        });

        if (cancelled) return;

        if (res.status === 404) {
          setExistingCredentials(null);
          setCredentialsValidated(false);
          setLoadingStoredCredentials(false);
          return;
        }

        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok) {
          console.error('Failed to load stored credentials', data);
          setExistingCredentials(null);
          setCredentialsValidated(false);
          return;
        }

        setCredentialsPrefilled(false);
        setExistingCredentials({
          portal: data.portal ?? null,
          collection: data.collection ?? null,
          api_type: data.api_type ?? null,
          credentials: data.credentials ?? {},
        });
        setFieldErrors((prev) => ({ ...prev, ...(Object.keys(data.credentials ?? {}).reduce((acc: Record<string, string>, key: string) => { acc[key] = ''; return acc; }, {} as Record<string, string>)) }));
        setCredentialsValidated(true);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load stored credentials', err);
          setExistingCredentials(null);
          setCredentialsValidated(false);
        }
      } finally {
        if (!cancelled) {
          setLoadingStoredCredentials(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEditingExisting, resolvedMinerKey, session?.user?.address]);

  useEffect(() => {
    if (!existingCredentials || credentialsPrefilled) return;

    const saved = existingCredentials.credentials ?? {};
    const apiType = existingCredentials.api_type;

    // Try to find a matching subtype. Prefer the explicit api_type if present.
    let match = null as (typeof availableSubtypes[number]) | null;
    if (apiType) {
      match = availableSubtypes.find((s) => s.id === apiType) ?? null;
    } else {
      // No explicit api_type saved — attempt to infer by comparing saved credential keys
      // to each subtype's required keys. Prefer the first subtype where all keys exist
      // (and are non-empty). If none match but there's exactly one available subtype,
      // pick that as a reasonable fallback.
      for (const s of availableSubtypes) {
        const keys = s.sub_types ?? [];
        if (!keys.length) continue;
        const allPresent = keys.every((k) => saved[k] !== undefined && saved[k] !== '');
        if (allPresent) {
          match = s;
          break;
        }
      }
      if (!match && availableSubtypes.length === 1) {
        match = availableSubtypes[0];
      }
    }

    if (!match) return;

    setSelectedSubtype(match.id);
    setCredentials((prev) => {
      const next = { ...prev };
      (match!.sub_types ?? []).forEach((key: string) => {
        next[key] = saved[key] ?? '';
      });
      return next;
    });
    setCredentialsPrefilled(true);
  }, [existingCredentials, availableSubtypes, credentialsPrefilled]);

const sections = [
    { id: 0, title: 'Credentials' },
    { id: 1, title: 'Personal Information' },
    { id: 2, title: 'Localization' }
  ];

  // Auto-select when there is exactly one subtype
  useEffect(() => {
    if (availableSubtypes.length === 1 && !selectedSubtype) {
      setSelectedSubtype(availableSubtypes[0].id);
      const nextCreds: Record<string, string> = {};
      (availableSubtypes[0].sub_types ?? []).forEach((k) => (nextCreds[k] = credentials[k] ?? ''));
      setCredentials((prev) => ({ ...prev, ...nextCreds }));
    }
  }, [availableSubtypes, credentials, selectedSubtype]);

  // SwitchBot discovery state
  const [switchbotDevices, setSwitchbotDevices] = useState<Array<{ deviceId: string; deviceName: string; deviceType?: string }>>([]);
  const [switchbotLoading, setSwitchbotLoading] = useState(false);
  const [switchbotError, setSwitchbotError] = useState<string | null>(null);

  // Shelly device discovery states
  const [shellyDevices, setShellyDevices] = useState<Array<{ deviceId: string; deviceName: string; deviceType?: string }>>([]);
  const [shellyLoading, setShellyLoading] = useState(false);
  const [shellyError, setShellyError] = useState<string | null>(null);

  const submitCredentials = async (options: { suppressToast?: boolean } = {}): Promise<boolean> => {
    if (!resolvedMinerKey || !session?.user.address) {
      toast.error({ heading: 'Error', message: 'Missing miner key or session.' });
      return false;
    }

    if (!selectedSubtype) {
      toast.error({ heading: 'Error', message: 'Please select a device subtype.' });
      return false;
    }

    // Get the validator for this device type
    const validator = deviceValidatorRegistry.getValidator(selectedSubtype);
    if (!validator) {
      // Fallback to original validation for unsupported device types
      const needed = (availableSubtypes.find((s) => s.id === selectedSubtype)?.sub_types ?? []);
      const bad = validateCredentialsGroup(needed);

      if (bad.length > 0) {
        toast.error({ heading: 'Error', message: `Fix invalid fields: ${bad.join(', ')}` });
        return false;
      }

      try {
        const res = await fetch('/api/credentials/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ miner_key: resolvedMinerKey, api_type: selectedSubtype, credentials })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setCredentialsValidated(false);
          toast.error({ heading: 'Error', message: data.message ?? 'Credentials validation failed' });
          return false;
        }

        setCredentialsValidated(true);
        if (!options.suppressToast) {
          toast.success({ heading: 'Success', message: data.message ?? 'Credentials validated successfully.' });
        }
        return true;
      } catch (error) {
        setCredentialsValidated(false);
        console.error(error);
        toast.error({ heading: 'Error', message: 'Failed to validate credentials' });
        return false;
      }
    }

    // Use the new validator system
    try {
      const validationContext = {
        session,
        minerKey: resolvedMinerKey,
        currentDeviceId: credentials['deviceId']
      };

      const result = await validator.validateCredentials(credentials, validationContext);
      
      if (!result.success) {
        setCredentialsValidated(false);
        // Handle device-specific error states
        if (selectedSubtype.toLowerCase() === 'switchbot') {
          setSwitchbotError(result.error || 'Validation failed');
        }
        if (selectedSubtype.toLowerCase() === 'shelly') {
          setShellyError(result.error || 'Validation failed');
        }
        if (!options.suppressToast) {
          toast.error({ heading: 'Error', message: result.error || 'Credentials validation failed' });
        }
        return false;
      }

      // Validation successful
      setCredentialsValidated(true);
      
      // Handle device-specific success states
      if (selectedSubtype.toLowerCase() === 'switchbot') {
        setSwitchbotError(null);
        if (result.devices) {
          setSwitchbotDevices(result.devices.map(d => ({
            deviceId: d.deviceId,
            deviceName: d.deviceName,
            deviceType: d.deviceType
          })));
        }
      }
      if (selectedSubtype.toLowerCase() === 'shelly') {
        setShellyError(null);
        if (result.devices) {
          setShellyDevices(result.devices.map(d => ({
            deviceId: d.deviceId,
            deviceName: d.deviceName,
            deviceType: d.deviceType
          })));
        }
      }

      if (!options.suppressToast) {
        toast.success({ 
          heading: 'Success', 
          message: result.devices?.length 
            ? `Found ${result.devices.length} device(s)` 
            : 'Credentials validated successfully.' 
        });
      }
      
      return true;
    } catch (error: any) {
      setCredentialsValidated(false);
      console.error(error);
      
      // Handle device-specific error states
      if (selectedSubtype.toLowerCase() === 'switchbot') {
        setSwitchbotError(error?.message || 'Validation failed');
      }
      if (selectedSubtype.toLowerCase() === 'shelly') {
        setShellyError(error?.message || 'Validation failed');
      }
      
      if (!options.suppressToast) {
        toast.error({ heading: 'Error', message: error?.message || 'Failed to validate credentials' });
      }
      return false;
    }
  };

  // helper to return keys for the currently selected credential subtype
  const activeCredentialKeys = useCallback((): string[] => {
    if (!selectedSubtype) return [];
    const match = availableSubtypes.find((s) => s.id === selectedSubtype);
    return (match?.sub_types ?? []).slice();
  }, [availableSubtypes, selectedSubtype]);

  const buildCredentialPayload = useCallback(() => {
    const keys = activeCredentialKeys();
    if (!keys.length) {
      return credentials;
    }
    const payload: Record<string, string> = {};
    keys.forEach((key) => {
      payload[key] = credentials[key] ?? '';
    });
    return payload;
  }, [activeCredentialKeys, credentials]);

  const persistCredentials = useCallback(async (): Promise<{ ok: boolean; collection?: string | null }> => {
    if (!credentialsValidated || !session?.user.address || !resolvedMinerKey) {
      return { ok: false };
    }
    try {
      const queryType = typeof type === 'string' ? type : Array.isArray(type) && type.length > 0 ? type[0] : null;
      const res = await fetch('/api/devices/save-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          miner_key: resolvedMinerKey,
          portal: effectivePortalKey ?? queryType ?? null,
          credentials: buildCredentialPayload(),
          api_type: selectedSubtype,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('Failed to persist credentials', data);
        return { ok: false };
      }
      return { ok: true, collection: data.collection ?? null };
    } catch (err) {
      console.error('Failed to persist credentials', err);
      return { ok: false };
    }
  }, [buildCredentialPayload, credentialsValidated, effectivePortalKey, type, resolvedMinerKey, selectedSubtype, session?.user?.address]);

  const handleCredentialUpdate = async () => {
    if (!selectedSubtype) {
      toast.error({ heading: 'Error', message: 'Select a subtype before updating credentials.' });
      return;
    }
    setCredentialActionLoading(true);
    try {
      const ok = await submitCredentials({ suppressToast: true });
      if (!ok) return;
      const result = await persistCredentials();
      if (!result.ok) {
        toast.error({ heading: 'Error', message: 'Failed to save credentials' });
        return;
      }
      const keys = activeCredentialKeys();
      const stored: Record<string, string> = {};
      keys.forEach((key) => {
        stored[key] = credentials[key] ?? '';
      });
      setExistingCredentials({
        portal: effectivePortalKey ?? (typeof type === 'string' ? type : Array.isArray(type) && type.length > 0 ? type[0] : existingCredentials?.portal ?? null) ?? null,
        collection: result.collection ?? existingCredentials?.collection ?? null,
        api_type: selectedSubtype,
        credentials: stored,
      });
      setCredentialsPrefilled(true);
  toast.success({ heading: 'Success', message: 'Credentials updated.' });
  setCredentialsJustUpdated(true);
    } catch (err) {
      console.error('Failed to update credentials', err);
      toast.error({ heading: 'Error', message: 'Failed to save credentials' });
    } finally {
      setCredentialActionLoading(false);
    }
  };

  // Validate, persist credentials and then navigate back to devices
  const handleUpdateAndExit = async () => {
    if (!selectedSubtype) {
      toast.error({ heading: 'Error', message: 'Select a subtype before updating credentials.' });
      return;
    }
    setCredentialActionLoading(true);
    try {
      const ok = await submitCredentials({ suppressToast: true });
      if (!ok) return;
      const result = await persistCredentials();
      if (!result.ok) {
        toast.error({ heading: 'Error', message: 'Failed to save credentials' });
        return;
      }
      const keys = activeCredentialKeys();
      const stored: Record<string, string> = {};
      keys.forEach((key) => {
        stored[key] = credentials[key] ?? '';
      });
      setExistingCredentials({
        portal: effectivePortalKey ?? (typeof type === 'string' ? type : Array.isArray(type) && type.length > 0 ? type[0] : existingCredentials?.portal ?? null) ?? null,
        collection: result.collection ?? existingCredentials?.collection ?? null,
        api_type: selectedSubtype,
        credentials: stored,
      });
      setCredentialsPrefilled(true);
  toast.success({ heading: 'Success', message: 'Credentials updated.' });
  setCredentialsJustUpdated(true);
      // After successful save, return to devices list
      router.push('/devices');
    } catch (err) {
      console.error('Failed to update credentials', err);
      toast.error({ heading: 'Error', message: 'Failed to save credentials' });
    } finally {
      setCredentialActionLoading(false);
    }
  };

  const handleCredentialUnlink = async () => {
    if (!resolvedMinerKey) return;
    const keysToClear = activeCredentialKeys();
    setCredentialActionLoading(true);
    try {
      const res = await fetch('/api/credentials/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ miner_key: resolvedMinerKey, portal: existingCredentials?.collection ?? existingCredentials?.portal ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error({ heading: 'Error', message: data.message ?? 'Failed to unlink credentials' });
        return;
      }
      toast.success({ heading: 'Success', message: data.message ?? 'Credentials unlinked.' });
      setExistingCredentials(null);
      setCredentialsPrefilled(false);
      setCredentials({});
      setSelectedSubtype(null);
      setCredentialsValidated(false);
      setFieldErrors((prev) => {
        if (!keysToClear.length) return prev;
        const next = { ...prev };
        keysToClear.forEach((key) => {
          if (key in next) {
            delete next[key];
          }
        });
        return next;
      });
    } catch (err) {
      console.error('Failed to unlink credentials', err);
      toast.error({ heading: 'Error', message: 'Failed to unlink credentials' });
    } finally {
      setCredentialActionLoading(false);
    }
  };

const savePersonalInformation = async (): Promise<boolean> => {

  const pi = {
    email: (personalInfoData.email ?? '').trim(),
    firstName: (personalInfoData.firstName ?? '').trim(),
    lastName: (personalInfoData.lastName ?? '').trim(),
    nickname: (personalInfoData.nickname ?? '').trim(),
    reward_wallet: (personalInfoData.reward_wallet ?? '').trim(),
  };

  const errs: Record<string,string> = {};
  errs.email = validateField('email', pi.email, null) || '';
  errs.firstName = validateField('firstName', pi.firstName, null) || '';
  errs.lastName = validateField('lastName', pi.lastName, null) || '';

  if (pi.nickname) errs.nickname = validateField('nickname', pi.nickname, null) || '';
  if (pi.reward_wallet) errs.reward_wallet = validateField('reward_wallet', pi.reward_wallet, null) || '';

  setFieldErrors((prev) => ({ ...prev, ...errs }));
  if (Object.values(errs).some(Boolean)) {
    toast.error({ heading: 'Error', message: 'Please fix Personal Information fields.' });
    return false;
  }

  if (!resolvedMinerKey) {
    toast.error({ heading: 'Error', message: 'Miner key is missing.' });
    return false;
  }

  if (!session?.user.address) {
    toast.error({ heading: 'Error', message: 'Your wallet session has expired.' });
    return false;
  }

  // Persist personal info into main.devices
  const resp1 = await fetch('/api/devices/save-device-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      miner_key: resolvedMinerKey,
      email: pi.email,
      names: { first_name: pi.firstName, last_name: pi.lastName },
      nickname: pi.nickname,
      address: session.user.address
    })
  });

  if (!resp1.ok) {
    toast.error({ heading: 'Error', message: 'Failed to save personal details' });
    return false;
  }

  // Persist reward wallet into main.devices
  const resp2 = await fetch('/api/devices/save-wallet-info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      miner_key: resolvedMinerKey,
      reward_wallet: pi.reward_wallet,
      address: session.user.address
    })
  });

  if (!resp2.ok) {
    toast.error({ heading: 'Error', message: 'Failed to save rewards wallet' });
    return false;
  }

  toast.success({ heading: 'Success', message: 'Personal Information saved' });
  return true;
};

  const saveMapInformation = async (): Promise<boolean> => {
    const m = mapInfoData;
    const mapErrs: Record<string, string> = {};
    mapErrs.latitude = validateField('latitude', m.latitude || '', null) || '';
    mapErrs.longitude = validateField('longitude', m.longitude || '', null) || '';
    setFieldErrors((prev) => ({ ...prev, ...mapErrs }));
    if (Object.values(mapErrs).some((v) => !!v)) {
      toast.error({ heading: 'Error', message: 'Please enter a valid latitude/longitude.' });
      return false;
    }

    if (!resolvedMinerKey) {
      toast.error({ heading: 'Error', message: 'Miner key is missing.' });
      return false;
    }

    if (!session?.user.address) {
      toast.error({ heading: 'Error', message: 'Your wallet session has expired.' });
      return false;
    }

    try {
      const saveData = {
        miner_key: resolvedMinerKey,
        position: {
          lat: mapInfoData.latitude,
          lng: mapInfoData.longitude
        },
        address: session.user.address
      };

      const response = await fetch('/api/devices/save-map-info', {
        method: 'POST',
        body: JSON.stringify(saveData),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      if (response.ok) {
        toast.success({ heading: 'Success', message: 'Save map information successfully' });
        return true;
      }

      toast.error({ heading: 'Error', message: 'Failed to save map information' });
      return false;
    } catch (error) {
      toast.error({ heading: 'Error', message: 'Failed to save map information' });
      return false;
    }
  };

  const evaluatePostRegistrationRoute = useCallback((): NextRoute => {
    const productMinerKey = device?.miner_key ?? resolvedMinerKey;
    const haveProducts = Array.isArray(products) && products.length > 0;
    const product =
      haveProducts && productMinerKey
        ? findProductByMinerKey(productMinerKey, products)
        : undefined;
    const registrationNeeded = product ? isRegistrationNeeded(product) : null;
    const nodeStakingNeeded = product ? isNodeStakingNeeded(product) : null;

    return (
      product && (registrationNeeded || nodeStakingNeeded)
        ? { pathname: '/pay-register', query: { minerKey: resolvedMinerKey } }
        : '/devices'
    );
  }, [device?.miner_key, resolvedMinerKey, products]);

  // Update registerDevice to use the new personal+localization flow
  const registerDevice = async () => {
    if (!resolvedMinerKey) {
      toast.error({ heading: 'Error', message: 'Miner key is missing.' });
      return;
    }

    // Save personal first, then localization
    const stepsSucceeded =
      (await savePersonalInformation()) &&
      (await saveMapInformation());

    if (!stepsSucceeded) return;

    // Registration step + persist credentials (same as before)
    if (!clickable) {
      if (!session?.user.address) {
        toast.error({ heading: 'Error', message: 'Your wallet session has expired.' });
        return;
      }

      // Persist credentials first. Only mark device as registered after all saves succeed.
      const persistResult = await persistCredentials();
      if (persistResult.ok && selectedSubtype) {
        const keys = activeCredentialKeys();
        const stored: Record<string, string> = {};
        keys.forEach((key) => {
          stored[key] = credentials[key] ?? '';
        });
        setExistingCredentials({
    portal: effectivePortalKey ?? (typeof type === 'string' ? type : Array.isArray(type) && type.length > 0 ? type[0] : existingCredentials?.portal ?? null) ?? null,
          collection: persistResult.collection ?? existingCredentials?.collection ?? null,
          api_type: selectedSubtype,
          credentials: stored,
        });

        // Now that credentials were persisted, call the registration endpoint to flip is_registered
        try {
          const response = await fetch('/api/registrations/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ miner_key: resolvedMinerKey, address: session.user.address, type: (typeof type === 'string' ? type : Array.isArray(type) && type.length > 0 ? type[0] : null) })
          });
          if (!response.ok) {
            const j = await response.json().catch(() => ({}));
            console.error('Registration endpoint failed after save:', j);
            toast.error({ heading: 'Warning', message: 'Credentials saved but failed to finalize registration.' });
          }
        } catch (e) {
          console.error('Failed to call registration endpoint after save', e);
          toast.error({ heading: 'Warning', message: 'Credentials saved but failed to finalize registration.' });
        }
      }
        // Ensure registered_portal_model is set immediately when registering
      try {
  // choose portal type to save: prefer explicit query `type`, fall back to effectivePortalKey
  const queryType = typeof type === 'string' ? type : Array.isArray(type) && type.length > 0 ? type[0] : null;
  const portalToSave = queryType ?? effectivePortalKey ?? null;
        if (portalToSave && resolvedMinerKey && session?.user?.address) {
          const sp = await fetch(`/api/devices/save-portal-type`, {
            method: 'POST',
            headers: { 'Content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              miner_key: resolvedMinerKey,
              type: String(portalToSave).toLowerCase(),
              address: session.user.address,
            }),
          });
          if (sp.ok) {
            const d = await sp.json().catch(() => ({}));
            if (d.device) setDevice(d.device as Device);
          }
        }
      } catch (e) {
        console.error('Failed to save portal type after register', e);
      }
    }

    router.push(evaluatePostRegistrationRoute());
  };

  const handleSyncHexOrSave = async () => {
    // If not synced yet: validate lat/lon, compute res7 H3, update state and let HexMap fit to it
    if (!hexSynced) {
      const latitude = (mapInfoData.latitude ?? '').trim();
      const longitude = (mapInfoData.longitude ?? '').trim();

      const latError = validateField('latitude', latitude, null) || '';
      const lonError = validateField('longitude', longitude, null) || '';
      setFieldErrors((prev) => ({ ...prev, latitude: latError, longitude: lonError }));

      if (!latError && !lonError && latitude && longitude) {
        const parsedLat = Number(latitude);
        const parsedLng = Number(longitude);

        if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
          setFieldErrors((prev) => ({ ...prev, latitude: 'Invalid number', longitude: 'Invalid number' }));
          return;
        }

        if (displayedHexRes == null) {
          toast.error({ heading: 'Map', message: 'Zoom the map first so we can match the active resolution.' });
          return;
        }

        const idx = h3.latLngToCell(parsedLat, parsedLng, displayedHexRes);
        setMapInfoData((p: any) => ({ ...p, h3Index: idx }));

        // Mark synced so UI switches to "Save"
        setHexSynced(true);

        // Update displayed hex state (UI badge)
        if (typeof setDisplayedHex === 'function') setDisplayedHex(idx);
        if (typeof setDisplayedHexRes === 'function') setDisplayedHexRes(displayedHexRes);

        // At this point HexMap (which watches selectedCell / mapInfoData.h3Index) should FitBounds the hex
        return;
      }

      // validation failed -> bail out, errors already set
      return;
    }

    // If already synced: perform the actual save action
    try {
      // First save personal information (nickname, reward wallet)
      const personalSaved = await savePersonalInformation();
      if (!personalSaved) {
        // savePersonalInformation shows its own toast, so just return
        return;
      }

      // Then save map information
      const mapSaved = await saveMapInformation();
      if (!mapSaved) {
        // saveMapInformation shows its own toast, so just return
        return;
      }

      // Then persist credentials (if any)
      const persistResult = await persistCredentials();
      if (!persistResult.ok) {
        toast.error({ heading: 'Error', message: 'Failed to persist credentials.' });
        return;
      }

      toast.success({ heading: 'Success', message: 'Location and credentials saved.' });

      // Ensure portal type is saved immediately as well
      try {
        const queryType = typeof type === 'string' ? type : Array.isArray(type) && type.length > 0 ? type[0] : null;
        const portalToSave = queryType ?? effectivePortalKey ?? null;
        if (portalToSave && resolvedMinerKey && session?.user?.address) {
          const sp = await fetch(`/api/devices/save-portal-type`, {
            method: 'POST',
            headers: { 'Content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              miner_key: resolvedMinerKey,
              type: String(portalToSave).toLowerCase(),
              address: session.user.address,
            }),
          });
          if (sp.ok) {
            const d = await sp.json().catch(() => ({}));
            if (d.device) setDevice(d.device as Device);
          }
        }
      } catch (e) {
        console.error('Failed to save portal type after handleSyncHexOrSave', e);
      }

      // After a successful save, attempt to mark device registered and then navigate back to devices
      try {
        if (resolvedMinerKey && session?.user?.address) {
          const r = await fetch('/api/registrations/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ miner_key: resolvedMinerKey, address: session.user.address, type: (typeof type === 'string' ? type : Array.isArray(type) && type.length > 0 ? type[0] : null) })
          });
          if (!r.ok) {
            const j = await r.json().catch(() => ({}));
            console.error('Registration endpoint failed after save:', j);
            toast.error({ heading: 'Warning', message: 'Saved but failed to finalize registration.' });
          }
        }
      } catch (e) {
        console.error('Failed to call registration endpoint after save', e);
        toast.error({ heading: 'Warning', message: 'Saved but failed to finalize registration.' });
      }

      router.push(evaluatePostRegistrationRoute());
      return;
    } catch (err: any) {
      console.error('Failed to save location/credentials', err);
      toast.error({ heading: 'Error', message: 'Failed to save location/credentials' });
    }
  };

  // Update handleNext to reflect new steps
  const handleNext = () => {

    switch (currentSection) {
      case 1: // leaving Personal Information
        setDeviceStatus(true);
        setWalletStatus(true); // keep Sidebar completion consistent
        break;
      default:
        break;
    }

    if (currentSection < sections.length - 1) {
      setCurrentSection((prev) => prev + 1);
    } else {
      registerDevice();
    }
  };

  const handleCancel = async () => {
    const isFullyRegistered = device?.is_registered === true || isEditingExisting;
    if (!isFullyRegistered && resolvedMinerKey && session?.user.address) {
      try {
        await fetch('/api/registrations/cancel', {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            miner_key: resolvedMinerKey,
            address: session.user.address
          })
        });
      } catch (e) {
        // swallow cancel errors
      }
    }
    router.push('/devices');
  };

  const handleSkip = () => {
    if (isEditingExisting) {
      handleCancel();
      return;
    }

    if (currentSection > 0) {
      setCurrentSection((prev) => prev - 1);
    } else {
      router.push('/devices');
    }
  };

  const handleRewardWalletPaste = () => {
    const walletAddress = (session as any)?.user?.address;
    if (!walletAddress) {
      return;
    }
    setPersonalInfoData((prev) => ({ ...prev, reward_wallet: walletAddress }));
    setFieldErrors((prev) => ({ ...prev, reward_wallet: '' }));
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const subtypeLogoMap: Record<string, StaticImageData> = useMemo(
    () => ({
      airthings: airthingsLogo,
      ambient: ambientLogo,
      atmotube: atmotubeLogo,
      awair: awairLogo,
      ecowitt: ecowittLogo,
      gmcmap: gmcmapLogo,
      govee: goveeLogo,
      iopool: iopoolLogo,
      kaiterra: kaiterraLogo,
      lacrosse: lacrosseLogo,
      nrf: nrfLogo,
      pebble: pebbleLogo,
      purpleair: purpleairLogo,
      rtsp: RTSPLogo,
      sensecap: sensecapLogo,
      shelly: shellyLogo,
      switchbot: switchbotLogo,
      tapo: tapoLogo,
      tempest: tempestLogo,
      weatherxm: weatherxmLogo
    }),
    []
  );

  const currentSubtypeKeys = useMemo(
    () => (availableSubtypes.find((s) => s.id === selectedSubtype)?.sub_types ?? []),
    [availableSubtypes, selectedSubtype]
  );

  const selectedSubtypeLower = useMemo(() => norm(selectedSubtype), [selectedSubtype]);

  const credentialsInvalid = useMemo(() => {
    if (!selectedSubtype) return true;
    return currentSubtypeKeys.some((k) => !!validateField(k, credentials[k] ?? '', selectedSubtype));
  }, [selectedSubtype, currentSubtypeKeys, credentials]);

  const rewardWalletInvalid = useMemo(() => {
    const wallet = personalInfoData.reward_wallet ?? '';
    // Use validateField to reuse existing validation rules; key 'reward_wallet'
    const err = validateField('reward_wallet', wallet, null);
    return !!err;
  }, [personalInfoData.reward_wallet]);

  const switchbotPrereqsOk = useMemo(() => {
    if ((selectedSubtype || '').toLowerCase() !== 'switchbot') return true;
    const t = credentials['token'] ?? '';
    const s = credentials['secret'] ?? '';
    return !validateField('token', t, selectedSubtype) && !validateField('secret', s, selectedSubtype);
  }, [selectedSubtype, credentials]);

  const shellyPrereqsOk = useMemo(() => {
    if ((selectedSubtype || '').toLowerCase() !== 'shelly') return true;
    const authKey = credentials['auth_key'] ?? '';
    const serverUrl = credentials['serverUrl'] ?? '';
    return !validateField('auth_key', authKey, selectedSubtype) && !validateField('serverUrl', serverUrl, selectedSubtype);
  }, [selectedSubtype, credentials]);

    return (
    <div className="flex h-[calc(100vh-92px)] overflow-hidden">
      <style jsx global>{`
        .react-mapbox-ac-menu,
        .react-mapbox-ac-suggestion {
          color: #111 !important;
        }
        .react-mapbox-ac-suggestion:hover {
          color: #111 !important;
        }
      `}</style>

      <Sidebar
        completionStatus={{
          credentials: credentialsValidated,
          device: deviceStatus,
          wallet: walletStatus,
          map: locationStatus,
        }}
        isOpen={isSidebarOpen}
        toggleSidebar={toggleSidebar}
        setCurrentSection={setCurrentSection}
        currentSection={currentSection}
  portalTitle={displayPortalTitle ?? device?.registered_portal_model ?? (typeof type === 'string' ? type : Array.isArray(type) && type.length > 0 ? type[0] : null) ?? null}
      />
      {!isSidebarOpen && (
        <button
          onClick={toggleSidebar}
          className="fixed top-1/2 left-1 z-50 transform -translate-y-1/2 flex flex-col space-y-1 md:hidden"
        >
          <ChevronRightIcon className="h-6 w-6" />
        </button>
      )}

      <div className="relative w-full h-full overflow-hidden">
        <div
          className="flex h-full w-full transition-transform duration-700 ease-in-out"
          style={{ transform: `translateX(-${currentSection * 100}%)` }}
        >
          {/* Credentials / Portal intro page (index 0) */}
          <div className="flex-shrink-0 w-full h-full">
            <div className="flex h-full flex-col bg-gray-950 text-white p-4 sm:p-6 md:p-8">
              <SectionBanner
                image={bgImg}
                title={displayPortalTitle ?? ((typeof type === 'string' ? type : Array.isArray(type) && type.length > 0 ? type[0] : 'Portal'))}
                subtitle="Select the subtype and provide credentials. You can validate and save before continuing."
                height={160}
                darkOverlay={0.45}
              />
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left column */}
                <div className="lg:col-span-1">
                  <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 md:p-5">
                    <h3 className="font-semibold mb-3">Available Subtypes</h3>
                    {availableSubtypes.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {availableSubtypes.map((opt) => {
                          const isLockedSubtype = !!(existingCredentials?.api_type && existingCredentials.api_type !== opt.id);
                          const disabled = credentialActionLoading || loadingStoredCredentials || isLockedSubtype;
                          const normalizedId = opt.id.toLowerCase();
                          const logo = subtypeLogoMap[normalizedId];
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              disabled={disabled}
                              className={`group flex flex-col items-center justify-center rounded-xl border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
                                selectedSubtype === opt.id
                                  ? 'border-red-500 bg-red-600/10 shadow-md'
                                  : 'border-white/10 bg-gray-900/70 hover:border-red-400/70 hover:bg-gray-900'
                              } ${disabled ? 'opacity-50 cursor-not-allowed hover:border-white/10 hover:bg-gray-900/70' : ''}`}
                              onClick={() => {
                                if (disabled) return;
                                setSelectedSubtype(opt.id);
                                const nextCreds: Record<string, string> = {};
                                (opt.sub_types ?? []).forEach((k: string) => (nextCreds[k] = credentials[k] ?? ''));
                                setCredentials((prev) => ({ ...prev, ...nextCreds }));
                                if (normalizedId !== 'switchbot') {
                                  setSwitchbotDevices([]);
                                  setSwitchbotError(null);
                                }
                              }}
                            >
                             {logo ? (
                               <Image
                                 src={logo}
                                 alt={opt.name}
                                 className="h-14 w-auto object-contain transition group-hover:scale-105"
                                 width={96}
                                 height={56}
                               />
                             ) : (
                               <span className="px-3 py-2 text-sm font-medium text-gray-100">{opt.name}</span>
                             )}
                              {existingCredentials?.api_type === opt.id ? (
                                <span className="mt-2 text-[11px] text-red-200 text-center px-2">
                                  Linked to stored credentials
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-300">No subtypes available for this portal.</p>
                    )}
                    <div className="mt-4 text-xs text-gray-400 space-y-1">
                      <p>Your credentials are kept local until you complete registration.</p>
                      <p>Use the Validate button to check credentials before moving on.</p>
                    </div>
                  </div>
                </div>

                {/* Right column: credentials card */}
                <div className="lg:col-span-2">
                  <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 md:p-5">
                    {credentialsNotNeeded ? (
                      /* Temporary page for devices that don't need credentials */
                      <div className="text-center py-8">
                        <div className="mb-4">
                          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                            <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                          <h3 className="text-xl font-semibold text-white mb-2">No Credentials Required</h3>
                          <p className="text-gray-300 mb-4">
                            This device type ({resolvedMinerKey?.split('-')[0]}) doesn't require credentials configuration at this time.
                          </p>
                          <p className="text-sm text-gray-400">
                            You can proceed directly to the next step to complete your device registration.
                          </p>
                        </div>
                      </div>
                    ) : (
                      /* Original credentials form */
                      <>
                        {loadingStoredCredentials ? <p className="text-sm text-gray-400 mb-3">Loading stored credentials…</p> : null}
                        {existingCredentials?.api_type ? (
                          <p className="text-xs text-red-300 mb-2">
                            Stored credentials are linked to subtype{' '}
                            {availableSubtypes.find((s) => s.id === existingCredentials.api_type)?.name ?? existingCredentials.api_type}. Unlink to make changes.
                          </p>
                        ) : null}
                        {selectedSubtype ? (
                      <>
                        <h4 className="font-semibold mb-3">
                          {(selectedSubtype === 'mac' || selectedSubtype === 'node-mac')
                            ? "What is the MAC address of the device on which the software is installed?"
                            : `Credentials for ${selectedSubtype}`}
                        </h4>

                        {(availableSubtypes.find((s) => s.id === selectedSubtype)?.sub_types ?? ['key']).map((field: string) => {
                          if (field === 'deviceId' && selectedSubtypeLower === 'switchbot') return null;
                          if (field === 'deviceId' && selectedSubtypeLower === 'shelly') return null;
                          const value = credentials[field] ?? '';
                          const err = fieldErrors[field];
                          const hint = (HINTS_BY_SUBTYPE[(selectedSubtype || '').toLowerCase()]?.[field] as any) || FIELD_HINT[field];
                          const { pattern, maxLength, placeholder } = getSubtypeConstraints(field, selectedSubtype);
                          return (
                            <div key={field} className="mb-3">
                              <label className="block text-sm mb-1 text-gray-200">{FIELD_LABELS[field] ?? field}</label>
                              <input
                                disabled={credentialActionLoading || loadingStoredCredentials}
                                value={value}
                                onChange={(e) => setCredAndValidate(field, e.target.value)}
                                onBlur={(e) => setCredAndValidate(field, e.target.value)}
                                onPaste={(e) => {
                                  const pasted = e.clipboardData?.getData('text') || '';
                                  if (field === 'mac_address') {
                                    e.preventDefault();
                                    setCredAndValidate(
                                      field,
                                      (pasted || '')
                                        .replace(/[^A-Fa-f0-9]/g, '')
                                        .toUpperCase()
                                        .slice(0, 12)
                                        .match(/.{1,2}/g)
                                        ?.join(':') || ''
                                    );
                                  } else if (field === 'imei') {
                                    e.preventDefault();
                                    setCredAndValidate(field, (pasted || '').replace(/\D/g, '').slice(0, 15));
                                  }
                                }}
                                inputMode={field === 'imei' ? 'numeric' : undefined}
                                pattern={
                                  pattern ??
                                  (field === 'imei'
                                    ? '\\d{15}'
                                    : field === 'mac_address'
                                    ? '[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}'
                                    : undefined)
                                }
                                maxLength={
                                  maxLength ??
                                  (field === 'mac_address' ? 17 : field === 'imei' ? 15 : undefined)
                                }
                                placeholder={
                                  placeholder ??
                                  (field === 'mac_address' ? 'AA:BB:CC:DD:EE:FF' : field === 'imei' ? '15 digits' : undefined)
                                }
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                                className={`w-full p-2 rounded-xl bg-gray-900 text-white outline-none ring-1 disabled:cursor-not-allowed disabled:bg-gray-900/60 ${
                                  err ? 'ring-red-500' : 'ring-white/10 focus:ring-red-500/50'
                                }`}
                              />
                              {err ? <p className="mt-1 text-xs text-red-400">{err}</p> : hint ? <p className="mt-1 text-xs text-gray-400">{hint}</p> : null}
                            </div>
                          );
                        })}

                        {(selectedSubtype || '').toLowerCase() === 'switchbot' && (
                          <div className="mt-4">
                            <div className="flex flex-wrap gap-2 mb-2">
                              <button
                                className="px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 disabled:opacity-50"
                                disabled={switchbotLoading || !switchbotPrereqsOk}
                                onClick={async () => {
                                  setSwitchbotError(null);
                                  setSwitchbotDevices([]);
                                  setSwitchbotLoading(true);
                                  try {
                                    const validator = deviceValidatorRegistry.getValidator('switchbot');
                                    if (validator && validator.discoverDevices) {
                                      const validationContext = {
                                        session,
                                        minerKey: resolvedMinerKey,
                                        currentDeviceId: credentials['deviceId']
                                      };
                                      
                                      const result = await validator.discoverDevices(credentials, validationContext);
                                      
                                      if (!result.success) {
                                        setSwitchbotError(result.error ?? 'Failed to fetch SwitchBot devices');
                                        return;
                                      }
                                      
                                      if (result.devices && Array.isArray(result.devices)) {
                                        setSwitchbotDevices(result.devices.map(d => ({
                                          deviceId: d.deviceId,
                                          deviceName: d.deviceName,
                                          deviceType: d.deviceType
                                        })));
                                      } else {
                                        setSwitchbotError('No devices returned');
                                      }
                                    } else {
                                      // Fallback to validator-backed credentials/validate
                                      const res = await fetch('/api/credentials/validate', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        credentials: 'include',
                                        body: JSON.stringify({
                                          miner_key: resolvedMinerKey,
                                          api_type: 'switchbot',
                                          credentials: { token: credentials['token'], secret: credentials['secret'], deviceId: credentials['deviceId'] },
                                          portal_type: 'energy'
                                        }),
                                      });

                                      if (!res.ok) {
                                        const j = await res.json().catch(() => ({}));
                                        setSwitchbotError(j?.message ?? 'Failed to fetch SwitchBot devices');
                                        return;
                                      }

                                      const j = await res.json();
                                      if (Array.isArray(j.devices)) {
                                        setSwitchbotDevices(j.devices);
                                      } else {
                                        setSwitchbotError('No devices returned');
                                      }
                                    }
                                  } catch (err: any) {
                                    setSwitchbotError(err?.message ?? String(err));
                                  } finally {
                                    setSwitchbotLoading(false);
                                  }
                                }}
                              >
                                {switchbotLoading ? 'Discovering devices...' : 'Discover devices'}
                              </button>
                              <button
                                className="px-3 py-2 rounded-xl border border-gray-700 hover:bg-gray-800"
                                onClick={() => {
                                  setSwitchbotDevices([]);
                                  setSwitchbotError(null);
                                }}
                              >
                                Clear
                              </button>
                            </div>

                            {selectedSubtypeLower === 'switchbot' && (
                              <div className="mt-4 space-y-3">
                                {switchbotError && (
                                  <p className="text-xs text-red-400">{switchbotError}</p>
                                )}
                                {switchbotLoading && (
                                  <p className="text-xs text-gray-400">Discovering devices…</p>
                                )}
                                {!switchbotLoading && switchbotDevices.length === 0 && !switchbotError && (
                                  <p className="text-xs text-gray-400">
                                    Use “Discover devices” to pull available SwitchBot plugs linked to this token and secret.
                                  </p>
                                )}
                                {switchbotDevices.length > 0 && (
                                  <div>
                                    <h5 className="text-sm font-semibold text-gray-100 mb-2">
                                      Select the device you want to link
                                    </h5>
                                    <div className="relative">
                                      <select
                                        className="w-full appearance-none rounded-xl border border-white/10 bg-gray-900/70 px-3 py-2 pr-10 text-sm text-gray-100 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                                        value={credentials['deviceId'] ?? ''}
                                        onChange={(e) => {
                                          setSwitchbotError(null);
                                          setCredAndValidate('deviceId', e.target.value);
                                        }}
                                      >
                                        <option value="" disabled>
                                          Choose a device
                                        </option>
                                        {switchbotDevices.map((device) => (
                                          <option key={device.deviceId} value={device.deviceId}>
                                            {device.deviceName || device.deviceId} · {device.deviceType || 'Unknown type'}
                                          </option>
                                        ))}
                                      </select>
                                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">
                                        ▼
                                      </span>
                                    </div>
                                    <p className="mt-2 text-xs text-gray-400">
                                      Selected device ID: {credentials['deviceId'] ? credentials['deviceId'] : 'None'}
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {(selectedSubtype || '').toLowerCase() === 'shelly' && (
                          <div className="mt-4">
                            <div className="flex flex-wrap gap-2 mb-2">
                              <button
                                className="px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 disabled:opacity-50"
                                disabled={shellyLoading || !shellyPrereqsOk}
                                onClick={async () => {
                                  setShellyError(null);
                                  setShellyDevices([]);
                                  setShellyLoading(true);
                                  try {
                                    const validator = deviceValidatorRegistry.getValidator('shelly');
                                    if (validator && validator.discoverDevices) {
                                      const validationContext = {
                                        session,
                                        minerKey: resolvedMinerKey,
                                        currentDeviceId: credentials['deviceId']
                                      };
                                      
                                      const result = await validator.discoverDevices(credentials, validationContext);
                                      
                                      if (!result.success) {
                                        setShellyError(result.error ?? 'Failed to fetch Shelly devices');
                                        return;
                                      }
                                      
                                      if (result.devices && Array.isArray(result.devices)) {
                                        setShellyDevices(result.devices.map(d => ({
                                          deviceId: d.deviceId,
                                          deviceName: d.deviceName,
                                          deviceType: d.deviceType
                                        })));
                                      } else {
                                        setShellyError('No devices returned');
                                      }
                                    } else {
                                      // Fallback to original API call
                                      const res = await fetch('/api/energy/shelly-devices', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        credentials: 'include',
                                        body: JSON.stringify({
                                          authKey: credentials['auth_key'],
                                          serverURL: credentials['serverUrl'],
                                          address: session?.user?.address,
                                          miner_key: resolvedMinerKey,
                                        }),
                                      });

                                      if (!res.ok) {
                                        const j = await res.json().catch(() => ({}));
                                        setShellyError(j?.message ?? 'Failed to fetch Shelly devices');
                                        return;
                                      }

                                      const j = await res.json();
                                      if (Array.isArray(j.devices)) {
                                        setShellyDevices(j.devices);
                                      } else {
                                        setShellyError('No devices returned');
                                      }
                                    }
                                  } catch (err: any) {
                                    setShellyError(err?.message ?? String(err));
                                  } finally {
                                    setShellyLoading(false);
                                  }
                                }}
                              >
                                {shellyLoading ? 'Discovering devices...' : 'Discover devices'}
                              </button>
                              <button
                                className="px-3 py-2 rounded-xl border border-gray-700 hover:bg-gray-800"
                                onClick={() => {
                                  setShellyDevices([]);
                                  setShellyError(null);
                                }}
                              >
                                Clear
                              </button>
                            </div>

                            {selectedSubtypeLower === 'shelly' && (
                              <div className="mt-4 space-y-3">
                                {shellyError && (
                                  <p className="text-xs text-red-400">{shellyError}</p>
                                )}
                                {shellyLoading && (
                                  <p className="text-xs text-gray-400">Discovering devices…</p>
                                )}
                                {!shellyLoading && shellyDevices.length === 0 && !shellyError && (
                                  <p className="text-xs text-gray-400">
                                    Use &ldquo;Discover devices&rdquo; to pull available Shelly devices linked to this auth key and server URL.
                                  </p>
                                )}
                                {shellyDevices.length > 0 && (
                                  <div>
                                    <h5 className="text-sm font-semibold text-gray-100 mb-2">
                                      Select the device you want to link
                                    </h5>
                                    <div className="relative">
                                      <select
                                        className="w-full appearance-none rounded-xl border border-white/10 bg-gray-900/70 px-3 py-2 pr-10 text-sm text-gray-100 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/50"
                                        value={credentials['deviceId'] ?? ''}
                                        onChange={(e) => {
                                          setShellyError(null);
                                          setCredAndValidate('deviceId', e.target.value);
                                        }}
                                      >
                                        <option value="" disabled>
                                          Choose a device
                                        </option>
                                        {shellyDevices.map((device) => (
                                          <option key={device.deviceId} value={device.deviceId}>
                                            {device.deviceName || device.deviceId} · {device.deviceType || 'Unknown type'}
                                          </option>
                                        ))}
                                      </select>
                                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">
                                        ▼
                                      </span>
                                    </div>
                                    <p className="mt-2 text-xs text-gray-400">
                                      Selected device ID: {credentials['deviceId'] ? credentials['deviceId'] : 'None'}
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex gap-2 mt-5">
                          <button
                            type="button"
                            className="px-4 py-2 rounded-xl border border-gray-700 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={credentialActionLoading || loadingStoredCredentials || Boolean(existingCredentials)}
                            onClick={() => {
                              if (existingCredentials) return;
                              setSelectedSubtype(null);
                              setCredentialsPrefilled(false);
                              setSwitchbotDevices([]);
                              setSwitchbotError(null);
                              setShellyDevices([]);
                              setShellyError(null);
                              const keys = (availableSubtypes.find((s) => s.id === selectedSubtype)?.sub_types ?? []);
                              const cleared: Record<string, string> = {};
                              keys.forEach((k: string) => (cleared[k] = ''));
                              setFieldErrors((prev) => ({ ...prev, ...cleared }));
                              setCredentials((prev) => {
                                if (!keys.length) return prev;
                                const next = { ...prev };
                                keys.forEach((k) => {
                                  delete next[k];
                                });
                                return next;
                              });
                              setCredentialsValidated(false);
                            }}
                          >
                            Clear
                          </button>
                          {existingCredentials ? (
                            <>
                              <button
                                type="button"
                                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 border border-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={credentialActionLoading || loadingStoredCredentials || !selectedSubtype || !credentialsChanged}
                                onClick={handleCredentialUpdate}
                              >
                                Update
                              </button>
                              <button
                                type="button"
                                className="px-4 py-2 rounded-xl border border-gray-500 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={credentialActionLoading || loadingStoredCredentials}
                                onClick={handleCredentialUnlink}
                              >
                                Unlink
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 border border-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={credentialActionLoading || loadingStoredCredentials || credentialsInvalid}
                              onClick={async () => await submitCredentials()}
                            >
                              Validate
                            </button>
                          )}
                        </div>
                      </>
                        ) : (
                          <div className="text-sm text-gray-300">Choose a subtype on the left to enter credentials.</div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer nav for section 0 */}
              <div className="absolute bottom-4 right-4 flex gap-2 text-white">
                <button className="px-4 py-2 border border-gray-500 rounded hover:bg-gray-500" onClick={() => router.push('/devices')}>
                  Cancel
                </button>
                {credentialsJustUpdated && (
                  <button
                    className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 border border-red-500 disabled:opacity-50 disabled:cursor-not-allowed mr-2"
                    onClick={handleUpdateAndExit}
                  >
                    Save & Exit
                  </button>
                )}
                <button
                  className="px-4 py-2 border border-red-600 rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    if (!credentialsNotNeeded && (credentialsInvalid || !credentialsValidated)) return;
                    setCurrentSection(1);
                  }}
                  disabled={!credentialsNotNeeded && (credentialsInvalid || !credentialsValidated)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {/* Personal Information (index 1) - unchanged layout from earlier */}
          <div className="flex-shrink-0 w-full h-full">
            <div className="flex h-full flex-col bg-gray-950 text-white p-4 sm:p-6 md:p-8">
              <SectionBanner image={bgImg} title="Personal Information" subtitle="Tell us about the owner and rewards wallet." height={160} darkOverlay={0.45} />

              <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 md:p-5 w-full flex flex-col gap-4">
                {/* Email */}
                <div>
                  <label className="block text-sm mb-1 text-gray-200">Email</label>
                  <input
                    value={personalInfoData.email}
                    onChange={(e) => setPersonalInfoData((p: any) => ({ ...p, email: e.target.value }))}
                    className="w-full p-2 rounded-xl bg-gray-900 text-white ring-1 ring-white/10 focus:ring-red-500/50 outline-none"
                    placeholder="example@domain.tld"
                  />
                  {fieldErrors.email && <p className="mt-1 text-xs text-red-400">{fieldErrors.email}</p>}
                </div>

                {/* First / Last */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm mb-1 text-gray-200">First Name</label>
                    <input
                      value={personalInfoData.firstName}
                      onChange={(e) => setPersonalInfoData((p: any) => ({ ...p, firstName: e.target.value }))}
                      className="w-full p-2 rounded-xl bg-gray-900 text-white ring-1 ring-white/10 focus:ring-red-500/50 outline-none"
                      placeholder="Samuel"
                    />
                    {fieldErrors.firstName && <p className="mt-1 text-xs text-red-400">{fieldErrors.firstName}</p>}
                  </div>
                  <div>
                    <label className="block text-sm mb-1 text-gray-200">Last Name</label>
                    <input
                      value={personalInfoData.lastName}
                      onChange={(e) => setPersonalInfoData((p: any) => ({ ...p, lastName: e.target.value }))}
                      className="w-full p-2 rounded-xl bg-gray-900 text-white ring-1 ring-white/10 focus:ring-red-500/50 outline-none"
                      placeholder="Fry"
                    />
                    {fieldErrors.lastName && <p className="mt-1 text-xs text-red-400">{fieldErrors.lastName}</p>}
                  </div>
                </div>

                {/* Device Nickname */}
                <div>
                  <label className="block text-sm mb-1 text-gray-200">Device Nickname</label>
                  <input
                    value={personalInfoData.nickname}
                    onChange={(e) => setPersonalInfoData((p: any) => ({ ...p, nickname: e.target.value }))}
                    className="w-full p-2 rounded-xl bg-gray-900 text-white ring-1 ring-white/10 focus:ring-red-500/50 outline-none"
                    placeholder="Kitchen Tempest"
                  />
                  {fieldErrors.nickname && <p className="mt-1 text-xs text-red-400">{fieldErrors.nickname}</p>}
                </div>

                {/* Rewards Wallet (Algorand) */}
                <div className="space-y-2">
                  <label className="block text-sm mb-1 text-gray-200">Rewards Wallet (Algorand)</label>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <input
                      value={personalInfoData.reward_wallet}
                      onChange={(e) => setPersonalInfoData((p: any) => ({ ...p, reward_wallet: e.target.value.trim() }))}
                      className="w-full sm:flex-1 p-2 rounded-xl bg-gray-900 text-white ring-1 ring-white/10 focus:ring-red-500/50 outline-none"
                      placeholder="58-char Algorand address"
                    />
                    <PasteAddress handlePaste={handleRewardWalletPaste} />
                  </div>

                  {fieldErrors.reward_wallet && <p className="mt-1 text-xs text-red-400">{fieldErrors.reward_wallet}</p>}
                  <p className="mt-1 text-xs text-gray-400">{FIELD_HINT.reward_wallet}</p>
                </div>
              </div>

              {/* Footer nav for Personal */}
              <div className="mt-auto flex justify-end gap-2 text-white">
                <button className="px-4 py-2 border border-gray-500 rounded hover:bg-gray-500" onClick={() => router.push('/devices')}>
                  Cancel
                </button>
                <button className="px-4 py-2 border border-gray-500 rounded" onClick={() => setCurrentSection(0)}>
                  Back
                </button>
                <button
                  className="px-4 py-2 border border-red-600 rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    if (rewardWalletInvalid || credentialsInvalid) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        reward_wallet: rewardWalletInvalid ? (FIELD_HINT.reward_wallet ?? 'Provide a valid rewards wallet address.') : prev.reward_wallet,
                      }));
                      return;
                    }
                    handleNext();
                  }}
                  disabled={rewardWalletInvalid || credentialsInvalid}
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {/* Localization (index 2) – AUTOFIT VERSION (v9: toolbar grid + HexMap auto-resolution) */}
          <div className="flex-shrink-0 w-full h-full">
            <div className="flex h-full flex-col bg-gray-950 text-white p-2 sm:p-3 md:p-4">
              <SectionBanner image={bgImg} title="Localization" subtitle="Search your address or pick an H3 hex. We will store the median coordinates." height={110} darkOverlay={0.45} />

              {/* Autofit card: fills available width/height */}
              <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-2 md:p-3 w-full h-full flex flex-col">
                {/* Toolbar (search + lon/lat) — responsive grid that aligns labels + inputs */}
                <div className="flex flex-col gap-2 mt-1">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                    {/* Search: spans 6 columns on md+ */}
                    <div className="md:col-span-6 flex flex-col">
                      <label className="text-sm mb-1 text-white">Search</label>
                      <MapboxAutocomplete
                        // @ts-ignore
                        publicKey={mapboxgl.accessToken!}
                        inputClass="w-full rounded-lg border border-red-600 bg-white text-gray-900 placeholder:text-gray-600 p-2 h-10 shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                        resetSearch={true}
                        placeholder="Search location..."
                        onSuggestionSelect={(_result: string, lat: string, lng: string) => {
                          const parsedLat = Number(lat);
                          const parsedLng = Number(lng);
                          if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
                            setMapInfoData((p: any) => ({
                              ...p,
                              latitude: String(parsedLat),
                              longitude: String(parsedLng),
                              h3Index: h3.latLngToCell(parsedLat, parsedLng, 7),
                            }));
                            setFieldErrors((prev: any) => ({ ...prev, latitude: '', longitude: '' }));
                            setHexSynced(true);
                          }
                        }}
                      />
                      {/* reserve error space to avoid vertical shifts */}
                      <div className="min-h-[1.25rem] mt-1" />
                    </div>

                    {/* Longitude: spans 3 columns on md+ */}
                    <div className="md:col-span-3 flex flex-col">
                      <label className="text-sm mb-1 text-white">Longitude</label>
                      <input
                        type="text"
                        className="w-full p-2 h-10 rounded border border-red-600 text-black"
                        placeholder="Longitude"
                        value={mapInfoData.longitude ?? ''}
                        onChange={(e) => {
                          const input = e.target.value;
                          if (/^-?\d*\.?\d*$/.test(input)) {
                            const lonError = validateField('longitude', input, null) || '';
                            setMapInfoData((p: any) => ({ ...p, longitude: input }));
                            setFieldErrors((prev: any) => ({ ...prev, longitude: lonError }));
                            setHexSynced(false);
                          }
                        }}
                      />
                      <span className="min-h-[1.25rem] text-red-500 text-sm mt-1">{fieldErrors.longitude ?? ''}</span>
                    </div>

                    {/* Latitude: spans 3 columns on md+ */}
                    <div className="md:col-span-3 flex flex-col">
                      <label className="text-sm mb-1 text-white">Latitude</label>
                      <input
                        type="text"
                        className="w-full p-2 h-10 rounded border border-red-600 text-black"
                        placeholder="Latitude"
                        value={mapInfoData.latitude ?? ''}
                        onChange={(e) => {
                          const input = e.target.value;
                          if (/^-?\d*\.?\d*$/.test(input)) {
                            const latError = validateField('latitude', input, null) || '';
                            setMapInfoData((p: any) => ({ ...p, latitude: input }));
                            setFieldErrors((prev: any) => ({ ...prev, latitude: latError }));
                            setHexSynced(false);
                          }
                        }}
                      />
                      <span className="min-h-[1.25rem] text-red-500 text-sm mt-1">{fieldErrors.latitude ?? ''}</span>
                    </div>
                  </div>
                </div>

                {/* Show current displayed hex/res (if available) */}
                {/* Map + H3 section fills remaining space — map grows to fill */}
                <div className="flex-1 min-h-0 mt-1 flex flex-col">
                  <div className="relative flex-1 min-h-0">
                    {displayedHex && displayedHexRes !== null && (
                      <div className="absolute bottom-3 left-3 z-[500] bg-gray-900/80 px-3 py-1 rounded text-xs text-gray-200 shadow">
                        Res {displayedHexRes} · {displayedHex}
                      </div>
                    )}
                    <HexMap
                      resolution={undefined}
                      autoResolution={true}
                      center={mapCenter}
                      selectedCell={mapInfoData?.h3Index && isValidCell(mapInfoData.h3Index) ? mapInfoData.h3Index : undefined}
                      neighborsK={1}
                      onSelect={(cell: string, lat: number, lng: number) => {
                        setMapInfoData({ latitude: String(lat), longitude: String(lng), h3Index: cell });
                        setFieldErrors((prev: any) => ({ ...prev, latitude: '', longitude: '' }));
                        setHexSynced(true);
                      }}
                      onDisplayCellChange={(cell: string | null, res: number) => {
                        setDisplayedHex(cell);
                        setDisplayedHexRes(res);
                      }}
                      className="rounded-2xl overflow-hidden w-full h-full min-h-[26rem]"
                    />
                  </div>

                  {/* NOTE: H3 input (label + input + helper text) intentionally removed so the map occupies more vertical space */}
                </div>
              </div>

              {/* Footer nav for Localization */}
              <div className="mt-3 flex justify-end gap-2 text-white">
                <button className="px-4 py-2 border border-gray-500 rounded hover:bg-gray-500" onClick={() => router.push('/devices')}>
                  Cancel
                </button>
                <button className="px-4 py-2 border border-gray-500 rounded" onClick={() => setCurrentSection(1)}>
                  Back
                </button>
                <div className="flex flex-col items-end">
                  <button
                    className="px-4 py-2 border border-red-600 rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    type="button"
                    onClick={handleSyncHexOrSave}
                    disabled={credentialsInvalid || rewardWalletInvalid}
                  >
                    {hexSynced ? 'Save' : 'Sync Hex'}
                  </button>
                  {(credentialsInvalid || rewardWalletInvalid || !credentialsValidated) && (
                    <p className="mt-2 text-xs text-red-300 text-right">
                      {credentialsInvalid ? 'Fix credential fields for the selected subtype.' : ''}
                      {credentialsInvalid && rewardWalletInvalid ? ' ' : ''}
                      {rewardWalletInvalid ? 'Provide a valid rewards wallet address.' : ''}
                      {!credentialsInvalid && !rewardWalletInvalid && !credentialsValidated
                        ? 'Validate your credentials before continuing.'
                        : ''}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export async function getServerSideProps(context: any) {
  const session = await getSession(context);
  if (!session || !(session as any).user?.address) {
    return { props: {} };
  }
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const products = await db.collection('products').find({}).toArray();
    if (!products) {
      return { props: { products: [] } };
    } else {
      return {
        props: {
          products: JSON.parse(
            JSON.stringify(
              products.map((product) => {
                return {
                  name: product.name,
                  key: product.key,
                  reward: product.reward
                };
              })
            )
          )
        }
      };
    }
  } catch (error) {
    console.error(error);
    return { props: {} };
  }
}
