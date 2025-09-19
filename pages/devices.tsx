import { useEffect, useMemo, useState } from 'react';
import {
  UserIcon,
  UserAddIcon,
  UserRemoveIcon
} from '@heroicons/react/outline';
import { useRouter } from 'next/router';
import { Button, Flex, Title } from '@tremor/react';
import { getSession, useSession } from 'next-auth/react';
import { SWRConfig } from 'swr';
import type { Summary } from '../lib/hooks/useRewardSummary';
import clientPromise from '../lib/mongoclient';
import { Device, FryConversion, Product } from '../lib/types';
import CopyAddress from '../components/CopyAddress';
import bgImg from '../assets/background.png';
import Image from 'next/image';
import Link from 'next/link';
import MessageUpdate from '../components/messageUpdate';
import { useModal } from '../app/modalcontext';
import AddDeviceModal from '../components/modals/AddDevice';
import StakeWithdrawModal from '../components/modals/Stake';
import DeviceListItem from '../components/DeviceListItem';
import StakeModal from '../components/modals/Stake';
import WithdrawModal from '../components/modals/Withdraw';
import BoostModal from '../components/modals/Boost';
import { mutate as swrMutate } from 'swr';
import ClaimModal from '../components/modals/Claim';
import DeleteModal from '../components/modals/Delete';
import { useToastContext } from '../hooks/ToastContext';
import WithdrawAllModal from '../components/modals/WithdrawAll';
import FryConversionModal from '../components/modals/FryConversion';
import Fry1CheckModal from '../components/modals/Fry1CheckModal';
import FloatingTotalsWidget from '../components/FloatingTotalsWidget';
// import WithdrawAlgoModal from '../components/modals/WithdrawAlgo';
import {
  isNodeStaked,
  isRegistartionStaked,
  getWalletAddress,
  algodClient,
  computeDeviceStatus,
  FRY_1,
  fNODE
} from '../lib/utils';

const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const minerType = {
  weather: ['HWM', 'LWM'],
  air: ['IHAQM', 'ILAQM', 'OMAQM', 'IMAQM', 'OHAQM'],
  water: ['OLWQM', 'OHWQM'],
  radiation: ['IRM'],
  hardware: ['ISM', 'OSM', 'BM', 'IDM', 'ODM'],
  camera: [
    'AOWSCM',
    'AOWCM',
    'AIWCM',
    'AOSCM',
    'AISCM',
    'AOTCM',
    'AITCM',
    'AIWSCM'
  ],
  energy: ['EM'],
  node: ['SDN', 'SVN', 'RDN', 'CN', 'AEM']
};

type MinerCategory = keyof typeof minerType;
type MinerType = (typeof minerType)[MinerCategory][number];

function getMinerCategory(miner_key: string): MinerCategory | null {
  const prefix = miner_key.split('-')[0];
  for (const key of Object.keys(minerType) as MinerCategory[]) {
    if (minerType[key].includes(prefix)) {
      return key;
    }
  }
  return null;
}

