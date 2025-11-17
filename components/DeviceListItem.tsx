import { Button, Title } from '@tremor/react';
import { Device, Product } from '../lib/types';
import CopyAddress from './CopyAddress';
import DeleteIcon from './DeleteIcon';
import { useCallback, useEffect, useMemo, useState, ReactNode } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { isProductStakeAvailable } from '../pages/devices';
import { useRouter } from 'next/router';
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
import { describeMacIssue } from '../lib/validators/macAddressValidator';
import { InformationCircleIcon } from '@heroicons/react/outline';
// import WithdrawIcon from './WithdrawIcon';
import StakingIcon from './StakeIcon';
import EditIcon from './EditIcon';
import SettingIcon from './SettingIcon';
import { useSession } from 'next-auth/react';
import Tooltip from './Tooltip';
import { useRewardSummary } from '../lib/hooks/useRewardSummary';

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

// Hardware check uses the same `NEXT_PUBLIC_CREDENTIALS_NEEDED` parsing above.
function isHardwareCheckRequiredForPrefix(prefix: string) {
  return isLinkRequiredForPrefix(prefix);
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

export default function DeviceListItem({
  initialDevice,
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
  hardwareStatus
  // handleAlgoWithdrawButton,
}: {
  initialDevice: Device;
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
    reason?: string;
    detail?: string;
  };
  // handleAlgoWithdrawButton: (device: Device) => void;
}) {
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
  const { data: session } = useSession();
  const isLegacyStake = useMemo(() => isLegacyVerificationStake(device), [device]);
  const legacyDeadlineLabel = useMemo(() => {
    if (!LEGACY_FORCE_DATE) return null;
    return LEGACY_FORCE_DATE.toUTCString();
  }, []);
  const [expanded, setExpanded] = useState(false);
  const [isPortalReady, setIsPortalReady] = useState(false);

  useEffect(() => {
    setIsPortalReady(true);
  }, []);

  const openDetails = () => setExpanded(true);
  const closeDetails = () => setExpanded(false);

  const deviceStatusOkay = device?.verified === true && alertShow === false;

  const router = useRouter();
  const isStaked = () => {
    if (!device) {
      return false;
    }

    if (!device.verified) {
      return false;
    }

    return true;
  };

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
    const stakeHint = 'Use the Stake icon to complete this staking step before verification.';

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
    type Badge = { label: string; className: string; severity: 'red' | 'yellow' | 'green' | 'default'; info?: string };
    const badges: Array<Badge> = [];
    const portalHelp =
      'Open the gear icon (Portal settings) and complete the Fry portal link so rewards keep flowing.';
    if (!device.registered_portal_model) {
      if (isLinkRequiredForPrefix(minerPrefix)) {
        badges.push({
          label: 'Portal link needed',
          className: 'bg-red-500/20 text-red-200 border border-red-400/40',
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
        className: 'bg-red-500/20 text-red-200 border border-red-400/40',
        severity: 'red',
        info: macInfo
      });
    }

    badges.push(
      device.verified
        ? { label: 'Verified', className: 'bg-green-500/20 text-green-200 border border-green-400/40', severity: 'green' }
        : { label: 'Unverified', className: 'bg-yellow-500/20 text-yellow-200 border border-yellow-400/40', severity: 'yellow' }
    );

    if (isLegacyStake) {
      badges.push({
        label: 'Legacy FRY 1.0 stake',
        className: 'bg-amber-500/20 text-amber-100 border border-amber-400/40',
        severity: 'yellow',
        info: 'Legacy FRY 1.0 verification stake detected. Withdraw the legacy stake and re-stake with FRY 2.0 to keep multiplier rewards.'
      });
    }

    issueMessages
      .filter(Boolean)
      .forEach((message) => {
        if (!badges.some((b) => b.label === message.label)) {
          badges.push({
            label: message.label,
            className: 'bg-red-500/20 text-red-200 border border-red-400/40',
            severity: 'red',
            info: message.info
          });
        }
      });

    const severityRank: Record<Badge['severity'], number> = {
      red: 0,
      yellow: 1,
      green: 2,
      default: 3
    };

    return badges.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  }, [
    device.registered_portal_model,
    device.verified,
    isLegacyStake,
    issueMessages,
    minerPrefix,
    hardwareStatus?.linked,
    hardwareWarning
  ]);

  // Determine verification prerequisites based on product config and current device state
  const needsRegistration = isRegistrationNeeded(product);
  const needsNodeStake = isNodeProduct(product) && isNodeStakingNeeded(product);
  const hasRegistration = isRegistrationStaked(device);
  const hasNode = isNodeStaked(device);
  const verificationBlocked = (needsRegistration && !hasRegistration) || (needsNodeStake && !hasNode);
  const portalMissing = linkRequiredForPrefix && !device.registered_portal_model;
  const stakingPrereqsMissing = verificationBlocked;
  const shouldShowRed = stakingPrereqsMissing || portalMissing || hardwareWarning || hasDeviceStatusIssues;
  const shouldShowYellow = !shouldShowRed && !device.verified;
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
    if (stakeable === false && !device.verified) {
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
        borderClass: 'border-yellow-400',
        hoverRingClass: 'hover:ring-2 hover:ring-yellow-300/70 hover:ring-offset-0',
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

  const { data: rewardSummary } = useRewardSummary(device?.miner_key);
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
      } border-red-500 text-red-100 hover:bg-red-500 hover:border-red-500`}
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
        label: 'Unverified',
        description: 'Base daily rate without multiplier',
        value: baseDailyReward,
        accent: 'text-gray-200'
      },
      {
        key: 'type1',
        label: 'Type 1 • 1.5×',
        description: '24 hour lock multiplier',
        value: typeOneDaily,
        accent: 'text-green-300'
      },
      {
        key: 'type2',
        label: 'Type 2 • 3×',
        description: '6 month lock multiplier',
        value: typeTwoDaily,
        accent: 'text-amber-300'
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
          setDevice(data.device as Device);
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
    fetchDeviceInfo(initialDevice.miner_key);
  }, [fetchDeviceInfo, initialDevice.miner_key]);

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
                  <span className="text-amber-300">Type 2 (6 month lock)</span>
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
        color: 'border-amber-500/60 bg-amber-500/10',
        tooltip: (
          <div className="min-w-[280px] space-y-2">
            <div className="border-b border-amber-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-amber-300">
              Verification Withdrawal
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <span className="text-gray-400">Amount:</span>
              <span className="font-semibold text-amber-200">{formatAmount(verificationWithdrawal.amount)}</span>

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
        color: 'border-amber-500/60 bg-amber-500/10',
        tooltip: (
          <div className="min-w-[260px] space-y-2">
            <div className="border-b border-amber-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-amber-300">
              Verification Withdrawal
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <span className="text-gray-400">Amount:</span>
              <span className="font-semibold text-amber-200">{formatAmount(device.staked.amount)}</span>

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
            </div>
          )
        });
      } else if (registrationWithdrawal || latestHistoryEntry) {
        const withdrawalSource = registrationWithdrawal ?? latestHistoryEntry!;
        entries.push({
          key: 'registration-withdrawn',
          label: 'Registration stake withdrew on',
          date: formatDateTime(withdrawalSource.time ?? registrationDetail.time),
          color: 'border-amber-500/60 bg-amber-500/10',
          tooltip: (
            <div className="min-w-[250px] space-y-2">
              <div className="border-b border-amber-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-amber-300">
                Registration Withdrawal
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <span className="text-gray-400">Amount:</span>
                <span className="font-semibold text-amber-200">
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
          color: 'border-orange-500/60 bg-orange-500/10',
          tooltip: (
            <div className="min-w-[250px] space-y-2">
              <div className="border-b border-orange-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-orange-300">
                Node Operation Stake
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <span className="text-gray-400">Amount:</span>
                <span className="font-semibold text-orange-300">
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
            </div>
          )
        });
      } else if (nodeWithdrawal || latestNodeHistory) {
        const nodeWithdrawalSource = nodeWithdrawal ?? latestNodeHistory!;
        entries.push({
          key: 'node-withdrawn',
          label: 'Node stake withdrew on',
          date: formatDateTime(nodeWithdrawalSource.time ?? nodeDetail.time),
          color: 'border-amber-500/60 bg-amber-500/10',
          tooltip: (
            <div className="min-w-[250px] space-y-2">
              <div className="border-b border-amber-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-amber-300">
                Node Stake Withdrawal
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <span className="text-gray-400">Amount:</span>
                <span className="font-semibold text-amber-200">
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
        accent: 'text-green-300',
        tooltip: REWARD_STATUS_DESCRIPTIONS.claimable
      },
      {
        key: 'pending',
        label: 'Pending',
        value: formatTokenAmount(pendingAmount),
        accent: 'text-amber-300',
        tooltip: REWARD_STATUS_DESCRIPTIONS.pending
      },
      {
        key: 'accruing',
        label: 'Accruing (weekly preview)',
        value: formatTokenAmount(rewardSummary?.accruing ?? 0),
        accent: 'text-sky-300',
        tooltip: REWARD_STATUS_DESCRIPTIONS.accruing
      }
    ],
    [claimableAmount, pendingAmount, rewardSummary?.accruing]
  );

  const nextUnlockUTC = useMemo(() => {
    if (!rewardSummary?.nextUnlockAt) return null;
    const date = new Date(rewardSummary.nextUnlockAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toUTCString();
  }, [rewardSummary?.nextUnlockAt]);

  type SectionConfig = {
    key: 'rewards' | 'contact' | 'status';
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
              <div className="text-gray-400">Reward token</div>
              <div className="mt-1 flex flex-wrap items-baseline gap-2 text-gray-200">
                <span className="text-sm font-semibold" title={rewardTokenDetail.name}>
                  {rewardTokenDetail.label}
                </span>
                {rewardTokenDetail.id && (
                  <span className="font-mono text-[0.65rem] text-gray-500">#{rewardTokenDetail.id}</span>
                )}
              </div>
            </div>
            {dailyRewardEntries.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">Daily earnings</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {dailyRewardEntries.map((entry) => (
                    <div
                      key={entry.key}
                      className="rounded-lg border border-gray-800/70 bg-gray-900/40 p-3"
                    >
                      <div className="text-[0.7rem] uppercase tracking-wide text-gray-500">
                        {entry.label}
                      </div>
                      <div className={`mt-1 text-lg font-semibold ${entry.accent}`}>
                        {`${formatDailyValue(entry.value)} ${rewardTokenUnitLabel}`}
                      </div>
                      <div className="text-[0.65rem] text-gray-500">{entry.description}</div>
                    </div>
                  ))}
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
                      className="rounded-lg border border-gray-800/70 bg-gray-900/40 p-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-gray-200">
                        <span className="font-semibold">{option.title}</span>
                        <span className="text-xs text-emerald-300">{option.multiplier}</span>
                      </div>
                      <div className="mt-2 text-[0.85rem] text-gray-300">
                        Stake requirement:{' '}
                        <span className="font-semibold text-white">
                          {option.amount !== null
                            ? `${option.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${stakeTokenDetail.label}`
                            : 'Not required'}
                        </span>
                      </div>
                      <div className="text-[0.65rem] text-gray-500">{option.description}</div>
                    </div>
                  ))}
                </div>
                {stakeTokenDetail.id && (
                  <div className="text-[0.65rem] text-gray-500">
                    Stake asset:{' '}
                    <span className="font-semibold text-gray-300" title={stakeTokenDetail.name}>
                      {stakeTokenDetail.label}
                    </span>{' '}
                    <span className="font-mono text-gray-400">#{stakeTokenDetail.id}</span>
                  </div>
                )}
                {byodDiscountApplied && (
                  <div className="text-[0.65rem] text-amber-300">
                    BYOD licence detected: stake requirements shown include the 50% BYOD discount.
                  </div>
                )}
              </div>
            )}
            {(needsRegistration || needsNodeStake) && (
              <div className="space-y-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Operational staking requirements
                </div>
                {needsRegistration && (
                  <div className="rounded-lg border border-gray-800/70 bg-gray-900/40 p-3">
                    <div className="flex items-center justify-between text-sm text-gray-200">
                      <span className="font-semibold">Registration stake</span>
                      <span className={`text-xs ${hasRegistration ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {hasRegistration ? 'Completed' : 'Required'}
                      </span>
                    </div>
                    <div className="mt-1 text-[0.85rem] text-gray-300">
                      {registrationRequirementHint ?? 'Stake not required'}
                    </div>
                    {registrationTokenDetail.id && (
                      <div className="mt-1 text-[0.65rem] text-gray-500">
                        Asset:{' '}
                        <span className="font-semibold text-gray-300" title={registrationTokenDetail.name}>
                          {registrationTokenDetail.label}
                        </span>{' '}
                        <span className="font-mono text-gray-400">#{registrationTokenDetail.id}</span>
                      </div>
                    )}
                  </div>
                )}
                {needsNodeStake && (
                  <div className="rounded-lg border border-gray-800/70 bg-gray-900/40 p-3">
                    <div className="flex items-center justify-between text-sm text-gray-200">
                      <span className="font-semibold">Node operation stake</span>
                      <span className={`text-xs ${hasNode ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {hasNode ? 'Completed' : 'Required'}
                      </span>
                    </div>
                    <div className="mt-1 text-[0.85rem] text-gray-300">
                      {nodeRequirementHint ?? 'Stake not required'}
                    </div>
                    {nodeTokenDetail.id && (
                      <div className="mt-1 text-[0.65rem] text-gray-500">
                        Asset:{' '}
                        <span className="font-semibold text-gray-300" title={nodeTokenDetail.name}>
                          {nodeTokenDetail.label}
                        </span>{' '}
                        <span className="font-mono text-gray-400">#{nodeTokenDetail.id}</span>
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
              <div className="text-gray-400">Owner wallet</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs sm:text-sm text-gray-200 break-all">
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
              <div className="text-gray-400">Reward wallet</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs sm:text-sm text-gray-200 break-all">
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
              <div className="text-gray-400">Email</div>
              <div className="mt-1 text-gray-200 break-words">{device.email ?? '—'}</div>
            </div>
            <div>
              <div className="text-gray-400">Location</div>
              <div className="mt-1 text-gray-200">
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
              <span className="text-gray-400">Verification</span>
              <span
                className={`font-semibold ${
                  deviceStatusOkay
                    ? 'text-green-300'
                    : shouldShowYellow
                      ? 'text-yellow-300'
                      : 'text-red-300'
                }`}
              >
                {device.verified ? 'Verified' : 'Unverified'}
              </span>
            </div>
            {Object.keys(deviceStatus).length > 0 && (
              <div className="space-y-2">
                {Object.entries(deviceStatus).map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
                  >
                    {value}
                  </div>
                ))}
              </div>
            )}
            {isLegacyStake && (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                Legacy FRY 1.0 verification stake detected. Withdraw the legacy stake and re-stake with FRY 2.0 to keep multiplier rewards.
                {legacyDeadlineLabel && (
                  <div className="mt-1 text-[0.65rem] text-amber-200">
                    Verification benefits end after {legacyDeadlineLabel} unless you restake with FRY 2.0.
                  </div>
                )}
              </div>
            )}
          </div>
        )
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
      nodeTokenDetail.name
    ]
  );

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    const baseState: Record<string, boolean> = { rewards: true, contact: true, status: true };
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
      <div
        key={section.key}
        className="rounded-xl border border-gray-800 bg-black/70"
      >
        <button
          type="button"
          className="w-full px-4 py-3 flex items-center justify-between text-left text-gray-200 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-red-400"
          onClick={() => toggleSection(section.key)}
        >
          <span className="text-xs uppercase tracking-wide text-gray-400">
            {section.title}
          </span>
          <div className="flex items-center gap-2">
            {showAlertBadge && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[0.6rem] uppercase tracking-wide text-red-200">
                Attention
              </span>
            )}
            <span className="text-xs text-gray-500">{isExpanded ? 'Hide' : 'Show'}</span>
          </div>
        </button>
        {isExpanded && (
          <div className="border-t border-gray-800 px-4 py-4 text-sm text-gray-100">
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

      const baseClass =
        variant === 'default'
          ? `min-w-[150px] bg-transparent ${
              verificationLocked
                ? 'border-gray-500 text-gray-500 cursor-not-allowed'
                : isStaked()
                  ? 'border-green-500 hover:bg-green-500 hover:border-green-500'
                  : verificationBlocked
                    ? 'border-gray-500 text-gray-500 cursor-not-allowed'
                    : 'border-red-500 hover:bg-red-500 hover:border-red-500'
            }`
          : `min-w-[110px] bg-transparent text-[0.6rem] py-1 ${
              verificationLocked
                ? 'border-gray-500 text-gray-500 cursor-not-allowed'
                : isStaked()
                  ? 'border-green-500 hover:bg-green-500 hover:border-green-500'
                  : verificationBlocked
                    ? 'border-gray-500 text-gray-500 cursor-not-allowed'
                    : 'border-red-500 hover:bg-red-500 hover:border-red-500'
            }`;

      const button = (
        <span>
          <Button
            className={baseClass}
            disabled={verificationLocked || (!isStaked() && verificationBlocked)}
            onClick={(event) => {
              event.stopPropagation();
              if (verificationLocked) return;
              if (!isStaked() && verificationBlocked) return;
              handleWithdrawStake(device);
            }}
          >
            {isStaked() ? 'Verification Withdraw' : 'Verification Stake'}
          </Button>
        </span>
      );

      const tooltipText = verificationLocked
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
      isStaked
    ]
  );

  const detailContent = (
    <div className="space-y-6 pt-8 text-sm text-gray-100">
      {!device.registered_portal_model && isLinkRequiredForPrefix(minerPrefix) && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-yellow-200">
          This device is not linked to FryNetworks. Click the <b>gear icon</b> to link it.
        </div>
      )}
      {!(!device.registered_portal_model) && hardwareWarning && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-yellow-200">
          We could not verify a MAC address for this device. Click the <b>gear icon</b> to re-link your MAC so rewards remain active.
        </div>
      )}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
          <Title className="text-white text-2xl md:text-3xl">
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
          <div className="space-y-1 text-xs text-gray-400">
            <div className="flex flex-wrap items-center gap-2">
              <span className="uppercase tracking-wide text-[0.65rem] text-gray-500">Miner key</span>
              <span className="font-mono text-[0.75rem] text-gray-200 break-all">{device.miner_key}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="uppercase tracking-wide text-[0.65rem] text-gray-500">Product</span>
              <span className="text-gray-200">{product?.name ?? '—'}</span>
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
                  className="inline-flex p-1.5 text-white/80 transition hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
                >
                  <span className="flex h-5 w-5 items-center justify-center">
                    <StakingIcon />
                  </span>
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
                className="inline-flex p-1.5 text-white/80 transition hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  <EditIcon />
                </span>
              </button>
            </Tooltip>
            <Tooltip text="Portal settings">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleSetting(device.miner_key);
                }}
                className="inline-flex p-1.5 text-white/80 transition hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  <SettingIcon />
                </span>
              </button>
            </Tooltip>
            <Tooltip text="Unregister">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleDeleteButton(device);
                }}
                className="inline-flex p-1.5 text-white/80 transition hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  <DeleteIcon />
                </span>
              </button>
            </Tooltip>
          </div>
        </div>
        </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {collapsibleSections.map(renderSection)}
      </div>
      {!!timelineEntries.length && (
        <div className="rounded-xl border border-gray-800 bg-black/70 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Activity timeline</div>
          <div className="mt-3 space-y-3">
            {timelineEntries.map((entry) => (
              <div key={entry.key} className={`rounded-lg border ${entry.color} px-3 py-2`}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <span>{entry.label}</span>
                    {entry.tooltip && (
                      <Tooltip text={entry.tooltip} className="max-w-sm">
                        <InformationCircleIcon className="h-4 w-4 text-gray-500 hover:text-gray-300" />
                      </Tooltip>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-gray-200">{entry.date}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-800 bg-black/70 p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Rewards</div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-400">Pending</div>
              <div className="font-semibold text-amber-200">{formatTokenAmount(pendingAmount)}</div>
            </div>
            <div>
              <div className="text-gray-400">Claimable</div>
              <div className="font-semibold text-green-300">{formatTokenAmount(claimableAmount)}</div>
            </div>
            <div>
              <div className="text-gray-400">Claimed</div>
              <div className="font-semibold text-gray-100">{formatTokenAmount(claimedAmount)}</div>
            </div>
            <div>
              <div className="text-gray-400">Accruing (weekly preview)</div>
              <div className="font-semibold text-sky-300">{formatTokenAmount(rewardSummary?.accruing ?? 0)}</div>
            </div>
          </div>
          {pendingAmount > 0 && (
            <div className="mt-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
              Rewards collect as pending for up to 30 days. Once that timer completes they unlock for a fee-free claim; claiming earlier with Instant Claim applies the 30% boost fee.
            </div>
          )}
        </div>
        <div className="rounded-xl border border-gray-800 bg-black/70 p-4 space-y-2">
          <div className="text-xs uppercase tracking-wide text-gray-500">Unlock window</div>
          <div className="text-sm text-gray-100">
            {nextUnlockUTC ? (
              <>
                <div>
                  Next unlock: <span className="font-semibold">{nextUnlockUTC}</span>
                </div>
                {countdown && <div className="text-xs text-gray-400">Unlocks in {countdown}</div>}
              </>
            ) : (
              <div>No unlock window scheduled</div>
            )}
          </div>
          {rewardSummary?.accruing && (
            <div className="text-xs text-gray-400">
              Weekly estimate reflects current accrual pace. Actual payout finalizes at unlock.
            </div>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-gray-800 bg-black/70 p-4">
        <div className="text-xs uppercase tracking-wide text-gray-500">Actions</div>
        <div className="mt-3 flex flex-wrap gap-3">
          {isLegacyStake && (
            <Button
              className="min-w-[150px] border-amber-500 text-amber-900 bg-transparent hover:bg-amber-500 hover:border-amber-500 hover:text-black dark:text-amber-200"
              onClick={(event) => {
                event.stopPropagation();
                handleWithdrawStake(device);
              }}
            >
              Withdraw Legacy Stake
            </Button>
          )}
          {renderVerificationActionButton()}
          {needsRegistration && !hasRegistration && (
            <StakeRequirementCTA requirement="registration" label="Stake Registration" />
          )}
          {needsNodeStake && !hasNode && (
            <StakeRequirementCTA requirement="node" label="Stake Node Operation" />
          )}
          <Button
            className={`min-w-[150px] bg-transparent transition-colors duration-150 ${
              !isProductStakeAvailable(product) || claimableAmount <= 0
                ? 'border-gray-600 text-gray-500 cursor-not-allowed'
                : isStaked()
                  ? 'border-green-500 text-green-300 hover:bg-green-600/10'
                  : 'border-red-500 text-red-300 hover:bg-red-600/10'
            }`}
            disabled={claimableAmount <= 0}
            onClick={() => handleClaimButton(device)}
          >
            Claim Reward
          </Button>
          <Button
            className={`min-w-[150px] bg-transparent transition-colors duration-150 ${
              !isProductStakeAvailable(product)
                ? 'border-gray-500 text-gray-500 hover:bg-gray-600/20 cursor-not-allowed'
                : pendingAmount > 0 && boostSupported
                  ? 'border-red-600 text-red-300 hover:bg-red-600/10 hover:text-red-200'
                  : 'border-gray-500 text-gray-500 cursor-not-allowed'
            }`}
            disabled={pendingAmount <= 0 || !boostSupported}
            onClick={() => handleBoostButton(device)}
            title={!boostSupported ? 'Instant Claim is available only for fNODE and tFRY rewards.' : undefined}
          >
            Instant Claim (30% Fee)
          </Button>
          <Button
            className={`min-w-[150px] bg-transparent ${
              !isProductStakeAvailable(product)
                ? 'border-gray-500 hover:bg-gray-500 hover:border-gray-500'
                : isStaked()
                  ? 'border-green-500 hover:bg-green-500 hover:border-green-500'
                  : 'border-red-500 hover:bg-red-500 hover:border-red-500'
            }`}
            onClick={() => viewHistory()}
          >
            Reward History
          </Button>
          {((device && product && isNodeProduct(product) && isRegistrationStaked(device)) || isNodeStaked(device)) && (
            <Button
              className={`min-w-[150px] bg-transparent ${
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
        className={`group relative mb-6 w-full cursor-pointer select-none rounded-xl border bg-black/60 px-4 py-5 text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${borderClass} ${hoverRingClass}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="text-[0.65rem] uppercase tracking-widest text-gray-500">
              {product?.name ?? 'Device'}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-white sm:text-xl">
                {device.nickname ? device.nickname : device.name}
              </span>
              {device.byod && (
                <span className="rounded-full border border-gray-600/60 px-2 py-0.5 text-[0.6rem] uppercase tracking-wide text-gray-300">
                  BYOD
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {summaryBadges.map((badge, index) => (
                <span
                  key={`${badge.label}-${index}`}
                  className={`inline-flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide ${badge.className}`}
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
          <div className="flex items-center gap-2 sm:gap-3 pr-1 sm:pr-2">
            {(needsRegistration && !hasRegistration) || (needsNodeStake && !hasNode) ? (
              <Tooltip text="Stake requirements">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handlePrimaryStakeRequirement();
                  }}
                  className="inline-flex p-1.5 text-white/70 transition hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
                >
                  <span className="flex h-5 w-5 items-center justify-center">
                    <StakingIcon />
                  </span>
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
                className="inline-flex p-1.5 text-white/70 transition hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  <EditIcon />
                </span>
              </button>
            </Tooltip>
            <Tooltip text="Portal settings">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleSetting(device.miner_key);
                }}
                className="inline-flex p-1.5 text-white/70 transition hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  <SettingIcon />
                </span>
              </button>
            </Tooltip>
            <Tooltip text="Unregister">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleDeleteButton(device);
                }}
                className="inline-flex p-1.5 text-white/70 transition hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
              >
                <span className="flex h-5 w-5 items-center justify-center">
                  <DeleteIcon />
                </span>
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {summaryMetrics.map((metric) => (
            <Tooltip key={metric.key} text={metric.tooltip} className="flex w-full">
              <div className="w-full rounded-lg border border-gray-800/80 bg-black/60 px-3 py-2">
                <div className="text-[0.65rem] uppercase tracking-widest text-gray-500">
                  {metric.label}
                </div>
                <div className={`mt-1 text-sm font-semibold tabular-nums ${metric.accent}`}>
                  {metric.value}
                </div>
              </div>
            </Tooltip>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-1 text-xs text-gray-400">
          <span className="uppercase tracking-widest text-[0.6rem] text-gray-500">Reward wallet</span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[0.7rem] text-gray-200 break-all">
              {device.reward_wallet ?? '—'}
            </span>
            {device.reward_wallet && <CopyAddress address={device.reward_wallet} />}
          </div>
        </div>
        <div
          className="mt-4 flex flex-wrap items-center gap-2"
          onClick={(event) => event.stopPropagation()}
        >
          {isLegacyStake && (
            <Button
              className="min-w-[110px] bg-transparent text-[0.6rem] py-1 border-amber-500 text-amber-900 hover:bg-amber-500 hover:border-amber-500 hover:text-black dark:text-amber-200"
              onClick={(event) => {
                event.stopPropagation();
                handleWithdrawStake(device);
              }}
            >
              Withdraw Legacy Stake
            </Button>
          )}
          {renderVerificationActionButton('compact')}
          {needsRegistration && !hasRegistration && (
            <StakeRequirementCTA requirement="registration" label="Stake Registration" compact />
          )}
          {needsNodeStake && !hasNode && (
            <StakeRequirementCTA requirement="node" label="Stake Node Operation" compact />
          )}
          <Button
            className={`min-w-[110px] bg-transparent text-[0.6rem] py-1 transition-colors duration-150 ${
              !isProductStakeAvailable(product) || claimableAmount <= 0
                ? 'border-gray-600 text-gray-500 cursor-not-allowed'
                : isStaked()
                  ? 'border-green-500 text-green-300 hover:bg-green-600/10'
                  : 'border-red-500 text-red-300 hover:bg-red-600/10'
            }`}
            disabled={claimableAmount <= 0}
            onClick={() => handleClaimButton(device)}
          >
            Claim Reward
          </Button>
          <Button
            className={`min-w-[110px] bg-transparent text-[0.6rem] py-1 transition-colors duration-150 ${
              !isProductStakeAvailable(product)
                ? 'border-gray-500 text-gray-500 hover:bg-gray-600/20 cursor-not-allowed'
                : pendingAmount > 0
                  ? 'border-red-600 text-red-300 hover:bg-red-600/10 hover:text-red-200'
                  : isStaked()
                    ? 'border-green-500 text-green-300 cursor-not-allowed'
                    : 'border-gray-500 text-gray-500 cursor-not-allowed'
            }`}
            disabled={pendingAmount <= 0}
            onClick={() => handleBoostButton(device)}
          >
            Instant Claim (30% fee)
          </Button>
          <Button
            className={`min-w-[110px] bg-transparent text-[0.6rem] py-1 ${
              !isProductStakeAvailable(product)
                ? 'border-gray-500 hover:bg-gray-500 hover:border-gray-500'
                : isStaked()
                  ? 'border-green-500 hover:bg-green-500 hover:border-green-500'
                  : 'border-red-500 hover:bg-red-500 hover:border-red-500'
            }`}
            onClick={() => viewHistory()}
          >
            History
          </Button>
          {((device && product && isNodeProduct(product) && isRegistrationStaked(device)) || isNodeStaked(device)) && (
            <Button
              className={`min-w-[110px] bg-transparent text-[0.6rem] py-1 ${
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
        </div>
        {pendingAmount > 0 && (
          <div className="mt-2 text-[0.6rem] text-yellow-200/80">
            Pending rewards unlock after 30 days from accrual. Wait for the unlock to claim at 0% fee, or use Instant Claim (30% fee) if you need the funds early.
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span className="font-mono text-[0.7rem] text-gray-400">
            {truncateAddress(device.miner_key)}
          </span>
          {nextUnlockUTC && (
            <span className="ml-auto text-gray-400">
              Next unlock {countdown ? `• ${countdown}` : `• ${nextUnlockUTC}`}
            </span>
          )}
        </div>
        <div className="mt-4 rounded-lg border border-dashed border-gray-800/80 bg-black/40 px-3 py-2 text-xs text-gray-400">
          Click to open detailed actions and history.
        </div>
      </div>
      {expanded && isPortalReady &&
          createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 px-4 py-8 pt-20 backdrop-blur-sm"
            onClick={closeDetails}
          >
            <div
              className="relative mt-6 max-h-[82vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-gray-800 bg-black/95 p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={closeDetails}
                className="absolute right-5 top-5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-gray-300 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 hover:bg-red-600/30 hover:text-white"
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
    </>
  );
}
