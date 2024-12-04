import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Sidebar from '../components/Sidebar';
import DeviceInfo from '../components/DeviceInfo';
import MapInfo from '../components/MapInfo';
import Stake from '../components/modals/Stake';
import { ChevronRightIcon } from '@heroicons/react/outline';
import WalletInfo from '../components/WalletInfo';
import { Device } from '../lib/types';
import { getSession } from 'next-auth/react';
import clientPromise from '../lib/mongoclient';
import { Product } from './api/stake/verify-stake';

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

  console.log(`MinerKey: ${minerKey}`);

  useEffect(() => {
    if (!minerKey || typeof minerKey !== 'string') {
      return;
    }

    console.log(minerKey);

    const fetchDeviceInfo = async (minerKey: string) => {
      console.log(minerKey);
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
  }, [minerKey, currentSection]);

  const findProduct = (minerKey: string) => {
    const key = minerKey.split('-')[0];
    console.log(key);

    const specificProduct = products.find((product) => {
      return product.key === key;
    });

    return specificProduct;
  };

  useEffect(() => {
    if (device === undefined) {
      return;
    }

    setProduct(findProduct(device.miner_key));

    setDeviceStatus(isDeviceInfoInputed());
    setWalletStatus(isWalletInfoInputed());
    setLocationStatus(isMapinfoInputed());
    setStakeStatus(isStaked());

    setDeviceInfoData({
      email: device.email,
      firstName: device.names ? device.names.first_name : '',
      lastName: device.names ? device.names.last_name : '',
      nickname: device.nickname ? device.nickname : ''
    });

    setWalletInfoData({
      reward_wallet: device.reward_wallet ? device.reward_wallet : '',
      connectivity_wallet: device.connectivity_wallet
        ? device.connectivity_wallet
        : '',
      note: device.note ?? ''
    });

    setMapInfoData({
      latitude: device.position ? device.position.lat.toString() : '0',
      longitude: device.position ? device.position.lng.toString() : '0'
    });
  }, [device]);

  const isDeviceInfoInputed = () => {
    if (!device) {
      return false;
    }

    if (
      device.is_registered &&
      device.names?.first_name &&
      device.names.last_name &&
      device.email
    ) {
      return true;
    }

    return false;
  };

  const isMapinfoInputed = () => {
    if (!device) {
      return false;
    }

    if (!device.position) {
      return false;
    }

    return true;
  };

  const isWalletInfoInputed = () => {
    if (!device) {
      return false;
    }

    if (!device.reward_wallet || device.reward_wallet.length <= 0) {
      return false;
    }

    if (!device.connectivity_wallet || device.connectivity_wallet.length <= 0) {
      return false;
    }

    return true;
  };

  const isStaked = () => {
    if (!device) {
      return false;
    }

    if (!device.verified) {
      return false;
    }

    return true;
  };
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
      router.push('/devices');
    }
  };

  const handleSkip = () => {
    if (currentSection < sections.length - 1) {
      setCurrentSection((prev) => prev + 1);
    } else {
      router.push('/');
    }
  };

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
        isClickable={clickable === 'true'}
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
              status={isDeviceInfoInputed()}
              minerKey={minerKey}
              data={deviceInfoData}
              setData={setDeviceInfoData}
              onNext={handleNext}
              onSkip={handleSkip}
            />
          </div>
          <div className="flex-shrink-0 w-full h-full">
            <WalletInfo
              status={isWalletInfoInputed()}
              minerKey={minerKey}
              data={walletInfoData}
              setData={setWalletInfoData}
              onNext={handleNext}
              onSkip={handleSkip}
              asset_id={product?.reward.tokens?.reward}
            />
          </div>
          <div className="flex-shrink-0 w-full h-full">
            <MapInfo
              status={isMapinfoInputed}
              minerKey={minerKey}
              data={mapInfoData}
              setData={setMapInfoData}
              onNext={handleNext}
              onSkip={handleSkip}
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