function StatsGrid({ devices, minerDevices, nodeDevices }: { devices: Device[]; minerDevices?: Device[]; nodeDevices?: Device[] }) {
  const miners = minerDevices ?? devices.filter(d => !['RDN','SVN','SDN'].includes(d.miner_key.split('-')[0]));
  const nodes = nodeDevices ?? devices.filter(d => ['RDN','SVN','SDN'].includes(d.miner_key.split('-')[0]));
  const countNotLinked = (arr: Device[]) => arr.filter(d => !d.registered_portal_model || d.registered_portal_model === '').length;

  const SummaryRow = ({ label, value, color }: { label: string; value: number; color: 'gray'|'red'|'green'|'yellow' }) => {
    const colorMap: Record<typeof color, string> = {
      gray: 'bg-gray-900/40 text-gray-300',
      red: 'bg-red-900/30 text-red-300',
      green: 'bg-green-900/30 text-green-300',
      yellow: 'bg-yellow-900/30 text-yellow-300'
    } as any;
    return (
      <div className={`flex flex-col items-center justify-center rounded-md p-2 ${colorMap[color]} text-xs`}>
        <div className="opacity-90">{label}</div>
        <div className="text-white text-sm">{value}</div>
      </div>
    );
  };

  const CategoryPanel = ({ title, items }: { title: string; items: Device[] }) => {
    if (!items || items.length === 0) return null;
    const total = items.length;
    const unverified = items.filter(d => !d.verified).length;
    const verified = items.filter(d => d.verified).length;
    const notLinked = countNotLinked(items);
    return (
      <div className="border border-gray-800 rounded-xl p-4 w-full">
        <div className="text-white text-sm font-semibold mb-2">{title}</div>
        <div className="grid grid-cols-4 gap-2">
          <SummaryRow label="Registered" value={total} color="gray" />
          <SummaryRow label="Unverified" value={unverified} color="red" />
          <SummaryRow label="Verified" value={verified} color="green" />
          <SummaryRow label="Not linked" value={notLinked} color="yellow" />
        </div>
      </div>
    );
  };

  const CombinedPanel = () => {
    // Renders on small screens only; shows one panel combining categories
    if ((miners?.length || 0) + (nodes?.length || 0) === 0) return null;
    const Sec = ({ title, items }: { title: string; items: Device[] }) => {
      if (!items || items.length === 0) return null;
      const total = items.length;
      const unverified = items.filter(d => !d.verified).length;
      const verified = items.filter(d => d.verified).length;
      const notLinked = countNotLinked(items);
      return (
        <div>
          <div className="text-white text-sm font-medium mb-2">{title}</div>
          <div className="grid grid-cols-2 gap-2">
            <SummaryRow label="Registered" value={total} color="gray" />
            <SummaryRow label="Unverified" value={unverified} color="red" />
            <SummaryRow label="Verified" value={verified} color="green" />
            <SummaryRow label="Not linked" value={notLinked} color="yellow" />
          </div>
        </div>
      );
    };
    return (
      <div className="border border-gray-800 rounded-xl p-4 w-full">
        <div className="space-y-4">
          <Sec title="Miners" items={miners} />
          <Sec title="Nodes" items={nodes} />
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop/tables: two panels side-by-side; hide if panel has no items */}
      <div className="hidden sm:grid grid-cols-1 md:grid-cols-2 gap-4 px-2 sm:px-20 mt-6">
        <CategoryPanel title="Miners" items={miners} />
        <CategoryPanel title="Nodes" items={nodes} />
      </div>
      {/* Mobile: single combined panel */}
      <div className="block sm:hidden px-2 mt-6">
        <CombinedPanel />
      </div>
    </>
  );
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

  return products.find((product) => product.key === miner_type);
}

