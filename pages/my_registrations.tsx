import { Title, Text, Button, Card, TextInput, Flex, MultiSelect, MultiSelectItem } from '@tremor/react';
import { useWallet } from '@txnlab/use-wallet-react';
import { useSession } from 'next-auth/react';
import { getServerSession } from 'next-auth';
import { authOptions } from './api/auth/[...nextauth]';
import { useEffect, useRef, useState } from 'react';
import clientPromise from '../lib/mongoclient';
import { CheckCircleIcon, XCircleIcon, ExternalLinkIcon } from '@heroicons/react/outline';
import UpdateRewardModal from '../components/modals/rewardWallet';
import PositionModal from '../components/modals/Position';
import { useModal } from '../app/modalcontext';
import StakeVerification from '../components/modals/StakeVerification';
import MessageUpdate from '../components/messageUpdate';
import NameChangeModal from '../components/modals/NameChange';
import WithdrawStakeVerification from '../components/modals/WithdrawStakeVerification';
import { Device } from '../lib/types';
import { useRouter } from 'next/router';
import PageShell from '../components/PageShell';

type DeviceWithMeta = Device & {
  registration?: Device['registration'] | null;
  node?: Device['node'] | null;
  verificationLocked?: boolean;
  verificationDisabledReason?: string | null;
};

