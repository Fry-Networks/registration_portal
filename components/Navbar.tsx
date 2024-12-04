'use client';

import { Fragment, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Disclosure } from '@headlessui/react';
import { signIn, signOut, useSession } from 'next-auth/react';
import { useWallet } from '@txnlab/use-wallet';
import Image from 'next/image';
import { Button, Flex, Title } from '@tremor/react';
import Link from 'next/link';

import fryLogo from '../assets/Logo.png';
import Modal from 'react-modal';
import { useDevWallet } from '../hooks/UseDevWallet';
import { useRouter } from 'next/router';

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

export default () => {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { providers, activeAccount, getAssets, getAccountInfo } = useWallet();
  const { devConnect, devAccount, algodClient, setDevConnect } = useDevWallet();
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [algoBalance, setAlgoBalance] = useState('0.00');
  const [fryBalance, setFryBalance] = useState('0.00');
  const router = useRouter();

  useEffect(() => {
    if (address && address.length > 0) {
      if (devMode) {
        console.log('Wallet Address: ' + address);
      } else {
        const assets = async () => {
          const infos = await getAssets();
          const accountInfo = await getAccountInfo();

          if (!accountInfo.amount) {
            setAlgoBalance('0.00');
          } else {
            setAlgoBalance(
              (accountInfo.amount / 10 ** 6).toFixed(2).toString()
            );
          }

          if (infos.length === 0) {
            setFryBalance('0.00');
          } else {
            infos.map((info) => {
              if (info['asset-id'] === 924268058) {
                setFryBalance((info.amount / 10 ** 6).toFixed(2).toString());
              }
            });
          }

          return infos;
        };

        assets();
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

  return (
    <div>
      <Flex
        flexDirection="row"
        className="w-full px-20 border-b h-24 border-white/10 max-sm:px-0"
      >
        <div className="flex" key="logo">
          <Link
            href="https://frynetworks.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image src={fryLogo} className="logo" alt="Fry logo" />
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
            <Button
              className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
              onClick={(e) => {
                if (devMode) {
                  setDevConnect(false);
                  if (session) {
                    console.log('Log out');
                    signOut();
                  }
                } else {
                  providers
                    ?.filter((provider) => provider.isConnected)[0]
                    .disconnect();
                  if (session) {
                    console.log('Log out');
                    signOut();
                  }
                }
              }}
            >
              {`Disconnect: ${address}`}
            </Button>
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
                fill-rule="evenodd"
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
            />
            <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-red-500 to-transparent"></div>
          </Flex>

          <Flex flexDirection="col" className="w-full gap-5 mt-10">
            {providers?.map((provider, index) => (
              <div
                key={`provider ${index}`}
                className="flex flex-row border-2 border-red-600 h-12 rounded-lg text-white gap-8 w-full items-center px-3 py-8 hover:bg-red-600 hover:bg-opacity-10"
                onClick={() => provider.connect()}
              >
                <Image
                  src={provider.metadata.icon}
                  alt="Pera logo"
                  width={32}
                  height={32}
                  className="object-contain align-middle"
                />
                <div className="cursor-default">
                  {provider.metadata.name} Wallet
                </div>
              </div>
            ))}
          </Flex>
        </div>
      </Modal>
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
