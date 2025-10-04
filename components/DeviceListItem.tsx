import { Button, Flex, Title } from '@tremor/react';
import { Device, Product } from '../lib/types';
import CopyAddress from './CopyAddress';
import DeleteIcon from './DeleteIcon';
import { useEffect, useMemo, useState, ReactNode } from 'react';
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
  initialStatus
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

  const isDeviceStatusOkay = (device: Device) => {
    return device.verified && device.verified === true && alertShow === false;
  };

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

  // Determine verification prerequisites based on product config and current device state
  const needsRegistration = isRegistrationNeeded(product);
  const needsNodeStake = isNodeProduct(product) && isNodeStakingNeeded(product);
  const hasRegistration = isRegistrationStaked(device);
  const hasNode = isNodeStaked(device);
  const verificationBlocked = (needsRegistration && !hasRegistration) || (needsNodeStake && !hasNode);
  const verificationReason = verificationBlocked
    ? `Complete ${
        needsRegistration && !hasRegistration && needsNodeStake && !hasNode
          ? 'registration and node operation staking'
          : needsRegistration && !hasRegistration
            ? 'registration staking'
            : 'node operation staking'
      } before verification`
    : undefined;

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

  const formatAssetId = (
    assetId?: string,
    fallbackKey?: keyof typeof productTokens
  ) => {
    if (assetId) return assetId;
    if (fallbackKey && typeof productTokens[fallbackKey] === 'string') {
      return productTokens[fallbackKey] as string;
    }
    return 'n/a';
  };

  const formatTx = (txId?: string) => (txId ? `${txId.slice(0, 6)}…${txId.slice(-6)}` : '—');

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

  const fetchDeviceInfo = async (minerKey: string) => {
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
  };

  const checkDeviceStatus = (device: Device) => {
    const status = computeDeviceStatus(device, product);

    if (status === undefined) {
      setAlertShow(false);
      setDeviceStatus({});
      return;
    }

    setDeviceStatus(status);
    setAlertShow(true);
  };

  useEffect(() => {
    console.log('Device Fetch: ' + initialDevice.miner_key);
    fetchDeviceInfo(initialDevice.miner_key);
  }, [initialDevice, product]);

  useEffect(() => {
    if (rewardSummary) {
      setPendingAmount(rewardSummary.pending || 0);
      setClaimableAmount(rewardSummary.claimable || 0);
      setClaimedAmount(rewardSummary.claimed || 0);
    }
    checkDeviceStatus(device);
  }, [device, rewardSummary]);

  // Simple countdown to next unlock (Friday 00:05 UTC) if provided by API
  useEffect(() => {
    if (!rewardSummary?.nextUnlockAt) {
      setCountdown("");
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

  const timelineEntries = useMemo(() => {
    const entries: Array<{ key: string; label: string; date: string; tooltip?: ReactNode; color: string }> = [];

    entries.push({
      key: 'registered',
      label: 'Registered on',
      date: formatDateTime(device?.created_at),
      color: 'border-blue-500/60 bg-blue-500/10',
      tooltip: (
        <div className="space-y-2 min-w-[250px]">
          <div className="text-xs font-semibold text-blue-300 uppercase tracking-wide border-b border-blue-500/30 pb-1">
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
          <div className="space-y-2 min-w-[280px]">
            <div className="text-xs font-semibold text-green-300 uppercase tracking-wide border-b border-green-500/30 pb-1">
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
                {verificationCountdown || (
                  <span className="text-gray-300">Unlock available</span>
                )}
              </span>
            </div>
            <div className="text-[0.65rem] text-gray-400 italic border-t border-gray-700 pt-1.5">
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
          <div className="space-y-2 min-w-[250px]">
            <div className="text-xs font-semibold text-purple-300 uppercase tracking-wide border-b border-purple-500/30 pb-1">
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
          <div className="space-y-2 min-w-[250px]">
            <div className="text-xs font-semibold text-orange-300 uppercase tracking-wide border-b border-orange-500/30 pb-1">
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
  }, [device, productTokens, verificationCountdown]);

  const viewHistory = async (): Promise<void> => {
    router.push({
      pathname: '/history',
      query: { miner_key: device.miner_key }
    });
  };

  return (
    <>
      {
        <div
          className={`relative w-full border-2 m-1 rounded-lg p-4 text-white shadow-lg ${
            stakeable === false && !device.verified
              ? 'border-gray-500'
              : !device.registered_portal_model
                ? 'border-yellow-400'
                : isDeviceStatusOkay(device)
                  ? 'border-green-500'
                  : 'border-red-500'
          }`}
        >
          {!device.registered_portal_model && (
            <div className="mb-2 p-2 rounded bg-yellow-100 text-yellow-800 text-sm">
              This device is not linked to FryNetworks. Click the <b>gear icon</b> to link it.
            </div>
          )}
          <div className="w-full flex flex-row justify-between">
            <div className="flex gap-2">
              <Title className="text-white font-bold text-xl sm:text-2xl mb-2">
                {`${device.nickname ? device.nickname : device.name} ${device.byod ? '(BYOD)' : ''}`}
              </Title>
              {alertShow && (
                <div className="">
                  <AlertWithTooltip deviceStatus={deviceStatus} />
                </div>
              )}
            </div>
            <Flex flexDirection="row" className="gap-3 sm:gap-5 w-auto">
              {device && product && isNodeProduct(product) && (
                <div onClick={() => handleStaking(device.miner_key)}>
                  <Tooltip text="Staking">
                    <StakingIcon />
                  </Tooltip>
                </div>
              )}
              <div onClick={() => handleChange(device.miner_key)}>
                <Tooltip text="Edit">
                  <SettingIcon />
                </Tooltip>
              </div>
              <div onClick={() => handleDeleteButton(device)}>
                <Tooltip text="Unregister">
                  <DeleteIcon />
                </Tooltip>
              </div>
            </Flex>
          </div>
          <hr className="border-gray-800 mt-2"></hr>
          <Flex flexDirection="row" className="mt-4">
            {device.address && device.address.length > 0 ? (
              <>
                <p className="hidden md:block text-white">
                  <strong className="text-white">Address: </strong>
                  {device.address}
                </p>
                <p className="block md:hidden text-white">
                  <strong className="text-white">Address: </strong>
                  {device.address.slice(0, 6)}...
                  {device.address.slice(
                    device.address.length - 6,
                    device.address.length
                  )}
                </p>
                <CopyAddress address={device.address} />
              </>
            ) : (
              <p>Address: None</p>
            )}
          </Flex>
          <p className="text-white">
            <strong className="text-white">Miner Key: </strong>
            {device.miner_key && device.miner_key.length > 0
              ? device.miner_key
              : 'None'}
          </p>
          <p>
            <strong className="text-white">Position: </strong>
            {device.position
              ? `Latitude (${device.position.lat}), Longitude (${device.position.lng})`
              : 'None'}
          </p>
          <Flex flexDirection="row">
            {device.reward_wallet && device.reward_wallet.length > 0 ? (
              <>
                <p className="hidden md:block">
                  <strong className="text-white">Reward Wallet: </strong>
                  {device.reward_wallet}
                </p>
                <p className="block md:hidden">
                  <strong className="text-white">Reward Wallet: </strong>
                  {device.reward_wallet.slice(0, 6)}...
                  {device.reward_wallet.slice(
                    device.reward_wallet.length - 6,
                    device.reward_wallet.length
                  )}
                </p>
                <CopyAddress address={device.reward_wallet} />
              </>
            ) : (
              <p>
                <strong className="text-white">Reward Wallet: </strong> None
              </p>
            )}
          </Flex>

          {timelineEntries.length > 0 && (
            <div className="mt-4 rounded-lg border border-gray-800/70 bg-gray-900/40 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-400">
                Registration/Staking timeline
              </p>
              <div className="mt-2 space-y-3">
                {timelineEntries.map((entry) => (
                  <div key={entry.key} className="border-b border-gray-800 pb-3 last:border-0 last:pb-0">
                    <div className="mb-1 flex items-center justify-between text-sm text-gray-300">
                      <span>{entry.label}</span>
                      {entry.tooltip && (
                        <Tooltip
                          text={entry.tooltip}
                          side="left"
                          className="max-w-sm"
                        >
                          <InformationCircleIcon className="h-4 w-4 text-gray-500 hover:text-gray-300" />
                        </Tooltip>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-white">{entry.date}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PoC Wallet removed from UI */}
          <p>
            <strong className="text-white">Pending Reward Amount: </strong>
            {pendingAmount}
          </p>
          <p>
            <strong className="text-white">Claimable Reward Amount: </strong>
            {claimableAmount}
          </p>
          <p>
            <strong className="text-white">Claimed Reward Amount: </strong>
            {claimedAmount}
          </p>
          {rewardSummary && (
            <div className="mt-2 p-2 rounded bg-gray-800 text-gray-200">
              <p>
                <strong>This Week&apos;s Accrual (preview): </strong>
                {rewardSummary.accruing ?? 0}
              </p>
              {rewardSummary.nextUnlockAt && (
                <p>
                  <strong>Unlocks (UTC): </strong>
                  {new Date(rewardSummary.nextUnlockAt).toUTCString()} {countdown && `• ${countdown}`}
                </p>
              )}
            </div>
          )}
          <Flex
            justifyContent="start"
            className="gap-3 mt-3 flex-wrap sm:flex-nowrap"
          >
            <>
              {(isProductStakeAvailable(product) || device.verified) && (
                <Button
                  className={`w-full sm:w-auto bg-transparent ${
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
              {/* If verification prerequisites are missing, surface a direct Stake button to guide users */}
              {verificationBlocked && (
                <Button
                  className={`w-full sm:w-auto bg-transparent border-red-500 hover:bg-red-500 hover:border-red-500`}
                  onClick={() => handleStaking(device.miner_key)}
                >
                  Stake
                </Button>
              )}
              <Button
                className={`w-full sm:w-auto bg-transparent transition-colors duration-150 ${!isProductStakeAvailable(product) ? 'border-gray-500 text-gray-500 hover:bg-gray-600/20' : isStaked() ? 'border-green-500 text-green-300 hover:bg-green-600/10' : 'border-red-500 text-red-300 hover:bg-red-600/10'}`}
                disabled={claimableAmount <= 0}
                onClick={() => handleClaimButton(device)}
              >
                Claim Reward
              </Button>
              <Button
                className={`w-full sm:w-auto bg-transparent transition-colors duration-150 ${!isProductStakeAvailable(product) ? 'border-gray-500 text-gray-500 hover:bg-gray-600/20 cursor-not-allowed' : pendingAmount > 0 ? 'border-red-600 text-red-300 hover:bg-red-600/10 hover:text-red-200' : isStaked() ? 'border-green-500 text-green-300 cursor-not-allowed' : 'border-gray-500 text-gray-500 cursor-not-allowed'}`}
                disabled={pendingAmount <= 0}
                onClick={() => handleBoostButton(device)}
              >
                Instant Claim (30% Fee)
              </Button>
              <Button
                className={`w-full sm:w-auto bg-transparent ${!isProductStakeAvailable(product) ? 'border-gray-500 hover:bg-gray-500 hover:border-gray-500' : isStaked() ? 'border-green-500 hover:bg-green-500 hover:border-green-500' : 'border-red-500 hover:bg-red-500 hover:border-red-500'}`}
                onClick={() => viewHistory()}
              >
                Reward History
              </Button>
              {((device &&
                product &&
                isNodeProduct(product) &&
                isRegistrationStaked(device)) ||
                isNodeStaked(device)) && (
                <Button
                  className={`w-full sm:w-auto bg-transparent ${!isProductStakeAvailable(product) ? 'border-gray-500 hover:bg-gray-500 hover:border-gray-500' : isStaked() ? 'border-green-500 hover:bg-green-500 hover:border-green-500' : 'border-red-500 hover:bg-red-500 hover:border-red-500'}`}
                  onClick={() => handleWithdrawAllButton(device)}
                >
                  Unstake
                </Button>
              )}
            </>
          </Flex>
        </div>
      }
    </>
  );
}
