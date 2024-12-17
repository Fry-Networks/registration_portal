import { Button, Flex, Title } from '@tremor/react';
import Image from 'next/image';
import bgImg from '../assets/background.png';
import { useRouter } from 'next/router';
import { getSession, useSession } from 'next-auth/react';
import clientPromise from '../lib/mongoclient';
import { useEffect, useState } from 'react';
import { Device, Product } from '../lib/types';
import { getFRYPrice } from '../lib/price';
import { getTokenBalance } from './api/algorand/get-token-balance';
import algosdk from 'algosdk';
import { useWallet } from '@txnlab/use-wallet';
import MessageUpdate from '../components/messageUpdate';
import {
  isNodeStaked,
  isNodeStakingNeeded,
  isRegistartionStaked,
  isRegistrationNeeded
} from '../lib/utils';
import {
  confirmTransaction,
  SEND_TXN_RESULT,
  sendAlgoTransaction,
  VERIFY_RESULT
} from '../lib/txn';
import { useToastContext } from '../hooks/ToastContext';
import Link from 'next/link';

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

const STAKE_ADDRESS =
  'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = 443;

export default function PayRegister({ products }: { products: Product[] }) {
  const router = useRouter();
  const [product, setProduct] = useState<Product | undefined>(undefined);
  const [tokenName, setTokenName] = useState('');
  const [nodeTokenName, setNodeTokenName] = useState('');
  const [device, setDevice] = useState<Device | undefined>(undefined);
  const { minerKey } = router.query;
  const { data: session } = useSession();

  const [isProcessing, setIsProcessing] = useState(false);
  const { activeAddress, signTransactions, sendTransactions } = useWallet();

  const toast = useToastContext();

  const fetchDeviceInfo = async (minerKey: string) => {
    console.log('Device Miner Key: ' + minerKey);
    try {
      const response = await fetch(`/api/devices/${minerKey}`);
      if (response.ok) {
        const data = await response.json();
        setDevice(data.device as Device);
      } else {
        setDevice(undefined);
      }
    } catch (error) {
      console.error(error);
      setDevice(undefined);
    }
  };

  const fetchTokenInformation = async (asset_id: string | undefined) => {
    console.log('Token Asset: ' + asset_id);
    if (!asset_id || asset_id === 'none') {
      return;
    }

    try {
      const response = await fetch('/api/tokens/get-one', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ asset_id: asset_id })
      });

      if (!response.ok) {
        setTokenName('Unknown');
      }

      const result = await response.json();
      setTokenName(result.token.name);
    } catch (error) {
      console.error(error);
    }
  };

  const fetchNodeTokenInformation = async (asset_id: string | undefined) => {
    console.log('Node Token: ' + asset_id);
    if (!asset_id || asset_id === 'none') {
      return;
    }

    try {
      const response = await fetch('/api/tokens/get-one', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ asset_id: asset_id })
      });

      if (!response.ok) {
        setNodeTokenName('Unknown');
      }

      const result = await response.json();
      setNodeTokenName(result.token.name);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    console.log('Miner key checking');
    if (!minerKey || typeof minerKey !== 'string') {
      return;
    }

    fetchDeviceInfo(minerKey);
  }, [minerKey]);

  useEffect(() => {
    const foundOne = products?.find((value) => {
      return value.key === device?.miner_key.split('-')[0];
    });
    console.log(foundOne);
    setProduct(foundOne);
  }, [device, products]);

  useEffect(() => {
    if (!product) {
      return;
    }

    fetchTokenInformation(product.reward.tokens?.register);
    fetchNodeTokenInformation(product.reward.tokens?.node);
  }, [product]);

  const handleRegisterStaking = async () => {
    if (!product || !device) {
      console.log('Requirement error for handleRegistrationStaking');
      return;
    }

    setIsProcessing(true);

    try {
      const asset_id = product.reward.tokens?.register ?? 'none';
      const USDAmount = product.reward.stake?.register ?? 0;

      const price = await getFRYPrice(asset_id);
      const amount = Math.floor(USDAmount / price);

      console.log('Registration Staking Amount: ' + amount);

      const note = {
        action: 'Registration Staking',
        miner_key:
          device.miner_key.split('-')[0] +
          '-' +
          device.miner_key.split('-')[1].slice(0, 6),
        from: session?.user.address,
        to: STAKE_ADDRESS,
        asset_id: asset_id,
        amount: amount,
        created_at: new Date(Date.now())
      };

      const sendResult = devMode
        ? await sendAlgoTransaction(
            session?.user.address!,
            STAKE_ADDRESS,
            asset_id,
            amount,
            JSON.stringify(note),
            null,
            null,
            true
          )
        : await sendAlgoTransaction(
            session?.user.address!,
            STAKE_ADDRESS,
            asset_id,
            amount,
            JSON.stringify(note),
            signTransactions,
            sendTransactions,
            false
          );

      if (sendResult.result != SEND_TXN_RESULT.OK) {
        let message = '';
        switch (sendResult.result) {
          case SEND_TXN_RESULT.INVALID_PARAM:
            {
              message = 'Invalid transaction parameters.';
            }
            break;
          case SEND_TXN_RESULT.NO_ASSET:
            {
              message = 'No asset is opted-in in your wallet';
            }
            break;
          case SEND_TXN_RESULT.INSUFFICIENT_AMOUNT:
            {
              message = 'Insufficient amount in your wallet';
            }
            break;
          case SEND_TXN_RESULT.INTERNAL_ERROR:
            {
              message = 'Error occured during sending transaction.';
            }
            break;
        }
        toast.error({ heading: 'Error', message: message });
        setIsProcessing(false);
        return;
      }

      const txId = sendResult.txId!;
      const verifyResult = await confirmTransaction(
        session?.user.address!,
        txId
      );

      if (verifyResult != VERIFY_RESULT.OK) {
        toast.error({ heading: 'Error', message: `Confirm ${txId} failed` });
        setIsProcessing(false);
        return;
      }

      const dataResponse = await fetch('api/stake/registration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          miner_key: device.miner_key,
          address: session?.user.address,
          txId: txId,
          amount: amount,
          asset_id: asset_id
        })
      });

      const dataResult = await dataResponse.json();
      if (!dataResponse.ok) {
        toast.error({ heading: 'Error', message: dataResult.message });
        setIsProcessing(false);
        return;
      }

      if (dataResult.success) {
        toast.success({
          heading: 'Success',
          message: `Tx: ${txId}`
        });
      } else {
        toast.error({
          heading: 'Error',
          message: 'Registration staking is failed'
        });
        setIsProcessing(false);
        return;
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message: 'Error occured during registration staking.'
      });
      return;
    }

    fetchDeviceInfo(device.miner_key);
    setIsProcessing(false);
  };

  const isAlreadyRegister = () => {
    if (
      product &&
      device &&
      isRegistrationNeeded(product!) &&
      isRegistartionStaked(device)
    ) {
      return true;
    }

    return false;
  };

  const handleNodeStaking = async () => {
    if (!product || !device) {
      console.log('Requirement error for handleRegistrationStaking');
      return;
    }

    setIsProcessing(true);

    try {
      const asset_id = product.reward.tokens?.node ?? 'none';
      const USDAmount = product.reward.stake?.node ?? 0;

      const price = await getFRYPrice(asset_id);
      const amount = Math.floor(USDAmount / price);

      console.log('Node Staking Amount: ' + amount);

      if (amount <= 0) {
        return;
      }

      const note = {
        action: 'Node Staking',
        miner_key:
          device.miner_key.split('-')[0] +
          '-' +
          device.miner_key.split('-')[1].slice(0, 6),
        from: session?.user.address,
        to: STAKE_ADDRESS,
        asset_id: asset_id,
        amount: amount,
        created_at: new Date(Date.now())
      };

      const sendResult = devMode
        ? await sendAlgoTransaction(
            session?.user.address!,
            STAKE_ADDRESS,
            asset_id,
            amount,
            JSON.stringify(note),
            null,
            null,
            true
          )
        : await sendAlgoTransaction(
            session?.user.address!,
            STAKE_ADDRESS,
            asset_id,
            amount,
            JSON.stringify(note),
            signTransactions,
            sendTransactions,
            false
          );

      if (sendResult.result != SEND_TXN_RESULT.OK) {
        let message = '';
        switch (sendResult.result) {
          case SEND_TXN_RESULT.INVALID_PARAM:
            {
              message = 'Invalid transaction parameters.';
            }
            break;
          case SEND_TXN_RESULT.NO_ASSET:
            {
              message = 'No asset is opted-in in your wallet';
            }
            break;
          case SEND_TXN_RESULT.INSUFFICIENT_AMOUNT:
            {
              message = 'Insufficient amount in your wallet';
            }
            break;
          case SEND_TXN_RESULT.INTERNAL_ERROR:
            {
              message = 'Error occured during sending transaction.';
            }
            break;
        }
        toast.error({ heading: 'Error', message: message });
        setIsProcessing(false);
        return;
      }

      const txId = sendResult.txId!;
      const verifyResult = await confirmTransaction(
        session?.user.address!,
        txId
      );

      if (verifyResult != VERIFY_RESULT.OK) {
        toast.error({ heading: 'Error', message: `Confirm ${txId} failed` });
        setIsProcessing(false);
        return;
      }

      const dataResponse = await fetch('api/stake/node-staking', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          miner_key: device.miner_key,
          address: session?.user.address,
          txId: txId,
          amount: amount,
          asset_id: asset_id
        })
      });

      const dataResult = await dataResponse.json();
      if (!dataResponse.ok) {
        toast.error({ heading: 'Error', message: dataResult.message });
        setIsProcessing(false);
        return;
      }

      if (dataResult.success) {
        toast.success({
          heading: 'Success',
          message: `Tx: ${txId}`
        });
      } else {
        toast.error({
          heading: 'Error',
          message: 'Node staking is failed'
        });
        setIsProcessing(false);
        return;
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message: 'Error occured during node staking.'
      });
      return;
    }
    fetchDeviceInfo(device.miner_key);
    setIsProcessing(false);
  };

  const isAlreadyNode = () => {
    if (
      product &&
      device &&
      isNodeStakingNeeded(product) &&
      isNodeStaked(device)
    ) {
      return true;
    }

    return false;
  };

  const handleNext = () => {
    router.push('/devices');
  };

  return (
    <div className="w-full">
      <div className="relative flex">
        <Image
          src={bgImg}
          className="w-full h-[40vh] object-cover"
          alt="Background Image"
        />
        <Flex
          flexDirection="col"
          className="absolute w-full h-full justify-center gap-6"
        >
          <Title className="text-white text-center text-4xl sm:text-5xl">
            Registration & Node Staking
          </Title>
          <p className="text-lg text-center px-2">
            You have to stake for registration with following payments.This will
            be withdrawed automatically when you un-register the devices.
          </p>
        </Flex>
      </div>

      <div className="px-2 sm:px-20">
        <Link href="/devices">
          <Button className="mt-6 min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600">
            {`< Back`}
          </Button>
        </Link>
      </div>

      <Flex
        justifyContent="center"
        className="mt-10 py-2"
        alignItems="center"
        flexDirection="col"
      >
        {product && isRegistrationNeeded(product!) === true && (
          <div>
            <Flex
              className="w-full gap-3"
              flexDirection="col"
              justifyContent="center"
            >
              <Title className="text-white text-center text-xl sm:text-2xl">{`Stake $${product?.reward.stake?.register}USD in ${tokenName} here to complete device registration.`}</Title>
              <Button
                className={`relative flex min-w-[150px] items-center justify-center bg-transparent text-white border-red-600 hover:bg-red-600 hover:border-red-600 ${
                  isProcessing ? 'cursor-not-allowed' : 'cursor-default'
                }`}
                onClick={() => handleRegisterStaking()}
                disabled={isAlreadyRegister() === true}
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
                ) : isAlreadyRegister() ? (
                  'Staked'
                ) : (
                  'Registration Stake'
                )}
              </Button>
            </Flex>
          </div>
        )}
        {product && isNodeStakingNeeded(product!) === true && (
          <div>
            <Flex
              className="w-full gap-3 mt-6 px-2 py-5"
              flexDirection="col"
              justifyContent="center"
            >
              <Title className="text-white text-center text-xl sm:text-2xl">{`Stake $${product?.reward.stake?.node}USD in ${nodeTokenName} here to support and maintain your node's operation.`}</Title>
              <Button
                className={`relative flex min-w-[150px] items-center justify-center bg-transparent text-white border-red-600 hover:bg-red-600 hover:border-red-600 ${
                  isProcessing ? 'cursor-not-allowed' : 'cursor-default'
                }`}
                onClick={() => handleNodeStaking()}
                disabled={isAlreadyNode() === true}
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
                ) : isAlreadyNode() ? (
                  'Staked'
                ) : (
                  'Node Stake'
                )}
              </Button>
            </Flex>
          </div>
        )}
        {isAlreadyNode() && isAlreadyRegister() && (
          <Button
            className="mt-10 min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
            onClick={() => handleNext()}
          >
            Finish
          </Button>
        )}
      </Flex>
    </div>
  );
}

export async function getServerSideProps(context: any) {
  const session = await getSession(context);
  if (!session || !session.user.address) {
    return { props: {} };
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    const products = await db.collection('products').find({}).toArray();

    if (!products) {
      return {
        props: {
          products: []
        }
      };
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
    return {
      props: {}
    };
  }
}
