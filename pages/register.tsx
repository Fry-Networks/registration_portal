import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Sidebar from '../components/Sidebar';
import DeviceInfo from '../components/DeviceInfo';
import MapInfo from '../components/MapInfo';
import Stake from '../components/modals/Stake';
import { ChevronRightIcon } from '@heroicons/react/outline';
import WalletInfo from '../components/WalletInfo';
import { Device, Product } from '../lib/types';
import { getSession, useSession } from 'next-auth/react';
import clientPromise from '../lib/mongoclient';
import { useToastContext } from '../hooks/ToastContext';
import { isNodeStakingNeeded, isRegistrationNeeded } from '../lib/utils';
import { findProductByMinerKey } from './devices';

export default ({ products }: { products: Product[] }) => {
  const router = useRouter();
  const [currentSection, setCurrentSection] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState(false);
  const [locationStatus, setLocationStatus] = useState(false);
  const [stakeStatus, setStakeStatus] = useState(false);
  const [walletStatus, setWalletStatus] = useState(false);
  const { minerKey, clickable } = router.query;
  const [device, setDevice] = useState<Device | undefined>(undefined);
  const [product, setProduct] = useState<Product | undefined>(undefined);
  const toast = useToastContext();
  const { data: session } = useSession();

  console.log(`MinerKey: ${minerKey}`);

  useEffect(() => {
    if (!minerKey || typeof minerKey !== 'string') {
      return;
    }

    const fetchDeviceInfo = async (minerKey: string) => {
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

    fetchDeviceInfo(minerKey);
  }, [minerKey]);

  const findProduct = (minerKey: string) => {
    const key = minerKey.split('-')[0];
    console.log(key);

    const specificProduct = products.find((product) => {
      return product.key === key;
    });

    return specificProduct;
  };

  const isDeviceInfoOk = () => {
    deviceInfoData;
  };

  useEffect(() => {
    if (device === undefined || !session || !session.user) {
      return;
    }

    setProduct(findProduct(device.miner_key));

    if (clickable) {
      setDeviceInfoData({
        email: device.email,
        firstName: device.names?.first_name ?? '',
        lastName: device.names?.last_name ?? '',
        nickname: device.nickname ?? ''
      });

      setWalletInfoData({
        reward_wallet: device.reward_wallet ?? '',
        connectivity_wallet: device.connectivity_wallet ?? '',
        note: device.note ?? ''
      });

      setMapInfoData({
        latitude: device.position?.lat.toString() ?? '',
        longitude: device.position?.lng.toString() ?? ''
      });

      setDeviceStatus(true);
      setWalletStatus(true);
      setLocationStatus(true);
    } else {
      setDeviceInfoData({
        email: session.user.email,
        firstName: session.user.first_name ?? '',
        lastName: session.user.last_name ?? '',
        nickname: ''
      });

      setWalletInfoData({
        ...walletInfoData,
        connectivity_wallet: session.user.poc_wallet
      });
    }

    if (!device.connectivity_wallet || device.connectivity_wallet.length < 0) {
      setWalletInfoData({
        ...walletInfoData,
        connectivity_wallet: session.user.poc_wallet
      });
    }
  }, [device]);

  // State for each form's data
  const [deviceInfoData, setDeviceInfoData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    nickname: ''
  });
  const [walletInfoData, setWalletInfoData] = useState({
    reward_wallet: '',
    connectivity_wallet: '',
    note: ''
  });

  const [mapInfoData, setMapInfoData] = useState({
    latitude: '',
    longitude: ''
  });

  const sections = [
    { id: 0, title: 'Device Information' },
    { id: 1, title: 'Wallet Information' },
    { id: 2, title: 'Map Information' }
  ];

  const saveDeviceInformation = async (): Promise<boolean> => {
    const saveData = {
      miner_key: minerKey,
      email: deviceInfoData.email,
      names: {
        first_name: deviceInfoData.firstName,
        last_name: deviceInfoData.lastName
      },
      nickname: deviceInfoData.nickname,
      address: session?.user.address
    };

    console.log(saveData);

    const response = await fetch('/api/devices/save-device-info', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(saveData)
    });

    if (response.ok) {
      toast.success({
        heading: 'Success',
        message: 'Device information saved successfully'
      });
      return true;
    } else {
      toast.error({
        heading: 'Error',
        message: 'Failed to save device information'
      });

      return false;
    }
  };

  const saveWalletInformation = async (): Promise<boolean> => {
    try {
      const saveData = {
        miner_key: minerKey,
        reward_wallet: walletInfoData.reward_wallet,
        connectivity_wallet: walletInfoData.connectivity_wallet,
        note: walletInfoData.note,
        address: session?.user.address
      };
      const response = await fetch('/api/devices/save-wallet-info', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(saveData)
      });

      if (response.ok) {
        toast.success({
          heading: 'Success',
          message: 'Save wallet information successfully'
        });
        return true;
      } else {
        toast.error({
          heading: 'Error',
          message: 'Failed to save wallet information'
        });

        return false;
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message: 'Failed to save wallet information'
      });

      return false;
    }
  };

  const saveMapInformation = async (): Promise<boolean> => {
    try {
      const saveData = {
        miner_key: minerKey,
        position: {
          lat: mapInfoData.latitude,
          lng: mapInfoData.longitude
        },
        address: session?.user.address
      };
      // Optionally send to backend
      const response = await fetch('/api/devices/save-map-info', {
        method: 'POST',
        body: JSON.stringify(saveData),
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        toast.success({
          heading: 'Success',
          message: 'Save map information successfully'
        });
      } else {
        toast.error({
          heading: 'Error',
          message: 'Failed to save wallet information'
        });

        return false;
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message: 'Failed to save wallet information'
      });
      return false;
    }

    return true;
  };

  const registerDevice = async () => {
    let result = true;
    result = await saveDeviceInformation();
    result = result && (await saveWalletInformation());
    result = result && (await saveMapInformation());

    console.log('Saving information result: ' + result);

    if (result) {
      const response = await fetch('api/registrations/register', {
        method: 'POST',
        body: JSON.stringify({
          miner_key: minerKey,
          address: session?.user.address
        }),
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        toast.error({
          heading: 'Error',
          message: 'Failed to register device'
        });

        return;
      }

      const product = findProductByMinerKey(device!.miner_key, products);
      if (
        product &&
        isRegistrationNeeded(product) &&
        isNodeStakingNeeded(product)
      ) {
        router.push({ pathname: '/pay-register', query: { minerKey } });
      } else {
        router.push('/devices');
      }
    }
  };

  const handleNext = () => {
    switch (currentSection) {
      case 0:
        setDeviceStatus(true);
        break;
      case 1:
        setWalletStatus(true);
        break;
      case 2:
        setLocationStatus(true);
        break;
      default:
        break;
    }
    if (currentSection < sections.length - 1) {
      setCurrentSection((prev) => prev + 1);
    } else {
      registerDevice();
    }
  };

  const handleSkip = () => {
    if (currentSection > 0) {
      setCurrentSection((prev) => prev - 1);
    } else {
      router.push('/devices');
    }
  };

  const handleCancel = () => {
    router.push('/devices');
  }

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <div className="flex h-[calc(100vh-96px)] overflow-hidden">
      <Sidebar
        completionStatus={{
          device: deviceStatus,
          wallet: walletStatus,
          map: locationStatus
        }}
        isOpen={isSidebarOpen}
        toggleSidebar={toggleSidebar}
        setCurrentSection={setCurrentSection} // Added to handle sidebar navigation
        currentSection={currentSection}
      />
      {!isSidebarOpen && (
        <button
          onClick={toggleSidebar}
          className="fixed top-1/2 left-1 z-50 transform -translate-y-1/2 flex flex-col space-y-1 md:hidden"
        >
          <ChevronRightIcon className="h-6 w-6" />
        </button>
      )}

      <div className="relative w-full h-full overflow-hidden">
        <div
          className="flex h-full w-full transition-transform duration-700 ease-in-out"
          style={{
            transform: `translateX(-${currentSection * 100}%)`
          }}
        >
          <div className="flex-shrink-0 w-full h-full">
            <DeviceInfo
              status={deviceStatus}
              minerKey={minerKey}
              data={deviceInfoData}
              setData={setDeviceInfoData}
              onNext={handleNext}
              onSkip={handleSkip}
            />
          </div>
          <div className="flex-shrink-0 w-full h-full">
            <WalletInfo
              status={walletStatus}
              minerKey={minerKey}
              data={walletInfoData}
              setData={setWalletInfoData}
              onNext={handleNext}
              onSkip={handleSkip}
              onCancel={handleCancel}
              asset_id={product?.reward.tokens?.reward}
            />
          </div>
          <div className="flex-shrink-0 w-full h-full">
            <MapInfo
              status={locationStatus}
              minerKey={minerKey}
              data={mapInfoData}
              setData={setMapInfoData}
              onNext={handleNext}
              onSkip={handleSkip}
              onCancel={handleCancel}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

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