export default function MyRegistrationsPage({ devices = [] }: { devices: DeviceWithMeta[] }) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { activeAccount } = useWallet();
  const { openModal, closeModal } = useModal();

  const [currentDevice, setCurrentDevice] = useState<DeviceWithMeta | null>(null);
  const [rewardWallet, setRewardWallet] = useState('');
  const [isValid, setIsValid] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState({ status: 'success', message: '' });
  const [minerTypes, setMinerTypes] = useState([{ name: '', key: '' }]);
  const [typeFilter, setTypeFilter] = useState(['ALL']);
  const [miscFilter, setMiscFilter] = useState(['ALL']);
  const [filter, setFilter] = useState('');
  const [filteredDevices, setFilteredDevices] = useState<DeviceWithMeta[]>(devices);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const clickedInside = Object.values(dropdownRefs.current).some(
        (el) => el && el.contains(event.target as Node)
      );
      if (!clickedInside) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const regex = /^[A-Z0-9]{58}$/;
    setIsValid(rewardWallet.length === 0 || regex.test(rewardWallet));
  }, [rewardWallet]);

  useEffect(() => {
    // Must have both wallet and session to fetch
    if (!activeAccount || !session) return;
    const fetchMinerTypes = async () => {
      const response = await fetch('/api/get_miner_types', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address: activeAccount?.address }),
      });
      if (response.ok) {
        const data = await response.json();
        setMinerTypes(data.data as { name: string, key: string }[]);
      }
    };
    fetchMinerTypes();

  }, [activeAccount, session, router]);


  useEffect(() => {
    let updatedDevices = devices.filter(device => {
      return (filter.length > 0 ? device.reward_wallet?.includes(filter) : true) &&
        (typeFilter.includes('ALL') || typeFilter.includes(device.miner_key.split('-')[0])) &&
        (miscFilter.includes('ALL') || (miscFilter.some(filter => {
          const split = filter.split('!')[1]
          return filter.startsWith('!') ? !miscFilter.includes(split) && !(device as any)[split] : (device as any)[filter];
        })
        ));
    }
    )
    updatedDevices.sort((a, b) => {
      if (a.nickname) {
        if (b.nickname) {
          return a.nickname.localeCompare(b.nickname);
        } else {
          return a.nickname.localeCompare(b.name);
        }
      } else {
        if (b.nickname) {
          return a.name.localeCompare(b.nickname);
        } else {
          return a.name.localeCompare(b.name);
        }
      }
    });
    setFilteredDevices(updatedDevices);
  }, [filter, devices, typeFilter, miscFilter]);





  const handleOpenModal = (device: Device, modalName: string) => {
    setCurrentDevice(device);
    openModal(modalName);
  };


  const handleUpdateRewardWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentDevice || !isValid) return;
    try {
      const response = await fetch('/api/update-reward-wallet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ miner: currentDevice.miner_key, reward_wallet: rewardWallet, address: activeAccount?.address }),
      });
      if (response.ok) {
        setRewardWallet('');
        setUpdateSuccess({ status: 'success', message: 'reward wallet' });
        closeModal('updateReward');
        router.reload();
      } else {
        setUpdateSuccess({ status: 'error', message: 'reward wallet' });
        console.error('Failed to update reward wallet');
      }
    } catch (error) {
      setUpdateSuccess({ status: 'error', message: 'reward wallet' });
      console.error('An error occurred while updating the reward wallet', error);
    }
  };
  const handleVerify = async (data: { latitude: number, longitude: number }) => {
    if (!currentDevice) return;
    try {
      const response = await fetch('/api/verify-position', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...data, miner: currentDevice.miner_key, address: activeAccount?.address }),
      });
      if (response.ok) {
        setUpdateSuccess({ status: 'success', message: 'position' });
        closeModal('positionVerification');
        router.reload();
        // Optionally update the device list or show a success message
      } else {
        console.error('Failed to verify address');
      }
    } catch (error) {
      console.error('An error occurred while verifying the address', error);
    }
  };

  if (status === 'loading') {
    return <p>Loading...</p>;
  }


  return (
    <PageShell title="My Registrations" breadcrumb={true}>
      <div className="max-w-7xl mx-auto px-4 py-space-6">
        {session ? (
          <>
            <div className="mb-space-8">
              <h1 className="text-2xl font-display font-bold text-ink">
                My Registrations
              </h1>
              <p className="text-sm text-ink-secondary mt-1 font-mono">{session.user.address}</p>
            </div>
            <MessageUpdate updateSuccess={updateSuccess} />

            {/* Filter section */}
            <div className="flex flex-col md:flex-row items-start md:items-center gap-4 mb-space-6 bg-surface-elevated border border-divider rounded-token-lg p-4">
              <input
                type="text"
                placeholder="Filter by reward wallet"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full md:w-auto bg-surface-strong border border-divider rounded-token-md px-4 py-2.5 text-ink text-sm outline-none focus:ring-2 focus:ring-primary-500/40 transition"
              />
              <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                <select
                  className="bg-surface-strong border border-divider rounded-token-md px-3 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-primary-500/40 transition"
                  value={typeFilter[0] || 'ALL'}
                  onChange={(e) => setTypeFilter([e.target.value])}
                >
                  <option value="ALL">All Types</option>
                  {minerTypes.map((miner) => (
                    <option key={miner.key} value={miner.key}>
                      {miner.key} — {miner.name}
                    </option>
                  ))}
                </select>
                <select
                  className="bg-surface-strong border border-divider rounded-token-md px-3 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-primary-500/40 transition"
                  value={miscFilter[0] || 'ALL'}
                  onChange={(e) => setMiscFilter([e.target.value])}
                >
                  <option value="ALL">All Statuses</option>
                  <option value="is_registered">Registered</option>
                  <option value="verified">Verified</option>
                  <option value="position">Position set</option>
                  <option value="!is_registered">Not registered</option>
                  <option value="!verified">Not verified</option>
                  <option value="!position">Position not set</option>
                </select>
              </div>
            </div>

            {/* Desktop table */}
            {filteredDevices && filteredDevices.length > 0 ? (
              <>
                <div className="hidden lg:block bg-surface-elevated border border-divider rounded-token-xl">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-divider">
                        <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider font-display">Device</th>
                        <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider font-display">Status</th>
                        <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider font-display">Reward Wallet</th>
                        <th className="px-4 py-3 text-xs font-semibold text-ink-secondary uppercase tracking-wider font-display text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-divider">
                      {filteredDevices.map((device) => {
                        const allGood = device.verified && device.position && device.is_registered && device.reward_wallet;
                        return (
                          <tr key={device._id} className="hover:bg-surface-strong/50 transition">
                            <td className="px-4 py-3">
                              <div className="font-semibold text-ink">{device.nickname ? device.nickname : device.name}</div>
                              <div className="font-mono text-xs text-ink-secondary mt-1">{device.miner_key}</div>
                              {device.position && <div className="text-xs text-ink-secondary mt-1">{device.position?.lat}, {device.position?.lng}</div>}
                            </td>
                            <td className="px-4 py-3">
                              {allGood ? (
                                <span className="inline-flex items-center gap-1.5 bg-success-500/10 border border-success-500/20 rounded-token-md px-2.5 py-1 text-xs font-medium text-success-500">
                                  <CheckCircleIcon className="h-4 w-4" /> Verified
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 bg-error-500/10 border border-error-500/20 rounded-token-md px-2.5 py-1 text-xs font-medium text-error-500">
                                  <XCircleIcon className="h-4 w-4" /> Incomplete
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-mono text-xs text-ink truncate max-w-[200px]">{device.reward_wallet ?? 'None'}</div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div
                                className="relative inline-block"
                                ref={(el) => { dropdownRefs.current[device._id] = el; }}
                              >
                                <button
                                  className="p-2 rounded-token-md hover:bg-surface-strong text-ink-secondary hover:text-ink transition"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenDropdownId(openDropdownId === device._id ? null : device._id);
                                  }}
                                  aria-label="Actions"
                                >
                                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                                  </svg>
                                </button>

                                {openDropdownId === device._id && (
                                  <div className="absolute right-0 mt-2 w-56 bg-surface-elevated border border-divider rounded-token-lg shadow-token-lg z-50 py-1">
                                    <button
                                      className="w-full text-left px-4 py-2 text-sm text-ink-secondary hover:text-ink hover:bg-surface-strong transition"
                                      onClick={() => { setOpenDropdownId(null); handleOpenModal(device, 'updateReward'); }}
                                    >
                                      {!device.reward_wallet ? "Set reward wallet" : "Change reward wallet"}
                                    </button>

                                    {device.verified && device.staked ? (
                                      <button
                                        className="w-full text-left px-4 py-2 text-sm text-ink-secondary hover:text-ink hover:bg-surface-strong transition disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={() => { setOpenDropdownId(null); handleOpenModal(device, 'withdraw_stakeVerification'); }}
                                        disabled={device.is_registered === false}
                                      >
                                        Withdraw stake
                                      </button>
                                    ) : (
                                      <button
                                        className="w-full text-left px-4 py-2 text-sm text-ink-secondary hover:text-ink hover:bg-surface-strong transition disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={() => { setOpenDropdownId(null); handleOpenModal(device, 'stakeVerification'); }}
                                        disabled={device.is_registered === false || device.verificationLocked}
                                      >
                                        Verify
                                      </button>
                                    )}

                                    <button
                                      className="w-full text-left px-4 py-2 text-sm text-ink-secondary hover:text-ink hover:bg-surface-strong transition"
                                      onClick={() => { setOpenDropdownId(null); handleOpenModal(device, 'positionVerification'); }}
                                    >
                                      {!device.position ? "Set location" : "Change location"}
                                    </button>

                                    <button
                                      className="w-full text-left px-4 py-2 text-sm text-ink-secondary hover:text-ink hover:bg-surface-strong transition"
                                      onClick={() => { setOpenDropdownId(null); handleOpenModal(device, 'changeName'); }}
                                    >
                                      Rename
                                    </button>

                                    {device?.hexId && (
                                      <>
                                        <div className="border-t border-divider my-1" />
                                        <button
                                          className="w-full text-left px-4 py-2 text-sm text-warning-500 hover:text-warning-400 hover:bg-surface-strong transition inline-flex items-center gap-1.5"
                                          onClick={() => { setOpenDropdownId(null); window.open('https://explorer.frynetworks.com/hex/' + device?.hexId, '_blank'); }}
                                        >
                                          Explorer <ExternalLinkIcon className="h-3.5 w-3.5" />
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-space-4">
                  {filteredDevices.map((device) => {
                    const verificationDisabled =
                      device.is_registered === false || device.verificationLocked;
                    const verificationReason = device.verificationLocked
                      ? device.verificationDisabledReason ??
                        'Complete the required staking steps before verification.'
                      : undefined;
                    const allGood = device.verified && device.position && device.is_registered && device.reward_wallet;

                    return (
                      <div key={device._id} className="bg-surface-elevated border border-divider rounded-token-lg p-space-5 relative">
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <div>
                            <h3 className="text-lg font-display font-semibold text-ink">{device.nickname ? device.nickname : device.name}</h3>
                            <p className="font-mono text-xs text-ink-secondary mt-1">{device.miner_key}</p>
                          </div>
                          {allGood ? (
                            <div className="flex items-center gap-1.5 bg-success-500/10 border border-success-500/20 rounded-token-md px-2.5 py-1">
                              <CheckCircleIcon className="h-4 w-4 text-success-500" />
                              <span className="text-xs font-medium text-success-500">Verified</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 bg-error-500/10 border border-error-500/20 rounded-token-md px-2.5 py-1">
                              <XCircleIcon className="h-4 w-4 text-error-500" />
                              <span className="text-xs font-medium text-error-500">Incomplete</span>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                          <div className="bg-surface-strong rounded-token-md px-3 py-2">
                            <p className="text-xs text-ink-secondary">Created</p>
                            <p className="text-ink">{new Date(device.created_at).toLocaleDateString()}</p>
                          </div>
                          <div className="bg-surface-strong rounded-token-md px-3 py-2">
                            <p className="text-xs text-ink-secondary">Registered</p>
                            <p className={`font-medium ${device.is_registered ? 'text-success-500' : 'text-error-500'}`}>{device.is_registered ? 'Yes' : 'No'}</p>
                          </div>
                          <div className="bg-surface-strong rounded-token-md px-3 py-2 col-span-2">
                            <p className="text-xs text-ink-secondary">Reward Wallet</p>
                            <p className="font-mono text-xs text-ink truncate">{device.reward_wallet ?? 'None'}</p>
                          </div>
                          {device.position && (
                            <div className="bg-surface-strong rounded-token-md px-3 py-2 col-span-2">
                              <p className="text-xs text-ink-secondary">Position</p>
                              <p className="font-mono text-xs text-ink">{device.position?.lat}, {device.position?.lng}</p>
                            </div>
                          )}
                          {device.byod && (
                            <div className="bg-surface-strong rounded-token-md px-3 py-2 col-span-2">
                              <p className="text-xs text-ink-secondary">BYOD</p>
                              <p className="font-mono text-xs text-primary-500">{device.byod}</p>
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end">
                          <div
                            className="relative inline-block"
                            ref={(el) => { dropdownRefs.current[device._id + '-mobile'] = el; }}
                          >
                            <button
                              className="p-2 rounded-token-md hover:bg-surface-strong text-ink-secondary hover:text-ink transition"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenDropdownId(openDropdownId === device._id ? null : device._id);
                              }}
                              aria-label="Actions"
                            >
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                              </svg>
                            </button>

                            {openDropdownId === device._id && (
                              <div className="absolute right-0 mt-2 w-56 bg-surface-elevated border border-divider rounded-token-lg shadow-token-lg z-50 py-1">
                                <button
                                  className="w-full text-left px-4 py-2 text-sm text-ink-secondary hover:text-ink hover:bg-surface-strong transition"
                                  onClick={() => { setOpenDropdownId(null); handleOpenModal(device, 'updateReward'); }}
                                >
                                  {!device.reward_wallet ? "Set reward wallet" : "Change reward wallet"}
                                </button>

                                {device.verified && device.staked ? (
                                  <button
                                    className="w-full text-left px-4 py-2 text-sm text-ink-secondary hover:text-ink hover:bg-surface-strong transition disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={() => { setOpenDropdownId(null); handleOpenModal(device, 'withdraw_stakeVerification'); }}
                                    disabled={device.is_registered === false}
                                  >
                                    Withdraw stake
                                  </button>
                                ) : (
                                  <button
                                    className="w-full text-left px-4 py-2 text-sm text-ink-secondary hover:text-ink hover:bg-surface-strong transition disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={() => { setOpenDropdownId(null); handleOpenModal(device, 'stakeVerification'); }}
                                    disabled={verificationDisabled}
                                    title={verificationReason}
                                  >
                                    Verify (stake)
                                  </button>
                                )}

                                <button
                                  className="w-full text-left px-4 py-2 text-sm text-ink-secondary hover:text-ink hover:bg-surface-strong transition"
                                  onClick={() => { setOpenDropdownId(null); handleOpenModal(device, 'positionVerification'); }}
                                >
                                  {!device.position ? "Set location" : "Change location"}
                                </button>

                                <button
                                  className="w-full text-left px-4 py-2 text-sm text-ink-secondary hover:text-ink hover:bg-surface-strong transition"
                                  onClick={() => { setOpenDropdownId(null); handleOpenModal(device, 'changeName'); }}
                                >
                                  Rename
                                </button>

                                {device?.hexId && (
                                  <>
                                    <div className="border-t border-divider my-1" />
                                    <button
                                      className="w-full text-left px-4 py-2 text-sm text-warning-500 hover:text-warning-400 hover:bg-surface-strong transition inline-flex items-center gap-1.5"
                                      onClick={() => { setOpenDropdownId(null); window.open('https://explorer.frynetworks.com/hex/' + device?.hexId, '_blank'); }}
                                    >
                                      Explorer <ExternalLinkIcon className="h-3.5 w-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {device.verificationLocked && verificationReason && (
                          <p className="text-warning-500 text-xs mt-3 bg-warning-500/10 border border-warning-500/20 rounded-token-md px-3 py-2">
                            {verificationReason}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="bg-surface-elevated border border-divider rounded-token-xl p-space-8 text-center">
                <p className="text-ink-secondary font-body">No devices found</p>
              </div>
            )}
          </>
        ) : (
          <div className="min-h-[40vh] flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-xl font-display font-semibold text-ink">{activeAccount ? 'Session expired — please sign in again' : 'Please connect your wallet and authenticate'}</h2>
              <p className="text-sm text-ink-secondary mt-2 font-body">{activeAccount ? 'Your wallet is connected, but your dashboard session has expired. Sign in again to view your registrations.' : 'You need to sign in to view your registrations.'}</p>
              {activeAccount && (
                <button onClick={() => router.push('/signin')} className="mt-4 px-4 py-2 rounded-token-md bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 transition">
                  Sign in
                </button>
              )}
            </div>
          </div>
        )}

        {/* Modals */}
        <UpdateRewardModal
          modalName="updateReward"
          handleUpdateRewardWallet={handleUpdateRewardWallet}
          rewardWallet={rewardWallet}
          setRewardWallet={setRewardWallet}
          isValid={isValid}
        />
        <PositionModal modalName="positionVerification" onSubmit={handleVerify} />
        <StakeVerification modalName="stakeVerification" miner={currentDevice?.miner_key} byod={!!currentDevice?.byod} />
        <WithdrawStakeVerification
          modalName="withdraw_stakeVerification"
          miner={currentDevice?.miner_key}
          staked={currentDevice?.staked?.amount ?? undefined}
        />
        <NameChangeModal modalName="changeName" address={activeAccount?.address} miner_key={currentDevice?.miner_key} />
      </div>
    </PageShell>
  );
}


export async function getServerSideProps(context: any) {
  // Avoid internal fetch to NEXTAUTH_URL_INTERNAL; read session from cookies directly.
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session || !session.user.address) {
    return {
      props: {},
    };
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    const devices = await db.collection('devices').find({ address: session.user.address}).toArray();
    const products = await db.collection('products').find({}).toArray();

    if (!devices) {
      return {
        props: {
          devices: [],
        },
      };
    }

    const productMap = new Map(
      products.map((product: any) => [product.key, product])
    );

    const serializedDevices = devices.map((device: any) => {
      const productKey = device.miner_key?.split('-')[0];
      const product = productMap.get(productKey);

      const registerStakeRequired = Boolean(
        product?.reward?.tokens?.register &&
          product?.reward?.tokens?.register !== 'none' &&
          product?.reward?.stake?.register &&
          product?.reward?.stake?.register > 0
      );

      const nodeStakeRequired = Boolean(
        product?.reward?.tokens?.node &&
          product?.reward?.tokens?.node !== 'none' &&
          product?.reward?.stake?.node &&
          product?.reward?.stake?.node > 0
      );

      const hasRegistrationStake = Boolean(
        Number(device?.registration?.amount ?? 0) > 0
      );

      const hasNodeStake = Boolean(Number(device?.node?.amount ?? 0) > 0);

      const missingRequirements: string[] = [];
      if (registerStakeRequired && !hasRegistrationStake) {
        missingRequirements.push('registration stake');
      }
      if (nodeStakeRequired && !hasNodeStake) {
        missingRequirements.push('node operation stake');
      }

      const verificationLocked = missingRequirements.length > 0;
      const verificationDisabledReason = verificationLocked
        ? `Complete the ${missingRequirements.join(' and ')} before verification staking.`
        : null;

      return {
        _id: device._id?.toString?.() ?? device._id,
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
        registration: device.registration ?? null,
        node: device.node ?? null,
        verificationLocked,
        verificationDisabledReason
      };
    });

    return {
      props: {
        devices: JSON.parse(JSON.stringify(serializedDevices))
      }
    };
  } catch (e) {
    console.error(e);
    return {
      props: {},
    };
  }
}
