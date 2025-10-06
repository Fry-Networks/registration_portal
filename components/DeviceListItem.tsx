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
  isNodeStakingNeeded
} from '../lib/utils';
import { describeMacIssue } from '../lib/validators/macAddressValidator';
import { InformationCircleIcon } from '@heroicons/react/outline';
import AlertWithTooltip from './AlertIcon';
// import WithdrawIcon from './WithdrawIcon';
import StakingIcon from './StakeIcon';
import EditIcon from './EditIcon';
import SettingIcon from './SettingIcon';
import { useSession } from 'next-auth/react';
import Tooltip from './Tooltip';
import { useRewardSummary } from '../lib/hooks/useRewardSummary';

type TokenConfig = {
  stake?: string;
  reward?: string;
  register?: string;
  node?: string;
};

export default function DeviceListItem({
  initialDevice,
  product,
  stakeable,
  handleDeleteButton,
  handleStaking,
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
  handleStaking: (miner_key: string) => Promise<void>;
  handleChange: (miner_key: string) => Promise<void>;
  handleSetting: (miner_key: string) => Promise<void>;
  handleBoostButton: (device: Device) => Promise<void>;
  handleClaimButton: (device: Device) => void;
  handleWithdrawStake: (device: Device) => void;
  handleWithdrawAllButton: (device: Device) => void;
  initialStatus?: { [key: string]: string } | undefined;
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
  const [alertShow, setAlertShow] = useState(!!initialStatus);
  const [deviceStatus, setDeviceStatus] = useState<{ [key: string]: string }>(
    (initialStatus as any) || {}
  );
  const [device, setDevice] = useState<Device>(initialDevice);
  const { data: session } = useSession();
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
  const needsHardwareCheck = ['AEM', 'CN', 'RDN', 'SDN', 'SVN', 'BM', 'ISM', 'OSM', 'IDM', 'ODM'].includes(minerPrefix);
  const hardwareWarning = needsHardwareCheck && hardwareStatus ? (!hardwareStatus.linked || !hardwareStatus.valid) : false;

  const summaryBadges: Array<{ label: string; className: string }> = [];
  if (!device.registered_portal_model) {
    summaryBadges.push({
      label: 'Portal link needed',
      className: 'bg-yellow-500/20 text-yellow-200 border border-yellow-400/40'
    });
  }
  if (hardwareWarning) {
    summaryBadges.push({
      label: 'MAC attention required',
      className: 'bg-yellow-500/20 text-yellow-200 border border-yellow-400/40'
    });
  }
  summaryBadges.push(
    device.verified
      ? { label: 'Verified', className: 'bg-green-500/20 text-green-200 border border-green-400/40' }
      : { label: 'Unverified', className: 'bg-red-500/20 text-red-200 border border-red-400/40' }
  );

  // Determine verification prerequisites based on product config and current device state
  const needsRegistration = isRegistrationNeeded(product);
  const needsNodeStake = isNodeProduct(product) && isNodeStakingNeeded(product);
  const hasRegistration = isRegistrationStaked(device);
  const hasNode = isNodeStaked(device);
  const verificationBlocked = (needsRegistration && !hasRegistration) || (needsNodeStake && !hasNode);
  const portalMissing = !device.registered_portal_model;
  const stakingPrereqsMissing = verificationBlocked;
  const shouldShowRed = stakingPrereqsMissing || portalMissing || hardwareWarning;
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

  // Normalise product token configuration so downstream tooltip helpers may look up defaults safely.
  const productTokens = useMemo<TokenConfig>(() => product?.reward?.tokens ?? {}, [product]);

  const formatDateTime = (value?: string | Date) => {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  };

  const formatAmount = (amount?: number) =>
    typeof amount === 'number' ? amount.toLocaleString() : '—';

  const formatAssetId = useCallback(
    (assetId?: string, fallbackKey?: keyof typeof productTokens) => {
      if (assetId) return assetId;
      if (fallbackKey && typeof productTokens[fallbackKey] === 'string') {
        return productTokens[fallbackKey] as string;
      }
      return 'n/a';
    },
    [productTokens]
  );

  const formatTx = (txId?: string) => (txId ? `${txId.slice(0, 6)}…${txId.slice(-6)}` : '—');

  const formatTokenAmount = (value: number) =>
    Number.isFinite(value)
      ? value.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      : '0.00';

  const truncateAddress = (value?: string) => {
    if (!value) return '—';
    return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
  };

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
      const needsHardwareCheck = ['AEM', 'CN', 'RDN', 'SDN', 'SVN', 'BM', 'ISM', 'OSM', 'IDM', 'ODM'].includes(prefix);

      if (needsHardwareCheck && currentHardwareStatus) {
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

    entries.push({
      key: 'registered',
      label: 'Registered on',
      date: formatDateTime(device?.created_at),
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

    if (device?.staked?.time) {
      const verificationDisplay = `${formatDateTime(device.staked.time)}${
        verificationCountdown ? ` • ${verificationCountdown}` : ''
      }`;

      entries.push({
        key: 'verification',
        label: 'Verification staked on',
        date: verificationDisplay,
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
              <span className="font-medium">{verificationCountdown || <span className="text-gray-300">Unlock available</span>}</span>
            </div>
            <div className="border-t border-gray-700 pt-1.5 text-[0.65rem] text-gray-400 italic">
              Keeping staked after unlock maintains multiplier rewards. Withdrawing reduces to base rate.
            </div>
          </div>
        )
      });
    }

    if (device?.registration?.time) {
      entries.push({
        key: 'registration',
        label: 'Registration staked on',
        date: formatDateTime(device.registration.time),
        color: 'border-purple-500/60 bg-purple-500/10',
        tooltip: (
          <div className="min-w-[250px] space-y-2">
            <div className="border-b border-purple-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-purple-300">
              Registration Stake
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <span className="text-gray-400">Amount:</span>
              <span className="font-semibold text-purple-300">{formatAmount(device.registration.amount)}</span>

              <span className="text-gray-400">Asset ID:</span>
              <span className="font-mono text-[0.65rem]">{formatAssetId(device.registration.asset_id, 'register')}</span>

              <span className="text-gray-400">Transaction:</span>
              <span className="font-mono text-[0.65rem]">{formatTx(device.registration.txId)}</span>
            </div>
          </div>
        )
      });
    }

    if (isNodeProduct(product) && device?.node?.time) {
      entries.push({
        key: 'node',
        label: 'Node operation staked on',
        date: formatDateTime(device.node.time),
        color: 'border-orange-500/60 bg-orange-500/10',
        tooltip: (
          <div className="min-w-[250px] space-y-2">
            <div className="border-b border-orange-500/30 pb-1 text-xs font-semibold uppercase tracking-wide text-orange-300">
              Node Operation Stake
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <span className="text-gray-400">Amount:</span>
              <span className="font-semibold text-orange-300">{formatAmount(device.node.amount)}</span>

              <span className="text-gray-400">Asset ID:</span>
              <span className="font-mono text-[0.65rem]">{formatAssetId(device.node.asset_id, 'node')}</span>

              <span className="text-gray-400">Transaction:</span>
              <span className="font-mono text-[0.65rem]">{formatTx(device.node.txId)}</span>
            </div>
          </div>
        )
      });
    }

    return entries;
  }, [device, product, verificationCountdown, formatAssetId]);

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
        accent: 'text-green-300'
      },
      {
        key: 'pending',
        label: 'Pending',
        value: formatTokenAmount(pendingAmount),
        accent: 'text-amber-300'
      },
      {
        key: 'accruing',
        label: 'Weekly preview',
        value: formatTokenAmount(rewardSummary?.accruing ?? 0),
        accent: 'text-sky-300'
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

  const detailContent = (
    <div className="space-y-6 text-sm text-gray-100">
      {!device.registered_portal_model && (
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
                className={`rounded-full px-3 py-1 text-xs font-semibold ${badge.className}`}
              >
                {badge.label}
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
        <div className="flex items-center gap-3 md:gap-4 self-end md:self-auto pr-12">
          {alertShow && (
            <div>
              <AlertWithTooltip deviceStatus={deviceStatus} />
            </div>
          )}
          {device && product && isNodeProduct(product) && (
            <div
              onClick={(event) => {
                event.stopPropagation();
                handleStaking(device.miner_key);
              }}
            >
              <Tooltip text="Staking">
                <StakingIcon />
              </Tooltip>
            </div>
          )}
          <div
            onClick={(event) => {
              event.stopPropagation();
              handleChange(device.miner_key);
            }}
          >
            <Tooltip text="Edit device">
              <EditIcon />
            </Tooltip>
          </div>
          <div
            onClick={(event) => {
              event.stopPropagation();
              handleSetting(device.miner_key);
            }}
          >
            <Tooltip text="Portal settings">
              <SettingIcon />
            </Tooltip>
          </div>
          <div
            onClick={(event) => {
              event.stopPropagation();
              handleDeleteButton(device);
            }}
          >
            <Tooltip text="Unregister">
              <DeleteIcon />
            </Tooltip>
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-800 bg-black/70 p-4 space-y-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Wallets & contact</div>
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
        </div>
        <div className="rounded-xl border border-gray-800 bg-black/70 p-4 space-y-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Status</div>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-400">Verification</span>
              <span className="font-semibold text-gray-100">{device.verified ? 'Verified' : 'Pending'}</span>
            </div>
            {verificationReason && (
              <div className="text-xs text-amber-300">{verificationReason}</div>
            )}
            {hardwareStatus?.miner_mac && (
              <div>
                <div className="text-gray-400">Hardware MAC</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-gray-200 break-all">
                  <span>{hardwareStatus.miner_mac}</span>
                  <CopyAddress address={hardwareStatus.miner_mac} />
                </div>
              </div>
            )}
            {Object.keys(deviceStatus).length > 0 && (
              <div className="space-y-2">
                {Object.entries(deviceStatus).map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200"
                  >
                    {value}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
              <div className="text-gray-400">Weekly preview</div>
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
          {(isProductStakeAvailable(product) || device.verified) && (
            <Button
              className={`min-w-[150px] bg-transparent ${
                isStaked()
                  ? 'border-green-500 hover:bg-green-500 hover:border-green-500'
                  : verificationBlocked
                    ? 'border-gray-500 text-gray-500 cursor-not-allowed'
                    : 'border-red-500 hover:bg-red-500 hover:border-red-500'
              }`}
              disabled={!isStaked() && verificationBlocked}
              onClick={() => {
                if (!isStaked() && verificationBlocked) return;
                handleWithdrawStake(device);
              }}
              title={verificationReason}
            >
              {isStaked() ? 'V-Withdraw' : 'V-Stake'}
            </Button>
          )}
          {verificationBlocked && (
            <Button
              className="min-w-[150px] bg-transparent border-red-500 hover:bg-red-500 hover:border-red-500"
              onClick={() => handleStaking(device.miner_key)}
            >
              Stake
            </Button>
          )}
          <Button
            className={`min-w-[150px] bg-transparent transition-colors duration-150 ${
              !isProductStakeAvailable(product)
                ? 'border-gray-500 text-gray-500 hover:bg-gray-600/20'
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
                : pendingAmount > 0
                  ? 'border-red-600 text-red-300 hover:bg-red-600/10 hover:text-red-200'
                  : isStaked()
                    ? 'border-green-500 text-green-300 cursor-not-allowed'
                    : 'border-gray-500 text-gray-500 cursor-not-allowed'
            }`}
            disabled={pendingAmount <= 0}
            onClick={() => handleBoostButton(device)}
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
        role="button"
        tabIndex={0}
        onClick={openDetails}
        onKeyDown={handleCardKeyDown}
        className={`group relative w-full cursor-pointer select-none rounded-xl border bg-black/60 px-4 py-5 text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${borderClass} ${hoverRingClass}`}
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
                  className={`rounded-full bg-black/50 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide ${badge.className}`}
                >
                  {badge.label}
                </span>
              ))}
            </div>
          </div>
          {alertShow && (
            <div className="shrink-0">
              <AlertWithTooltip deviceStatus={deviceStatus} />
            </div>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {summaryMetrics.map((metric) => (
            <div
              key={metric.key}
              className="rounded-lg border border-gray-800/80 bg-black/60 px-3 py-2"
            >
              <div className="text-[0.65rem] uppercase tracking-widest text-gray-500">
                {metric.label}
              </div>
              <div className={`mt-1 text-sm font-semibold tabular-nums ${metric.accent}`}>
                {metric.value}
              </div>
            </div>
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
          {(isProductStakeAvailable(product) || device.verified) && (
            <Button
              className={`min-w-[110px] bg-transparent text-[0.6rem] py-1 ${
                isStaked()
                  ? 'border-green-500 hover:bg-green-500 hover:border-green-500'
                  : verificationBlocked
                    ? 'border-gray-500 text-gray-500 cursor-not-allowed'
                    : 'border-red-500 hover:bg-red-500 hover:border-red-500'
              }`}
              disabled={!isStaked() && verificationBlocked}
              onClick={() => {
                if (!isStaked() && verificationBlocked) return;
                handleWithdrawStake(device);
              }}
              title={verificationReason}
            >
              {isStaked() ? 'Verification Withdraw' : 'Verification Stake'}
            </Button>
          )}
          {verificationBlocked && (
            <Button
              className="min-w-[110px] bg-transparent text-[0.6rem] py-1 border-red-500 hover:bg-red-500 hover:border-red-500"
              onClick={() => handleStaking(device.miner_key)}
            >
              Stake
            </Button>
          )}
          <Button
            className={`min-w-[110px] bg-transparent text-[0.6rem] py-1 transition-colors duration-150 ${
              !isProductStakeAvailable(product)
                ? 'border-gray-500 text-gray-500 hover:bg-gray-600/20'
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
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm"
            onClick={closeDetails}
          >
            <div
              className="relative max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-gray-800 bg-black/95 p-6 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={closeDetails}
                className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-700 text-gray-400 transition-colors hover:border-red-500 hover:text-red-400"
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