const DevicesPage = ({
  initialDevices = [],
  products = [],
  rewardFallback = {},
  statusFallback = {},
  bannerTotals = {
    FRY1: { pending: 0, claimable: 0 },
    fNODE: { pending: 0, claimable: 0 },
    tFRY: { pending: 0, claimable: 0 }
  }
}: {
  initialDevices: Device[];
  products: Product[];
  rewardFallback?: Record<string, Summary>;
  statusFallback?: Record<string, { [key: string]: string } | undefined>;
  bannerTotals: {
    FRY1: { pending: number; claimable: number };
    fNODE: { pending: number; claimable: number };
    tFRY: { pending: number; claimable: number };
  };
}) => {
  const router = useRouter();
  const toast = useToastContext();
  const { openModal } = useModal();
  const { data: session } = useSession();


  // Enhanced sort: supports sortField and sortDirection
  const [sortField, setSortField] = useState<'nickname' | 'miner_key' | 'created_at'>('nickname');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

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

  // Keep devices sorted when sortField, sortDirection, or initialDevices change
  useEffect(() => {
    setDevices(sortDevices(initialDevices));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortField, sortDirection, initialDevices]);

  const [selectedDevice, setSelectedDevice] = useState<Device>(
    initialDevices[0]
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [addr, setAddr] = useState(session?.user.address);
  const [showFry1Check, setShowFry1Check] = useState(false);
  const [showFryConversion, setShowFryConversion] = useState(false);
  // Ribbon state
  const [countdown, setCountdown] = useState<string>("");
  const [totals, setTotals] = useState<{
    totals: {
      fry1: { pending: number; claimable: number; claimed: number; accruing: number };
      fnode: { pending: number; claimable: number; claimed: number; accruing: number };
      tfry: { pending: number; claimable: number; claimed: number; accruing: number };
    };
    nextUnlockAt?: string;
  } | null>(null);
  const fmt = (v?: number) => (v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleAdd = () => {
    openModal('addDevice');
  };

  const handleConversion = async () => {
    setShowFry1Check(true);
  };

  

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

  const handleRegister = async (minerKey: string): Promise<void> => {
    try {
      const response = await fetch(`/api/devices/${minerKey}`);
      if (!response.ok) {
        toast.error({ heading: 'Error', message: 'Device not found' });
        return;
      }

      const result = await response.json();
      if (result.device.is_registered) {
        toast.error({ heading: 'Error', message: 'Already registered' });
        return;
      }

      const prefix = getMinerCategory(minerKey);
      if (!prefix) {
        toast.error({
          heading: 'Error',
          message: `Invalid Miner Key! We couldn't validate that miner key. Please double-check it and try again.`
        });
        return;
      }

      if (result.device.registered_portal_model !== undefined) {
        router.push({
          pathname: `/${prefix}portal`,
          query: { minerKey, portalType: result.device.registered_portal_model }
        });
        return;
      }
      // router.push({ pathname: '/register', query: { minerKey } });
      router.push({ pathname: `/${prefix}portal`, query: { minerKey } });
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'There is an error occured for registering. Please contact us before you try again'
      });
      return;
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
      const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
      const secs = Math.floor((diff % (60 * 1000)) / 1000);
      setCountdown(`${days}d ${hours}h ${mins}m ${secs}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // Fetch totals for ribbon (only when signed in)
  useEffect(() => {
    let active = true;
    let id: any;
    const start = async () => {
      if (!session?.user?.address) {
        setTotals(null);
        return;
      }
      const fetchTotals = async () => {
        try {
          const res = await fetch('/api/rewards/get-asset-totals', { method: 'POST' });
          if (!res.ok) { if (active) setTotals(null); return; }
          const json = await res.json();
          if (active) setTotals(json);
        } catch { if (active) setTotals(null); }
      };
      await fetchTotals();
      id = setInterval(fetchTotals, 30000);
    };
    start();
    return () => { active = false; if (id) clearInterval(id); };
  }, [session?.user?.address]);

  // Estimated weekly earnings (per asset) from current week accrual pace
  const { estimatedFry1, estimatedFnode, estimatedTfry } = useMemo(() => {
    if (!totals?.totals) return { estimatedFry1: 0, estimatedFnode: 0, estimatedTfry: 0 };
    const accFry1 = totals.totals.fry1?.accruing || 0;
    const accFnode = totals.totals.fnode?.accruing || 0;
    const accTfry = totals.totals.tfry?.accruing || 0;
    const now = new Date();
    const day = now.getUTCDay();
    const thisFriday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const diffToFriday = (day + 7 - 5) % 7;
    thisFriday.setUTCDate(thisFriday.getUTCDate() - diffToFriday);
    const elapsed = Math.floor((now.getTime() - thisFriday.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const daysElapsed = Math.min(7, Math.max(1, elapsed));
    const est1 = Math.round(((accFry1 / daysElapsed) * 7) * 100) / 100;
    const estN = Math.round(((accFnode / daysElapsed) * 7) * 100) / 100;
    const estT = Math.round(((accTfry / daysElapsed) * 7) * 100) / 100;
    return { estimatedFry1: est1, estimatedFnode: estN, estimatedTfry: estT };
  }, [totals?.totals]);

  const handleSetting = async (minerKey: string): Promise<void> => {
    // Redirect to an edit page where the device details can be modified
    try {
      const response = await fetch(`/api/devices/${minerKey}`, {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({ address: session?.user.address })
      });
      if (!response.ok) {
        toast.error({
          heading: 'Error',
          message: `Device not found.`
        });
        return;
      }

      const result = await response.json();

      // if (!testMode) {
      //   const missingBalance = await checkAlgoBalance(
      //     result.device.connectivity_wallet
      //   );
      //   if (missingBalance !== null) {
      //     toast.warning({
      //       heading: 'Warning',
      //       message: `Too Low ALGO Balance for PoC Wallet. Please transfer ${missingBalance} ALGO into your PoC wallet to continue.`
      //     });
      //     return;
      //   }
      // }

      const prefix = getMinerCategory(minerKey);
      if (!prefix) {
        toast.error({
          heading: 'Error',
          message: `Invalid Miner Key! It doesn't exist the portal credential for miner key. Please double-check it and try again.`
        });
        return;
      }

      // Correct check for registered_portal_model existence in device object
      if (
        'registered_portal_model' in result.device &&
        result.device.registered_portal_model
      ) {
        router.push({
          pathname: `/${prefix}portal`,
          query: {
            minerKey,
            portalType: result.device.registered_portal_model,
            onlyPortal: true
          }
        });
        return;
      }

      router.push({
        pathname: `/${prefix}portal`,
        query: { minerKey, onlyPortal: true }
      });
    } catch (error) {
      toast.error({
        heading: 'Error',
        message: `Failed to fetch device information.`
      });
    }
  };

  const handleDeleteButton = (device: Device) => {
    setSelectedDevice(device);

    console.log('Verification: ' + device.verified);
    if (
      isRegistartionStaked(device) ||
      isNodeStaked(device) ||
      device.verified
    ) {
      toast.warning({
        heading: 'Warning',
        message:
          'After withdraw all you staked. You can un-register your device.'
      });
      return;
    }
    openModal('delete');
  };

  const handleDelete = async (miner_key: string): Promise<void> => {
    // Send a request to delete the device from the backend
    setDevices((prevDevices) =>
      prevDevices.filter((device) => device.miner_key !== miner_key)
    );
  };

  const handleWithdrawAll = async (device: Device): Promise<void> => {
    const updatedMiners = devices.map((value) => {
      if (value.miner_key !== device.miner_key) {
        return value;
      } else {
        let returnDevice = { ...value };
        if (returnDevice.registration) {
          returnDevice.registration = undefined;
        }

        if (returnDevice.node) {
          returnDevice.node = undefined;
        }

        return returnDevice;
      }
    }) as Device[];
    setDevices(updatedMiners);
  };

  const handleChange = async (miner_key: string): Promise<void> => {
    // Redirect to an edit page where the device details can be modified
    try {
      const response = await fetch(`/api/devices/${miner_key}`, {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({ address: session?.user.address })
      });
      if (!response.ok) {
        toast.error({
          heading: 'Error',
          message: `Device not found.`
        });
      }

      router.push({
        pathname: '/register',
        query: { minerKey: miner_key, clickable: 'true' }
      });
    } catch (error) {
      toast.error({
        heading: 'Error',
        message: `Failed to fetch device information.`
      });
    }
  };

  const handleStaking = async (miner_key: string): Promise<void> => {
    // Redirect to an edit page where the device details can be modified
    router.push({ pathname: '/pay-register', query: { minerKey: miner_key } });
  };

  // const handleAlgoWithdraw = async (device: Device): Promise<void> => {
  //   console.log('handleAlgoWithdraw');
  // }

  const handleWithdrawStake = (device: Device): void => {
    setSelectedDevice(device);

    if (!device.verified) {
      openModal('stake');
    } else {
      openModal('withdraw');
    }
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

  const handleBoost = async (ret: boolean, message: string): Promise<void> => {
    console.log('Boost function');

    const updateDevices = devices.map((element) => {
      if (element.miner_key !== selectedDevice.miner_key) {
        return element;
      } else {
        return {
          ...element
        };
      }
    }) as Device[];

    setDevices(updateDevices);
    // Revalidate only this device's summary
    if (selectedDevice?.miner_key) {
      swrMutate(`reward-summary:${selectedDevice.miner_key}`);
    }
  };

  const handleClaim = async (ret: boolean, message: string): Promise<void> => {
    const updateDevices = devices.map((element) => {
      if (element.miner_key !== selectedDevice.miner_key) {
        return element;
      } else {
        return {
          ...element
        };
      }
    }) as Device[];

    setDevices(updateDevices);
    if (selectedDevice?.miner_key) {
      const key = `reward-summary:${selectedDevice.miner_key}`;
      // Optimistic drop of claimable to 0, then revalidate
      swrMutate(
        key,
        (current: any) => ({ pending: current?.pending ?? 0, claimable: 0 }),
        { revalidate: true }
      );
    }
  };

  const handleStakingUpdate = (device: Device): void => {
    console.log('Staked device update');
    const updateDevices = devices.map((element) => {
      if (element.miner_key !== device.miner_key) {
        return element;
      } else {
        return {
          ...element,
          verified: true
        };
      }
    }) as Device[];

    setDevices(updateDevices);
  };

  const handleWithdrawUpdate = (device: Device): void => {
    console.log('Withdraw device update');
    const updateDevices = devices.map((element) => {
      if (element.miner_key !== device.miner_key) {
        return element;
      } else {
        return {
          ...element,
          verified: false
        };
      }
    }) as Device[];

    setDevices(updateDevices);
  };

  // const handleAlgoWithdrawButton = (device: Device): void => {
  //   setSelectedDevice(device);
  //   openModal('withdraw_algo');
  //   console.log('Selected Withdraw: ', device);
  // }

  function isNodeDevice(d: Device): boolean {
    const prefix = d.miner_key.split('-')[0];
    return ['RDN', 'SVN', 'SDN'].includes(prefix);
  }

  function isMinerDevice(d: Device): boolean {
    return !isNodeDevice(d);
  }

  const minerDevices = useMemo(() => devices.filter(isMinerDevice), [devices]);
  const nodeDevices = useMemo(() => devices.filter(isNodeDevice), [devices]);

  return (
    <SWRConfig value={{ fallback: rewardFallback }}>
    <div className="w-full">
      <div className="relative flex">
        <Image
          src={bgImg}
          className="w-full h-[18vh] sm:h-[22vh] object-cover"
          alt="Background Image"
          priority
        />
        <Flex
          flexDirection="col"
          className="absolute w-full h-full justify-center gap-6"
        >
          <Title className="text-white text-4xl sm:text-5xl w-full text-center font-extralight tracking-wide">
            Onboard your miners and nodes to Fry Networks
          </Title>
          <p className="text-lg text-center px-2 text-gray-300">
            Register and manage miners and nodes: verify details, link portals, and handle rewards.
          </p>
        </Flex>
      </div>
      {/* FloatingTotalsWidget - replaces old sticky ribbon */}
      {session?.user?.address && totals && (
        <FloatingTotalsWidget
          totals={totals}
          countdown={countdown}
          estimatedFry1={estimatedFry1}
          estimatedFnode={estimatedFnode}
          estimatedTfry={estimatedTfry}
        />
      )}
      <StatsGrid
        devices={devices}
        minerDevices={minerDevices}
        nodeDevices={nodeDevices}
      />

      <div className="w-full mt-10 px-2 sm:px-20">
        <Flex
          justifyContent="between"
          className="gap-3 w-full mt-10 flex-col sm:flex-row"
        >
          <Button
            className={`min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 w-full sm:w-auto ${
              isProcessing ? 'cursor-not-allowed' : 'cursor-default'
            }`}
            onClick={handleConversion}
          >
            {isProcessing ? (
              <svg
                className="animate-spin h-6 w-6 text-red-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <defs>
                  <linearGradient
                    id="redGradient"
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="0%"
                  >
                    <stop offset="0%" stopColor="#ff0000" />
                    <stop offset="50%" stopColor="#ff4d4d" />
                    <stop offset="100%" stopColor="#ff9999" />
                  </linearGradient>
                </defs>
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="url(#redGradient)"
                  strokeWidth="4"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              'FRY1.0 Conversion'
            )}
          </Button>
      <Flex className="gap-3 w-full flex-col sm:flex-row sm:justify-end">
            <Link href="/convert" className="w-full sm:w-auto">
              <Button className="min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 w-full">
                BYOD to Miner Key
              </Button>
            </Link>

            <Button
              className="min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 w-full sm:w-auto"
              onClick={handleAdd}
            >
              + Add
            </Button>
          </Flex>
      </Flex>
    </div>
    {/* Totals banner removed; now provided in top Navbar ribbon */}
    <Flex flexDirection="col" className="w-full px-2 sm:px-20 mt-5">
      {/* Sort controls */}
      <div className="flex flex-row items-center gap-4 mb-4">
        <label htmlFor="sortField" className="text-white">Sort by:</label>
        <select
          id="sortField"
          value={sortField}
          onChange={e => setSortField(e.target.value as 'nickname' | 'miner_key' | 'created_at')}
          className="rounded p-1 text-black"
        >
          <option value="nickname">Nickname</option>
          <option value="miner_key">Miner Key</option>
          <option value="created_at">Date of Registration</option>
        </select>
        <button
          onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
          className="rounded bg-gray-700 text-white px-2 py-1"
        >
          {sortDirection === 'asc' ? 'Ascendant ↑' : 'Descendant ↓'}
        </button>
      </div>
        {devices.length > 0 ? (
          devices.map((device, index) => {
            const product = findProductByMinerKey(device.miner_key, products);
            return (
              <DeviceListItem
                key={device.miner_key}
                initialDevice={device}
                product={product!}
                stakeable={isProductStakeAvailable(product!)}
                initialStatus={statusFallback[device.miner_key]}
                handleStaking={handleStaking}
                handleDeleteButton={handleDeleteButton}
                handleChange={handleChange}
                handleSetting={handleSetting}
                handleBoostButton={handleBoostButton}
                handleClaimButton={handleClaimButton}
                handleWithdrawStake={handleWithdrawStake}
                handleWithdrawAllButton={handleWithdrawAllButton}
                // handleAlgoWithdrawButton={handleAlgoWithdrawButton}
              />
            );
          })
        ) : (
          <Title className="text-gray-700">No devices onboarded</Title>
        )}
      </Flex>
      <AddDeviceModal modalName="addDevice" handleRegister={handleRegister} />
      <Fry1CheckModal
        modalName="fry1Check"
        isOpen={showFry1Check}
        onClose={() => setShowFry1Check(false)}
        onStartConversion={() => {
          setShowFry1Check(false);
          setShowFryConversion(true);
          openModal('fryConversion');
        }}
      />
      {showFryConversion && (
        <FryConversionModal
          modalName="fryConversion"
          address={addr}
          onClose={() => setShowFryConversion(false)}
        />
      )}
      {selectedDevice && (
        <>
          <StakeModal
            modalName={'stake'}
            device={selectedDevice}
            product={findProductByMinerKey(selectedDevice.miner_key, products)!}
            handleStakingUpdate={handleStakingUpdate}
          />
          <WithdrawModal
            modalName={'withdraw'}
            device={selectedDevice}
            product={findProductByMinerKey(selectedDevice.miner_key, products)!}
            handleWithdrawUpdate={handleWithdrawUpdate}
          />
          <BoostModal
            modalName="boost"
            miner_key={selectedDevice.miner_key}
            handleBoost={handleBoost}
          />
          <ClaimModal
            modalName="claim"
            miner_key={selectedDevice.miner_key}
            handleClaim={handleClaim}
          />
          <DeleteModal
            modalName="delete"
            miner_key={selectedDevice.miner_key}
            handleDelete={handleDelete}
          />
          <WithdrawAllModal
            modalName="withdraw_all"
            device={selectedDevice}
            product={findProductByMinerKey(selectedDevice.miner_key, products)!}
            handleWithdrawAll={handleWithdrawAll}
          />

          {/* <WithdrawAlgoModal
            modalName="withdraw_algo"
            device={selectedDevice}
            handleAlgoWithdraw={handleAlgoWithdraw}
          /> */}
        </>
      )}
    </div>
    </SWRConfig>
  );
};

