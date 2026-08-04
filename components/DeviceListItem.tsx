import { Button, Title } from '@tremor/react';
import Image, { type StaticImageData } from 'next/image';
import { Device, Product } from '../lib/types';
import CopyAddress from './CopyAddress';
import DeleteIcon from './DeleteIcon';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  ReactNode,
  useRef,
  MouseEvent as ReactMouseEvent
} from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { isProductStakeAvailable } from '../pages/devices';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  computeDeviceStatus,
  isNodeProduct,
  isNodeStaked,
  isRegistrationStaked,
  isRegistrationNeeded,
  isNodeStakingNeeded,
  anchorIdForMinerKey,
  REWARD_STATUS_DESCRIPTIONS,
  isBoostAssetSupported
} from '../lib/utils';
import { getLegacyForceTimestamp, isLegacyVerificationStake } from '../lib/legacyStake';
import { describeMacIssue, validateMacAddress } from '../lib/validators/macAddressValidator';
import { InformationCircleIcon } from '@heroicons/react/outline';
// import WithdrawIcon from './WithdrawIcon';
import StakingIcon from './StakeIcon';
import EditIcon from './EditIcon';
import SettingIcon from './SettingIcon';
import { useSession } from 'next-auth/react';
import Tooltip from './Tooltip';
import { useRewardSummary, type Summary } from '../lib/hooks/useRewardSummary';
import { useToastContext } from '../hooks/ToastContext';
import { useWallet } from '@txnlab/use-wallet-react';
import { useTheme } from 'next-themes';
import tfryOptInQr from '../opt-in-qrcodes/tFry-Opt-in.png';
import fNodeOptInQr from '../opt-in-qrcodes/fNode-Opt-in.png';
import fry2OptInQr from '../opt-in-qrcodes/FRY2-Opt-in.png';
import fVpnOptInQr from '../opt-in-qrcodes/fVPN-Opt-in.png';
import { FRY_2, fNODE, fVPN, tFRY } from '../lib/utils';

// Env-driven portal credential requirement parsing (matches logic in pages/devices.tsx)
const _CREDENTIALS_NEEDED_RAW = (process.env.NEXT_PUBLIC_CREDENTIALS_NEEDED || '').trim();
function parseCredentialsNeeded(): Set<string> {
  if (!_CREDENTIALS_NEEDED_RAW) {
    return new Set(['ALL']);
  }
  const v = _CREDENTIALS_NEEDED_RAW.toUpperCase();
  if (v === 'NONE' || v === 'FALSE' || v === '0') return new Set();
  if (v === 'ALL' || v === 'TRUE' || v === '1') return new Set(['ALL']);
  return new Set(v.split(',').map(s => s.trim()).filter(Boolean));
}
const CREDENTIALS_NEEDED = parseCredentialsNeeded();
const LEGACY_FORCE_TIMESTAMP = getLegacyForceTimestamp();
const LEGACY_FORCE_DATE = LEGACY_FORCE_TIMESTAMP ? new Date(LEGACY_FORCE_TIMESTAMP) : null;

function isLinkRequiredForPrefix(prefix: string) {
  if (!CREDENTIALS_NEEDED || CREDENTIALS_NEEDED.size === 0) return false;
  if (CREDENTIALS_NEEDED.has('ALL')) return true;
  return CREDENTIALS_NEEDED.has(prefix);
}

// Hardware MAC check is independent of credential portal requirements —
// the hardware type list at the call site already filters which prefixes need it.
function isHardwareCheckRequiredForPrefix(prefix: string) {
  return true;
}

function serializeDeviceSnapshot(device: Device | undefined): string {
  if (!device) {
    return '';
  }
  try {
    return JSON.stringify(device);
  } catch {
    return `${device.miner_key ?? ''}|${device.updated_at ?? ''}`;
  }
}

type TokenConfig = {
  stake?: string;
  reward?: string;
  register?: string;
  node?: string;
};

type TokenMetadataEntry = {
  name?: string;
  shortName?: string;
  unitName?: string;
  symbol?: string;
};

type TokenMetadataMap = Record<string, TokenMetadataEntry>;

type IssueBadgeInfo = {
  label: string;
  info?: string;
};

type RewardWalletOptInStatus = 'unknown' | 'checking' | 'missing' | 'present';

