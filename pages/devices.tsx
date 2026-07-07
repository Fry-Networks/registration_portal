import PageShell from "../components/PageShell";
import WalletGate from "../components/WalletGate";
import { useCallback, useEffect, useMemo, useRef, useState, type ElementType } from 'react';
import { UserIcon, UserAddIcon, UserRemoveIcon, ArrowRightIcon, SwitchHorizontalIcon, KeyIcon, PlusCircleIcon, ChevronDownIcon } from '@heroicons/react/outline';
import { useRouter } from 'next/router';
import { Button, Flex, Title } from '@tremor/react';
import { signOut, useSession } from 'next-auth/react';
import { getServerSession } from 'next-auth';
import { authOptions } from './api/auth/[...nextauth]';
import { SWRConfig } from 'swr';
import type { Summary } from '../lib/hooks/useRewardSummary';
import { useRewardSummaryBatch } from '../lib/hooks/useRewardSummaryBatch';
import { useDeviceInfoBatch } from '../lib/hooks/useDeviceInfoBatch';
import { useTokenBalanceBatch, type TokenBalanceEntry } from '../lib/hooks/useTokenBalanceBatch';
import clientPromise from '../lib/mongoclient';
import { Device, FryConversion, FryToken, Product } from '../lib/types';
import { getClientToken, refreshClientToken } from '../lib/clientToken';
import { generateRequestSignatureAsync } from '../lib/requestSignature.client';
import { getServerTime, getServerTimestamp, setServerTime } from "../lib/serverTime";
import CopyAddress from '../components/CopyAddress';
import bgImg from '../assets/background.png';
import Link from 'next/link';
import MessageUpdate from '../components/messageUpdate';
import { useModal } from '../app/modalcontext';
import AddDeviceModal from '../components/modals/AddDevice';
import StakeWithdrawModal from '../components/modals/Stake';
import DeviceListItem from '../components/DeviceListItem';
import StakeModal from '../components/modals/Stake';
import WithdrawModal from '../components/modals/Withdraw';
import BoostModal from '../components/modals/Boost';
import ByodConvertModal from '../components/modals/ByodConvert'; // BYOD conversion modal replaces old page
import { mutate as swrMutate } from 'swr';
import ClaimModal from '../components/modals/Claim';
import DeleteModal from '../components/modals/Delete';
import { useToastContext } from '../hooks/ToastContext';
import WithdrawAllModal from '../components/modals/WithdrawAll';
import FryConversionModal from '../components/modals/FryConversion';
import PostSnapshotConversionModal from '../components/modals/PostSnapshotConversion';
import Fry1CheckModal from '../components/modals/Fry1CheckModal';
import FloatingTotalsWidget from '../components/FloatingTotalsWidget';
import { shouldForceLegacyUnverified, isLegacyVerificationStake } from '../lib/legacyStake';
import HeroBanner from '../components/HeroBanner';
import { useSeasonalTheme } from '../app/seasonal-theme/SeasonalThemeProvider'; // Holiday-aware hero
// import WithdrawAlgoModal from '../components/modals/WithdrawAlgo';
import { isNodeStaked, isRegistrationStaked, getWalletAddress, algodClient, computeDeviceStatus, anchorIdForMinerKey } from '../lib/utils';
import type { Notification as AppNotification } from '../components/NotificationCenter';
import { describeMacIssue } from '../lib/validators/macAddressValidator';
import { useNotifications } from '../app/notificationcontext';
import { useFingerprintReady } from '../app/fingerprintcontext';
import { fetchWithFingerprintRetry } from '../lib/api/fetchWithFingerprintRetry';
import { useTheme } from 'next-themes';
import VirtualActivationBanner, { PendingVirtualDevice } from '../components/VirtualActivationBanner';
import CredentialsBanner from '../components/CredentialsBanner';
const logClientError = async (payload: Record<string, unknown>) => {
  try {
    await fetch('/api/logging/client-error', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch {
    // best effort: avoid throwing inside logging helper
  }
};
const testMode = process.env.NEXT_PUBLIC_TEST_MODE && process.env.NEXT_PUBLIC_TEST_MODE === 'true';
const minerType = {
  weather: ['HWM', 'LWM'],
  air: ['IHAQM', 'ILAQM', 'OMAQM', 'IMAQM', 'OHAQM'],
  water: ['OLWQM', 'OHWQM'],
  radiation: ['IRM'],
  hardware: ['ISM', 'OSM', 'BM', 'FEM', 'IDM', 'ODM', 'SDN', 'SVN', 'RDN', 'CN'],
  camera: ['AOWSCM', 'AOWCM', 'AIWCM', 'AOSCM', 'AISCM', 'AOTCM', 'AITCM', 'AIWSCM'],
  energy: ['EM'],
  virtual: ['VRDN', 'VSDN', 'VSVN']
};
type MinerCategory = keyof typeof minerType;
type MinerType = (typeof minerType)[MinerCategory][number];
type HardwareStatus = {
  linked: boolean;
  valid: boolean;
  miner_mac?: string;
  reason?: 'missing_mac' | 'invalid_mac';
  detail?: string;
};
const FRY_DOCS_LINK = 'https://docs.frynetworks.com/poc-4-all';
const NOTIFICATION_PREFIXES = new Set(['SDN', 'SVN', 'RDN', 'CN', 'BM', 'FEM', 'ISM', 'OSM', 'IDM', 'ODM']);
const HARDWARE_MAC_PREFIXES = new Set(['CN', 'RDN', 'SDN', 'SVN', 'BM', 'FEM', 'ISM', 'OSM', 'IDM', 'ODM']);

// Hardware checks follow the same configuration as credentials needed setting
// Hardware MAC check is independent of credential portal requirements —
// the hardware type list at the call site already filters which prefixes need it.
function isHardwareCheckRequiredForPrefix(prefix: string) {
  return true;
}

// Determine which prefixes require portal credentials/linking based on env.
// NEXT_PUBLIC_CREDENTIALS_NEEDED can be:
//  - empty/undefined => default to requiring links for ALL known prefixes (preserves current behavior)
//  - 'NONE' or 'FALSE' => no prefixes require linking
//  - 'ALL' or 'TRUE' => all prefixes require linking
//  - comma-separated list like 'AEM,ISM' => only those prefixes require linking
const _CREDENTIALS_NEEDED_RAW = (process.env.NEXT_PUBLIC_CREDENTIALS_NEEDED || '').trim();
function parseCredentialsNeeded(): Set<string> {
  if (!_CREDENTIALS_NEEDED_RAW) {
    // default: require links for all prefixes (preserve existing behavior)
    return new Set(['ALL']);
  }
  const v = _CREDENTIALS_NEEDED_RAW.toUpperCase();
  if (v === 'NONE' || v === 'FALSE' || v === '0') return new Set();
  if (v === 'ALL' || v === 'TRUE' || v === '1') return new Set(['ALL']);
  return new Set(v.split(',').map(s => s.trim()).filter(Boolean));
}
const CREDENTIALS_NEEDED = parseCredentialsNeeded();
function isLinkRequiredForPrefix(prefix: string) {
  if (!CREDENTIALS_NEEDED || CREDENTIALS_NEEDED.size === 0) return false;
  if (CREDENTIALS_NEEDED.has('ALL')) return true;
  return CREDENTIALS_NEEDED.has(prefix);
}
function getMinerCategory(miner_key: string): MinerCategory | null {
  const prefix = miner_key.split('-')[0];
  for (const key of Object.keys(minerType) as MinerCategory[]) {
    if (minerType[key].includes(prefix)) {
      return key;
    }
  }
  return null;
}
function buildPortalLink(device: Device) {
  const category = getMinerCategory(device.miner_key);
  if (!category) {
    return null;
  }
  const prefix = device.miner_key.split('-')[0];
  const query: Record<string, string> = {
    minerKey: device.miner_key,
    clickable: 'true'
  };
  let portalType = device.registered_portal_model || category;
  query.type = portalType;
  return {
    pathname: '/register',
    query
  } as const;
}
function StatsGrid({
  devices,
  minerDevices,
  nodeDevices,
  hardwareStatusMap
}: {
  devices: Device[];
  minerDevices?: Device[];
  nodeDevices?: Device[];
  hardwareStatusMap?: Record<string, HardwareStatus>;
}) {
  const NODE_PREFIXES = new Set(['RDN', 'SVN', 'SDN', 'CN']);
  const miners = minerDevices ?? devices.filter(d => !NODE_PREFIXES.has(d.miner_key.split('-')[0]));
  const nodes = nodeDevices ?? devices.filter(d => NODE_PREFIXES.has(d.miner_key.split('-')[0]));

  // Count not linked but consider env-driven requirements
  const getNotLinkedDevices = (arr: Device[]) => arr.filter(d => {
    const prefix = d.miner_key.split('-')[0];
    if (!isLinkRequiredForPrefix(prefix)) return false; // linking not required for this prefix
    const portalMissing = !d.registered_portal_model || d.registered_portal_model === '';
    const status = hardwareStatusMap?.[d.miner_key];
    const hardwareIssue = HARDWARE_MAC_PREFIXES.has(prefix) && status ? !status.linked || !status.valid : false;
    return portalMissing || hardwareIssue;
  });
  const scrollToDevice = useCallback((minerKey: string) => {
    if (typeof window === 'undefined') return;
    const anchorId = anchorIdForMinerKey(minerKey);
    const element = document.getElementById(anchorId);
    if (!element) return;
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
    if (element instanceof HTMLElement) {
      window.requestAnimationFrame(() => {
        element.focus({
          preventScroll: true
        });
      });
    }
  }, []);
  const formatNotLinkedLabel = (minerKey: string) => {
    const [prefix = '', remainder = ''] = minerKey.split('-');
    const suffix = remainder.slice(0, 3).toUpperCase();
    return suffix ? `${prefix}-${suffix}` : prefix;
  };
  const renderNotLinkedBadges = (devicesList: Device[], spanClass: string) => {
    if (!devicesList.length) return null;
    return <div className={`${spanClass} flex flex-wrap items-center gap-2 pt-1`}>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary-200">
          Devices Not Linked:
        </span>
        {devicesList.map(device => {
        const label = formatNotLinkedLabel(device.miner_key);
        const status = hardwareStatusMap?.[device.miner_key];
        const prefix = device.miner_key.split('-')[0];
        const portalMissing = !device.registered_portal_model || device.registered_portal_model === '';
        const hardwareIssue = HARDWARE_MAC_PREFIXES.has(prefix) && status ? !status.linked || !status.valid : false;
        return <button key={device.miner_key} type="button" onClick={() => scrollToDevice(device.miner_key)} className="rounded-full border border-primary-500/40 bg-primary-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-200 transition hover:bg-primary-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400">
              {label}
              {hardwareIssue && !portalMissing ? ' · MAC' : null}
            </button>;
      })}
      </div>;
  };
  const {
    resolvedTheme
  } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const {
    activeHoliday
  } = useSeasonalTheme();
  const holidayKey = activeHoliday?.key ?? null;
  const SummaryRow = ({
    label,
    value,
    color
  }: {
    label: string;
    value: number;
    color: 'gray' | 'red' | 'green' | 'yellow';
  }) => {
    const colorMap: Record<typeof color, string> = {
      gray: isDark ? 'bg-gray-900/40 text-gray-300' : 'bg-gray-200 text-slate-900',
      red: isDark ? 'bg-primary-900/30 text-primary-300' : 'bg-primary-100 text-primary-800',
      green: isDark ? 'bg-green-900/30 text-green-300' : 'bg-green-100 text-green-800',
      yellow: isDark ? 'bg-warning-900/30 text-warning-300' : 'bg-warning-100 text-warning-800'
    } as any;
    return <div className={`flex flex-col items-center justify-center rounded-md p-2 ${colorMap[color]} text-xs`}>
        <div className="opacity-90">{label}</div>
        <div className={`${isDark ? 'text-white' : 'text-slate-900'} text-sm`}>{value}</div>
      </div>;
  };
  const CategoryPanel = ({
    title,
    items
  }: {
    title: string;
    items: Device[];
  }) => {
    if (!items || items.length === 0) return null;
    const total = items.length;
    const unverified = items.filter(d => !d.verified).length;
    const verified = items.filter(d => d.verified).length;
    const notLinkedDevices = getNotLinkedDevices(items);
    const notLinked = notLinkedDevices.length;
    // Thicker border to improve visual separation of miner/node summaries in all themes.
    return <div className={`border-2 rounded-xl p-4 w-full ${isDark ? 'border-primary-500/40' : 'border-primary-300/70'}`}>
        <div className={`text-sm font-semibold mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>{title}</div>
        <div className="grid grid-cols-4 gap-2">
          <SummaryRow label="Registered" value={total} color="gray" />
          <SummaryRow label="Unverified" value={unverified} color="yellow" />
          <SummaryRow label="Verified" value={verified} color="green" />
          <SummaryRow label="Not linked" value={notLinked} color="red" />
          {renderNotLinkedBadges(notLinkedDevices, 'col-span-4')}
        </div>
      </div>;
  };
  const CombinedPanel = () => {
    // Renders on small screens only; shows one panel combining categories
    if ((miners?.length || 0) + (nodes?.length || 0) === 0) return null;
    const Sec = ({
      title,
      items
    }: {
      title: string;
      items: Device[];
    }) => {
      if (!items || items.length === 0) return null;
      const total = items.length;
      const unverified = items.filter(d => !d.verified).length;
      const verified = items.filter(d => d.verified).length;
      const notLinkedDevices = getNotLinkedDevices(items);
      const notLinked = notLinkedDevices.length;
      return <div>
          <div className="text-white text-sm font-medium mb-2">{title}</div>
          <div className="grid grid-cols-2 gap-2">
            <SummaryRow label="Registered" value={total} color="gray" />
            <SummaryRow label="Unverified" value={unverified} color="yellow" />
            <SummaryRow label="Verified" value={verified} color="green" />
            <SummaryRow label="Not linked" value={notLinked} color="red" />
            {renderNotLinkedBadges(notLinkedDevices, 'col-span-2')}
          </div>
        </div>;
    };
    // Match desktop panels with thicker, higher-contrast borders in both themes.
    return <div className={`border-2 rounded-xl p-4 w-full ${isDark ? 'border-primary-500/40' : 'border-primary-300/70'}`}>
        <div className="space-y-4">
          <Sec title="Miners" items={miners} />
          <Sec title="Nodes" items={nodes} />
        </div>
      </div>;
  };
  return <>
      {/* Desktop/tables: two panels side-by-side; hide if panel has no items */}
      <div className="hidden sm:grid grid-cols-1 md:grid-cols-2 gap-4 px-2 sm:px-20 mt-6">
        <CategoryPanel title="Miners" items={miners} />
        <CategoryPanel title="Nodes" items={nodes} />
      </div>
      {/* Mobile: single combined panel */}
      <div className="block sm:hidden px-2 mt-6">
        <CombinedPanel />
      </div>
    </>;
}
export function isProductStakeAvailable(product: Product) {
  let result = false;
  if (product.reward.tokens && product.reward.tokens.stake !== 'none') {
    result = true;
  }
  return result;
}
export function findProductByMinerKey(miner_key: string, products: Product[]) {
  const miner_type = miner_key.split('-')[0];
  return products.find(product => product.key === miner_type);
}
type QuickActionCardProps = {
  title: string;
  description: string;
  cta: string;
  icon: ElementType;
  onClick?: () => void;
  href?: string;
  loading?: boolean;
};
const GradientSpinner = () => <svg className="h-5 w-5 animate-spin text-primary-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
  </svg>;
const QuickActionCard = ({
  title,
  description,
  cta,
  icon: Icon,
  onClick,
  href,
  loading = false
}: QuickActionCardProps) => {
  const {
    resolvedTheme
  } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const baseCardClass = isDark ? 'border-primary-500/40 bg-[radial-gradient(circle_at_top,_rgba(248,113,113,0.12),_transparent_60%)] bg-[#0b0b0f]' : 'border-primary-700/50';
  const iconClass = isDark ? 'rounded-xl bg-primary-500/15 p-3 text-primary-200 transition-colors duration-300 group-hover:bg-primary-500/25' : 'rounded-xl bg-white/15 p-3 text-white transition-colors duration-300 group-hover:bg-white/25';
  const titleClass = isDark ? 'text-white' : 'text-white';
  const descClass = isDark ? 'text-gray-300' : 'text-primary-50/90';
  const ctaClass = isDark ? 'text-primary-300' : 'text-primary-100';
  const content = <div className={`group relative overflow-hidden rounded-2xl border p-4 sm:p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary-500/70 hover:shadow-[0_24px_40px_-24px_rgba(248,113,113,0.55)] ${baseCardClass}`} style={isDark ? undefined : {
    backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.14), transparent 45%), radial-gradient(circle at 80% 10%, rgba(255,255,255,0.08), transparent 40%), linear-gradient(135deg, #b50f24 0%, #d52236 45%, #8b0d1e 100%)'
  }}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={iconClass}>
            <Icon className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <div className={`text-sm sm:text-base font-semibold ${titleClass}`}>{title}</div>
            <p className={`mt-1 text-xs leading-relaxed ${descClass}`}>
              {description}
            </p>
          </div>
        </div>
        <ArrowRightIcon className={`h-5 w-5 opacity-0 transition-opacity duration-300 group-hover:opacity-80 ${isDark ? 'text-primary-300' : 'text-white'}`} aria-hidden="true" />
      </div>
      <div className={`mt-4 flex items-center gap-2 text-sm font-semibold ${ctaClass}`}>
        {loading ? <>
            <GradientSpinner />
            <span className={`text-xs sm:text-sm uppercase tracking-wide ${isDark ? 'text-primary-200' : 'text-white/90'}`}>Processing…</span>
          </> : <span>{cta}</span>}
      </div>
    </div>;
  if (href) {
    return <Link href={href} className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60">
        {content}
      </Link>;
  }
  return <button type="button" onClick={onClick} disabled={loading} className="block text-left rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60">
      {content}
    </button>;
};

// Preserve the mongoose document prototype while layering UI-only patches on top.
const cloneDeviceWithPatch = (device: Device, patch: Partial<Device>): Device => {
  const proto = Object.getPrototypeOf(device) ?? Object.prototype;
  const clone = Object.assign(Object.create(proto), device);
  return Object.assign(clone, patch) as Device;
};
const DevicesPage = ({
  initialDevices = [],
  products = [],
  tokenMetadata = {},
  rewardFallback = {},
  statusFallback = {},
  pendingVirtualDevices = []
}: {
  initialDevices: Device[];
  products: Product[];
  tokenMetadata?: Record<string, {
    name?: string;
    shortName?: string;
    unitName?: string;
    symbol?: string;
  }>;
  rewardFallback?: Record<string, Summary>;
  statusFallback?: Record<string, {
    [key: string]: string;
  } | undefined>;
  pendingVirtualDevices?: PendingVirtualDevice[];
}) => {
  const router = useRouter();
  const {
    resolvedTheme
  } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const {
    activeHoliday
  } = useSeasonalTheme();
  const holidayKey = activeHoliday?.key ?? null;
  const heroOffsetClass = holidayKey === 'christmas' ? 'mt-10 sm:mt-14' : 'mt-2'; // Xmas: push hero down to clear garland
  const toast = useToastContext();
  const {
    openModal
  } = useModal();
  const {
    data: session,
    status: sessionStatus
  } = useSession();
  const {
    ready: fingerprintReady,
    refresh: refreshFingerprint
  } = useFingerprintReady();

  // Enhanced sort: supports sortField and sortDirection
  const [sortField, setSortField] = useState<'nickname' | 'miner_key' | 'created_at'>('nickname');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // ---- Search / filter state ----
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'registered' | 'unverified' | 'verified' | 'notlinked' | 'active'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'miners' | 'nodes'>('all');
  function sortDevices(devices: Device[]) {
    return [...devices].sort((a, b) => {
      let result = 0;
      if (sortField === 'nickname') {
        const aHasNickname = !!a.nickname;
        const bHasNickname = !!b.nickname;
        if (aHasNickname && bHasNickname) {
          result = a.nickname!.localeCompare(b.nickname!);
        } else if (aHasNickname) {
          result = -1;
        } else if (bHasNickname) {
          result = 1;
        } else {
          result = a.name.localeCompare(b.name);
        }
      } else if (sortField === 'miner_key') {
        result = a.miner_key.localeCompare(b.miner_key);
      } else if (sortField === 'created_at') {
        // Fallback to string comparison if created_at is not a Date
        result = String(a.created_at).localeCompare(String(b.created_at));
      }
      return sortDirection === 'asc' ? result : -result;
    });
  }

  const [devices, setDevices] = useState<Device[]>(sortDevices(initialDevices));
  const allMinerKeys = useMemo(() => devices.map(d => d.miner_key).filter(Boolean), [devices]);
  const {
    data: batchSummaries,
    error: batchError
  } = useRewardSummaryBatch(allMinerKeys);
  const {
    data: batchDeviceInfos,
    error: deviceInfoError
  } = useDeviceInfoBatch(allMinerKeys);
  const tokenBalanceEntries = useMemo<TokenBalanceEntry[]>(() => {
    return devices.map(device => {
      const product = findProductByMinerKey(device.miner_key, products);
      const rewardWallet = device.reward_wallet ?? null;
      const rewardAssetId = product?.reward?.tokens?.reward;
      const resolvedAssetId = rewardAssetId && rewardAssetId !== 'n/a' ? rewardAssetId : null;
      if (!resolvedAssetId || !rewardWallet) return null;
      return {
        key: device.miner_key,
        address: rewardWallet,
        asset_id: resolvedAssetId
      };
    }).filter((e): e is TokenBalanceEntry => e !== null);
  }, [devices, products]);
  const {
    data: batchTokenBalances,
    error: tokenBalanceError
  } = useTokenBalanceBatch(tokenBalanceEntries);

  // Keep devices sorted when sortField, sortDirection, or initialDevices change
  useEffect(() => {
    setDevices(sortDevices(initialDevices));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortField, sortDirection, initialDevices]);
  const [selectedDevice, setSelectedDevice] = useState<Device>(initialDevices[0]);
  const [stakeContext, setStakeContext] = useState<'verification' | 'registration' | 'node'>('verification');
  const [isProcessing, setIsProcessing] = useState(false);
  const [addr, setAddr] = useState(session?.user.address);
  const [showFry1Check, setShowFry1Check] = useState(false);
  const [showFryConversion, setShowFryConversion] = useState(false);
  const [showPostSnapshotConversion, setShowPostSnapshotConversion] = useState(false);
  const [securityBlocked, setSecurityBlocked] = useState(false);
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const securityToastShown = useRef(false);
  // Ribbon state
  const [countdown, setCountdown] = useState<string>("");
  const [claimCountdown, setClaimCountdown] = useState<string>(""); // Countdown until pending matures to claimable
  const [totals, setTotals] = useState<{
    totals: {
      fnode: {
        pending: number;
        claimable: number;
        claimed: number;
        accruing: number;
      };
      tfry: {
        pending: number;
        claimable: number;
        claimed: number;
        accruing: number;
      };
    };
    nextUnlockAt?: string;
    nextClaimableAt?: string | null;
    pendingWindowLabel?: string | null;
    legacyFryClaimedSnapshot?: number;
  } | null>(null);
  const [totalsError, setTotalsError] = useState(false);
  const fmt = (v?: number) => (v ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const [hardwareStatus, setHardwareStatus] = useState<Record<string, HardwareStatus>>({});
  // ---- Filtered + sorted device list ----
  const filteredDevices = useMemo(() => {
    let list = devices;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(d => {
        const product = findProductByMinerKey(d.miner_key, products);
        return (
          (d.nickname && d.nickname.toLowerCase().includes(q)) ||
          d.miner_key.toLowerCase().includes(q) ||
          (product?.name && product.name.toLowerCase().includes(q)) ||
          d.name.toLowerCase().includes(q)
        );
      });
    }
    if (statusFilter !== 'all') {
      list = list.filter(d => {
        if (statusFilter === 'registered') return d.is_registered;
        if (statusFilter === 'unverified') return !d.verified;
        if (statusFilter === 'verified') return d.verified;
        if (statusFilter === 'active') return d.is_active === true;
        if (statusFilter === 'notlinked') {
          const prefix = d.miner_key.split('-')[0];
          if (!isLinkRequiredForPrefix(prefix)) return false;
          const portalMissing = !d.registered_portal_model || d.registered_portal_model === '';
          const status = hardwareStatus[d.miner_key];
          const hardwareIssue = HARDWARE_MAC_PREFIXES.has(prefix) && status ? (!status.linked || !status.valid) : false;
          return portalMissing || hardwareIssue;
        }
        return true;
      });
    }
    if (typeFilter !== 'all') {
      const NODE_PREFIXES = new Set(['RDN', 'SVN', 'SDN', 'CN']);
      if (typeFilter === 'miners') {
        list = list.filter(d => !NODE_PREFIXES.has(d.miner_key.split('-')[0]));
      } else if (typeFilter === 'nodes') {
        list = list.filter(d => NODE_PREFIXES.has(d.miner_key.split('-')[0]));
      }
    }
    return sortDevices(list);
  }, [devices, searchQuery, statusFilter, typeFilter, products, hardwareStatus, sortField, sortDirection]);


  // ---- Filtered + sorted device list ----

  const {
    setNotifications: syncNotifications,
    dismissedIds: dismissedNotificationIds
  } = useNotifications();
  const minerKeys = useMemo(() => {
    const keys = devices.map(d => d.miner_key).filter(Boolean);
    return Array.from(new Set(keys));
  }, [devices]);
  const handleAdd = () => {
    openModal('addDevice');
  };

  // Open BYOD conversion modal instead of routing to the deprecated BYOD page.
  const handleByod = () => {
    openModal('byodConvert');
  };
  const handleConversion = async () => {
    setShowFry1Check(true);
  };
  const handlePostSnapshotConversion = () => {
    setShowPostSnapshotConversion(true);
    openModal('postSnapshotConversion');
  };
  const handleSecurityBlock = useCallback((code?: string) => {
    if (securityToastShown.current) return;
    securityToastShown.current = true;
    const message = code === 'DEVICE_MISMATCH' ? 'Our system detected a security issue and signed you out to protect your account. Please reconnect with your device wallet to continue.' : 'Security verification failed. Please reconnect with your device wallet to continue.';
    setSecurityBlocked(true);
    setSecurityMessage(message);
    toast.error({
      heading: 'Security check triggered',
      message
    });
    void signOut({
      redirect: true,
      callbackUrl: '/signin'
    });
  }, [toast]);
  useEffect(() => {
    if (!session?.user?.address || minerKeys.length === 0) {
      if (minerKeys.length === 0) {
        setHardwareStatus({});
      }
      return;
    }
    let cancelled = false;
    const loadHardwareStatus = async () => {
      try {
        const response = await fetchWithFingerprintRetry(() => fetch('/api/hardware/status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            miner_keys: minerKeys
          })
        }), refreshFingerprint);
        if (!response.ok) {
          throw new Error(`Failed to load hardware status (${response.status})`);
        }
        const data: Record<string, HardwareStatus> = await response.json();
        if (!cancelled) {
          setHardwareStatus(data ?? {});
        }
      } catch (error) {
        console.error('Failed to load hardware status', error);
        if (!cancelled) {
          setHardwareStatus({});
        }
      }
    };
    loadHardwareStatus();
    return () => {
      cancelled = true;
    };
  }, [minerKeys, session?.user?.address, refreshFingerprint]);
  const notifications = useMemo<AppNotification[]>(() => {
    if (!devices || devices.length === 0) {
      return [];
    }
    const dismissedSet = new Set(dismissedNotificationIds);
    const pushed = new Set<string>();
    return devices.reduce<AppNotification[]>((acc, device) => {
      const key = device.miner_key;
      if (!key) {
        return acc;
      }
      const prefix = key.split('-')[0];
      if (!NOTIFICATION_PREFIXES.has(prefix)) {
        return acc;
      }
      const portalLink = buildPortalLink(device);
      if (!portalLink) {
        return acc;
      }
      const idBase = `${key}-link`;
      const status = hardwareStatus[key];
      const isLinked = Boolean(device.registered_portal_model && device.registered_portal_model.trim().length > 0);

      // Skip link-required warnings if linking is not required for this prefix
      if (!isLinkRequiredForPrefix(prefix)) return acc;
      if (!isLinked || !status || (!isHardwareCheckRequiredForPrefix(prefix) ? false : status.reason === 'missing_mac') || !status.linked) {
        if (!dismissedSet.has(idBase) && !pushed.has(idBase)) {
          acc.push({
            id: idBase,
            variant: 'warning',
            title: `Link required for ${key}`,
            message: <span>
                Miner <code className="font-mono">{key}</code> isn’t linked to FryNetworks. Rewards will pause soon for devices without completed portal links—please finish setup as soon as possible.{' '}
                <Link href={portalLink} className="font-semibold text-primary-200 underline">
                  Go to portal
                </Link>{' '}to complete the link or review our{' '}
                <a href={FRY_DOCS_LINK} target="_blank" rel="noreferrer" className="underline">
                  linking guide
                </a>
                .
              </span>,
            source: 'device'
          });
          pushed.add(idBase);
        }
        return acc;
      }
      if (isHardwareCheckRequiredForPrefix(prefix) && status && status.linked && !status.valid) {
        const id = `${key}-mac`;
        if (!dismissedSet.has(id) && !pushed.has(id)) {
          const issue = describeMacIssue(status.detail ?? status.reason);
          acc.push({
            id,
            variant: 'warning',
            title: `Update MAC for ${key}`,
            message: <span>
                The recorded MAC address{status.miner_mac ? ` (${status.miner_mac})` : ''} for miner{' '}
                <code className="font-mono">{key}</code> looks invalid ({issue}). Rewards will pause soon if the MAC stays incorrect—update it right away.{' '}
                <Link href={portalLink} className="font-semibold text-primary-200 underline">
                  Go to portal
                </Link>{' '}or review our{' '}
                <a href={FRY_DOCS_LINK} target="_blank" rel="noreferrer" className="underline">
                  linking guide
                </a>{' '}to resubmit the correct address.
              </span>,
            source: 'device'
          });
          pushed.add(id);
        }
      }
      return acc;
    }, []);
  }, [devices, hardwareStatus, dismissedNotificationIds]);
  useEffect(() => {
    syncNotifications(notifications);
  }, [notifications, syncNotifications]);

  // const checkAlgoBalance = async (mnemonic: string): Promise<null | number> => {
  //   const account = getWalletAddress(mnemonic);

  //   try {
  //     // Fetch account information
  //     const accountInfo = await algodClient.accountInformation(account).do();

  //     // ALGO balance is in microalgos; convert to ALGO
  //     const algoBalance = parseFloat((accountInfo.amount / 1e6).toFixed(2));
  //     if (algoBalance < 10) {
  //       return 10 - algoBalance;
  //     }

  //     return null;
  //   } catch (error) {
  //     console.error('Error fetching account balance:', error);
  //     return null;
  //   }
  // };

  // Keep miner-key validation aligned with onboarding modals: 2-6 char prefix + 32-char body.
  const MINER_KEY_PATTERN = /^[A-Z]{2,6}-[A-Z0-9]{32}$/;
  const isLikelyMinerKey = (value: string) => MINER_KEY_PATTERN.test(value.trim().toUpperCase());
  const handleRegister = async (minerKey: string): Promise<void> => {
    try {
      // Normalize to uppercase so case mismatches do not block valid keys.
      const normalizedKey = (minerKey || '').trim().toUpperCase();
      if (!normalizedKey || !isLikelyMinerKey(normalizedKey)) {
        toast.error({
          heading: 'Miner key invalid',
          message: 'That miner key looks malformed. Please double-check and try again.'
        });
        logClientError({
          issueType: 'DEVICE_LOOKUP_FAILED',
          part: 'devices.handleRegister',
          minerKey: normalizedKey || null,
          walletAddress: session?.user?.address ?? null,
          url: `/api/devices/${normalizedKey || 'empty'}`,
          message: 'Miner key blocked as malformed before lookup'
        });
        return;
      }
      const response = await fetchWithFingerprintRetry(() => fetch(`/api/devices/${normalizedKey}`), refreshFingerprint);
      if (!response.ok) {
        if (response.status === 404) {
          toast.error({
            heading: 'Miner key not found',
            message: `We couldn't find ${normalizedKey}. It may be mistyped or already used.`
          });
        } else if (response.status === 401) {
          toast.error({
            heading: 'Sign in required',
            message: 'Please sign in with your wallet before registering.'
          });
        } else {
          toast.error({
            heading: 'Error',
            message: 'We could not look up that miner key. Please try again.'
          });
        }
        logClientError({
          issueType: 'DEVICE_LOOKUP_FAILED',
          part: 'devices.handleRegister',
          minerKey: normalizedKey,
          walletAddress: session?.user?.address ?? null,
          url: `/api/devices/${normalizedKey}`,
          message: `Lookup failed with status ${response.status}`
        });
        return;
      }
      const result = await response.json();
      if (result.device.is_registered) {
        toast.error({
          heading: 'Error',
          message: 'Already registered'
        });
        return;
      }
      const prefix = getMinerCategory(normalizedKey);
      if (!prefix) {
        toast.error({
          heading: 'Error',
          message: `Invalid Miner Key! We couldn't validate that miner key. Please double-check it and try again.`
        });
        return;
      }

      // Always open the new /register flow. If a portal model exists include it so the portal page shows the correct subtype
      const regQuery: any = {
        minerKey: normalizedKey
      };
      if (result.device.registered_portal_model) {
        regQuery.type = result.device.registered_portal_model;
      }
      router.push({
        pathname: '/register',
        query: regQuery
      });
      return;
    } catch (error) {
      toast.error({
        heading: 'Error',
        message: 'There is an error occured for registering. Please contact us before you try again'
      });
      logClientError({
        issueType: 'DEVICE_LOOKUP_FAILED',
        part: 'devices.handleRegister',
        minerKey: (minerKey || '').trim() || null,
        walletAddress: session?.user?.address ?? null,
        url: `/api/devices/${(minerKey || '').trim() || 'empty'}`,
        message: `Register handler threw: ${String(error)}`
      });
      return;
    }
  };
  const handleClaimFreeFem = async () => {
    if (!session?.user?.address) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch('/api/events/claim-free-fem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) {
        setClaimError(data.message || 'Failed to generate key');
        return;
      }
      const minerKey = data.minerKey;
      if (minerKey) {
        router.push(`/register?minerKey=${encodeURIComponent(minerKey)}&type=fem`);
      }
    } catch (e: any) {
      setClaimError(e.message || 'Network error');
    } finally {
      setClaiming(false);
    }
  };

  // Countdown to next Friday 00:05 UTC (for ribbon)
  useEffect(() => {
    const getNextFridayUnlockUTC = (now: Date) => {
      const day = now.getUTCDay();
      const thisFriday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      const diffToFriday = (day + 7 - 5) % 7;
      thisFriday.setUTCDate(thisFriday.getUTCDate() - diffToFriday);
      const thisUnlock = new Date(thisFriday.getTime() + 5 * 60 * 1000);
      if (now.getTime() >= thisUnlock.getTime()) {
        const nextFriday = new Date(thisFriday.getTime() + 7 * 24 * 60 * 60 * 1000);
        return new Date(nextFriday.getTime() + 5 * 60 * 1000);
      }
      return thisUnlock;
    };
    const update = () => {
      const now = new Date();
      const target = getNextFridayUnlockUTC(now);
      const diff = Math.max(0, target.getTime() - now.getTime());
      const days = Math.floor(diff / (24 * 60 * 60 * 1000));
      const hours = Math.floor(diff % (24 * 60 * 60 * 1000) / (60 * 60 * 1000));
      const mins = Math.floor(diff % (60 * 60 * 1000) / (60 * 1000));
      const secs = Math.floor(diff % (60 * 1000) / 1000);
      setCountdown(`${days}d ${hours}h ${mins}m ${secs}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // Countdown until the next pending weekly reward matures into claimable.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const targetIso = totals?.nextClaimableAt;
    if (!targetIso) {
      setClaimCountdown('');
      return () => {
        if (timer) clearInterval(timer);
      };
    }
    const targetMs = new Date(targetIso).getTime();
    if (!Number.isFinite(targetMs)) {
      setClaimCountdown('');
      return () => {
        if (timer) clearInterval(timer);
      };
    }
    const tick = () => {
      const diff = Math.max(0, targetMs - getServerTime());
      const days = Math.floor(diff / (24 * 60 * 60 * 1000));
      const hours = Math.floor(diff % (24 * 60 * 60 * 1000) / (60 * 60 * 1000));
      const mins = Math.floor(diff % (60 * 60 * 1000) / (60 * 1000));
      const secs = Math.floor(diff % (60 * 1000) / 1000);
      setClaimCountdown(diff <= 0 ? 'Now' : `${days}d ${hours}h ${mins}m ${secs}s`);
    };
    tick();
    timer = setInterval(tick, 1000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [totals?.nextClaimableAt]);

  // Fetch totals for ribbon (only when signed in)
  useEffect(() => {
    let active = true;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let consecutiveFailures = 0;
    let loggedFailure = false;
    if (!fingerprintReady || sessionStatus !== 'authenticated' || !session?.user?.address) {
      if (sessionStatus === 'unauthenticated') {
        setTotals(null);
      }
      return () => {
        active = false;
        if (intervalId) clearInterval(intervalId);
      };
    }
    const refreshClientTokenOnce = async () => {
      try {
        await refreshClientToken();
        return true;
      } catch (error) {
        console.error('[ClientToken] Failed to refresh token after rejection', error);
        return false;
      }
    };
    const stopPolling = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    const schedulePolling = () => {
      if (!intervalId) {
        intervalId = setInterval(fetchTotals, 30000);
      }
    };
    const fetchTotals = async () => {
      try {
        const requestFactory = async () => {
          const timestamp = getServerTimestamp();
          const signature = await generateRequestSignatureAsync('POST', '/api/rewards/get-asset-totals', {}, timestamp);
          const clientToken = await getClientToken();
          return fetch('/api/rewards/get-asset-totals', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-client-token': clientToken,
              'x-request-signature': signature,
              'x-request-timestamp': timestamp.toString()
            }
          });
        };
        const res = await fetchWithFingerprintRetry(requestFactory, refreshFingerprint, {
          refreshClientToken: refreshClientTokenOnce
        });
        if (!res.ok) {
          consecutiveFailures += 1;
          if (active && res.status === 401) {
            setTotals(null);
            setTotalsError(true);
            stopPolling();
            return;
          }
          // Suppress expected security rejections (client token/signature/fingerprint) from Discord noise.
          let errorCode: string | undefined;
          try {
            const payload = await res.clone().json();
            errorCode = typeof payload?.code === 'string' ? payload.code : undefined;
          } catch {
            errorCode = undefined;
          }
          if (active && errorCode && (errorCode === 'DEVICE_MISMATCH' || errorCode === 'DEVICE_FINGERPRINT_REFRESH')) {
            setTotals(null);
            setTotalsError(true);
            stopPolling();
            handleSecurityBlock(errorCode);
            return;
          }
          const expectedSecurityCodes = new Set(['MISSING_CLIENT_TOKEN', 'INVALID_CLIENT_TOKEN', 'MISSING_SIGNATURE', 'INVALID_SIGNATURE', 'EXPIRED_TIMESTAMP', 'DEVICE_MISMATCH', 'DEVICE_FINGERPRINT_REFRESH']);
          const isExpectedSecurityRejection = (res.status === 403 || res.status === 409) && errorCode && expectedSecurityCodes.has(errorCode);
          if (!loggedFailure) {
            if (!isExpectedSecurityRejection) {
              logClientError({
                issueType: 'REWARD_TOTALS_REFRESH_FAILED',
                part: 'devices.pollTotals',
                minerKey: null,
                walletAddress: session?.user?.address ?? null,
                url: '/api/rewards/get-asset-totals',
                message: `Totals refresh returned ${res.status}${errorCode ? ` (${errorCode})` : ''}`
              });
            }
            loggedFailure = true;
          }
          if (consecutiveFailures >= 3) {
            stopPolling();
          }
          if (active) setTotalsError(true);
          return;
        }
        const json = await res.json();
        if (json.serverTime) setServerTime(json.serverTime);
        consecutiveFailures = 0;
        loggedFailure = false;
        // Diagnostic: capture raw totals for mobile mismatch investigation.
        /*console.log('[Totals] payload', {
          nextClaimableAt: json?.nextClaimableAt,
          pendingWindowLabel: json?.pendingWindowLabel,
          totals: json?.totals,
          legacyFryClaimedSnapshot: json?.legacyFryClaimedSnapshot
        });*/
        if (active) setTotalsError(false);
        if (active) setTotals(json);
      } catch (error) {
        consecutiveFailures += 1;
        if (active) setTotalsError(true);
        // Diagnostic: surface failures to console so we know if mobile cannot fetch totals.
        console.log('[Totals] fetch error', error);
        if (!loggedFailure) {
          logClientError({
            issueType: 'REWARD_TOTALS_REFRESH_FAILED',
            part: 'devices.pollTotals',
            minerKey: null,
            walletAddress: session?.user?.address ?? null,
            url: '/api/rewards/get-asset-totals',
            message: `Totals refresh threw: ${String(error)}`
          });
          loggedFailure = true;
        }
        if (consecutiveFailures >= 3) {
          stopPolling();
        }
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        consecutiveFailures = 0;
        loggedFailure = false;
        stopPolling();
        fetchTotals().finally(() => {
          if (active) schedulePolling();
        });
      }
    };
    const handleOnline = () => {
      consecutiveFailures = 0;
      loggedFailure = false;
      stopPolling();
      fetchTotals().finally(() => {
        if (active) schedulePolling();
      });
    };
    fetchTotals();
    schedulePolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    return () => {
      active = false;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [fingerprintReady, sessionStatus, session?.user?.address, refreshFingerprint, session, handleSecurityBlock]);

  // Estimated weekly earnings (per asset) from current week accrual pace
  const {
    estimatedFnode,
    estimatedTfry
  } = useMemo(() => {
    if (!totals?.totals) return {
      estimatedFnode: 0,
      estimatedTfry: 0
    };
    const accFnode = totals.totals.fnode?.accruing || 0;
    const accTfry = totals.totals.tfry?.accruing || 0;
    const now = new Date();
    const day = now.getUTCDay();
    const thisFriday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const diffToFriday = (day + 7 - 5) % 7;
    thisFriday.setUTCDate(thisFriday.getUTCDate() - diffToFriday);
    const elapsed = Math.floor((now.getTime() - thisFriday.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const daysElapsed = Math.min(7, Math.max(1, elapsed));
    const estN = Math.round(accFnode / daysElapsed * 7 * 100) / 100;
    const estT = Math.round(accTfry / daysElapsed * 7 * 100) / 100;
    return {
      estimatedFnode: estN,
      estimatedTfry: estT
    };
  }, [totals?.totals]);
  const handleSetting = async (minerKey: string): Promise<void> => {
    // Gear icon should go directly to credentials (register page)
    router.push({
      pathname: '/register',
      query: {
        minerKey,
        clickable: 'true'
      }
    });
  };
  const handleDeleteButton = (device: Device) => {
    setSelectedDevice(device);
    console.log('Verification: ' + device.verified);
    if (isRegistrationStaked(device) || isNodeStaked(device) || device.verified) {
      toast.warning({
        heading: 'Warning',
        message: 'After withdraw all you staked. You can un-register your device.'
      });
      return;
    }
    openModal('delete');
  };
  const handleDelete = async (miner_key: string): Promise<void> => {
    // Send a request to delete the device from the backend
    setDevices(prevDevices => prevDevices.filter(device => device.miner_key !== miner_key));
  };
  const handleWithdrawAll = async (device: Device): Promise<void> => {
    const updated = await refreshDevice(device.miner_key);
    if (!updated) {
      // If the API has not yet persisted the change, softly mutate local state so the card still responds.
      const updatedMiners = devices.map(value => {
        if (value.miner_key !== device.miner_key) {
          return value;
        }
        const patch: Partial<Device> = {};
        if (value.registration) patch.registration = undefined;
        if (value.node) patch.node = undefined;
        return cloneDeviceWithPatch(value, patch);
      }) as Device[];
      setDevices(updatedMiners);
      setSelectedDevice(prev => {
        if (!prev || prev.miner_key !== device.miner_key) return prev;
        return cloneDeviceWithPatch(prev, {
          registration: undefined,
          node: undefined
        });
      });
    }
  };
  const handleChange = async (miner_key: string): Promise<void> => {
    router.push({
      pathname: '/register',
      query: {
        minerKey: miner_key,
        clickable: 'true',
        section: 'personal'
      }
    });
  };
  const handleStakeRequirement = (device: Device, requirement: 'registration' | 'node'): void => {
    setSelectedDevice(device);
    setStakeContext(requirement);
    openModal('stake');
  };

  // const handleAlgoWithdraw = async (device: Device): Promise<void> => {
  //   console.log('handleAlgoWithdraw');
  // }

  const handleWithdrawStake = (device: Device): void => {
    setSelectedDevice(device);

    // Legacy FRY1 verification stakes remain withdrawable even after verification is forced off.
    if (isLegacyVerificationStake(device)) {
      openModal('withdraw');
      return;
    }
    if (!device.verified) {
      setStakeContext('verification');
      openModal('stake');
      return;
    }
    openModal('withdraw');
  };
  const handleWithdrawAllButton = (device: Device): void => {
    setSelectedDevice(device);
    openModal('withdraw_all');
  };
  const handleClaimButton = (device: Device) => {
    setSelectedDevice(device);
    openModal('claim');
  };
  const handleBoostButton = async (device: Device): Promise<void> => {
    setSelectedDevice(device);
    openModal('boost');
  };
  const selectedProduct = useMemo(() => selectedDevice ? findProductByMinerKey(selectedDevice.miner_key, products) : null, [selectedDevice, products]);

  // After a stake/withdraw completes we pull the authoritative document back from the API.
  const refreshDevice = useCallback(async (minerKey: string): Promise<Device | null> => {
    if (!session?.user?.address) return null;
    try {
      const response = await fetchWithFingerprintRetry(() => fetch(`/api/devices/${encodeURIComponent(minerKey)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: session.user.address
        })
      }), refreshFingerprint);
      if (!response.ok) return null;
      const json = await response.json();
      const updatedDevice = json?.device as Device | undefined;
      if (!updatedDevice) return null;
      setDevices(prev => prev.map(element => element.miner_key === minerKey ? cloneDeviceWithPatch(element, updatedDevice as Partial<Device>) : element));
      setSelectedDevice(prev => {
        if (!prev || prev.miner_key !== minerKey) return prev;
        return cloneDeviceWithPatch(prev, updatedDevice as Partial<Device>);
      });
      return updatedDevice;
    } catch (error) {
      console.error(`Failed to refresh device ${minerKey}:`, error);
      return null;
    }
  }, [session?.user?.address, refreshFingerprint]);
  const hydrateFromSelectedDevice = (element: Device): Device => {
    if (!selectedDevice || element.miner_key !== selectedDevice.miner_key) {
      return element;
    }
    return cloneDeviceWithPatch(element, {
      names: selectedDevice.names ?? element.names,
      email: selectedDevice.email ?? element.email
    });
  };
  const handleBoost = async (ret: boolean, message: string): Promise<void> => {
    console.log('Boost function');
    const updateDevices = devices.map(hydrateFromSelectedDevice) as Device[];
    setDevices(updateDevices);
    // Revalidate only this device's summary
    if (selectedDevice?.miner_key) {
      swrMutate(`reward-summary:${selectedDevice.miner_key}`);
    }
  };
  const handleClaim = async (ret: boolean, message: string, _context?: {
    txId?: string;
    minerKey?: string;
    rewardNumbers?: number[];
  }): Promise<void> => {
    const updateDevices = devices.map(hydrateFromSelectedDevice) as Device[];
    setDevices(updateDevices);
    if (selectedDevice?.miner_key) {
      const key = `reward-summary:${selectedDevice.miner_key}`;
      // Optimistic drop of claimable to 0, then revalidate
      swrMutate(key, (current: any) => ({
        pending: current?.pending ?? 0,
        claimable: 0,
        claimed: current?.claimed,
        accruing: current?.accruing,
        nextUnlockAt: current?.nextUnlockAt ?? null,
        firstRewardAt: current?.firstRewardAt ?? null
      }), {
        revalidate: true
      });
    }
  };
  const handleStakingUpdate = (device: Device): void => {
    console.log('Staked device update');
    refreshDevice(device.miner_key).then(updated => {
      if (!updated) {
        // Optimistic update: keep UI responsive until the fresh document arrives.
        setDevices(prev => prev.map(element => element.miner_key === device.miner_key ? cloneDeviceWithPatch(element, {
          verified: true
        }) : element));
        setSelectedDevice(prev => {
          if (!prev || prev.miner_key !== device.miner_key) return prev;
          return cloneDeviceWithPatch(prev, {
            verified: true
          });
        });
      }
    });
  };
  const handleWithdrawUpdate = (device: Device): void => {
    console.log('Withdraw device update');
    refreshDevice(device.miner_key).then(updated => {
      if (!updated) {
        // Mirror the optimistic branch for withdrawals so cards instantly reflect loss of staking.
        setDevices(prev => prev.map(element => element.miner_key === device.miner_key ? cloneDeviceWithPatch(element, {
          verified: false
        }) : element));
        setSelectedDevice(prev => {
          if (!prev || prev.miner_key !== device.miner_key) return prev;
          return cloneDeviceWithPatch(prev, {
            verified: false
          });
        });
      }
    });
  };

  // const handleAlgoWithdrawButton = (device: Device): void => {
  //   setSelectedDevice(device);
  //   openModal('withdraw_algo');
  //   console.log('Selected Withdraw: ', device);
  // }

  const isNodeDevice = useCallback((d: Device): boolean => {
    const prefix = d.miner_key.split('-')[0];
    return ['RDN', 'SVN', 'SDN', 'CN'].includes(prefix);
  }, []);
  const isMinerDevice = useCallback((d: Device): boolean => !isNodeDevice(d), [isNodeDevice]);
  const minerDevices = useMemo(() => devices.filter(isMinerDevice), [devices, isMinerDevice]);
  const nodeDevices = useMemo(() => devices.filter(isNodeDevice), [devices, isNodeDevice]);
  const [statsOpen, setStatsOpen] = useState(false);

  // Session loading state - show loading spinner while auth resolves
  if (sessionStatus === 'loading') {
    return <PageShell title="My Devices" breadcrumb={true}>
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <svg className="animate-spin h-10 w-10 mx-auto mb-4 text-primary-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-gray-500 dark:text-gray-400">Loading your devices...</p>
        </div>
      </div>
    </PageShell>;
  }

  return (
    <WalletGate>
      <PageShell title="My Devices" breadcrumb={true}>
    <SWRConfig value={{
      fallback: rewardFallback
    }}>
    <div className="w-full space-y-6">
      <div className={`px-2 sm:px-20 ${heroOffsetClass}`}>
        <HeroBanner title="Fry Operations Center" subtitle="Register and manage miners and nodes: verify details, link portals, and handle rewards." backgroundImage={bgImg} links={[{
            label: 'Registration Guide',
            href: 'https://docs.frynetworks.com/dashboard/registration'
          }]} mode={isDark ? 'dark' : 'light'} holidayKey={holidayKey} />
      </div>
      {securityBlocked && <div className="mx-2 sm:mx-20 rounded-lg border border-error-300 bg-error-50 px-4 py-3 text-sm text-error-900">
          <strong>Security check triggered.</strong>{' '}
          {securityMessage ?? 'Please reconnect with your device wallet to continue.'}
        </div>}
      {/* FloatingTotalsWidget - replaces old sticky ribbon */}
      {session?.user?.address && (totals || totalsError) && <FloatingTotalsWidget totals={totals} countdown={countdown} claimCountdown={claimCountdown} estimatedFnode={estimatedFnode} estimatedTfry={estimatedTfry} legacyFryClaimedSnapshot={totals?.legacyFryClaimedSnapshot} isError={!!batchError || totalsError} />}
      {/* Phase 3: Virtual device activation banner */}
      {pendingVirtualDevices.length > 0 && <VirtualActivationBanner devices={pendingVirtualDevices} sessionAddress={session?.user?.address || ''} />}
      {/* Phase 4: Credential onboarding banner */}
      <CredentialsBanner />
      <div className="mx-2 sm:mx-20 mt-6 rounded-xl border border-divider bg-surface-elevated overflow-hidden">
        <button
          type="button"
          onClick={() => setStatsOpen(o => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-surface-strong"
        >
          <span className="text-sm font-semibold text-ink-primary">
            Network Overview: {minerDevices.length} miner{minerDevices.length !== 1 ? 's' : ''}, {nodeDevices.length} node{nodeDevices.length !== 1 ? 's' : ''}
          </span>
          <ChevronDownIcon className={`h-5 w-5 text-ink-secondary transition-transform duration-200 ${statsOpen ? 'rotate-180' : ''}`} />
        </button>
        {statsOpen && (
          <div className="border-t border-divider">
            <StatsGrid devices={devices} minerDevices={minerDevices} nodeDevices={nodeDevices} hardwareStatusMap={hardwareStatus} />
          </div>
        )}
      </div>
      <div className="w-full mt-10 px-2 sm:px-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <QuickActionCard title="Onboard a Miner or Node" description="Walk through ownership verification, staking, and portal linking to bring Fry hardware online." cta="Start onboarding" icon={PlusCircleIcon} onClick={handleAdd} />
          <QuickActionCard title="Activate BYOD License" description="Turn your BYOD license into a Fry miner key with a guided conversion." cta="Generate miner key" icon={KeyIcon} onClick={handleByod} />          
          <QuickActionCard title="December 2024 FRY 1.0 Conversion" description="Review your Dec 1, 2024 FRY 1.0 snapshot balance and choose a conversion into FRY 2.0 or fNode." cta="Review snapshot" icon={SwitchHorizontalIcon} onClick={handleConversion} loading={isProcessing} />
          <QuickActionCard title="August 2025 FRY 1.0 Conversion" description="Convert FRY 1.0 acquired after Dec 2024 snapshot into tFRY at 40:1 ratio with no vesting." cta="Start conversion" icon={SwitchHorizontalIcon} onClick={handlePostSnapshotConversion} />

        </div>
      </div>
      {session?.user?.address && <div className={`mt-6 mx-2 sm:mx-20 rounded-2xl border p-5 ${isDark ? 'border-success-500/30 bg-success-500/10' : 'border-success-200 bg-success-50'}`}>
          <h3 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>
            Need a FEM key to compete?
          </h3>
          <p className={`mt-1 text-sm ${isDark ? 'text-white/70' : 'text-slate-600'}`}>
            Generate a free FEM key and register it to start competing. Your key will be created instantly and linked to your wallet.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={handleClaimFreeFem} disabled={claiming} className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${claiming ? 'opacity-50 cursor-not-allowed bg-gray-500 text-white' : isDark ? 'bg-success-600 hover:bg-success-500 text-white' : 'bg-success-600 hover:bg-success-700 text-white'}`}>
              {claiming ? 'Generating...' : 'Generate Free FEM Key'}
            </button>
            {claimError && <span className="text-sm text-error-400">{claimError}</span>}
          </div>
        </div>}
    {/* Totals banner removed; now provided in top Navbar ribbon */}
    {/* D1: Page header actions */}
    <div className="flex flex-wrap items-center gap-3 mt-6 mx-2 sm:mx-20">
      <button
        onClick={handleAdd}
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
          isDark
            ? 'bg-primary-600 hover:bg-primary-500 text-white'
            : 'bg-primary-600 hover:bg-primary-700 text-white'
        }`}
      >
        <PlusCircleIcon className="h-4 w-4" />
        Add Device
      </button>
      {((totals?.totals.fnode?.claimable ?? 0) > 0 || (totals?.totals.tfry?.claimable ?? 0) > 0) && (
        <Link href="/history">
          <button
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              isDark
                ? 'bg-warning-500 hover:bg-warning-400 text-black'
                : 'bg-warning-500 hover:bg-warning-600 text-white'
            }`}
          >
            Claim Rewards →
          </button>
        </Link>
      )}
    </div>
    <Flex flexDirection="col" className="w-full px-2 sm:px-20 mt-5">
      {/* Sort controls */}
      <div className="flex flex-row items-center gap-4 mb-4">
        <label htmlFor="sortField" className={isDark ? 'text-white' : 'text-slate-900'}>Sort by:</label>
        <select id="sortField" value={sortField} onChange={e => setSortField(e.target.value as 'nickname' | 'miner_key' | 'created_at')} className="rounded p-1 text-black">
          <option value="nickname">Nickname</option>
          <option value="miner_key">Miner Key</option>
          <option value="created_at">Date of Registration</option>
        </select>
        <button onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')} className="rounded bg-gray-700 text-white px-2 py-1">
          {sortDirection === 'asc' ? 'Ascendant ↑' : 'Descendant ↓'}
        </button>
      </div>
        {filteredDevices.length > 0 ? filteredDevices.map((device, index) => {
            const product = findProductByMinerKey(device.miner_key, products);
            if (!product) {
              return <div key={device.miner_key} className="rounded-xl border border-warning-500/30 bg-warning-500/5 p-4">
                  <div className="text-sm font-medium text-warning-200">{device.name || device.miner_key}</div>
                  <div className="text-xs font-mono text-warning-300/70 mt-1">{device.miner_key}</div>
                  <div className="text-xs text-warning-400 mt-2">Product configuration missing for this device type. Contact admin to configure.</div>
                </div>;
            }
            return <DeviceListItem key={device.miner_key} initialDevice={device} batchRewardSummary={batchSummaries?.[device.miner_key]} batchDeviceInfo={batchDeviceInfos?.[device.miner_key]} batchOptInStatus={batchTokenBalances?.[device.miner_key]} batchRewardError={!!batchError} batchDeviceError={!!deviceInfoError} batchTokenError={!!tokenBalanceError} product={product!} tokenMetadata={tokenMetadata} stakeable={isProductStakeAvailable(product!)} initialStatus={statusFallback[device.miner_key]} hardwareStatus={hardwareStatus[device.miner_key]} handleStakeRequirement={handleStakeRequirement} handleDeleteButton={handleDeleteButton} handleChange={handleChange} handleSetting={handleSetting} handleBoostButton={handleBoostButton} handleClaimButton={handleClaimButton} handleWithdrawStake={handleWithdrawStake} handleWithdrawAllButton={handleWithdrawAllButton}
            // handleAlgoWithdrawButton={handleAlgoWithdrawButton}
            />;
          }) : (
            <div className={`rounded-2xl border p-8 text-center ${isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-white'}`}>
              <svg className={`mx-auto mb-4 h-12 w-12 ${isDark ? 'text-gray-600' : 'text-slate-300'}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
              <h3 className={`text-lg font-semibold mb-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {devices.length === 0 ? 'No devices yet' : 'No devices match your filters'}
              </h3>
              <p className={`text-sm mb-4 ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                {devices.length === 0
                  ? "Add your first device to start tracking rewards and performance."
                  : "Try adjusting your search or filter criteria."}
              </p>
              {devices.length === 0 && (
                <button
                  type="button"
                  onClick={handleAdd}
                  className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition ${
                    isDark
                      ? 'bg-primary-600 hover:bg-primary-500 text-white'
                      : 'bg-primary-600 hover:bg-primary-700 text-white'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add your first device
                </button>
              )}
              {devices.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setStatusFilter('all'); setTypeFilter('all'); }}
                  className="text-sm font-semibold text-primary-400 hover:text-primary-300"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}
      </Flex>
      <AddDeviceModal modalName="addDevice" handleRegister={handleRegister} />
      <ByodConvertModal modalName="byodConvert" address={session?.user?.address} handleRegister={mk => handleRegister(mk)} // Reuse existing register flow after conversion
        />
      <Fry1CheckModal modalName="fry1Check" isOpen={showFry1Check} onClose={() => setShowFry1Check(false)} onStartConversion={() => {
          setShowFry1Check(false);
          setShowFryConversion(true);
          openModal('fryConversion');
        }} />
      {showFryConversion && <FryConversionModal modalName="fryConversion" address={addr} onClose={() => setShowFryConversion(false)} />}
      {showPostSnapshotConversion && <PostSnapshotConversionModal modalName="postSnapshotConversion" address={addr} onClose={() => setShowPostSnapshotConversion(false)} />}
      {selectedDevice && <>
          <StakeModal modalName={'stake'} device={selectedDevice} product={selectedProduct!} stakeContext={stakeContext} handleStakingUpdate={handleStakingUpdate} />
          <WithdrawModal modalName={'withdraw'} device={selectedDevice} product={selectedProduct!} handleWithdrawUpdate={handleWithdrawUpdate} />
          <BoostModal modalName="boost" miner_key={selectedDevice.miner_key} rewardAssetId={selectedProduct?.reward?.tokens?.reward} handleBoost={handleBoost} />
          <ClaimModal modalName="claim" miner_key={selectedDevice.miner_key} handleClaim={handleClaim} />
          <DeleteModal modalName="delete" miner_key={selectedDevice.miner_key} handleDelete={handleDelete} />
          <WithdrawAllModal modalName="withdraw_all" device={selectedDevice} product={findProductByMinerKey(selectedDevice.miner_key, products)!} handleWithdrawAll={handleWithdrawAll} />

          {/* <WithdrawAlgoModal
            modalName="withdraw_algo"
            device={selectedDevice}
            handleAlgoWithdraw={handleAlgoWithdraw}
           /> */}
        </>}
    </div>
    </SWRConfig>
      </PageShell>;
    </WalletGate>
  );
};
export async function getServerSideProps(context: any) {
  const testMode = process.env.NEXT_PUBLIC_TEST_MODE && process.env.NEXT_PUBLIC_TEST_MODE === 'true';
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session || !session.user.address) {
    return {
      props: {}
    };
  }
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const {
      hydrateDeviceWithPosition
    } = await import('../lib/devicePosition');

    // Initialize variables at function scope
    let rewardFallback: Record<string, Summary> = {};
    let statusFallback: Record<string, any> = {};

    // const collection = db.collection('rewards');
    // let query = { miner_key: { $regex: "ISM-3VMFG9XP18V5U9WQR70NC111ZTBTJNYF", $options: "i" } };
    // let records = await collection
    //   .find(query, {})
    //   .toArray();

    // for (const doc of records) {
    //   if (doc.status === "claimable") {
    //     await collection.updateOne(
    //       { _id: doc._id }, // Match the document by its unique _id
    //       { $set: { status: "pending" } } // Update the 'code' field with the new value
    //     );
    //   }
    // }

    // const collection = db.collection('devices');
    // const rCollection = db.collection('rewards');
    // let query = { miner_key: { $regex: "OMAQM", $options: "i" } };

    // let records = await collection
    //   .find({is_registered: true})
    //   .toArray();

    // console.log(records.length);

    // // console.log('IMAQM Counts: ', records);

    // for (const doc of records) {
    //   if (doc.miner_key) {
    //     query = { miner_key: { $regex: doc.miner_key, $options: "i"} };
    //     let rewardsList = await rCollection.find(query, {}).toArray();
    //     // console.log('Rewards List: ', rewardsList);

    //     let index = 1;

    //     for (const ele of rewardsList) {
    //       if (ele.no) {
    //         await rCollection.updateOne(
    //             { _id: ele._id }, // Match the document by its unique _id
    //             { $set: { no: index } } // Update the 'code' field with the new value
    //           );
    //       }
    //       index++;
    //     }
    //     // const updatedCode = doc.miner_key.replace(/IMAQM/gi, "OMAQM");
    //     // await collection.updateOne(
    //     //   { _id: doc._id }, // Match the document by its unique _id
    //     //   { $set: { miner_key: updatedCode } } // Update the 'code' field with the new value
    //     // );
    //   }
    // }

    const devicesCollection = db.collection<Device>(testMode ? 'test-devices' : 'devices');
    // Resolve user _id for user_id fallback (matches my-keys.ts pattern).
    // user_id stored as ObjectId in devices (sampled 2026-07-04); query both forms for defensive match.
    const userDoc = await db.collection('registration-users').findOne(
      { address: session.user.address },
      { projection: { _id: 1 } }
    );
    const userIdString = userDoc?._id?.toString();
    const userObjectId = userDoc?._id;
    const ownershipClauses: any[] = [{ address: session.user.address }];
    if (userObjectId) ownershipClauses.push({ user_id: userObjectId });
    if (userIdString && userIdString !== userObjectId?.toString()) ownershipClauses.push({ user_id: userIdString });

    const devicesRaw = await devicesCollection.find({
      $and: [
        { $or: ownershipClauses },
        { $or: [{
          is_registered: true
        }, {
          virtual: true,
          activated: true
        }] }
      ]
    }, {
      projection: {
        address: 1,
        byod: 1,
        is_registered: 1,
        miner_key: 1,
        name: 1,
        nickname: 1,
        position: 1,
        reward_wallet: 1,
        staked: 1,
        stake_type: 1,
        verified: 1,
        hexId: 1,
        created_at: 1,
        email: 1,
        registered_portal_model: 1,
        legacy_stake_unlocked: 1,
        virtual: 1,
        activated: 1,
        registration: 1,
        node: 1
      }
    }).toArray();
    await Promise.all(devicesRaw.map(async rawDevice => {
      if (shouldForceLegacyUnverified(rawDevice) && rawDevice.verified) {
        await devicesCollection.updateOne({
          _id: rawDevice._id
        }, {
          $set: {
            verified: false
          }
        });
        rawDevice.verified = false;
      }
    }));
    const devices = await Promise.all(devicesRaw.map((device: any) => hydrateDeviceWithPosition(client, device)));

    // Active-device tracking: any poc_reward_dailies record within last 14 days means active.
    const TRACKED_PREFIXES = ['BM', 'FEM', 'RDN', 'SDN', 'SVN', 'CN'];
    const activeMinerKeys = new Set<string>();
    const deviceMinerKeys = devices.map((d: any) => d.miner_key).filter(Boolean);
    if (deviceMinerKeys.length > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 14);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const pocDocs = await db.collection('poc_reward_dailies').find(
        { miner_key: { $in: deviceMinerKeys }, date: { $gte: cutoffStr } },
        { projection: { miner_key: 1 } }
      ).toArray();
      for (const doc of pocDocs) {
        if (doc.miner_key) activeMinerKeys.add(doc.miner_key);
      }
    }

    // Phase 3: Fetch pending virtual devices for this user (by email match)
    const sessionEmail = session.user.email?.trim().toLowerCase();
    let pendingVirtualDevices: Array<{
      miner_key: string;
      name: string;
      order?: string;
      created_at?: string;
    }> = [];
    if (sessionEmail) {
      const virtualRaw = await devicesCollection.find({
        email: new RegExp('^' + sessionEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'),
        virtual: true,
        activated: false
      }, {
        projection: {
          miner_key: 1,
          name: 1,
          order: 1,
          created_at: 1
        }
      }).toArray();
      pendingVirtualDevices = JSON.parse(JSON.stringify(virtualRaw));
    }
    const products = await db.collection('products').find({}).toArray();
    const tokenDocuments = (await db.collection('tokens').find({}).toArray()) as unknown as FryToken[];
    const tokenMetadata = tokenDocuments.reduce((acc, token) => {
      const assetId = token && typeof token.asset_id !== 'undefined' ? String(token.asset_id) : undefined;
      if (!assetId || assetId.length === 0) {
        return acc;
      }
      const entry: {
        name?: string;
        shortName?: string;
        unitName?: string;
        symbol?: string;
      } = {};
      if (typeof token.name === 'string' && token.name.trim()) {
        entry.name = token.name.trim();
      }
      const rawShort = (token as any)?.short_name ?? (token as any)?.shortName ?? (token as any)?.ticker ?? undefined;
      if (typeof rawShort === 'string' && rawShort.trim()) {
        entry.shortName = rawShort.trim();
      }
      const rawUnit = (token as any)?.unit_name ?? (token as any)?.unitName ?? undefined;
      if (typeof rawUnit === 'string' && rawUnit.trim()) {
        entry.unitName = rawUnit.trim();
      }
      if (typeof (token as any)?.symbol === 'string' && (token as any).symbol.trim()) {
        entry.symbol = (token as any).symbol.trim();
      }
      acc[assetId] = entry;
      return acc;
    }, {} as Record<string, {
      name?: string;
      shortName?: string;
      unitName?: string;
      symbol?: string;
    }>);
    const serializedTokenMetadata = JSON.parse(JSON.stringify(tokenMetadata));

    // Server-side reward summary prefetch for all devices
    const minerKeys: string[] = devices?.map((d: any) => d.miner_key) || [];
    if (minerKeys.length > 0) {
      for (const d of devices as any[]) {
        const product = products.find((p: any) => p.key === d.miner_key.split('-')[0]);
        const status = computeDeviceStatus({
          address: d.address,
          byod: d.byod,
          created_at: d.created_at,
          email: d.email,
          names: d.names,
          hexId: d.hexId,
          is_registered: d.is_registered,
          miner_key: d.miner_key,
          name: d.name,
          nickname: d.nickname,
          position: d.position,
          reward_wallet: d.reward_wallet,
          staked: d.staked,
          stake_type: d.stake_type,
          verified: d.verified,
          virtual: d.virtual,
          activated: d.activated,
          registration: d.registration,
          node: d.node,
          _id: d._id,
          __v: d.__v
        } as any, product as any);
        if (status) {
          statusFallback[d.miner_key] = status;
        }
      }
    }
    return {
      props: {
        initialDevices: JSON.parse(JSON.stringify(devices.map(device => ({
          address: device.address,
          byod: device.byod,
          is_registered: device.is_registered,
          miner_key: device.miner_key,
          name: device.name,
          nickname: device.nickname,
          position: device.position,
          reward_wallet: device.reward_wallet,
          staked: device.staked,
          stake_type: device.stake_type,
          verified: device.verified,
          legacy_stake_unlocked: device.legacy_stake_unlocked,
          hexId: device.hexId,
          created_at: device.created_at,
          email: device.email,
          registered_portal_model: device.registered_portal_model,
          names: device.names,
          registration: device.registration,
          node: device.node,
          is_active: TRACKED_PREFIXES.includes(device.miner_key.split('-')[0])
            ? activeMinerKeys.has(device.miner_key)
            : undefined
        })))),
        products: JSON.parse(JSON.stringify(products.map(product => ({
          name: product.name,
          key: product.key,
          reward: product.reward,
          color: product.color,
          display_name: product.display_name
        })))),
        rewardFallback,
        statusFallback,
        tokenMetadata: serializedTokenMetadata,
        pendingVirtualDevices
      }
    };
  } catch (e) {
    console.error(e);
    return {
      props: {}
    };
  }
}
export default DevicesPage;