export async function getServerSideProps(context: any) {
  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';
  const session = await getSession(context);

  if (!session || !session.user.address) {
    return {
      props: {}
    };
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    // Initialize variables at function scope
    let rewardFallback: Record<string, Summary> = {};
    let statusFallback: Record<string, any> = {};
    let bannerTotals = {
      FRY1: { pending: 0, claimable: 0 },
      fNODE: { pending: 0, claimable: 0 },
      tFRY: { pending: 0, claimable: 0 }
    };

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

    const devices = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .find({ address: session.user.address, is_registered: true }, { projection: { address: 1, byod: 1, is_registered: 1, miner_key: 1, name: 1, nickname: 1, position: 1, reward_wallet: 1, staked: 1, stake_type: 1, verified: 1, hexId: 1, created_at: 1, email: 1, registered_portal_model: 1 } })
      .toArray();

    const products = await db.collection('products').find({}).toArray();

    // Server-side reward summary prefetch for all devices
    const minerKeys: string[] = devices?.map((d: any) => d.miner_key) || [];
    if (minerKeys.length > 0) {
      const rewardsCol = db.collection(testMode ? 'test-rewards' : 'rewards');
      const pipeline = [
        {
          $match: {
            miner_key: { $in: minerKeys },
            status: { $in: ['pending', 'claimable'] }
          }
        },
        {
          $group: {
            _id: { miner_key: '$miner_key', status: '$status', asset_id: '$asset_id' },
            total: { $sum: { $toDouble: '$amount' } }
          }
        }
      ];
      const grouped = await rewardsCol.aggregate(pipeline).toArray();

      // initialize
      rewardFallback = minerKeys.reduce((acc, key) => {
        acc[`reward-summary:${key}`] = { pending: 0, claimable: 0 };
        return acc;
      }, {} as Record<string, Summary>);

      for (const row of grouped as any[]) {
        const mk = row._id.miner_key as string;
        const status = row._id.status as 'pending' | 'claimable';
        const total = Math.round((row.total || 0) * 100) / 100;
        const k = `reward-summary:${mk}`;
        if (!rewardFallback[k]) rewardFallback[k] = { pending: 0, claimable: 0 };
        rewardFallback[k][status] = total;
      }

      // Build statusFallback (SSR device status) and bannerTotals by asset
      for (const d of devices as any[]) {
        const product = products.find((p: any) => p.key === d.miner_key.split('-')[0]);
        const status = computeDeviceStatus(
          {
            address: d.address,
            byod: d.byod,
            created_at: d.created_at,
            email: d.email,
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
            _id: d._id,
            __v: d.__v
          } as any,
          product as any
        );
        if (status) {
          statusFallback[d.miner_key] = status;
        }
      }

      // Banner totals per asset_id across all devices
      const assetTotals: Record<string, { pending: number; claimable: number }> = {};
      for (const row of grouped as any[]) {
        const asset = String(row._id.asset_id);
        const status = row._id.status as 'pending' | 'claimable';
        const total = Math.round((row.total || 0) * 100) / 100;
        if (!assetTotals[asset]) assetTotals[asset] = { pending: 0, claimable: 0 };
        assetTotals[asset][status] += total;
      }

      bannerTotals = {
        FRY1: assetTotals[FRY_1.id] || { pending: 0, claimable: 0 },
        fNODE: assetTotals[fNODE.id] || { pending: 0, claimable: 0 },
        tFRY: { pending: 0, claimable: 0 } // Placeholder until tFry is live
      };

      // Return early with computed fallbacks
      return {
        props: {
          initialDevices: JSON.parse(
            JSON.stringify(
              devices.map((device) => ({
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
                hexId: device.hexId,
                created_at: device.created_at,
                email: device.email,
                registered_portal_model: device.registered_portal_model
              }))
            )
          ),
          products: JSON.parse(
            JSON.stringify(
              products.map((product) => ({
                name: product.name,
                key: product.key,
                reward: product.reward
              }))
            )
          ),
          rewardFallback,
          statusFallback,
          bannerTotals
        }
      };
    }

    if (!devices && !products) {
      return {
        props: {
          devices: [],
          products: [],
          rewardFallback: {},
          statusFallback: {},
          bannerTotals: { FRY1: { pending: 0, claimable: 0 }, fNODE: { pending: 0, claimable: 0 }, tFRY: { pending: 0, claimable: 0 } }
        }
      };
    } else if (!devices && products) {
      return {
        props: {
          initialDevices: [],
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
          ),
          rewardFallback: {},
          statusFallback: {},
          bannerTotals: { FRY1: { pending: 0, claimable: 0 }, fNODE: { pending: 0, claimable: 0 }, tFRY: { pending: 0, claimable: 0 } }
        }
      };
    } else if (devices && !products) {
      return {
        props: {
          initialDevices: JSON.parse(
            JSON.stringify(
              devices.map((device) => {
                return {
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
                  hexId: device.hexId,
                  created_at: device.created_at,
                  email: device.email,
                  registered_portal_model: device.registered_portal_model
                };
              })
            )
          ),
          products: [],
          rewardFallback,
          statusFallback,
          bannerTotals
        }
      };
    } else {
      return {
        props: {
          initialDevices: JSON.parse(
            JSON.stringify(
              devices.map((device) => {
                return {
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
                  hexId: device.hexId,
                  created_at: device.created_at,
                  email: device.email,
                  registered_portal_model: device.registered_portal_model
                };
              })
            )
          ),
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
          ),
          rewardFallback,
          statusFallback,
          bannerTotals
        }
      };
    }
  } catch (e) {
    console.error(e);
    return {
      props: {}
    };
  }
}

export default DevicesPage;