export default function DeviceListItem({
  initialDevice,
  batchRewardSummary,
  batchDeviceInfo,
  batchOptInStatus,
  batchRewardError,
  batchDeviceError,
  batchTokenError,
  product,
  tokenMetadata = {},
  stakeable,
  handleDeleteButton,
  handleStakeRequirement,
  handleChange,
  handleSetting,
  handleBoostButton,
  handleClaimButton,
  handleWithdrawStake,
  handleWithdrawAllButton,
  initialStatus,
  hardwareStatus,
  waivedMinerTypes
  // handleAlgoWithdrawButton,
}: {
  initialDevice: Device;
  batchRewardSummary?: Summary;
  batchDeviceInfo?: Device;
  batchOptInStatus?: { opted_in: boolean };
  batchRewardError?: boolean;
  batchDeviceError?: boolean;
  batchTokenError?: boolean;
  product: Product;
  stakeable: boolean;
  handleDeleteButton: (device: Device) => void;
  handleStakeRequirement: (device: Device, requirement: 'registration' | 'node') => void;
  handleChange: (miner_key: string) => Promise<void>;
  handleSetting: (miner_key: string) => Promise<void>;
  handleBoostButton: (device: Device) => Promise<void>;
  handleClaimButton: (device: Device) => void;
  handleWithdrawStake: (device: Device) => void;
  handleWithdrawAllButton: (device: Device) => void;
  initialStatus?: { [key: string]: string } | undefined;
  tokenMetadata?: TokenMetadataMap;
  hardwareStatus?: {
    linked: boolean;
    valid: boolean;
    miner_mac?: string;
    device_mac?: string;
    mac_match?: boolean;
    mac_last_changed?: string;
    reason?: string;
    detail?: string;
  };
  waivedMinerTypes?: string[];
  // handleAlgoWithdrawButton: (device: Device) => void;
}) {
  const toast = useToastContext();
  const [pendingAmount, setPendingAmount] = useState(0);
  const [claimableAmount, setClaimableAmount] = useState(0);
  const [claimedAmount, setClaimedAmount] = useState(0);
  const [alertShow, setAlertShow] = useState(
    Boolean(initialStatus && Object.keys(initialStatus).length > 0)
  );
  const [deviceStatus, setDeviceStatus] = useState<{ [key: string]: string }>(
    (initialStatus as any) || {}
  );
  const [device, setDevice] = useState<Device>(initialDevice);
  useEffect(() => { if (batchDeviceInfo) setDevice(prev => Object.assign(Object.assign(Object.create(Object.getPrototypeOf(prev) ?? Object.prototype), prev), batchDeviceInfo)); }, [batchDeviceInfo]);
  const initialDeviceSnapshot = useRef<string>('');
  const { data: session } = useSession();
  const { wallets } = useWallet();
  const activeWallet = useMemo(() => wallets.find(w => w.isActive), [wallets]);
  const isLegacyStake = useMemo(() => isLegacyVerificationStake(device), [device]);
  const legacyDeadlineLabel = useMemo(() => {
    if (!LEGACY_FORCE_DATE) return null;
    return LEGACY_FORCE_DATE.toUTCString();
  }, []);
  const [expanded, setExpanded] = useState(false);
  const [isPortalReady, setIsPortalReady] = useState(false);
  const [rewardWalletOptInStatus, setRewardWalletOptInStatus] = useState<RewardWalletOptInStatus>('unknown');
  const [optInQr, setOptInQr] = useState<{
    assetId: string;
    label: string;
    reason: string;
    src: StaticImageData;
  } | null>(null);

  // MAC address self-service state
  const [registeredMacInput, setRegisteredMacInput] = useState('');
  const [macSaveLoading, setMacSaveLoading] = useState(false);
  const [macSaveError, setMacSaveError] = useState<string | null>(null);

  useEffect(() => {
    setIsPortalReady(true);
  }, []);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  // Theme-aware primitives reused across the card to avoid re-declaring in hooks
  const cardBaseClass = isDark
    ? 'bg-black/60 text-white border-slate-700/80 shadow-md focus-visible:ring-offset-black'
    : 'bg-white/90 text-slate-900 border-slate-200 shadow-[0_16px_40px_-22px_rgba(15,23,42,0.35)] backdrop-blur focus-visible:ring-offset-white';
  const focusRingClass = isDark ? 'focus-visible:ring-red-500/70' : 'focus-visible:ring-red-300/80';
  const metricTileClass = isDark
    ? 'rounded-lg border border-gray-800/80 bg-black/60'
    : 'rounded-lg border border-slate-200 bg-white/95 shadow-sm';
  const metricLabelClass = isDark ? 'text-gray-500' : 'text-slate-500';
  const iconButtonClass = isDark
    ? 'inline-flex items-center gap-1.5 p-1.5 text-white/70 transition hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400'
    : 'inline-flex items-center gap-1.5 p-1.5 text-slate-600 transition hover:text-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300';
  const subTextMuted = isDark ? 'text-gray-400' : 'text-slate-600';
  const textStrong = isDark ? 'text-white' : 'text-slate-900';
  const textGreen = isDark ? 'text-green-300' : 'text-emerald-800';
  const textRed = isDark ? 'text-red-300' : 'text-red-700';
  const textAmber = isDark ? 'text-warning-100' : 'text-warning-800';
  const textGray = isDark ? 'text-gray-500' : 'text-slate-500';
  const overlayClass = isDark ? 'bg-black/70' : 'bg-black/40';
  const modalShellClass = isDark
    ? 'relative mt-6 max-h-[82vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-gray-800 bg-black/95 p-6 text-gray-100 shadow-2xl'
    : 'relative mt-6 max-h-[82vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-[0_28px_80px_-36px_rgba(15,23,42,0.5)]';
  const modalSectionClass = isDark
    ? 'rounded-xl border border-gray-800 bg-black/70'
    : 'rounded-xl border border-slate-200 bg-slate-50';
  const modalDividerClass = isDark ? 'border-gray-800' : 'border-slate-200';
  const modalTextHeading = isDark ? 'text-gray-200' : 'text-slate-800';
  const modalTextMuted = isDark ? 'text-gray-400' : 'text-slate-600';

  const openDetails = () => {
    // Force key sections open each time the drawer opens so users always see earnings + contact first.
    setExpandedSections((prev) => ({ ...prev, rewards: true, contact: true }));
    setExpanded(true);
  };
  const closeDetails = () => setExpanded(false);

  const femVerificationExempt = typeof device?.miner_key === 'string' && device.miner_key.startsWith('FEM-') && Boolean(device?.is_registered && device?.reward_wallet);
  const femBadgeVerified = femVerificationExempt && Boolean(device?.staked?.time);
  const deviceStatusOkay = (device?.verified === true || femBadgeVerified) && alertShow === false;

  const router = useRouter();
  const isStaked = useCallback(() => {
    if (!device) {
      return false;
    }

    if (!device.verified) {
      if (femVerificationExempt && Boolean(device?.staked?.time)) {
        return true;
      }
      return false;
    }

    return true;
  }, [device]);

  const minerPrefix = device.miner_key.split('-')[0];
  const linkRequiredForPrefix = isLinkRequiredForPrefix(minerPrefix);
  const needsHardwareCheck =
    ['AEM', 'CN', 'RDN', 'SDN', 'SVN', 'BM', 'ISM', 'OSM', 'IDM', 'ODM'].includes(minerPrefix) &&
    isHardwareCheckRequiredForPrefix(minerPrefix);
  const hardwareWarning = needsHardwareCheck && hardwareStatus ? (!hardwareStatus.linked || !hardwareStatus.valid) : false;
  // Track whether computeDeviceStatus flagged any blocking profile/setup issues.
  const hasDeviceStatusIssues = alertShow && Object.keys(deviceStatus).length > 0;
  const hasVerificationStake = Boolean(device?.verified);

  const issueMessages = useMemo<IssueBadgeInfo[]>(() => {
    if (!alertShow) return [];
    const editInfoHint = 'Click the Edit info (pencil) button to update this detail.';
    const rewardHint = 'Use Edit info to set the reward wallet that should receive payouts.';
    const locationHint = 'Open Edit info and drop the correct pin on the map.';
    const stakeHint = 'Use the Stake button to complete this staking step before verification.';

    const makeIssue = (label: string, info?: string): IssueBadgeInfo => ({ label, info });

    return Object.entries(deviceStatus)
      .filter(([key]) => key !== 'hardware')
      .map(([key, value]) => {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        const containsNotSet = /not\s+set/i.test(trimmed);
        switch (key) {
          case 'position': {
            let label: string;
            if (!trimmed) {
              label = 'Position not set';
            } else if (/^position\b/i.test(trimmed)) {
              label = containsNotSet ? 'Position not set' : trimmed;
            } else if (containsNotSet) {
              label = 'Position not set';
            } else {
              label = `Position ${trimmed}`;
            }
            return makeIssue(label, locationHint);
          }
          case 'reward_wallet': {
            let label: string;
            if (!trimmed) {
              label = 'Reward wallet not set';
            } else if (/^reward\s+wallet\b/i.test(trimmed)) {
              label = containsNotSet ? 'Reward wallet not set' : trimmed;
            } else if (containsNotSet) {
              label = 'Reward wallet not set';
            } else {
              label = `Reward wallet ${trimmed}`;
            }
            return makeIssue(label, rewardHint);
          }
          case 'email':
            return makeIssue(trimmed || 'Email not set', editInfoHint);
          case 'first_name':
            return makeIssue(trimmed || 'First name not set', editInfoHint);
          case 'last_name':
            return makeIssue(trimmed || 'Last name not set', editInfoHint);
          case 'registration':
            return makeIssue(trimmed || 'Registration staking required', stakeHint);
          case 'node':
            return makeIssue(trimmed || 'Node operation staking required', stakeHint);
          default:
            return makeIssue(trimmed || key, editInfoHint);
        }
      })
      .filter((issue): issue is IssueBadgeInfo => Boolean(issue?.label));
  }, [alertShow, deviceStatus]);

  const summaryBadges = useMemo(() => {
    const palette = {
      // Red badges: keep dark mode unchanged; in light mode use a stronger fill and darker text for legibility.
      red: isDark
        ? 'bg-red-500/20 text-warning-200 border border-red-400/40'
        : 'bg-red-200 text-red-800 border border-red-400',
      warning: isDark
        ? 'bg-warning-500/20 text-warning-200 border border-warning-400/40'
        : 'bg-warning-50 text-warning-800 border border-warning-200',
      green: isDark
        ? 'bg-green-500/20 text-green-200 border border-green-400/40'
        : 'bg-emerald-50 text-emerald-800 border border-emerald-200',
    };
    type Badge = { label: string; className: string; severity: 'red' | 'warning' | 'green' | 'default'; info?: string };
    const badges: Array<Badge> = [];
    if (product) {
      badges.push({
        label: product.display_name ?? product.name ?? minerPrefix,
        className: `${product.color ?? 'bg-gray-500'} text-white border border-white/20`,
        severity: 'default'
      });
    }
    const portalHelp =
      'Open the gear icon (Portal settings) and complete the Fry portal link so rewards keep flowing.';
    if (!device.registered_portal_model) {
      if (isLinkRequiredForPrefix(minerPrefix)) {
        badges.push({
          label: 'Portal link needed',
          className: palette.red,
          severity: 'red',
          info: portalHelp
        });
      }
    }

    if (isHardwareCheckRequiredForPrefix(minerPrefix) && hardwareWarning) {
      const label = hardwareStatus?.linked ? 'MAC invalid' : 'MAC link needed';
      const macInfo = hardwareStatus?.linked
        ? 'Open the gear icon and update the MAC address to match the sticker on your hardware.'
        : 'Use the gear icon to link this miner and add its MAC address so ops can validate it.';
      badges.push({
        label,
        className: palette.red,
        severity: 'red',
        info: macInfo
      });
    }

    badges.push(
      (device.verified || femBadgeVerified)
        ? { label: 'Verified', className: palette.green, severity: 'green' }
        : { label: 'Unverified', className: palette.warning, severity: 'warning' }
    );

    if (isLegacyStake) {
      badges.push({
        label: 'Legacy FRY 1.0 stake',
        className: palette.warning,
        severity: 'warning',
        info: 'Legacy FRY 1.0 verification stake detected. Withdraw the legacy stake and re-stake with FRY 2.0 to keep multiplier rewards.'
      });
    }

    issueMessages
      .filter(Boolean)
      .forEach((message) => {
        if (!badges.some((b) => b.label === message.label)) {
          badges.push({
            label: message.label,
            className: palette.red,
            severity: 'red',
            info: message.info
          });
        }
      });

    const severityRank: Record<Badge['severity'], number> = {
      red: 0,
      warning: 1,
      green: 2,
      default: 3
    };

    return badges.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  }, [
    device.registered_portal_model,
    device.verified,
    femBadgeVerified,
    isLegacyStake,
    issueMessages,
    minerPrefix,
    hardwareStatus?.linked,
    hardwareWarning,
    isDark
  ]);

  // Determine verification prerequisites based on product config and current device state
  const needsRegistration = isRegistrationNeeded(product, waivedMinerTypes);
  const needsNodeStake = isNodeProduct(product) && isNodeStakingNeeded(product);
  const hasRegistration = isRegistrationStaked(device);
  const hasNode = isNodeStaked(device);
  const verificationBlocked = (needsRegistration && !hasRegistration) || (needsNodeStake && !hasNode);
  const portalMissing = linkRequiredForPrefix && !device.registered_portal_model;
  const stakingPrereqsMissing = verificationBlocked;
  const shouldShowRed = stakingPrereqsMissing || portalMissing || hardwareWarning || hasDeviceStatusIssues;
  const shouldShowYellow = !shouldShowRed && !device.verified && !femBadgeVerified;
  const verificationReason = verificationBlocked
    ? `Complete ${
        needsRegistration && !hasRegistration && needsNodeStake && !hasNode
          ? 'registration and node operation staking'
          : needsRegistration && !hasRegistration
            ? 'registration staking'
            : 'node operation staking'
      } before verification`
    : undefined;
  const handleRequirementClick = useCallback(
    (requirement: 'registration' | 'node') => {
      handleStakeRequirement(device, requirement);
    },
    [device, handleStakeRequirement]
  );
  const handlePrimaryStakeRequirement = useCallback(() => {
    if (needsRegistration && !hasRegistration) {
      handleRequirementClick('registration');
      return;
    }
    if (needsNodeStake && !hasNode) {
      handleRequirementClick('node');
    }
  }, [handleRequirementClick, needsNodeStake, needsRegistration, hasNode, hasRegistration]);

  const { borderClass, hoverRingClass } = useMemo(() => {
    if (stakeable === false && !device.verified && !femVerificationExempt) {
      return {
        borderClass: 'border-gray-500',
        hoverRingClass: 'hover:ring-2 hover:ring-gray-400/70 hover:ring-offset-0',
      };
    }

    if (shouldShowRed) {
      return {
        borderClass: 'border-red-500',
        hoverRingClass: 'hover:ring-2 hover:ring-red-500/70 hover:ring-offset-0',
      };
    }

    if (shouldShowYellow) {
      return {
        borderClass: 'border-warning-400',
        hoverRingClass: 'hover:ring-2 hover:ring-warning-300/70 hover:ring-offset-0',
      };
    }

    if (deviceStatusOkay) {
      return {
        borderClass: 'border-green-500',
        hoverRingClass: 'hover:ring-2 hover:ring-green-400/70 hover:ring-offset-0',
      };
    }

    return {
      borderClass: 'border-gray-500',
      hoverRingClass: 'hover:ring-2 hover:ring-gray-400/70 hover:ring-offset-0',
    };
  }, [stakeable, device, shouldShowRed, shouldShowYellow, deviceStatusOkay]);

  const { data: _fetchedSummary } = useRewardSummary(!batchRewardSummary && batchRewardError ? device?.miner_key : undefined);
  const rewardSummary = batchRewardSummary ?? _fetchedSummary;
  const [countdown, setCountdown] = useState<string>("");
  const [verificationCountdown, setVerificationCountdown] = useState<string | null>(null);
  const anchorId = useMemo(() => anchorIdForMinerKey(device.miner_key), [device.miner_key]);

  // Normalise product token configuration so downstream tooltip helpers may look up defaults safely.
  const productTokens = useMemo<TokenConfig>(() => product?.reward?.tokens ?? {}, [product]);

  const formatDateTime = (value?: string | Date | null) => {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };

  const formatAmount = (amount?: number | null) =>
    typeof amount === 'number' && Number.isFinite(amount) ? amount.toLocaleString() : '—';

  const formatAssetId = useCallback(
    (assetId?: string | null, fallbackKey?: keyof typeof productTokens) => {
      if (assetId) return assetId;
      if (fallbackKey && typeof productTokens[fallbackKey] === 'string') {
        return productTokens[fallbackKey] as string;
      }
      return 'n/a';
    },
    [productTokens]
  );

  const resolveTokenDetail = useCallback(
    (assetId?: string | null, fallbackKey?: keyof typeof productTokens) => {
      const resolvedId = formatAssetId(assetId, fallbackKey);
      if (!resolvedId || resolvedId === 'n/a') {
        return {
          id: null as string | null,
          label: 'Token not configured',
          name: 'Token not configured'
        };
      }

      const meta = tokenMetadata?.[resolvedId];
      const labelCandidate =
        (meta?.unitName && meta.unitName.trim()) ||
        (meta?.shortName && meta.shortName.trim()) ||
        (meta?.symbol && meta.symbol.trim()) ||
        (meta?.name && meta.name.trim());
      const label = labelCandidate || `Asset ${resolvedId}`;
      const name = (meta?.name && meta.name.trim()) || label;

      return {
        id: resolvedId,
        label,
        name
      };
    },
    [formatAssetId, tokenMetadata]
  );

  const formatTx = (txId?: string | null) =>
    txId ? `${txId.slice(0, 6)}…${txId.slice(-6)}` : '—';

  const formatTokenAmount = (value: number) =>
    Number.isFinite(value)
      ? value.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      : '0.00';

  const formatUsdAmount = useCallback((value?: number | null) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    return `$${value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }, []);

  const StakeRequirementCTA = ({
    requirement,
    label,
    compact = false
  }: {
    requirement: 'registration' | 'node';
    label: string;
    compact?: boolean;
  }) => (
    <Button
      className={`bg-transparent ${
        compact ? 'min-w-[105px] py-1 text-[0.6rem]' : 'min-w-[130px] py-1.5 text-xs'
      } border-red-500 ${isDark ? 'text-red-100 hover:text-black' : 'text-slate-900'} hover:bg-red-500 hover:border-red-500`}
      onClick={() => handleRequirementClick(requirement)}
    >
      {label}
    </Button>
  );

  const truncateAddress = (value?: string) => {
    if (!value) return '—';
    return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
  };

  const rewardTokenDetail = useMemo(
    () => resolveTokenDetail(product?.reward?.tokens?.reward, 'reward'),
    [resolveTokenDetail, product?.reward?.tokens?.reward]
  );
  const optInQrByAssetId = useMemo(
    () => ({
      [tFRY.id]: {
        label: 'tFRY',
        reason: 'miner rewards',
        src: tfryOptInQr,
        enabled: true
      },
      [fNODE.id]: {
        label: 'fNode',
        reason: 'AEM / node rewards and staking',
        src: fNodeOptInQr,
        enabled: true
      },
      [FRY_2.id]: {
        label: 'FRY 2.0',
        reason: 'verification staking multipliers',
        src: fry2OptInQr,
        enabled: true
      },
      [fVPN.id]: {
        label: 'fVPN',
        reason: 'bandwidth miner rewards (coming soon)',
        src: fVpnOptInQr,
        enabled: false // flip to true when bandwidth miners monetize
      }
    }),
    []
  );
  const rewardAssetIdForOptIn =
    rewardTokenDetail.id && rewardTokenDetail.id !== 'n/a'
      ? rewardTokenDetail.id
      : null;
  const rewardWalletAddress = device.reward_wallet ?? null;

  const rewardTokenUnitLabel = rewardTokenDetail.id ? rewardTokenDetail.label : 'tokens';
  const boostSupported = useMemo(() => {
    const id = rewardTokenDetail.id ?? product?.reward?.tokens?.reward ?? '';
    return isBoostAssetSupported(id);
  }, [rewardTokenDetail.id, product?.reward?.tokens?.reward]);
  const stakeTokenDetail = useMemo(
    () => resolveTokenDetail(product?.reward?.tokens?.stake, 'stake'),
    [resolveTokenDetail, product?.reward?.tokens?.stake]
  );
  const registrationTokenDetail = useMemo(
    () => resolveTokenDetail(product?.reward?.tokens?.register, 'register'),
    [resolveTokenDetail, product?.reward?.tokens?.register]
  );
  const nodeTokenDetail = useMemo(
    () => resolveTokenDetail(product?.reward?.tokens?.node, 'node'),
    [resolveTokenDetail, product?.reward?.tokens?.node]
  );
  const registrationStakeUsd = useMemo(() => {
    const baseUsd = product?.reward?.stake?.register ?? 0;
    if (!device?.byod) return baseUsd;
    return Math.round((baseUsd / 2) * 100) / 100;
  }, [product?.reward?.stake?.register, device?.byod]);
  const nodeStakeUsd = useMemo(() => product?.reward?.stake?.node ?? 0, [product?.reward?.stake?.node]);
  const registrationRequirementHint = useMemo(() => {
    const usdLabel = formatUsdAmount(registrationStakeUsd);
    if (!usdLabel) return `Stake ${registrationTokenDetail.label}`;
    return `${usdLabel} USD in ${registrationTokenDetail.label}`;
  }, [formatUsdAmount, registrationStakeUsd, registrationTokenDetail.label]);
  const nodeRequirementHint = useMemo(() => {
    const usdLabel = formatUsdAmount(nodeStakeUsd);
    if (!usdLabel) return `Stake ${nodeTokenDetail.label}`;
    return `${usdLabel} USD in ${nodeTokenDetail.label}`;
  }, [formatUsdAmount, nodeStakeUsd, nodeTokenDetail.label]);

  useEffect(() => {
    if (batchOptInStatus) {
      setRewardWalletOptInStatus(batchOptInStatus.opted_in ? 'present' : 'missing');
      return;
    }
    if (!batchTokenError) return;
    // batch failed — fall back to per-device check
    if (!rewardWalletAddress || !rewardAssetIdForOptIn) {
      setRewardWalletOptInStatus('unknown');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setRewardWalletOptInStatus('checking');

    const checkOptIn = async () => {
      try {
        const response = await fetch('/api/algorand/get-token-balance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            address: rewardWalletAddress,
            asset_id: rewardAssetIdForOptIn
          }),
          signal: controller.signal
        });

        if (cancelled) return;

        if (!response.ok) {
          setRewardWalletOptInStatus('unknown');
          return;
        }

        const result = await response.json().catch(() => null);
        if (cancelled) return;
        setRewardWalletOptInStatus(result?.success ? 'present' : 'missing');
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error('[RewardOptIn] Failed to verify reward wallet opt-in', error);
        if (!cancelled) setRewardWalletOptInStatus('unknown');
      }
    };

    void checkOptIn();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [batchOptInStatus, batchTokenError, rewardAssetIdForOptIn, rewardWalletAddress]);


  const rewardWalletNeedsOptIn =
    Boolean(rewardWalletAddress && rewardAssetIdForOptIn) &&
    rewardWalletOptInStatus === 'missing';
  const rewardWalletChecking =
    Boolean(rewardWalletAddress && rewardAssetIdForOptIn) &&
    rewardWalletOptInStatus === 'checking';
  const rewardOptInInfo = rewardAssetIdForOptIn ? optInQrByAssetId[rewardAssetIdForOptIn] : undefined;
  const rewardOptInReason = rewardOptInInfo?.reason ?? 'this device';
  const rewardOptInLabel = rewardOptInInfo?.label ?? rewardTokenDetail.label;

  const handleRewardOptInClick = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!rewardAssetIdForOptIn) {
        return;
      }

      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(rewardAssetIdForOptIn);
          toast.success({
            heading: 'Asset ID copied',
            message: `ASA #${rewardAssetIdForOptIn} is ready to paste when opting in from your wallet.`
          });
        } else {
          throw new Error('Clipboard unavailable');
        }
      } catch {
        toast.info({
          heading: 'Asset ID',
          message: `Use ASA #${rewardAssetIdForOptIn} when opting in from your wallet.`
        });
      }
    },
    [rewardAssetIdForOptIn, toast]
  );

  const rewardOptInSteps =
    'Pera: Wallet/Account → + Add asset → paste the ASA ID → Opt In. Defly: Wallet/Account → … More → + Asset → paste the ASA ID → Opt In.';
  const deflyUnverifiedHint =
    (activeWallet?.id || '').toLowerCase() === 'defly' && rewardAssetIdForOptIn === tFRY.id
      ? 'Tip for Defly: toggle off “Show only verified tokens” in the top right to find tFRY before opting in.'
      : null;

  const handleRewardOptInGuideClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const assetId = rewardAssetIdForOptIn;
      if (!assetId) return;
      const qrEntry = optInQrByAssetId[assetId];
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
      const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);

      if (isMobile && typeof window !== 'undefined') {
        const explorerUrl = `https://explorer.perawallet.app/asset/${assetId}`;
        try {
          window.location.href = explorerUrl;
        } catch {
          window.open(explorerUrl, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      if (qrEntry?.enabled) {
        setOptInQr({
          assetId,
          label: qrEntry.label,
          reason: qrEntry.reason,
          src: qrEntry.src
        });
        return;
      }
      if (assetId && typeof window !== 'undefined') {
        const explorerUrl = `https://explorer.perawallet.app/asset/${assetId}`;
        window.open(explorerUrl, '_blank', 'noopener,noreferrer');
      }
    },
    [optInQrByAssetId, rewardAssetIdForOptIn]
  );


  const baseDailyReward =
    typeof product?.reward?.unverified === 'number' ? product.reward.unverified : null;

  const formatDailyValue = useCallback((value: number | null) => {
    if (value === null) return '—';
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }, []);

  const dailyRewardEntries = useMemo(() => {
    if (baseDailyReward === null) {
      return [];
    }

    const typeOneDaily = baseDailyReward * 1.5;
    const typeTwoDaily = baseDailyReward * 3;

    return [
      {
        key: 'base',
        tier: 'bronze' as const,
        label: 'No stake',
        description: 'Base daily rate without multiplier',
        value: baseDailyReward,
        accent: {
          light: 'text-[#374151]',
          dark: 'text-gray-200'
        }
      },
      {
        key: 'type1',
        tier: 'silver' as const,
        label: 'Type 1 • 1.5×',
        description: '24 hour lock multiplier',
        value: typeOneDaily,
        accent: {
          light: 'text-[#166534]',
          dark: 'text-green-300'
        }
      },
      {
        key: 'type2',
        tier: 'gold' as const,
        label: 'Type 2 • 3×',
        description: '6 month lock multiplier',
        value: typeTwoDaily,
        accent: {
          light: 'text-[#92400E]',
          dark: 'text-warning-300'
        }
      }
    ];
  }, [baseDailyReward]);

  const byodDiscountApplied = useMemo(
    () => Boolean(device?.byod && device.byod.length > 0),
    [device?.byod]
  );

  const hasStakeConfig = Boolean(product?.reward?.stake);

  const adjustStakeAmount = useCallback(
    (value?: number | null) => {
      if (typeof value !== 'number' || Number.isNaN(value)) return null;
      if (!byodDiscountApplied) return value;
      return Math.round((value * 100) / 2) / 100;
    },
    [byodDiscountApplied]
  );

  const stakeOneRequirement = useMemo(
    () => adjustStakeAmount(product?.reward?.stake?.stake_one ?? null),
    [adjustStakeAmount, product?.reward?.stake?.stake_one]
  );

  const stakeTwoRequirement = useMemo(
    () => adjustStakeAmount(product?.reward?.stake?.stake_two ?? null),
    [adjustStakeAmount, product?.reward?.stake?.stake_two]
  );

  const stakeOptions = useMemo(() => {
    if (!hasStakeConfig) return [];
    const options: Array<{
      key: 'one' | 'two';
      title: string;
      multiplier: string;
      description: string;
      amount: number | null;
    }> = [];

    if (stakeOneRequirement !== null) {
      options.push({
        key: 'one',
        title: 'Type 1 • 24 hour lock',
        multiplier: '1.5× multiplier',
        description: 'Short lock boosts to 1.5× daily rewards.',
        amount: stakeOneRequirement
      });
    }

    if (stakeTwoRequirement !== null) {
      options.push({
        key: 'two',
        title: 'Type 2 • 6 month lock',
        multiplier: '3× multiplier',
        description: 'Long lock delivers the maximum multiplier.',
        amount: stakeTwoRequirement
      });
    }

    return options;
  }, [hasStakeConfig, stakeOneRequirement, stakeTwoRequirement]);

  const verificationUnlockTime = useMemo(() => {
    if (!device?.staked?.time) return null;
    const base = new Date(device.staked.time);
    if (Number.isNaN(base.getTime())) return null;

    if (device.staked.type === 'two') {
      const sixMonthsLater = new Date(base);
      sixMonthsLater.setUTCMonth(sixMonthsLater.getUTCMonth() + 6);
      return sixMonthsLater;
    }

    return new Date(base.getTime() + 24 * 60 * 60 * 1000);
  }, [device?.staked?.time, device?.staked?.type]);

  const fetchDeviceInfo = useCallback(
    async (minerKey: string) => {
      try {
        const response = await fetch(`/api/devices/${minerKey}`, {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({ address: session?.user.address })
        });
        if (response.ok) {
          const data = await response.json();
          setDevice(prev => Object.assign(Object.assign(Object.create(Object.getPrototypeOf(prev) ?? Object.prototype), prev), data.device));
        }
      } catch (error) {
        console.error(error);
      }
    },
    [session?.user.address]
  );

  const checkDeviceStatus = useCallback(
    (
      targetDevice: Device,
      currentHardwareStatus?: {
        linked: boolean;
        valid: boolean;
        miner_mac?: string;
        device_mac?: string;
        mac_match?: boolean;
        mac_last_changed?: string;
        reason?: string;
        detail?: string;
      }
    ) => {
      const status = computeDeviceStatus(targetDevice, product);
      const combinedStatus: { [key: string]: string } = status ? { ...status } : {};
      let hasIssue = Boolean(status);

      const prefix = targetDevice.miner_key.split('-')[0];
      // Only perform hardware-related status checks when the environment
      // indicates hardware checks are required for this prefix.
      const needsHardwareCheck = ['AEM', 'CN', 'RDN', 'SDN', 'SVN', 'BM', 'ISM', 'OSM', 'IDM', 'ODM'].includes(prefix);
      const hardwareAllowed = needsHardwareCheck && isHardwareCheckRequiredForPrefix(prefix);

      if (hardwareAllowed && currentHardwareStatus) {
        if (!currentHardwareStatus.linked) {
          combinedStatus.hardware = 'MAC address not linked to FryNetworks.';
          hasIssue = true;
        } else if (!currentHardwareStatus.valid) {
          combinedStatus.hardware = describeMacIssue(currentHardwareStatus.detail ?? currentHardwareStatus.reason);
          hasIssue = true;
        }
      }

      if (hasIssue) {
        setDeviceStatus(combinedStatus);
        setAlertShow(true);
      } else {
        setDeviceStatus({});
        setAlertShow(false);
      }
    },
    [product]
  );

  useEffect(() => {
    const snapshot = serializeDeviceSnapshot(initialDevice);
    if (snapshot === initialDeviceSnapshot.current) {
      return;
    }
    initialDeviceSnapshot.current = snapshot;

    setDevice((prev) => {
      if (!prev) {
        return initialDevice;
      }

      const prototype = Object.getPrototypeOf(prev) ?? Object.prototype;
      const merged = Object.assign(Object.create(prototype), prev);
      Object.assign(merged, initialDevice);

      const preserveKeys: Array<keyof Device> = ['registration', 'node', 'staked'];
      for (const key of preserveKeys) {
        if (!Object.prototype.hasOwnProperty.call(initialDevice, key)) {
          (merged as any)[key] = prev[key];
        }
      }
      return merged;
    });
  }, [initialDevice]);

  useEffect(() => {
    if (!batchDeviceInfo && batchDeviceError) {
      fetchDeviceInfo(initialDevice.miner_key);
    }
  }, [batchDeviceInfo, batchDeviceError, fetchDeviceInfo, initialDevice.miner_key]);

  useEffect(() => {
    if (rewardSummary) {
      setPendingAmount(rewardSummary.pending || 0);
      setClaimableAmount(rewardSummary.claimable || 0);
      setClaimedAmount(rewardSummary.claimed || 0);
    }
    checkDeviceStatus(device, hardwareStatus);
  }, [checkDeviceStatus, device, hardwareStatus, rewardSummary]);

  // Simple countdown to next unlock (Friday 00:05 UTC) if provided by API
  useEffect(() => {
    if (!rewardSummary?.nextUnlockAt) {
      setCountdown('');
      return;
    }
    const target = new Date(rewardSummary.nextUnlockAt).getTime();
    const update = () => {
      const now = Date.now();
      const diff = Math.max(0, target - now);
      const days = Math.floor(diff / (24 * 60 * 60 * 1000));
      const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
      const secs = Math.floor((diff % (60 * 1000)) / 1000);
      setCountdown(`${days}d ${hours}h ${mins}m ${secs}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [rewardSummary?.nextUnlockAt]);

  useEffect(() => {
    if (!verificationUnlockTime) {
      setVerificationCountdown(null);
      return;
    }

    const formatRemaining = () => {
      const diff = verificationUnlockTime.getTime() - Date.now();
      if (diff <= 0) return 'Unlock available';

      const totalSeconds = Math.floor(diff / 1000);
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const parts: string[] = [];
      if (days > 0) parts.push(`${days}d`);
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0 && parts.length < 2) parts.push(`${minutes}m`);
      if (parts.length === 0) parts.push(`${seconds}s`);

      return `Unlocks in ${parts.join(' ')}`;
    };

    const update = () => setVerificationCountdown(formatRemaining());
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [verificationUnlockTime]);

  const verificationLocked = useMemo(() => {
    if (!hasVerificationStake) return false;
    if (isLegacyStake) return false;
    if (!verificationUnlockTime) return false;
    return verificationUnlockTime.getTime() > Date.now();
  }, [hasVerificationStake, isLegacyStake, verificationUnlockTime]);

  const verificationLockTooltip = useMemo(() => {
    if (!verificationLocked) return undefined;
    if (verificationCountdown && verificationCountdown.length > 0) {
      return `Verification stake is locked. ${verificationCountdown}`;
    }
    if (verificationUnlockTime) {
      return `Verification stake unlocks at ${verificationUnlockTime.toUTCString()}`;
    }
    return 'Verification stake is locked.';
  }, [verificationLocked, verificationCountdown, verificationUnlockTime]);

  useEffect(() => {
    if (!expanded) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDetails();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    let previousOverflow: string | null = null;
    if (typeof document !== 'undefined') {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (typeof document !== 'undefined' && previousOverflow !== null) {
        document.body.style.overflow = previousOverflow;
      }
    };
  }, [expanded]);

  const timelineEntries = useMemo(() => {
    const entries: Array<{ key: string; label: string; date: string; tooltip?: ReactNode; color: string }> = [];
    const firstRewardAt = rewardSummary?.firstRewardAt ?? null;

    entries.push({
      key: 'registered',
      label: 'Registered on',
      date: formatDateTime(firstRewardAt),
      color: 'border-blue-500/60 bg-blue-500/10',
      tooltip: (
        <div className="min-w-[250px] space-y-2">
          <div className="border-b border-blue-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-blue-300">
            Registration Details
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <span className="text-gray-400">Email:</span>
            <span className="font-medium">{device?.email ?? '—'}</span>
            <span className="text-gray-400">Location:</span>
            <span className="font-medium">
              {device?.position?.lat && device?.position?.lng
                ? `${device.position.lat.toFixed(4)}°, ${device.position.lng.toFixed(4)}°`
                : '—'}
            </span>
          </div>
        </div>
      )
    });

    const verificationWithdrawal = device?.staked?.lastWithdrawal ?? null;
    const isVerificationActive = Boolean(device?.verified && device?.staked?.time && device?.staked?.amount);

    if (isVerificationActive && device?.staked?.time) {
      entries.push({
        key: 'verification-active',
        label: 'Verification staked on',
        date: `${formatDateTime(device.staked.time)}${
          verificationCountdown ? ` • ${verificationCountdown}` : ''
        }`,
        color: 'border-green-500/60 bg-green-500/10',
        tooltip: (
          <div className="min-w-[280px] space-y-2">
            <div className="border-b border-green-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-green-300">
              Verification Stake
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <span className="text-gray-400">Amount:</span>
              <span className="font-semibold text-green-300">{formatAmount(device.staked.amount)}</span>

              <span className="text-gray-400">Asset ID:</span>
              <span className="font-mono text-[0.65rem]">{formatAssetId(device.staked.asset_id, 'stake')}</span>

              <span className="text-gray-400">Transaction:</span>
              <span className="font-mono text-[0.65rem]">{formatTx(device.staked.txId)}</span>

              <span className="text-gray-400">Lock Type:</span>
              <span className="font-medium">
                {device.staked.type === 'two' ? (
                  <span className="text-warning-300">Type 2 (6 month lock)</span>
                ) : (
                  <span className="text-sky-300">Type 1 (24 hour lock)</span>
                )}
              </span>

              <span className="text-gray-400">Status:</span>
              <span className="font-medium">
                {verificationCountdown || <span className="text-gray-300">Unlock available</span>}
              </span>
            </div>
            <div className="border-t border-gray-700 pt-1.5 text-[0.65rem] text-gray-400 italic">
              Keeping staked after unlock maintains multiplier rewards. Withdrawing reduces to base rate.
            </div>
          </div>
        )
      });
    } else if (verificationWithdrawal) {
      entries.push({
        key: 'verification-withdrawn',
        label: 'Verification stake withdrew on',
        date: formatDateTime(verificationWithdrawal.time ?? device?.staked?.time),
        color: 'border-warning-500/60 bg-warning-500/10',
        tooltip: (
          <div className="min-w-[280px] space-y-2">
            <div className="border-b border-warning-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-warning-300">
              Verification Withdrawal
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <span className="text-gray-400">Amount:</span>
              <span className="font-semibold text-warning-200">{formatAmount(verificationWithdrawal.amount)}</span>

              <span className="text-gray-400">Asset ID:</span>
              <span className="font-mono text-[0.65rem]">{formatAssetId(verificationWithdrawal.asset_id ?? device?.staked?.asset_id, 'stake')}</span>

              <span className="text-gray-400">Withdrawal Tx:</span>
              <span className="font-mono text-[0.65rem]">{formatTx(verificationWithdrawal.txId)}</span>
            </div>
            <div className="border-t border-gray-700 pt-1.5 text-[0.65rem] text-gray-400 italic">
              Re-stake to restore multiplier rewards for this device.
            </div>
          </div>
        )
      });
    } else if (device?.staked?.time) {
      // Legacy fallback for historical documents that haven't been migrated yet
      entries.push({
        key: 'verification-legacy',
        label: 'Verification stake withdrew on',
        date: formatDateTime(device.staked.time),
        color: 'border-warning-500/60 bg-warning-500/10',
        tooltip: (
          <div className="min-w-[260px] space-y-2">
            <div className="border-b border-warning-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-warning-300">
              Verification Withdrawal
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <span className="text-gray-400">Amount:</span>
              <span className="font-semibold text-warning-200">{formatAmount(device.staked.amount)}</span>

              <span className="text-gray-400">Asset ID:</span>
              <span className="font-mono text-[0.65rem]">{formatAssetId(device.staked.asset_id, 'stake')}</span>

              <span className="text-gray-400">Transaction:</span>
              <span className="font-mono text-[0.65rem]">{formatTx(device.staked.txId)}</span>
            </div>
            <div className="border-t border-gray-700 pt-1.5 text-[0.65rem] text-gray-400 italic">
              Withdraw and re-stake to capture full history with the new audit trail.
            </div>
          </div>
        )
      });
    }

    const registrationDetail = device?.registration;
    if (registrationDetail) {
      const registrationActive =
        Boolean(registrationDetail.amount && registrationDetail.amount > 0) &&
        Boolean(registrationDetail.time);
      const registrationWithdrawal = registrationDetail.lastWithdrawal ?? null;
      const registrationHistory = Array.isArray(registrationDetail.history)
        ? registrationDetail.history
        : [];
      const latestHistoryEntry =
        registrationHistory.length > 0
          ? registrationHistory[registrationHistory.length - 1]
          : null;
      const stakeSource =
        registrationActive && registrationDetail.time && registrationDetail.txId
          ? {
              amount: registrationDetail.amount,
              asset_id: registrationDetail.asset_id,
              time: registrationDetail.time,
              txId: registrationDetail.txId
            }
          : latestHistoryEntry ?? null;

      if (registrationActive && stakeSource?.time) {
        entries.push({
          key: 'registration',
          label: 'Registration staked on',
          date: formatDateTime(stakeSource.time),
          color: 'border-purple-500/60 bg-purple-500/10',
          tooltip: (
            <div className="min-w-[250px] space-y-2">
              <div className="border-b border-purple-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-purple-300">
                Registration Stake
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <span className="text-gray-400">Amount:</span>
                <span className="font-semibold text-purple-300">
                  {formatAmount(stakeSource.amount)}
                </span>

                <span className="text-gray-400">Asset ID:</span>
                <span className="font-mono text-[0.65rem]">
                  {formatAssetId(stakeSource.asset_id ?? registrationDetail.asset_id, 'register')}
                </span>

                <span className="text-gray-400">Transaction:</span>
                <span className="font-mono text-[0.65rem]">
                  {formatTx(stakeSource.txId ?? registrationDetail.txId)}
                </span>
              </div>
              <div className="border-t border-gray-700 pt-1.5 text-[0.65rem] text-gray-400 italic">
                Withdrawing registration stake stops device rewards until you re-stake.
              </div>
            </div>
          )
        });
      } else if (registrationWithdrawal || latestHistoryEntry) {
        const withdrawalSource = registrationWithdrawal ?? latestHistoryEntry!;
        entries.push({
          key: 'registration-withdrawn',
          label: 'Registration stake withdrew on',
          date: formatDateTime(withdrawalSource.time ?? registrationDetail.time),
          color: 'border-warning-500/60 bg-warning-500/10',
          tooltip: (
            <div className="min-w-[250px] space-y-2">
              <div className="border-b border-warning-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-warning-300">
                Registration Withdrawal
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <span className="text-gray-400">Amount:</span>
                <span className="font-semibold text-warning-200">
                  {formatAmount(withdrawalSource.amount)}
                </span>

                <span className="text-gray-400">Asset ID:</span>
                <span className="font-mono text-[0.65rem]">
                  {formatAssetId(withdrawalSource.asset_id ?? registrationDetail.asset_id, 'register')}
                </span>

                <span className="text-gray-400">Withdrawal Tx:</span>
                <span className="font-mono text-[0.65rem]">
                  {formatTx(withdrawalSource.txId ?? registrationWithdrawal?.txId)}
                </span>
              </div>
            </div>
          )
        });
      }
    }

    const nodeDetail = device?.node;
    if (isNodeProduct(product) && nodeDetail) {
      const nodeActive =
        Boolean(nodeDetail.amount && nodeDetail.amount > 0) &&
        Boolean(nodeDetail.time);
      const nodeWithdrawal = nodeDetail.lastWithdrawal ?? null;
      const nodeHistory = Array.isArray(nodeDetail.history) ? nodeDetail.history : [];
      const latestNodeHistory =
        nodeHistory.length > 0 ? nodeHistory[nodeHistory.length - 1] : null;
      const nodeStakeSource =
        nodeActive && nodeDetail.time && nodeDetail.txId
          ? {
              amount: nodeDetail.amount,
              asset_id: nodeDetail.asset_id,
              time: nodeDetail.time,
              txId: nodeDetail.txId
            }
          : latestNodeHistory ?? null;

      if (nodeActive && nodeStakeSource?.time) {
        entries.push({
          key: 'node',
          label: 'Node operation staked on',
          date: formatDateTime(nodeStakeSource.time),
          color: 'border-primary-500/60 bg-primary-500/10',
          tooltip: (
            <div className="min-w-[250px] space-y-2">
              <div className="border-b border-primary-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-primary-300">
                Node Operation Stake
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <span className="text-gray-400">Amount:</span>
                <span className="font-semibold text-primary-300">
                  {formatAmount(nodeStakeSource.amount)}
                </span>

                <span className="text-gray-400">Asset ID:</span>
                <span className="font-mono text-[0.65rem]">
                  {formatAssetId(nodeStakeSource.asset_id ?? nodeDetail.asset_id, 'node')}
                </span>

                <span className="text-gray-400">Transaction:</span>
                <span className="font-mono text-[0.65rem]">
                  {formatTx(nodeStakeSource.txId ?? nodeDetail.txId)}
                </span>
              </div>
              <div className="border-t border-gray-700 pt-1.5 text-[0.65rem] text-gray-400 italic">
                Withdrawing node staking pauses node earnings until you re-stake and resume operation.
              </div>
            </div>
          )
        });
      } else if (nodeWithdrawal || latestNodeHistory) {
        const nodeWithdrawalSource = nodeWithdrawal ?? latestNodeHistory!;
        entries.push({
          key: 'node-withdrawn',
          label: 'Node stake withdrew on',
          date: formatDateTime(nodeWithdrawalSource.time ?? nodeDetail.time),
          color: 'border-warning-500/60 bg-warning-500/10',
          tooltip: (
            <div className="min-w-[250px] space-y-2">
              <div className="border-b border-warning-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-warning-300">
                Node Stake Withdrawal
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <span className="text-gray-400">Amount:</span>
                <span className="font-semibold text-warning-200">
                  {formatAmount(nodeWithdrawalSource.amount)}
                </span>

                <span className="text-gray-400">Asset ID:</span>
                <span className="font-mono text-[0.65rem]">
                  {formatAssetId(nodeWithdrawalSource.asset_id ?? nodeDetail.asset_id, 'node')}
                </span>

                <span className="text-gray-400">Withdrawal Tx:</span>
                <span className="font-mono text-[0.65rem]">
                  {formatTx(nodeWithdrawalSource.txId ?? nodeWithdrawal?.txId)}
                </span>
              </div>
            </div>
          )
        });
      }
    }

    return entries;
  }, [device, product, verificationCountdown, formatAssetId, rewardSummary?.firstRewardAt]);

  const viewHistory = async (): Promise<void> => {
    router.push({
      pathname: '/history',
      query: { miner_key: device.miner_key }
    });
  };

  const summaryMetrics = useMemo(
    () => [
      {
        key: 'claimable',
        label: 'Claimable',
        value: formatTokenAmount(claimableAmount),
        accent: isDark ? 'text-green-300' : 'text-emerald-700',
        tooltip: REWARD_STATUS_DESCRIPTIONS.claimable
      },
      {
        key: 'pending',
        label: 'Pending',
        value: formatTokenAmount(pendingAmount),
        accent: isDark ? 'text-warning-300' : 'text-warning-700',
        tooltip: REWARD_STATUS_DESCRIPTIONS.pending
      },
      {
        key: 'accruing',
        label: 'Accruing (weekly preview)',
        value: formatTokenAmount(rewardSummary?.accruing ?? 0),
        accent: isDark ? 'text-sky-300' : 'text-sky-700',
        tooltip: REWARD_STATUS_DESCRIPTIONS.accruing
      }
    ],
    [claimableAmount, pendingAmount, rewardSummary?.accruing, isDark]
  );

  const nextUnlockUTC = useMemo(() => {
    if (!rewardSummary?.nextUnlockAt) return null;
    const date = new Date(rewardSummary.nextUnlockAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toUTCString();
  }, [rewardSummary?.nextUnlockAt]);

  type SectionConfig = {
    key: 'rewards' | 'contact' | 'status' | 'mac';
    title: string;
    content: ReactNode;
    important?: boolean;
  };

  
  const statusImportant = shouldShowRed || shouldShowYellow;

const collapsibleSections: SectionConfig[] = useMemo(
    () => [
      {
        key: 'rewards',
        title: 'Rewards & multipliers',
        content: (
          <div className="space-y-4">
            <div>
              <div className={modalTextMuted}>Reward token</div>
              <div
                className={`mt-1 flex flex-wrap items-baseline gap-2 ${
                  isDark ? 'text-gray-200' : 'text-slate-800 font-semibold'
                }`}
              >
                <span className="text-sm font-semibold" title={rewardTokenDetail.name}>
                  {rewardTokenDetail.label}
                </span>
                {rewardTokenDetail.id && (
                  <span className={`font-mono text-[0.65rem] ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>
                    #{rewardTokenDetail.id}
                  </span>
                )}
              </div>
            </div>
            {dailyRewardEntries.length > 0 && (
              <div>
                <div className={`text-xs uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>Daily earnings</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {dailyRewardEntries.map((entry) => {
                    const tierStyles: Record<
                      'bronze' | 'silver' | 'gold',
                      { gradient: string; text: string; border: string }
                    > = {
                      bronze: {
                        // Push bronze darker/warmer so gold contrasts more clearly.
                        gradient: 'linear-gradient(135deg, #78350F, #92400E, #B45309)',
                        text: '#FFF7ED',
                        border: '#D97706'
                      },
                      silver: {
                        gradient: 'linear-gradient(135deg, #4B5563, #9CA3AF, #E5E7EB)',
                        text: '#111827',
                        border: '#E5E7EB'
                      },
                      gold: {
                        // Make gold brighter and more luminous than bronze.
                        gradient: 'linear-gradient(135deg, #F59E0B, #FACC15, #FEF3C7)',
                        text: '#7C2D12',
                        border: '#FDE68A'
                      }
                    };

                    const tierStylesDark: Record<
                      'bronze' | 'silver' | 'gold',
                      { gradient: string; text: string; border: string }
                    > = {
                      bronze: {
                        gradient: 'linear-gradient(135deg, #3D2A1A, #5C3312, #8C5A2B)',
                        text: '#F5E6D3',
                        border: '#8C5A2B'
                      },
                      silver: {
                        gradient: 'linear-gradient(135deg, #2D3238, #4B5563, #9CA3AF)',
                        text: '#E5E7EB',
                        border: '#9CA3AF'
                      },
                      gold: {
                        // Enrich gold for dark mode so it reads distinctly brighter.
                        gradient: 'linear-gradient(135deg, #3A2A0A, #7C3A0A, #F59E0B)',
                        text: '#FEF9C3',
                        border: '#FDE68A'
                      }
                    };

                    if (isDark) {
                      const tierStyle = tierStylesDark[entry.tier] ?? tierStylesDark.bronze;
                      return (
                        <div
                          key={entry.key}
                          className="rounded-lg border p-3 shadow-sm"
                          style={{
                            background: tierStyle.gradient,
                            color: tierStyle.text,
                            borderColor: tierStyle.border
                          }}
                        >
                          <div className="text-[0.7rem] uppercase tracking-wide opacity-85 flex items-center gap-1">
                            <span
                              aria-hidden="true"
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-base ${
                                entry.tier === 'bronze'
                                  ? 'bg-black/40 border border-warning-800/60'
                                  : entry.tier === 'silver'
                                    ? 'bg-black/35 border border-gray-600/60'
                                    : 'bg-black/40 border border-warning-700/60'
                              }`}
                            >
                              {entry.tier === 'bronze' ? '🥉' : entry.tier === 'silver' ? '🥈' : '🥇'}
                            </span>
                            <span>{entry.label}</span>
                          </div>
                          <div className="mt-1 text-lg font-semibold" style={{ color: tierStyle.text }}>
                            {`${formatDailyValue(entry.value)} ${rewardTokenUnitLabel}`}
                          </div>
                          <div className="text-[0.65rem] opacity-85">{entry.description}</div>
                        </div>
                      );
                    }

                    const tierStyle = tierStyles[entry.tier] ?? tierStyles.bronze;

                    return (
                      <div
                        key={entry.key}
                        className="rounded-lg border p-3 shadow-sm"
                        style={{
                          background: tierStyle.gradient,
                          color: tierStyle.text,
                          borderColor: tierStyle.border
                        }}
                      >
                        <div className="text-[0.7rem] uppercase tracking-wide opacity-90 flex items-center gap-1">
                          <span
                            aria-hidden="true"
                            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-base ${
                              entry.tier === 'bronze'
                                ? 'bg-white/90 border border-warning-200'
                                : entry.tier === 'silver'
                                  ? 'bg-white/95 border border-gray-300'
                                  : 'bg-white/95 border border-warning-200'
                            }`}
                          >
                            {entry.tier === 'bronze' ? '🥉' : entry.tier === 'silver' ? '🥈' : '🥇'}
                          </span>
                          <span>{entry.label}</span>
                        </div>
                        <div className="mt-1 text-lg font-semibold" style={{ color: tierStyle.text }}>
                          {`${formatDailyValue(entry.value)} ${rewardTokenUnitLabel}`}
                        </div>
                        <div className="text-[0.65rem] opacity-90">{entry.description}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
                {stakeOptions.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500">
                      Verification stake options
                    </div>
                <div className="space-y-3">
                  {stakeOptions.map((option) => (
                    <div
                      key={option.key}
                      className={`rounded-lg border p-3 ${
                        isDark
                          ? 'border-gray-800/70 bg-gray-900/40'
                          : 'border-slate-200 bg-white shadow-sm'
                      }`}
                    >
                      <div className={`flex flex-wrap items-baseline justify-between gap-2 text-sm ${isDark ? 'text-gray-200' : 'text-slate-900'}`}>
                        <span className="font-semibold">{option.title}</span>
                        <span className={`text-xs ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>{option.multiplier}</span>
                      </div>
                      <div className={`mt-2 text-[0.85rem] ${isDark ? 'text-gray-300' : 'text-slate-800'}`}>
                        Stake requirement:{' '}
                        <span className={`font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                          {option.amount !== null
                            ? `${option.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${stakeTokenDetail.label}`
                            : 'Not required'}
                        </span>
                      </div>
                      <div className={`text-[0.65rem] ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>{option.description}</div>
                    </div>
                  ))}
                </div>
                {stakeTokenDetail.id && (
                  <div className={`text-[0.65rem] ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>
                    Stake asset:{' '}
                    <span className={`font-semibold ${isDark ? 'text-gray-300' : 'text-slate-800'}`} title={stakeTokenDetail.name}>
                      {stakeTokenDetail.label}
                    </span>{' '}
                    <span className={`font-mono ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>#{stakeTokenDetail.id}</span>
                  </div>
                )}
                {byodDiscountApplied && (
                  <div className={`text-[0.65rem] ${isDark ? 'text-warning-300' : 'text-warning-600'}`}>
                    BYOD licence detected: stake requirements shown include the 50% BYOD discount.
                  </div>
                )}
              </div>
            )}
            {(needsRegistration || needsNodeStake) && (
              <div className="space-y-3">
                <div className={`text-xs uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>
                  Operational staking requirements
                </div>
                {needsRegistration && (
                  <div className={`rounded-lg border p-3 ${isDark ? 'border-gray-800/70 bg-gray-900/40' : 'border-slate-200 bg-white shadow-sm'}`}>
                    <div className={`flex items-center justify-between text-sm ${isDark ? 'text-gray-200' : 'text-slate-900'}`}>
                      <span className="font-semibold">Registration stake</span>
                      <span className={`text-xs ${hasRegistration ? (isDark ? 'text-emerald-300' : 'text-emerald-700') : (isDark ? 'text-warning-300' : 'text-warning-700')}`}>
                        {hasRegistration ? 'Completed' : 'Required'}
                      </span>
                    </div>
                    <div className={`mt-1 text-[0.85rem] ${isDark ? 'text-gray-300' : 'text-slate-800'}`}>
                      {registrationRequirementHint ?? 'Stake not required'}
                    </div>
                    {registrationTokenDetail.id && (
                      <div className={`mt-1 text-[0.65rem] ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>
                        Asset:{' '}
                        <span className={`font-semibold ${isDark ? 'text-gray-300' : 'text-slate-800'}`} title={registrationTokenDetail.name}>
                          {registrationTokenDetail.label}
                        </span>{' '}
                        <span className={`font-mono ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>#{registrationTokenDetail.id}</span>
                      </div>
                    )}
                  </div>
                )}
                {needsNodeStake && (
                  <div className={`rounded-lg border p-3 ${isDark ? 'border-gray-800/70 bg-gray-900/40' : 'border-slate-200 bg-white shadow-sm'}`}>
                    <div className={`flex items-center justify-between text-sm ${isDark ? 'text-gray-200' : 'text-slate-900'}`}>
                      <span className="font-semibold">Node operation stake</span>
                      <span className={`text-xs ${hasNode ? (isDark ? 'text-emerald-300' : 'text-emerald-700') : (isDark ? 'text-warning-300' : 'text-warning-700')}`}>
                        {hasNode ? 'Completed' : 'Required'}
                      </span>
                    </div>
                    <div className={`mt-1 text-[0.85rem] ${isDark ? 'text-gray-300' : 'text-slate-800'}`}>
                      {nodeRequirementHint ?? 'Stake not required'}
                    </div>
                    {nodeTokenDetail.id && (
                      <div className={`mt-1 text-[0.65rem] ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>
                        Asset:{' '}
                        <span className={`font-semibold ${isDark ? 'text-gray-300' : 'text-slate-800'}`} title={nodeTokenDetail.name}>
                          {nodeTokenDetail.label}
                        </span>{' '}
                        <span className={`font-mono ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>#{nodeTokenDetail.id}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      },
      {
        key: 'contact',
        title: 'Wallets & contact',
        content: (
          <div className="space-y-3">
            <div>
              <div className={modalTextMuted}>Owner wallet</div>
              <div
                className={`mt-1 flex flex-wrap items-center gap-2 font-mono text-xs sm:text-sm break-all ${
                  isDark ? 'text-gray-200' : 'text-slate-800 font-semibold'
                }`}
              >
                {device.address ? (
                  <>
                    <span>{device.address}</span>
                    <CopyAddress address={device.address} />
                  </>
                ) : (
                  <span>—</span>
                )}
              </div>
            </div>
            <div>
              <div className={modalTextMuted}>Reward wallet</div>
              <div
                className={`mt-1 flex flex-wrap items-center gap-2 font-mono text-xs sm:text-sm break-all ${
                  isDark ? 'text-gray-200' : 'text-slate-800 font-semibold'
                }`}
              >
                {device.reward_wallet ? (
                  <>
                    <span>{device.reward_wallet}</span>
                    <CopyAddress address={device.reward_wallet} />
                  </>
                ) : (
                  <span>—</span>
                )}
              </div>
            </div>
            <div>
              <div className={modalTextMuted}>Email</div>
              <div className={`mt-1 break-words ${isDark ? 'text-gray-200' : 'text-slate-800 font-semibold'}`}>
                {device.email ?? '—'}
              </div>
            </div>
            <div>
              <div className={modalTextMuted}>Location</div>
              <div className={`mt-1 ${isDark ? 'text-gray-200' : 'text-slate-800 font-semibold'}`}>
                {device?.position?.lat && device?.position?.lng
                  ? `${device.position.lat.toFixed(4)}°, ${device.position.lng.toFixed(4)}°`
                  : '—'}
              </div>
            </div>
          </div>
        )
      },
      {
        key: 'status',
        title: 'Status',
        important: shouldShowRed || shouldShowYellow,
        content: (
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className={isDark ? 'text-gray-400' : 'text-slate-600'}>Verification</span>
              <span
                className={`font-semibold ${
                  deviceStatusOkay
                    ? isDark
                      ? 'text-green-300'
                      : 'text-emerald-700'
                    : shouldShowYellow
                      ? isDark
                        ? 'text-warning-300'
                        : 'text-warning-700'
                      : isDark
                        ? 'text-red-300'
                        : 'text-red-700'
                }`}
              >
                {(device.verified || femBadgeVerified) ? 'Verified' : 'Unverified'}
              </span>
            </div>
            {femVerificationExempt && !femBadgeVerified && (
              <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>
                <Link
                  href="/my_registrations"
                  className="underline underline-offset-2 hover:opacity-80"
                  onClick={(event) => event.stopPropagation()}
                >
                  Stake to verify &rarr;
                </Link>
              </div>
            )}
            {Object.keys(deviceStatus).length > 0 && (
              <div className="space-y-2">
                {Object.entries(deviceStatus).map(([key, value]) => (
                  <div
                    key={key}
                    className={`rounded border px-3 py-2 text-sm ${
                      isDark
                        ? 'border-red-500/40 bg-red-500/10 text-red-200'
                        : 'border-red-200 bg-red-50 text-red-700'
                    }`}
                  >
                    {value}
                  </div>
                ))}
              </div>
            )}
            {isLegacyStake && (
              <div
                className={`rounded border px-3 py-2 text-sm ${
                  isDark
                    ? 'border-warning-500/40 bg-warning-500/10 text-warning-100'
                    : 'border-warning-200 bg-warning-50 text-warning-800'
                }`}
              >
                Legacy FRY 1.0 verification stake detected. Withdraw the legacy stake and re-stake with FRY 2.0 to keep multiplier rewards.
                {legacyDeadlineLabel && (
                  <div className={`mt-1 text-[0.65rem] ${isDark ? 'text-warning-200' : 'text-warning-700'}`}>
                    Verification benefits end after {legacyDeadlineLabel} unless you restake with FRY 2.0.
                  </div>
                )}
              </div>
            )}
          </div>
        )
      },
      {
        key: 'mac',
        title: 'MAC Address',
        content: (() => {
          const deviceMac = hardwareStatus?.device_mac ?? '';
          const registeredMac = hardwareStatus?.miner_mac ?? '';
          const macMatch = hardwareStatus?.mac_match;
          const hasDeviceMac = Boolean(deviceMac);
          const hasRegisteredMac = Boolean(registeredMac);
          const displayInput = registeredMacInput !== '' ? registeredMacInput : (registeredMac || '');

          const handleSyncToDevice = () => {
            if (deviceMac) {
              setRegisteredMacInput(deviceMac);
              setMacSaveError(null);
            }
          };

          const handleSaveMac = async () => {
            const rawMac = displayInput.trim();
            if (!rawMac) {
              setMacSaveError('MAC address cannot be empty.');
              return;
            }
            const validation = validateMacAddress(rawMac);
            if (!validation.valid) {
              setMacSaveError(describeMacIssue(validation.reason));
              return;
            }
            setMacSaveLoading(true);
            setMacSaveError(null);
            try {
              const response = await fetch('/api/devices/save-credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  miner_key: device.miner_key,
                  credentials: { mac_address: validation.normalized ?? rawMac },
                  api_type: 'hardware',
                  portal: minerPrefix,
                }),
              });
              const data = await response.json();
              if (!response.ok) {
                setMacSaveError(data?.message || 'Failed to save MAC address.');
                toast.error({ heading: 'MAC save failed', message: data?.message || 'Failed to save MAC address.' });
              } else {
                setRegisteredMacInput('');
                toast.success({ heading: 'MAC updated', message: 'MAC address saved successfully.' });
                // Refresh hardware status
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('refresh-hardware-status', { detail: { miner_key: device.miner_key } }));
                }
              }
            } catch (err) {
              setMacSaveError('Network error. Please try again.');
              toast.error({ heading: 'MAC save failed', message: 'Network error. Please try again.' });
            } finally {
              setMacSaveLoading(false);
            }
          };

          return (
            <div className="space-y-3">
              {!hasDeviceMac && !hasRegisteredMac && (
                <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>
                  No MAC data available. This device type may not report MAC addresses.
                </div>
              )}
              {hasDeviceMac && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className={`text-xs uppercase tracking-wide ${textGray}`}>Device MAC</div>
                  <span className={`font-mono text-sm ${isDark ? 'text-gray-200' : 'text-slate-800 font-semibold'}`}>
                    {deviceMac}
                  </span>
                </div>
              )}
              {macMatch === true && (
                <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${isDark ? 'border-green-500/40 bg-green-500/10 text-green-300' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                  MAC Match ✓
                </div>
              )}
              {macMatch === false && (
                <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${isDark ? 'border-warning-500/40 bg-warning-500/10 text-warning-200' : 'border-warning-200 bg-warning-50 text-warning-800'}`}>
                  MAC Mismatch — PoC rewards may be affected
                </div>
              )}
              <div className="space-y-2">
                <div className={`text-xs uppercase tracking-wide ${textGray}`}>Registered MAC</div>
                <input
                  type="text"
                  value={displayInput}
                  onChange={(e) => {
                    setRegisteredMacInput(e.target.value);
                    setMacSaveError(null);
                  }}
                  placeholder={hasDeviceMac ? 'Click Sync or enter manually' : 'Enter MAC address'}
                  className={`w-full rounded-lg border px-3 py-2 text-sm font-mono ${isDark ? 'border-gray-700 bg-black/60 text-gray-200 placeholder-gray-600' : 'border-slate-200 bg-white text-slate-900 placeholder-slate-400'} focus:outline-none focus:ring-2 focus:ring-red-500/40`}
                />
                {macSaveError && (
                  <div className={`text-xs ${isDark ? 'text-red-300' : 'text-red-600'}`}>{macSaveError}</div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {hasDeviceMac && (
                    <Button
                      size="xs"
                      className={`${isDark ? 'bg-sky-600 text-white border-sky-500 hover:bg-sky-500' : 'bg-sky-600 text-white border-sky-600 hover:bg-sky-700'}`}
                      onClick={handleSyncToDevice}
                      disabled={macSaveLoading}
                    >
                      Sync to Device
                    </Button>
                  )}
                  <Button
                    size="xs"
                    className={`${isDark ? 'bg-red-600 text-white border-red-500 hover:bg-red-500' : 'bg-red-600 text-white border-red-600 hover:bg-red-700'}`}
                    onClick={handleSaveMac}
                    disabled={macSaveLoading || !displayInput.trim()}
                  >
                    {macSaveLoading ? 'Saving…' : 'Save MAC'}
                  </Button>
                </div>
              </div>
              {hardwareStatus?.mac_last_changed && (
                <div className={`text-[0.65rem] ${isDark ? 'text-gray-500' : 'text-slate-500'}`}>
                  Last changed: {new Date(hardwareStatus.mac_last_changed).toLocaleString()}
                </div>
              )}
            </div>
          );
        })()
      }
    ],
    [
      byodDiscountApplied,
      dailyRewardEntries,
      device.address,
      device.email,
      device.position?.lat,
      device.position?.lng,
      device.reward_wallet,
      deviceStatus,
      deviceStatusOkay,
      rewardTokenDetail.label,
      rewardTokenDetail.id,
      rewardTokenDetail.name,
      rewardTokenUnitLabel,
      shouldShowRed,
      shouldShowYellow,
      stakeOptions,
      stakeTokenDetail.id,
      stakeTokenDetail.label,
      stakeTokenDetail.name,
      device.verified,
      formatDailyValue,
      isLegacyStake,
      legacyDeadlineLabel,
      needsRegistration,
      needsNodeStake,
      hasRegistration,
      hasNode,
      registrationRequirementHint,
      nodeRequirementHint,
      registrationTokenDetail.id,
      registrationTokenDetail.label,
      registrationTokenDetail.name,
      nodeTokenDetail.id,
      nodeTokenDetail.label,
      nodeTokenDetail.name,
      isDark,
      modalTextMuted,
      hardwareStatus,
      registeredMacInput,
      macSaveLoading,
      macSaveError,
      toast,
      device.miner_key,
    ]
  );

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    const baseState: Record<string, boolean> = { rewards: true, contact: true, status: true, mac: false };
    if (typeof window === 'undefined') {
      return statusImportant ? { ...baseState, status: true } : baseState;
    }

    let initial = { ...baseState };

    const stored = window.localStorage.getItem(`device-sections:${device.miner_key}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          initial = { ...initial, ...parsed };
        }
      } catch {
        // noop
      }
    }

    if (window.matchMedia('(max-width: 768px)').matches) {
      initial = {
        ...initial,
        rewards: false,
        contact: false,
        status: statusImportant ? true : false
      };
    }

    if (statusImportant) {
      initial = { ...initial, status: true };
    }

    return initial;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      `device-sections:${device.miner_key}`,
      JSON.stringify(expandedSections)
    );
  }, [expandedSections, device.miner_key]);
  useEffect(() => {
    if (!statusImportant) return;
    if (expandedSections.status) return;
    setExpandedSections((prev) => ({ ...prev, status: true }));
  }, [statusImportant, expandedSections.status]);


  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const renderSection = (section: SectionConfig) => {
    const isExpanded = expandedSections[section.key] ?? true;
    const showAlertBadge = section.key === 'status' && section.important;
    return (
      <div key={section.key} className={modalSectionClass}>
        <button
          type="button"
          className={`w-full px-4 py-3 flex items-center justify-between text-left ${modalTextHeading} focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-red-400`}
          onClick={() => toggleSection(section.key)}
        >
          <span className={`text-xs uppercase tracking-wide ${modalTextMuted}`}>
            {section.title}
          </span>
          <div className="flex items-center gap-2">
            {showAlertBadge && (
              <span
                className={`rounded-full px-2 py-0.5 text-[0.6rem] uppercase tracking-wide ${
                  isDark
                    ? 'bg-red-500/20 text-red-200 border border-red-400/40'
                    : 'bg-red-100 text-red-800 border border-red-300'
                }`}
              >
                Attention
              </span>
            )}
            <span className={`text-xs ${textGray}`}>{isExpanded ? 'Hide' : 'Show'}</span>
          </div>
        </button>
        {isExpanded && (
          <div className={`border-t px-4 py-4 text-sm ${isDark ? 'text-gray-100' : 'text-slate-800'} ${modalDividerClass}`}>
            {section.content}
          </div>
        )}
      </div>
    );
  };

  const renderVerificationActionButton = useCallback(
    (variant: 'default' | 'compact' = 'default') => {
      if (!isProductStakeAvailable(product) && !device.verified) {
        return null;
      }
      if (femVerificationExempt && !device.verified && !device?.staked?.time) {
        return null;
      }

      // When a legacy FRY 1.0 stake is present, force users to withdraw it first.
      const disableForLegacy = isLegacyStake;

      const baseClass =
        variant === 'default'
          ? `min-w-[150px] bg-transparent ${
              disableForLegacy || verificationLocked
                ? `border-gray-500 ${textGray} cursor-not-allowed`
                : isStaked()
                  ? `border-green-500 ${textStrong} hover:bg-green-500 hover:border-green-500`
                  : verificationBlocked
                    ? `border-gray-500 ${textGray} cursor-not-allowed`
                    : `border-red-500 ${textStrong} hover:bg-red-500 hover:border-red-500`
            }`
          : `min-w-[110px] bg-transparent text-[0.6rem] py-1 ${
              disableForLegacy || verificationLocked
                ? `border-gray-500 ${textGray} cursor-not-allowed`
                : isStaked()
                  ? `border-green-500 ${textStrong} hover:bg-green-500 hover:border-green-500`
                  : verificationBlocked
                    ? `border-gray-500 ${textGray} cursor-not-allowed`
                    : `border-red-500 ${textStrong} hover:bg-red-500 hover:border-red-500`
            }`;

      const button = (
        <span>
          <Button
            className={baseClass}
            disabled={disableForLegacy || verificationLocked || (!isStaked() && verificationBlocked)}
            onClick={(event) => {
              event.stopPropagation();
              if (disableForLegacy) return;
              if (verificationLocked) return;
              if (!isStaked() && verificationBlocked) return;
              handleWithdrawStake(device);
            }}
          >
            {isStaked() ? 'Verification Withdraw' : 'Verification Stake'}
          </Button>
        </span>
      );

      const tooltipText = disableForLegacy
        ? 'Legacy FRY 1.0 stake detected — withdraw legacy stake first.'
        : verificationLocked
        ? verificationLockTooltip
        : verificationReason || null;

      return tooltipText ? <Tooltip text={tooltipText}>{button}</Tooltip> : button;
    },
    [
      device,
      handleWithdrawStake,
      product,
      verificationBlocked,
      verificationLockTooltip,
      verificationLocked,
      verificationReason,
      isStaked,
      isLegacyStake,
      textGray,
      textStrong,
      textRed,
      textGreen
    ]
  );

  const detailContent = (
    <div className={`space-y-6 pt-8 text-sm ${isDark ? 'text-gray-100' : 'text-slate-900'}`}>
      {!device.registered_portal_model && isLinkRequiredForPrefix(minerPrefix) && (
        <div
          className={`rounded-lg border px-4 py-3 ${
            isDark
              ? 'border-warning-500/40 bg-warning-500/10 text-warning-200'
              : 'border-warning-200 bg-warning-50 text-warning-800'
          }`}
        >
          This device is not linked to FryNetworks. Click the <b>gear icon</b> or go to <Link href="/device-credentials" className="underline font-semibold">Device Credentials</Link> to link it.
        </div>
      )}
      {!(!device.registered_portal_model) && hardwareWarning && (
        <div
          className={`rounded-lg border px-4 py-3 ${
            isDark
              ? 'border-warning-500/40 bg-warning-500/10 text-warning-200'
              : 'border-warning-200 bg-warning-50 text-warning-800'
          }`}
        >
          We could not verify a MAC address for this device. Click the <b>gear icon</b> to re-link your MAC so rewards remain active.
        </div>
      )}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
          <Title className={`${isDark ? 'text-white' : 'text-slate-900'} text-2xl md:text-3xl`}>
            {`${device.nickname ? device.nickname : device.name} ${device.byod ? '(BYOD)' : ''}`}
          </Title>
          <div className="flex flex-wrap gap-2">
            {summaryBadges.map((badge, index) => (
              <span
                key={`${badge.label}-${index}`}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${badge.className}`}
              >
                <span>{badge.label}</span>
                {badge.info ? (
                  <Tooltip text={badge.info}>
                    <InformationCircleIcon
                      className="h-3.5 w-3.5 text-inherit/80"
                      aria-hidden="true"
                    />
                  </Tooltip>
                ) : null}
              </span>
            ))}
          </div>
          <div className={`space-y-1 text-xs ${modalTextMuted}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`uppercase tracking-wide text-[0.65rem] ${textGray}`}>Miner key</span>
              <span className={`font-mono text-[0.75rem] break-all ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>{device.miner_key}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`uppercase tracking-wide text-[0.65rem] ${textGray}`}>Product</span>
              <span className={isDark ? 'text-gray-200' : 'text-slate-800'}>{product?.name ?? '—'}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 self-end pr-12 md:self-auto md:gap-4">
          <div className="flex items-center gap-2 md:gap-3">
            {(needsRegistration && !hasRegistration) || (needsNodeStake && !hasNode) ? (
              <Tooltip text="Stake requirements">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handlePrimaryStakeRequirement();
                }}
                className={iconButtonClass}
              >
                  <span className="flex h-5 w-5 items-center justify-center">
                    <StakingIcon />
                  </span>
                  <span className="text-xs font-medium hidden sm:inline">Stake</span>
                </button>
              </Tooltip>
            ) : null}
            <Tooltip text="Edit info">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleChange(device.miner_key);
                }}
                className={iconButtonClass}
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  <EditIcon />
                </span>
                <span className="text-xs font-medium hidden sm:inline">Edit</span>
              </button>
            </Tooltip>
            <Tooltip text="Portal settings">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleSetting(device.miner_key);
                }}
                className={iconButtonClass}
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  <SettingIcon />
                </span>
                <span className="text-xs font-medium hidden sm:inline">Settings</span>
              </button>
            </Tooltip>
            <Tooltip text="Unregister">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleDeleteButton(device);
                }}
                className={iconButtonClass}
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  <DeleteIcon />
                </span>
                <span className="text-xs font-medium hidden sm:inline">Delete</span>
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {collapsibleSections.map(renderSection)}
      </div>
      {!!timelineEntries.length && (
        <div className={`${modalSectionClass} p-4`}>
          <div className={`text-xs uppercase tracking-wide ${textGray}`}>Activity timeline</div>
          <div className="mt-3 space-y-3">
            {timelineEntries.map((entry) => (
              <div key={entry.key} className={`rounded-lg border ${entry.color} px-3 py-2`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span>{entry.label}</span>
                    {entry.tooltip && (
                      <Tooltip text={entry.tooltip} className="max-w-sm">
                        <InformationCircleIcon
                          className={`h-4 w-4 ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-slate-500 hover:text-slate-700'}`}
                        />
                      </Tooltip>
                    )}
                  </div>
                  <div className={`text-xs font-semibold ${isDark ? 'text-gray-200' : 'text-slate-700'}`}>{entry.date}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${modalSectionClass} p-4`}>
          <div className={`text-xs uppercase tracking-wide ${textGray}`}>Rewards</div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className={modalTextMuted}>Pending</div>
              <div className={`font-semibold ${isDark ? 'text-warning-200' : 'text-warning-700'}`}>{formatTokenAmount(pendingAmount)}</div>
            </div>
            <div>
              <div className={modalTextMuted}>Claimable</div>
              <div className={`font-semibold ${isDark ? 'text-green-300' : 'text-emerald-700'}`}>{formatTokenAmount(claimableAmount)}</div>
            </div>
            <div>
              <div className={modalTextMuted}>Claimed</div>
              <div className={`font-semibold ${isDark ? 'text-gray-100' : 'text-slate-800'}`}>{formatTokenAmount(claimedAmount)}</div>
            </div>
            <div>
              <div className={modalTextMuted}>Accruing (weekly preview)</div>
              <div className={`font-semibold ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>{formatTokenAmount(rewardSummary?.accruing ?? 0)}</div>
            </div>
          </div>
          {pendingAmount > 0 && (
            <div
              className={`mt-3 rounded-md border px-3 py-2 text-xs ${
                isDark
                  ? 'border-warning-500/30 bg-warning-500/10 text-warning-100'
                  : 'border-warning-200 bg-warning-50 text-warning-800'
              }`}
            >
              Rewards collect as pending for up to 30 days. Once that timer completes they unlock for a fee-free claim; claiming earlier with Instant Claim applies the 30% boost fee.
            </div>
          )}
        </div>
        <div className={`${modalSectionClass} p-4 space-y-2`}>
          <div className={`text-xs uppercase tracking-wide ${textGray}`}>Unlock window</div>
          <div className={`text-sm ${isDark ? 'text-gray-100' : 'text-slate-800'}`}>
            {nextUnlockUTC ? (
              <>
                <div>
                  Next unlock: <span className="font-semibold">{nextUnlockUTC}</span>
                </div>
                {countdown && <div className={`text-xs ${modalTextMuted}`}>Unlocks in {countdown}</div>}
              </>
            ) : (
              <div>No unlock window scheduled</div>
            )}
          </div>
          {rewardSummary?.accruing && (
            <div className={`text-xs ${modalTextMuted}`}>
              Weekly estimate reflects current accrual pace. Actual payout finalizes at unlock.
            </div>
          )}
        </div>
      </div>
      <div className={`${modalSectionClass} p-4`}>
        <div className={`text-xs uppercase tracking-wide ${textGray}`}>Actions</div>
        <div className="mt-3 flex flex-wrap gap-3">
          {isLegacyStake && (
            <Button
              className={`min-w-[150px] border-warning-500 bg-transparent hover:bg-warning-500 hover:border-warning-500 ${
                isDark ? 'text-warning-200 hover:text-black' : 'text-black'
              }`}
              onClick={(event) => {
                event.stopPropagation();
                handleWithdrawStake(device);
              }}
            >
              Withdraw Legacy Stake
            </Button>
          )}

          {/* Mandatory staking first for node/AEM when incomplete */}
          {(isNodeProduct(product) || minerPrefix === 'AEM') && needsRegistration && !hasRegistration && (
            <StakeRequirementCTA requirement="registration" label="Stake Registration" />
          )}
          {isNodeProduct(product) && needsNodeStake && !hasNode && (
            <StakeRequirementCTA requirement="node" label="Stake Node Operation" />
          )}

          <Button
            className={`min-w-[150px] bg-transparent transition-colors duration-150 ${
              !isProductStakeAvailable(product) || claimableAmount <= 0
                ? `border-gray-600 ${textGray} cursor-not-allowed`
                : isStaked()
                  ? `border-green-500 ${textGreen} hover:bg-green-600/10`
                  : `border-red-500 ${textRed} hover:bg-red-600/10`
            }`}
            disabled={claimableAmount <= 0}
            onClick={() => handleClaimButton(device)}
          >
            Claim Reward
          </Button>

          <Button
            className={`min-w-[150px] bg-transparent transition-colors duration-150 ${
              !isProductStakeAvailable(product)
                ? `border-gray-500 ${textGray} hover:bg-gray-600/20 cursor-not-allowed`
                : pendingAmount > 0 && boostSupported
                  ? `border-red-600 ${textRed} hover:bg-red-600/10 hover:text-red-200`
                  : `border-gray-500 ${textGray} cursor-not-allowed`
            }`}
            disabled={pendingAmount <= 0 || !boostSupported}
            onClick={() => handleBoostButton(device)}
            title={!boostSupported ? 'Instant Claim is available only for fNODE and tFry rewards.' : undefined}
          >
            Instant Claim (30% Fee)
          </Button>

          {((isNodeProduct(product) && isRegistrationStaked(device) && isNodeStaked(device)) ||
            (minerPrefix === 'AEM' && isRegistrationStaked(device))) && (
            <Button
              className={`min-w-[150px] bg-transparent ${isDark ? 'text-red-100' : 'text-slate-900'} ${
                !isProductStakeAvailable(product)
                  ? 'border-gray-500 hover:bg-gray-500 hover:border-gray-500'
                  : isStaked()
                    ? 'border-green-500 hover:bg-green-500 hover:border-green-500'
                    : 'border-red-500 hover:bg-red-500 hover:border-red-500'
              }`}
              onClick={() => handleWithdrawAllButton(device)}
            >
              Unstake
            </Button>
          )}

          {renderVerificationActionButton()}

          <Button
            className={`min-w-[150px] bg-transparent ${
              !isProductStakeAvailable(product)
                ? `border-gray-500 ${textGray} hover:bg-gray-500 hover:border-gray-500`
                : isStaked()
                  ? `border-green-500 ${textStrong} hover:bg-green-500 hover:border-green-500`
                  : `border-red-500 ${textStrong} hover:bg-red-500 hover:border-red-500`
            }`}
            onClick={() => viewHistory()}
          >
            Reward History
          </Button>
        </div>
      </div>
    </div>
  );

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDetails();
    }
  };

  return (
    <>
      <div
        id={anchorId}
        role="button"
        tabIndex={0}
        onClick={openDetails}
        onKeyDown={handleCardKeyDown}
        className={`group relative mb-6 w-full cursor-pointer select-none rounded-xl border px-4 py-5 transition-all duration-200 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${cardBaseClass} ${borderClass} ${hoverRingClass} ${focusRingClass}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="text-[0.65rem] uppercase tracking-widest text-gray-500">
              {product?.name ?? 'Device'}
            </div>
            {typeof device.is_active === 'boolean' && (
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${device.is_active ? 'bg-green-500' : 'bg-gray-500'}`} />
                <span className={`text-xs font-medium ${device.is_active ? 'text-green-500' : 'text-gray-500'}`}>
                  {device.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-lg font-semibold sm:text-xl ${isDark ? 'text-white' : 'text-slate-900'}`}>
                {device.nickname ? device.nickname : device.name}
              </span>
              {device.byod && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[0.6rem] uppercase tracking-wide ${
                    isDark ? 'border border-gray-600/60 text-gray-300' : 'border border-slate-300 text-slate-700 bg-white/70'
                  }`}
                >
                  BYOD
                </span>
              )}
            </div>
          <div className="flex flex-wrap gap-1">
            {summaryBadges.map((badge, index) => (
              <span
                key={`${badge.label}-${index}`}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide ${badge.className}`}
                >
                  <span>{badge.label}</span>
                  {badge.info ? (
                    <Tooltip text={badge.info}>
                      <InformationCircleIcon
                        className="h-3 w-3 text-inherit/80"
                        aria-hidden="true"
                      />
                    </Tooltip>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 sm:gap-3 pr-1 sm:pr-2">
            {(needsRegistration && !hasRegistration) || (needsNodeStake && !hasNode) ? (
              <Tooltip text="Stake requirements">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handlePrimaryStakeRequirement();
                  }}
                  className={iconButtonClass}
                >
                  <span className="flex h-5 w-5 items-center justify-center">
                    <StakingIcon />
                  </span>
                  <span className="text-xs font-medium hidden sm:inline">Stake</span>
                </button>
              </Tooltip>
            ) : null}
            <Tooltip text="Edit info">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleChange(device.miner_key);
                }}
                className={iconButtonClass}
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  <EditIcon />
                </span>
                <span className="text-xs font-medium hidden sm:inline">Edit</span>
              </button>
            </Tooltip>
            <Tooltip text="Portal settings">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleSetting(device.miner_key);
                }}
                className={iconButtonClass}
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  <SettingIcon />
                </span>
                <span className="text-xs font-medium hidden sm:inline">Settings</span>
              </button>
            </Tooltip>
            <Tooltip text="Unregister">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleDeleteButton(device);
                }}
                className={iconButtonClass}
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  <DeleteIcon />
                </span>
                <span className="text-xs font-medium hidden sm:inline">Delete</span>
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {summaryMetrics.map((metric) => (
            <Tooltip key={metric.key} text={metric.tooltip} className="flex w-full">
              <div className={`w-full px-3 py-2 ${metricTileClass}`}>
                <div className={`text-[0.65rem] uppercase tracking-widest ${metricLabelClass}`}>
                  {metric.label}
                </div>
                <div className={`mt-1 text-sm font-semibold tabular-nums ${metric.accent}`}>
                  {metric.value}
                </div>
              </div>
            </Tooltip>
          ))}
        </div>
        <div className={`mt-4 flex flex-col gap-1 text-xs ${subTextMuted}`}>
          <span className={`uppercase tracking-widest text-[0.6rem] ${isDark ? 'text-gray-500' : 'text-slate-500'}`}>
            Reward wallet
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-mono text-[0.7rem] break-all ${isDark ? 'text-gray-200' : 'text-slate-800'}`}>
              {device.reward_wallet ?? '—'}
            </span>
            {device.reward_wallet && <CopyAddress address={device.reward_wallet} />}
          </div>
        </div>
        {/* Mobile action stack — full-width tappable buttons */}
        <div className="flex md:hidden flex-col gap-2 mt-4">
          {(needsRegistration && !hasRegistration) || (needsNodeStake && !hasNode) ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handlePrimaryStakeRequirement();
              }}
              className={`inline-flex items-center justify-center gap-2 w-full min-h-[44px] rounded-lg border px-3 text-sm font-medium transition ${isDark ? 'border-white/10 bg-white/5 text-white hover:bg-white/10' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="flex h-5 w-5 items-center justify-center">
                <StakingIcon />
              </span>
              <span className="text-sm font-medium">Stake</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleChange(device.miner_key);
            }}
            className={`inline-flex items-center justify-center gap-2 w-full min-h-[44px] rounded-lg border px-3 text-sm font-medium transition ${isDark ? 'border-white/10 bg-white/5 text-white hover:bg-white/10' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            <span className="flex h-5 w-5 items-center justify-center">
              <EditIcon />
            </span>
            <span className="text-sm font-medium">Edit</span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleSetting(device.miner_key);
            }}
            className={`inline-flex items-center justify-center gap-2 w-full min-h-[44px] rounded-lg border px-3 text-sm font-medium transition ${isDark ? 'border-white/10 bg-white/5 text-white hover:bg-white/10' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            <span className="flex h-5 w-5 items-center justify-center">
              <SettingIcon />
            </span>
            <span className="text-sm font-medium">Settings</span>
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleDeleteButton(device);
            }}
            className={`inline-flex items-center justify-center gap-2 w-full min-h-[44px] rounded-lg border px-3 text-sm font-medium transition ${isDark ? 'border-white/10 bg-white/5 text-white hover:bg-white/10' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
          >
            <span className="flex h-5 w-5 items-center justify-center">
              <DeleteIcon />
            </span>
            <span className="text-sm font-medium">Delete</span>
          </button>
        </div>
        {rewardWalletChecking && (
          <div
            className="mt-2 text-[0.65rem] text-gray-400"
            onClick={(event) => event.stopPropagation()}
          >
            Checking reward wallet opt-in status…
          </div>
        )}
        {rewardWalletNeedsOptIn && rewardAssetIdForOptIn && (
          <div
            className={`mt-3 rounded-lg border p-3 text-[0.7rem] ${
              isDark
                ? 'border-warning-400/60 bg-warning-500/10 text-warning-50'
                : 'border-warning-200 bg-warning-50 text-warning-800'
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={isDark ? 'font-semibold text-warning-100' : 'font-semibold text-warning-800'}>
              Opt into {rewardOptInLabel} for {rewardOptInReason}
            </div>
            <p className={`mt-1 ${isDark ? 'text-warning-100/90' : 'text-warning-700'}`}>
              Reward wallet {truncateAddress(device.reward_wallet)} must opt into ASA #{rewardAssetIdForOptIn}{' '}
              before we can send {rewardOptInReason}.
              <span className="block mt-1">{rewardOptInSteps}</span>
              {deflyUnverifiedHint && (
                <span className={`block mt-1 ${isDark ? 'text-warning-100/80' : 'text-warning-700/80'}`}>
                  {deflyUnverifiedHint}
                </span>
              )}
            </p>
            <div
              className={`mt-2 flex flex-wrap items-center gap-2 font-mono text-[0.65rem] ${
                isDark ? 'text-warning-200' : 'text-warning-800'
              }`}
            >
              ASA #{rewardAssetIdForOptIn}
              <CopyAddress address={rewardAssetIdForOptIn} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[0.65rem]">
              <button
                type="button"
                className={`rounded border px-3 py-1 font-semibold uppercase tracking-wide ${
                  isDark
                    ? 'border-warning-300/60 text-warning-100 hover:bg-warning-400/20'
                    : 'border-warning-300 text-warning-800 hover:bg-warning-100'
                }`}
                onClick={handleRewardOptInClick}
              >
                Copy ASA ID
              </button>
              <button
                type="button"
                className={`rounded border px-3 py-1 font-semibold uppercase tracking-wide ${
                  isDark
                    ? 'border-warning-300/60 text-warning-100 hover:bg-warning-400/20'
                    : 'border-warning-300 text-warning-800 hover:bg-warning-100'
                }`}
                onClick={handleRewardOptInGuideClick}
              >
                Scan QR to Opt-in
              </button>
            </div>
          </div>
        )}
        <div
          className="mt-4 flex flex-wrap items-center gap-2"
          onClick={(event) => event.stopPropagation()}
        >
          {isLegacyStake && (
          <Button
            className={`min-w-[110px] bg-transparent text-[0.6rem] py-1 border-warning-500 ${
              isDark ? 'text-warning-200 hover:text-black' : 'text-black'
            } hover:bg-warning-500 hover:border-warning-500`}
            onClick={(event) => {
              event.stopPropagation();
              handleWithdrawStake(device);
            }}
          >
              Withdraw Legacy Stake
            </Button>
          )}
          {/* Mandatory staking first for node/AEM when incomplete */}
          {(isNodeProduct(product) || minerPrefix === 'AEM') && needsRegistration && !hasRegistration && (
            <StakeRequirementCTA requirement="registration" label="Stake Registration" compact />
          )}
          {isNodeProduct(product) && needsNodeStake && !hasNode && (
            <StakeRequirementCTA requirement="node" label="Stake Node Operation" compact />
          )}
          <Button
            className={`min-w-[110px] bg-transparent text-[0.6rem] py-1 transition-colors duration-150 ${
              !isProductStakeAvailable(product) || claimableAmount <= 0
                ? `border-gray-600 ${textGray} cursor-not-allowed`
                : isStaked()
                  ? `border-green-500 ${textGreen} hover:bg-green-600/10`
                  : `border-red-500 ${textRed} hover:bg-red-600/10`
            }`}
            disabled={claimableAmount <= 0}
            onClick={() => handleClaimButton(device)}
          >
            Claim Reward
          </Button>
          <Button
            className={`min-w-[110px] bg-transparent text-[0.6rem] py-1 transition-colors duration-150 ${
              !isProductStakeAvailable(product)
                ? `border-gray-500 ${textGray} hover:bg-gray-600/20 cursor-not-allowed`
                : pendingAmount > 0
                  ? `border-red-600 ${textRed} hover:bg-red-600/10`
                  : isStaked()
                    ? `border-green-500 ${textGreen} cursor-not-allowed`
                    : `border-gray-500 ${textGray} cursor-not-allowed`
            }`}
            disabled={pendingAmount <= 0}
            onClick={() => handleBoostButton(device)}
          >
            Instant Claim (30% fee)
          </Button>
          {((isNodeProduct(product) && isRegistrationStaked(device) && isNodeStaked(device)) ||
            (minerPrefix === 'AEM' && isRegistrationStaked(device))) && (
            <Tooltip text="Registration and node staking keeps rewards flowing. Withdrawing stops payouts until you re-stake.">
              <Button
                className={`min-w-[110px] bg-transparent text-[0.6rem] py-1 ${isDark ? 'text-red-100' : 'text-slate-900'} ${
                  !isProductStakeAvailable(product)
                    ? `border-gray-500 ${textGray} hover:bg-gray-500 hover:border-gray-500`
                    : isStaked()
                      ? `border-green-500 ${textGreen} hover:bg-green-500 hover:border-green-500`
                      : `border-red-500 ${textRed} hover:bg-red-500 hover:border-red-500`
                }`}
                onClick={() => handleWithdrawAllButton(device)}
              >
                Unstake
              </Button>
            </Tooltip>
          )}
          {renderVerificationActionButton('compact')}
          <Button
            className={`min-w-[110px] bg-transparent text-[0.6rem] py-1 ${
              !isProductStakeAvailable(product)
                ? `border-gray-500 ${textGray} hover:bg-gray-500 hover:border-gray-500`
                : isStaked()
                  ? `border-green-500 ${textGreen} hover:bg-green-500 hover:border-green-500`
                  : `border-red-500 ${textRed} hover:bg-red-500 hover:border-red-500`
            }`}
            onClick={() => viewHistory()}
          >
            History
          </Button>
        </div>
        {pendingAmount > 0 && (
          <>
            {/* Light mode: raise contrast with black text; keep warm warning hint in dark mode. */}
            <div className={`mt-2 text-[0.6rem] ${isDark ? 'text-warning-200/80' : 'text-black'}`}>
              Pending rewards unlock after 30 days from accrual. Wait for the unlock to claim at 0% fee, or use Instant Claim (30% fee) if you need the funds early.
            </div>
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span className={`font-mono text-[0.7rem] ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>
            {truncateAddress(device.miner_key)}
          </span>
          {nextUnlockUTC && (
            <span className={`ml-auto ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>
              Next unlock {countdown ? `• ${countdown}` : `• ${nextUnlockUTC}`}
            </span>
          )}
        </div>
        <div
          className={`mt-4 rounded-lg border border-dashed px-3 py-2 text-xs ${
            isDark ? 'border-gray-800/80 bg-black/40 text-gray-400' : 'border-slate-200 bg-slate-50 text-slate-600'
          }`}
        >
          Click to open detailed actions and history.
        </div>
      </div>
      {expanded && isPortalReady &&
          createPortal(
          <div
            className={`fixed inset-0 z-[100] flex items-start justify-center ${overlayClass} px-4 py-8 pt-20 backdrop-blur-sm`}
            onClick={closeDetails}
          >
            <div
              className={modalShellClass}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={closeDetails}
                className={`absolute right-5 top-5 inline-flex h-9 w-9 items-center justify-center rounded-xl transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 ${
                  isDark
                    ? 'bg-white/5 text-gray-300 hover:bg-red-600/30 hover:text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-red-50 hover:text-red-600 border border-slate-200'
                }`}
                aria-label="Close device details"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              {detailContent}
            </div>
          </div>,
          document.body
        )}
      {optInQr && isPortalReady &&
        createPortal(
          <div
            className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 px-4 py-8"
            onClick={() => setOptInQr(null)}
          >
            <div
              className="relative w-full max-w-sm rounded-2xl border border-red-500/40 bg-[#0b0b0f]/95 p-5 shadow-2xl shadow-red-900/40"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setOptInQr(null)}
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-gray-200 transition hover:bg-red-600/30 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
                aria-label="Close opt-in QR"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <div className="space-y-3 text-sm text-gray-100">
                <div className="text-base font-semibold text-white">Opt-in to {optInQr.label}</div>
                <p className="text-xs text-gray-300">
                  Scan this QR in your wallet to opt into ASA #{optInQr.assetId} for {optInQr.reason}.
                  If your wallet cannot scan, paste the ASA ID manually.
                </p>
                <div className="flex justify-center">
                  <div className="rounded-2xl bg-white p-2">
                    <Image
                      src={optInQr.src}
                      alt={`Opt-in QR for ${optInQr.label}`}
                      width={260}
                      height={260}
                      className="h-60 w-60 object-contain"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[0.7rem] text-gray-200">
                  ASA #{optInQr.assetId}
                  <CopyAddress address={optInQr.assetId} />
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
