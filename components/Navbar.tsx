'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useWallet } from '@txnlab/use-wallet-react';
import Image from 'next/image';
import { Button, Flex, Title } from '@tremor/react';
import Link from 'next/link';

import fryLogo from '../assets/Logo.png';
import Modal from 'react-modal';
import { useDevWallet } from '../hooks/UseDevWallet';
import { useRouter } from 'next/router';
import DownMenu from './MenuBox';
import { normalizeAssetId } from '../lib/utils';

const navigation = [
  { name: 'My registrations', href: '/my_registrations' },
  { name: 'New registration', href: '/new_registration' }
];

function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

export default function Navbar() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const { wallets, activeAccount, algodClient } = useWallet();
  const activeWallet = wallets.find(w => w.isActive);
  const { devConnect, devAccount, algodClient: devAlgodClient, setDevConnect } = useDevWallet();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [algoBalance, setAlgoBalance] = useState('0.00');
  const [fryBalance, setFryBalance] = useState('0.00');
  const router = useRouter();
  const [countdown, setCountdown] = useState<string>("");

  const handleDisconnect = () => {
    if (devMode) {
      setDevConnect(false);
      if (session) {
        signOut();
      }
    } else {
      if (activeWallet) {
        activeWallet.disconnect();
      }
      if (session) {
        signOut();
      }
    }
  }

  useEffect(() => {
    if (address && address.length > 0) {
      if (devMode) {
      } else {
        const fetchBalances = async () => {
          try {
            // algodClient is already available from useWallet hook
            if (activeAccount) {
              const accountInfo = await algodClient.accountInformation(activeAccount.address).do();
              
              if (!accountInfo.amount) {
                setAlgoBalance('0.00');
              } else {
                setAlgoBalance(
                  (Number(accountInfo.amount) / 10 ** 6).toFixed(2).toString()
                );
              }

              // Normalize asset ids returned by algod (they may come back as bigint).
              const assets = (accountInfo.assets ?? []) as Array<{
                ['asset-id']?: number | bigint | string;
              }>;

              if (!assets.length) {
                setFryBalance('0.00');
              } else {
                const fryAsset = assets.find(
                  (asset) => normalizeAssetId(asset['asset-id']) === 924268058
                );
                if (fryAsset) {
                  setFryBalance(
                    (Number((fryAsset as any).amount ?? 0) / 10 ** 6)
                      .toFixed(2)
                      .toString()
                  );
                } else {
                  setFryBalance('0.00');
                }
              }
            }
          } catch (error) {
            console.error('Error fetching balances:', error);
            setAlgoBalance('0.00');
            setFryBalance('0.00');
          }
        };

        fetchBalances();
      }
    }
  }, [address]);

  useEffect(() => {
    if ((router.pathname !== '/' && !session) || !session?.user) {
      router.push('/');
    }
  }, [router.pathname, session, activeAccount]);

  useEffect(() => {
    if (devMode) {
      if (devConnect && devAccount) {
        setAddress(
          devAccount.addr.toString().substring(0, 4) +
            '...' +
            devAccount.addr.toString().slice(-4)
        );
      } else {
        setAddress('');
      }
    } else {
      if (activeAccount) {
        setAddress(
          activeAccount.address.substring(0, 4) +
            '...' +
            activeAccount.address.slice(-4)
        );
      } else {
        setAddress('');
      }
    }
  }, [activeAccount, devConnect]);

  // Countdown to next Friday 00:05 UTC
  useEffect(() => {
    const getNextFridayUnlockUTC = (now: Date) => {
      const day = now.getUTCDay(); // 0=Sun..5=Fri
      const thisFriday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      const diffToFriday = (day + 7 - 5) % 7; // days since last Friday
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

  // (Ribbon moved to devices page)

  return (
    <div>
      <Flex
        flexDirection="row"
        className="w-full px-2 border-b h-24 border-white/10 sm:px-20"
      >
        <div className="flex" key="logo">
          <Link
            href="https://frynetworks.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image src={fryLogo} className="logo" alt="Fry logo" priority />
          </Link>
        </div>
        
        <div
          className="flex items-center justify-between gap-2"
          key="connect-button"
        >
          {!address || address.length === 0 ? (
            <Button
              className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
              onClick={(e) => {
                if (devMode) {
                  setDevConnect(true);
                } else {
                  setIsWalletModalOpen(true);
                }
              }}
            >
              Connect Wallet
            </Button>
          ) : (
            <DownMenu 
              address={address} 
              disconnect={handleDisconnect} 
            />
            // <Button
            //   className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
            //   onClick={(e) => {
            //     if (devMode) {
            //       setDevConnect(false);
            //       if (session) {
            //         signOut();
            //       }
            //     } else {
            //       providers
            //         ?.filter((provider) => provider.isConnected)[0]
            //         .disconnect();
            //       if (session) {
            //         signOut();
            //       }
            //     }
            //   }}
            // >
            //   {`Disconnect: ${address}`}
            // </Button>
          )}
        </div>
      </Flex>
      <Modal
        isOpen={isWalletModalOpen}
        style={customStyles}
        contentLabel="Connect Wallet"
      >
        <div className="max-w-md sm:w-[415px] w-[320px]">
          <div className="flex justify-end">
            <Button
              className="text-white bg-transparent p-2 right-2 rounded border-transparent hover:bg-red-600 hover:border-transparent hover:rounded hover:bg-opacity-10"
              onClick={() => setIsWalletModalOpen(false)}
            >
              <svg
                fillRule="evenodd"
                viewBox="64 64 896 896"
                focusable="false"
                data-icon="close"
                width="1em"
                height="1em"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M799.86 166.31c.02 0 .04.02.08.06l57.69 57.7c.04.03.05.05.06.08a.12.12 0 010 .06c0 .03-.02.05-.06.09L569.93 512l287.7 287.7c.04.04.05.06.06.09a.12.12 0 010 .07c0 .02-.02.04-.06.08l-57.7 57.69c-.03.04-.05.05-.07.06a.12.12 0 01-.07 0c-.03 0-.05-.02-.09-.06L512 569.93l-287.7 287.7c-.04.04-.06.05-.09.06a.12.12 0 01-.07 0c-.02 0-.04-.02-.08-.06l-57.69-57.7c-.04-.03-.05-.05-.06-.07a.12.12 0 010-.07c0-.03.02-.05.06-.09L454.07 512l-287.7-287.7c-.04-.04-.05-.06-.06-.09a.12.12 0 010-.07c0-.02.02-.04.06-.08l57.7-57.69c.03-.04.05-.05.07-.06a.12.12 0 01.07 0c.03 0 .05.02.09.06L512 454.07l287.7-287.7c.04-.04.06-.05.09-.06a.12.12 0 01.07 0z"></path>
              </svg>
            </Button>
          </div>

          <Flex flexDirection="col">
            <Title className="text-red-600 text-2xl">CONNECT TO WALLET</Title>
            <Image
              src={fryLogo}
              className="logo_wallet mt-4 m-auto"
              alt="Fry logo"
              priority
            />
            <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-red-500 to-transparent"></div>
          </Flex>

          <Flex flexDirection="col" className="w-full gap-5 mt-10">
            {wallets.map((wallet, index) => (
              <div
                key={`wallet ${index}`}
                className="flex flex-row border-2 border-red-600 h-12 rounded-lg text-white gap-8 w-full items-center px-3 py-8 hover:bg-red-600 hover:bg-opacity-10"
                onClick={async () => {
                  try {
                    await wallet.connect();
                    setIsWalletModalOpen(false);
                  } catch (error) {
                    console.error('Failed to connect wallet:', error);
                  }
                }}
              >
                <Image
                  src={wallet.metadata.icon}
                  alt={`${wallet.metadata.name} logo`}
                  width={32}
                  height={32}
                  className="object-contain align-middle"
                />
                <div className="cursor-default">
                  {wallet.metadata.name} Wallet
                </div>
              </div>
            ))}
          </Flex>
        </div>
      </Modal>
      {/* Totals ribbon moved to devices page to appear under hero section */}
    </div>
  );
};

const customStyles = {
  content: {
    top: '50%',
    left: '50%',
    right: 'auto',
    bottom: 'auto',
    marginRight: '-50%',
    transform: 'translate(-50%, -50%)',
    backgroundColor: 'black', // Example background color
    color: '#6b7280',
    padding: '20px',
    boxShadow: '0 4px 8px 0 rgba(0,0,0,0.2)',
    borderColor: '#D00000',
    borderRadius: '40px',
    paddingBottom: '40px'
  },
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)', // Example overlay color
    backdropFilter: 'blur(5px)'
  }
};
