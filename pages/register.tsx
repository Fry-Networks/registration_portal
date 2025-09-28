import React, { useEffect, useMemo, useState, useRef } from 'react';
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
  const { minerKey, clickable, type } = router.query;

  const isEditingExisting = useMemo(() => {
    if (typeof clickable === 'string') {
      const normalized = clickable.toLowerCase();
      return normalized === 'true' || normalized === '1';
    }

    if (Array.isArray(clickable)) {
      return clickable.some((value) => {
        if (typeof value !== 'string') return false;
        const normalized = value.toLowerCase();
        return normalized === 'true' || normalized === '1';
      });
    }

    return Boolean(clickable);
  }, [clickable]);
  const hasFetchedRef = useRef(false);
  const savingRef = useRef(false);
  const lastAttemptRef = useRef<string | null>(null);

  const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

  const resolvedMinerKey = useMemo(() => {
    if (typeof minerKey === 'string') {
      return minerKey;
    }

    if (Array.isArray(minerKey) && minerKey.length > 0) {
      return minerKey[0];
    }

    return undefined;
  }, [minerKey]);

  const resolvedPortalType = useMemo(() => {
    if (typeof type === 'string') {
      return type;
    }

    if (Array.isArray(type) && type.length > 0) {
      return type[0];
    }

    return undefined;
  }, [type]);
  const [device, setDevice] = useState<Device | undefined>(undefined);
  const [product, setProduct] = useState<Product | undefined>(undefined);
  const toast = useToastContext();
  const { data: session } = useSession();

  // Effect A: fetch device when identity changes
  useEffect(() => {
    if (!resolvedMinerKey || !session?.user?.address) return;

    hasFetchedRef.current = false; // reset when identity changes

    (async () => {
      try {
        const res = await fetch(`/api/devices/${resolvedMinerKey}`, {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ address: session.user.address }),
        });
        if (res.ok) {
          const data = await res.json();
          setDevice(data.device as Device);
        } else {
          setDevice(undefined);
        }
      } catch (e) {
        console.error(e);
        setDevice(undefined);
      } finally {
        hasFetchedRef.current = true; // <-- important
      }
    })();
  }, [resolvedMinerKey, session?.user?.address]);

  // Effect B: only save portal type if it actually needs saving
  useEffect(() => {
    if (!resolvedMinerKey || !session?.user?.address || !resolvedPortalType) return;

    // wait until we fetched at least once for this identity
    if (!hasFetchedRef.current) return;

    const desired = norm(resolvedPortalType);
    const current = norm(device?.registered_portal_model);

    // already matches? do nothing
    if (current === desired) return;

    // avoid concurrent saves or repeating the same attempt
    const attemptKey = `${resolvedMinerKey}|${desired}`;
    if (savingRef.current) return;
    if (lastAttemptRef.current === attemptKey) return;

    savingRef.current = true;
    lastAttemptRef.current = attemptKey;

    (async () => {
      try {
        const res = await fetch(`/api/devices/save-portal-type`, {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            miner_key: resolvedMinerKey,
            type: desired, // send normalized
            address: session.user.address,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setDevice(data.device as Device); // should now echo registered_portal_model
          toast.success({ heading: 'Success', message: 'Device information updated successfully' });
        } else {
          lastAttemptRef.current = null; // allow retry
          toast.error({ heading: 'Error', message: 'Failed to update device information for portal type' });
        }
      } catch (e) {
        console.error(e);
        lastAttemptRef.current = null; // allow retry
        toast.error({ heading: 'Error', message: 'Failed to update device information for portal type' });
      } finally {
        savingRef.current = false;
      }
    })();
  }, [resolvedMinerKey, resolvedPortalType, session?.user?.address, device?.registered_portal_model]);


  const findProduct = (minerKey: string) => {
    const key = minerKey.split('-')[0];

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
        reward_wallet: device.reward_wallet ?? ''
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

      // ...existing code...
    }

    // ...existing code...
  }, [device]);

  // State for each form's data
  const [deviceInfoData, setDeviceInfoData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    nickname: ''
  });
  const [walletInfoData, setWalletInfoData] = useState({
    reward_wallet: ''
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
    if (!resolvedMinerKey) {
      toast.error({ heading: 'Error', message: 'Miner key is missing.' });

      return false;
    }

    if (!session?.user.address) {
      toast.error({
        heading: 'Error',
        message: 'Your wallet session has expired.'
      });

      return false;
    }

    const saveData = {
      miner_key: resolvedMinerKey,

      email: deviceInfoData.email,

      names: {
        first_name: deviceInfoData.firstName,

        last_name: deviceInfoData.lastName
      },

      nickname: deviceInfoData.nickname,

      address: session.user.address
    };

    const response = await fetch('/api/devices/save-device-info', {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      credentials: 'include',

      body: JSON.stringify(saveData)
    });

    if (response.ok) {
      toast.success({
        heading: 'Success',

        message: 'Device information saved successfully'
      });

      return true;
    }

    toast.error({
      heading: 'Error',

      message: 'Failed to save device information'
    });

    return false;
  };

  const saveWalletInformation = async (): Promise<boolean> => {
    if (!resolvedMinerKey) {
      toast.error({ heading: 'Error', message: 'Miner key is missing.' });

      return false;
    }

    if (!session?.user.address) {
      toast.error({
        heading: 'Error',
        message: 'Your wallet session has expired.'
      });

      return false;
    }

    try {
      const saveData = {
        miner_key: resolvedMinerKey,

        reward_wallet: walletInfoData.reward_wallet,

        address: session.user.address
      };

      const response = await fetch('/api/devices/save-wallet-info', {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        credentials: 'include',

        body: JSON.stringify(saveData)
      });

      if (response.ok) {
        toast.success({
          heading: 'Success',

          message: 'Save wallet information successfully'
        });

        return true;
      }

      toast.error({
        heading: 'Error',

        message: 'Failed to save wallet information'
      });

      return false;
    } catch (error) {
      toast.error({
        heading: 'Error',

        message: 'Failed to save wallet information'
      });

      return false;
    }
  };

  const saveMapInformation = async (): Promise<boolean> => {
    if (!resolvedMinerKey) {
      toast.error({ heading: 'Error', message: 'Miner key is missing.' });

      return false;
    }

    if (!session?.user.address) {
      toast.error({
        heading: 'Error',
        message: 'Your wallet session has expired.'
      });

      return false;
    }

    try {
      const saveData = {
        miner_key: resolvedMinerKey,

        position: {
          lat: mapInfoData.latitude,

          lng: mapInfoData.longitude
        },

        address: session.user.address
      };

      const response = await fetch('/api/devices/save-map-info', {
        method: 'POST',

        body: JSON.stringify(saveData),

        headers: { 'Content-Type': 'application/json' },

        credentials: 'include'
      });

      if (response.ok) {
        toast.success({
          heading: 'Success',

          message: 'Save map information successfully'
        });

        return true;
      }

      toast.error({
        heading: 'Error',

        message: 'Failed to save map information'
      });

      return false;
    } catch (error) {
      toast.error({
        heading: 'Error',

        message: 'Failed to save map information'
      });

      return false;
    }
  };

  const registerDevice = async () => {
    if (!resolvedMinerKey) {
      toast.error({ heading: 'Error', message: 'Miner key is missing.' });

      return;
    }

    const stepsSucceeded =
      (await saveDeviceInformation()) &&
      (await saveWalletInformation()) &&
      (await saveMapInformation());

    if (!stepsSucceeded) {
      return;
    }

    if (!clickable) {
      if (!session?.user.address) {
        toast.error({
          heading: 'Error',
          message: 'Your wallet session has expired.'
        });

        return;
      }

      const response = await fetch('/api/registrations/register', {
        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        credentials: 'include',

        body: JSON.stringify({
          miner_key: resolvedMinerKey,

          address: session.user.address,

          type: resolvedPortalType
        })
      });

      if (!response.ok) {
        toast.error({
          heading: 'Error',

          message: 'Failed to register device'
        });

        return;
      }
    }

    const product = device && findProductByMinerKey(device.miner_key, products);

    if (
      product &&
      (isRegistrationNeeded(product) || isNodeStakingNeeded(product))
    ) {
      router.push({
        pathname: '/pay-register',

        query: { minerKey: resolvedMinerKey }
      });

      return;
    }

    router.push('/devices');
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

  const handleCancel = async () => {
    const isFullyRegistered = device?.is_registered === true || isEditingExisting;

    if (!isFullyRegistered && resolvedMinerKey && session?.user.address) {
      try {
        await fetch('/api/registrations/cancel', {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            miner_key: resolvedMinerKey,
            address: session.user.address
          })
        });
      } catch (e) {
        // swallow cancel errors
      }
    }

    router.push('/devices');
  };

  const handleSkip = () => {
    if (isEditingExisting) {
      handleCancel();
      return;
    }

    if (currentSection > 0) {
      setCurrentSection((prev) => prev - 1);
    } else {
      router.push('/devices');
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
              minerKey={resolvedMinerKey ?? ''}
              data={deviceInfoData}
              setData={setDeviceInfoData}
              onNext={handleNext}
              onSkip={handleSkip}
              onCancel={handleCancel}
            />
          </div>
          <div className="flex-shrink-0 w-full h-full">
            <WalletInfo
              status={walletStatus}
              minerKey={resolvedMinerKey ?? ''}
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
              minerKey={resolvedMinerKey ?? ''}
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

