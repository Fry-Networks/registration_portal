import { Button, Flex, Title } from '@tremor/react';
import Image from 'next/image';
import bgImg from '../assets/background.png';
import { useRouter } from 'next/router';
import { getSession, useSession } from 'next-auth/react';
import clientPromise from '../lib/mongoclient';
import { Product } from './api/stake/verify-stake';
import { useEffect, useState } from 'react';
import { Device } from '../lib/types';
import { getFRYPrice } from '../lib/price';
import { getTokenBalance } from './api/stake/get-token-balance';
import algosdk from 'algosdk';
import { useWallet } from '@txnlab/use-wallet';
import MessageUpdate from '../components/messageUpdate';

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
  const [updateSuccess, setUpdateSuccess] = useState({
    status: 'success',
    message: ''
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const { activeAddress, signTransactions, sendTransactions } = useWallet();

  console.log(minerKey);

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

  const needStakeRegister = () => {
    if (product === undefined) {
      return false;
    }

    const result =
      product &&
      product.reward.stake?.register &&
      product.reward.stake.register > 0 &&
      product.reward.tokens?.register &&
      product.reward.tokens.register !== 'none'
        ? true
        : false;

    return result;
    console.log('Registration: ' + result);
  };

  const needNodeStake = () => {
    if (product === undefined) {
      return false;
    }

    return (
      product &&
      product.reward.stake?.node &&
      product.reward.stake.node > 0 &&
      product.reward.tokens?.node &&
      product.reward.tokens.node !== 'none'
    );
  };

  const sendTransaction = async (
    from: string,
    to: string,
    amount: number,
    asset_id: string
  ) => {
    try {
      const algodClient = new algosdk.Algodv2(
        '',
        'https://mainnet-api.algonode.cloud',
        ''
      );
      const suggestedParams = await algodClient.getTransactionParams().do();
      const noteInfo = {
        miner_key:
          device!.miner_key.split('-')[0] +
          '-' +
          device!.miner_key.split('-')[1].slice(0, 6),
        asset_id: asset_id,
        from: from,
        to: to,
        amount: amount,
        date: new Date(Date.now())
      };

      console.log(noteInfo);
      const enc = new TextEncoder();
      const note = enc.encode(JSON.stringify(noteInfo));

      const transaction =
        algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from,
          to,
          amount: testMode ? 0 : amount * 1_000_000, // Amount in microAlgos
          note: note,
          assetIndex: Number(asset_id),
          suggestedParams
        });

      const encodedTransaction = algosdk.encodeUnsignedTransaction(transaction);
      const signedTransactions = await signTransactions([encodedTransaction]);
      const waitRoundsToConfirm = 4;
      const { txId } = await sendTransactions(
        signedTransactions,
        waitRoundsToConfirm
      );

      console.log('Successfully sent transaction. Transaction ID:', txId);
      return txId;
    } catch (error) {
      console.error('Transaction failed:', error);
      return null;
    }
  };

  const handleRegisterStaking = async () => {
    if (!product || !device) {
      console.log('Requirement error for handleRegistrationStaking');
      return;
    }

    setIsProcessing(true);

    const asset_id = product.reward.tokens?.register ?? 'none';
    const USDAmount = product.reward.stake?.register ?? 0;

    try {
      const price = await getFRYPrice(asset_id);
      const amount = Math.floor(USDAmount / price);

      const balanceResponse = await fetch('api/stake/get-token-balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: session?.user.address,
          asset_id: product.reward.tokens!.register
        })
      });

      if (!balanceResponse.ok) {
        setUpdateSuccess({
          status: 'error',
          message: `Failed to get token balance from wallet. Check network status and try again`
        });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 5_000);
        setIsProcessing(false);
        return;
      }

      const balanceGet = await balanceResponse.json();
      if (balanceGet.success == false) {
        setUpdateSuccess({
          status: 'error',
          message: `There's no ${tokenName} token is in the wallet`
        });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 5_000);
        setIsProcessing(false);
        return;
      }

      const tokenAmountInWallet = balanceGet.balance;

      console.log('Wallet Balance: ' + Number(tokenAmountInWallet));

      if (
        !tokenAmountInWallet ||
        Number(tokenAmountInWallet) < Number(amount)
      ) {
        setUpdateSuccess({
          status: 'error',
          message: 'Not enough token amount is in the wallet'
        });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 5_000);

        setIsProcessing(false);
        return;
      }

      if (devMode) {
        const stakeReponse = await fetch('api/stake/stake-register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            miner_key: device.miner_key,
            asset_id: product.reward.tokens!.register,
            from: session?.user.address,
            to: STAKE_ADDRESS,
            amount: amount
          })
        });

        if (!stakeReponse.ok) {
          setUpdateSuccess({
            status: 'error',
            message:
              'Failed to send transaction. Please contact us before you try again'
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);

          setIsProcessing(false);
          return;
        }

        const stakeResult = await stakeReponse.json();
        const txId = stakeResult.txId;
        console.log(txId);
        const verifyResponse = await fetch('api/stake/verify-register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            txId: txId,
            miner: device.miner_key,
            asset_id: product.reward.tokens?.register,
            address: session?.user.address,
            amount: amount
          })
        });

        if (!verifyResponse.ok) {
          setUpdateSuccess({
            status: 'error',
            message:
              'Failed to verify transaction. Please contact us before you try again'
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);

          setIsProcessing(false);
          return;
        }
      } else {
        if (!session || !session.user) {
          console.log('Unauthorized');
          return;
        }

        const txId = await sendTransaction(
          activeAddress!,
          STAKE_ADDRESS,
          amount,
          product.reward.tokens?.register ?? 'none'
        );

        if (!txId) {
          setUpdateSuccess({
            status: 'error',
            message:
              'Failed to send transaction. Please contact us before you try again'
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);

          setIsProcessing(false);
          return;
        }

        const verifyResponse = await fetch('api/stake/verify-register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            txId: txId,
            miner: device.miner_key,
            address: session?.user.address,
            amount: amount,
            asset_id: product.reward.tokens?.register
          })
        });

        if (!verifyResponse.ok) {
          setUpdateSuccess({
            status: 'error',
            message:
              'Failed to verify transaction. Please contact us before you try again'
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);

          setIsProcessing(false);
          return;
        }
      }
    } catch (error) {}

    fetchDeviceInfo(device.miner_key);
    setIsProcessing(false);
  };

  const isAlreadyRegister = () => {
    console.log(device);
    if (device?.is_registered === true || device?.registration) {
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

    const asset_id = product.reward.tokens?.node ?? 'none';
    const USDAmount = product.reward.stake?.node ?? 0;

    try {
      const price = await getFRYPrice(asset_id);
      const amount = Math.floor(USDAmount / price);

      console.log('Staking Amount: ' + Number(amount));

      const balanceResponse = await fetch('api/stake/get-token-balance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: session?.user.address,
          asset_id: product.reward.tokens!.register
        })
      });

      if (!balanceResponse.ok) {
        setUpdateSuccess({
          status: 'error',
          message: `Failed to get token balance from wallet. Check network status and try again`
        });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 5_000);
        setIsProcessing(false);
        return;
      }

      const balanceGet = await balanceResponse.json();
      if (balanceGet.success == false) {
        setUpdateSuccess({
          status: 'error',
          message: `There's no ${tokenName} token is in the wallet`
        });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 5_000);
        setIsProcessing(false);
        return;
      }

      const tokenAmountInWallet = balanceGet.balance;

      console.log('Wallet Balance: ' + tokenAmountInWallet);

      if (
        !tokenAmountInWallet ||
        Number(tokenAmountInWallet) < Number(amount)
      ) {
        setUpdateSuccess({
          status: 'error',
          message: 'Not enough token amount is in the wallet'
        });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 5_000);

        setIsProcessing(false);
        return;
      }

      if (devMode) {
        const stakeReponse = await fetch('api/stake/stake-node', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            miner_key: device.miner_key,
            asset_id: product.reward.tokens!.node,
            from: session?.user.address,
            to: STAKE_ADDRESS,
            amount: amount
          })
        });

        if (!stakeReponse.ok) {
          setUpdateSuccess({
            status: 'error',
            message:
              'Failed to send transaction. Please contact us before you try again'
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);

          setIsProcessing(false);
          return;
        }

        const stakeResult = await stakeReponse.json();
        const txId = stakeResult.txId;
        console.log(txId);
        const verifyResponse = await fetch('api/stake/verify-node', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            txId: txId,
            miner: device.miner_key,
            asset_id: product.reward.tokens?.node,
            address: session?.user.address,
            amount: amount
          })
        });

        if (!verifyResponse.ok) {
          setUpdateSuccess({
            status: 'error',
            message:
              'Failed to verify transaction. Please contact us before you try again'
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);

          setIsProcessing(false);
          return;
        }
      } else {
        if (!session || !session.user) {
          console.log('Unauthorized');
          return;
        }

        const txId = await sendTransaction(
          activeAddress!,
          STAKE_ADDRESS,
          amount,
          product.reward.tokens?.node ?? 'none'
        );

        if (!txId) {
          setUpdateSuccess({
            status: 'error',
            message:
              'Failed to send transaction. Please contact us before you try again'
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);

          setIsProcessing(false);
          return;
        }

        const verifyResponse = await fetch('api/stake/verify-node', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            txId: txId,
            miner: device.miner_key,
            address: session?.user.address,
            amount: amount,
            asset_id: product.reward.tokens?.node
          })
        });

        if (!verifyResponse.ok) {
          setUpdateSuccess({
            status: 'error',
            message:
              'Failed to verify transaction. Please contact us before you try again'
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);

          setIsProcessing(false);
          return;
        }
      }
    } catch (error) {}

    fetchDeviceInfo(device.miner_key);
    setIsProcessing(false);
  };

  const isAlreadyNode = () => {
    if (device?.is_registered === true || device?.node) {
      return true;
    }

    return false;
  };

  const handleNext = () => {
    router.push({ pathname: '/register', query: { minerKey } });
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
          <Title className="text-white text-5xl">
            Registration Staking & Node Staking
          </Title>
          <p className="text-lg">
            You have to stake for registration with following payments.This will
            be withdrawed automatically when you un-register the devices.
          </p>
        </Flex>
      </div>

      <div className="px-2 sm:px-20">
        <MessageUpdate updateSuccess={updateSuccess} />
      </div>
      <Flex
        justifyContent="center"
        className="mt-20"
        alignItems="center"
        flexDirection="col"
      >
        {needStakeRegister() === true && (
          <div>
            <Flex
              className="w-full gap-3"
              flexDirection="col"
              justifyContent="center"
            >
              <Title className="text-white text-xl sm:text-2xl">{`You have to stake $${product?.reward.stake?.register}USD in ${tokenName}`}</Title>
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
                  'Stake'
                )}
              </Button>
            </Flex>
          </div>
        )}
        {needNodeStake() === true && (
          <div>
            <Flex
              className="w-full gap-3"
              flexDirection="col"
              justifyContent="center"
            >
              <Title className="text-white text-xl sm:text-2xl">{`You have to stake $${product?.reward.stake?.node}USD in ${nodeTokenName}`}</Title>
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
                  'Stake'
                )}
              </Button>
            </Flex>
          </div>
        )}
        {device?.is_registered === true && (
          <Button
            className="mt-10 min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
            onClick={() => handleNext()}
          >
            Next
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
