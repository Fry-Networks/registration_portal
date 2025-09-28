import { Button, Flex, Title } from '@tremor/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useModal } from '../app/modalcontext';
import { useToastContext } from '../hooks/ToastContext';

import Image from 'next/image';
import bgImg from '../assets/background.png';
import ambientLogo from '../assets/portals/ambient.png';
import ecowittLogo from '../assets/portals/ecowitt.png';
import weatherxmLogo from '../assets/portals/weatherxm.png';
import lacrosseLogo from '../assets/portals/lacrosse.jpg';
import sensecapLogo from '../assets/portals/sensecap.webp';
import tempestlogo from '../assets/portals/tempest.png';

import AmbientModal from '../components/modals/weather/Ambient';
import EcowittModal from '../components/modals/weather/Ecowitt';
import WeatherXMModal from '../components/modals/weather/WeatherXM';
import LacrosseModal from '../components/modals/weather/Lacrosse';
import SensecapModal from '../components/modals/weather/Sensecap';
import TempestModal from '../components/modals/weather/Tempest';


const WEATHER_PORTALS = [
  {
    id: 'ambient',
    name: 'Ambient',
    logo: ambientLogo
  },
  {
    id: 'ecowitt',
    name: 'Ecowitt / Froggit / MISOL',
    logo: ecowittLogo
  },
  {
    id: 'weatherxm',
    name: 'Weather-XM',
    logo: weatherxmLogo
  },
  {
    id: 'lacrosse',
    name: 'Lacrosse',
    logo: lacrosseLogo
  },
  {
    id: 'sensecap',
    name: 'Sensecap',
    logo: sensecapLogo
  },
  // adding Tempest
  {
    id: 'tempest',
    name: 'Tempest',
    logo: tempestlogo
  }
];

const WeatherPortal = () => {
  const router = useRouter();
  const { data: session } = useSession();
  const { openModal } = useModal();
  const toast = useToastContext();
  const { minerKey, portalType, onlyPortal } = router.query;

  const isEditMode = useMemo(() => {
    if (typeof onlyPortal === 'string') {
      const normalized = onlyPortal.toLowerCase();
      return normalized === 'true' || normalized === '1';
    }

    if (Array.isArray(onlyPortal)) {
      return onlyPortal.some((value) => {
        if (typeof value !== 'string') return false;
        const normalized = value.toLowerCase();
        return normalized === 'true' || normalized === '1';
      });
    }

    return Boolean(onlyPortal);
  }, [onlyPortal]);

  const resolvedMinerKey =
    typeof minerKey === 'string'
      ? minerKey
      : Array.isArray(minerKey)
        ? minerKey[0]
        : undefined;

  const resolvedPortalType =
    typeof portalType === 'string'
      ? portalType
      : Array.isArray(portalType)
        ? portalType[0]
        : undefined;

  const normalizedPortalType = resolvedPortalType?.toLowerCase();
  const [isUnregistering, setIsUnregistering] = useState(false);
  const autoOpenedRef = useRef(false);

  const portals = WEATHER_PORTALS;

  const handleModal = (id: string) => {
    openModal(id);
  };

  // Check if a portal is available based on portalType

  const isPortalAvailable = (portalId: string) => {
    if (!normalizedPortalType) return true;

    return portalId === normalizedPortalType;
  };

  const handlePortalClick = (portalId: string) => {
    if (isPortalAvailable(portalId)) {
      handleModal(portalId);
    }
  };

  useEffect(() => {
    if (!normalizedPortalType || autoOpenedRef.current) {
      return;
    }

    const hasPortal = portals.some(
      (portal) => portal.id === normalizedPortalType
    );

    if (!hasPortal) {
      return;
    }

    autoOpenedRef.current = true;
    openModal(normalizedPortalType);
  }, [normalizedPortalType, openModal, portals]);

  const handleUnregister = async () => {
    if (!resolvedMinerKey || !resolvedPortalType || !session?.user.address) {
      toast.error({
        heading: 'Error',

        message: 'Missing device details for unregistering.'
      });

      return;
    }

    setIsUnregistering(true);

    try {
      const response = await fetch('/api/weather/unregister', {
        method: 'POST',

        headers: { 'Content-type': 'application/json' },

        credentials: 'include',

        body: JSON.stringify({
          miner_key: resolvedMinerKey,

          api_type: resolvedPortalType,

          address: session.user.address
        })
      });

      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
      };

      if (!response.ok) {
        toast.error({
          heading: 'Error',

          message: result.message ?? 'Failed to unregister weather credential.'
        });

        return;
      }

      toast.success({
        heading: 'Success',

        message: result.message ?? 'Weather credential removed successfully.'
      });

      const updatedQuery = { ...router.query } as Record<
        string,
        string | string[]
      >;

      delete updatedQuery.portalType;

      delete updatedQuery.onlyPortal;

      await router.replace(
        { pathname: router.pathname, query: updatedQuery },

        undefined,

        { shallow: true }
      );
    } catch (error) {
      console.error(error);

      toast.error({
        heading: 'Error',

        message: 'Failed to unregister weather credential. Please try again.'
      });
    } finally {
      setIsUnregistering(false);
    }
  };

  const setPortalType = async (
    minerKey: string | string[] | undefined,

    type: string
  ) => {
    try {
      const response = await fetch(`/api/devices/save-portal-type`, {
        method: 'POST',

        headers: { 'Content-type': 'application/json' },

        body: JSON.stringify({
          miner_key: minerKey,

          type,

          address: session?.user.address
        })
      });

      if (response.ok) {
        toast.success({
          heading: 'Success',

          message: 'Device information updated successfully'
        });
      } else {
        toast.error({
          heading: 'Error',

          message: 'Failed to update device information for portal type'
        });
      }
    } catch (error) {
      console.error(error);

      toast.error({
        heading: 'Error',

        message: 'Failed to update device information for portal type'
      });
    }
  };

  const handleAmbient = async (apiKey: string): Promise<boolean> => {
    try {
      // const response = await fetch(`http://${process.env.NEXT_PUBLIC_API_HOST}:${process.env.NEXT_PUBLIC_AIR_API_PORT}/api/submitkey`, {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitkey`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            key: apiKey,
            address: session?.user.address
          })
        }
      );

      const result = await response.json();
      if (!response.ok) {
        toast.error({ heading: 'Error', message: result.message });
        return false;
      } else {
        toast.success({ heading: 'Success', message: result.message });
      }

      if (!onlyPortal) {
        router.push({
          pathname: '/register',
          query: { minerKey, type: 'ambient' }
        });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'ambient');
        }
        router.push('/devices');
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'We were unable to verify your key. Please try again later, if the problem persists, open a ticket on FryNetworks Discord.'
      });
      return false;
    }
    return true;
  };

  const handleEcowitt = async (
    apiKey: string,
    appKey: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitEcokey`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            apiKey,
            appKey,
            address: session?.user.address
          })
        }
      );

      const result = await response.json();
      if (!response.ok) {
        toast.error({ heading: 'Error', message: result.message });
        return false;
      } else {
        toast.success({ heading: 'Success', message: result.message });
      }

      if (!onlyPortal) {
        router.push({
          pathname: '/register',
          query: { minerKey, type: 'ecowitt' }
        });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'ecowitt');
        }
        router.push('/devices');
      }
    } catch (error) {
      console.log('handleEcowitt : ', error);
      toast.error({
        heading: 'Error',
        message:
          'We were unable to verify your key. Please try again later, if the problem persists, open a ticket on FryNetworks Discord.'
      });
      return false;
    }
    return true;
  };

  const handleWeatherXM = async (
    username: string,
    password: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitXMToken`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            username,
            password,
            address: session?.user.address
          })
        }
      );

      const result = await response.json();
      if (!response.ok) {
        toast.error({ heading: 'Error', message: result.message });
        return false;
      } else {
        toast.success({ heading: 'Success', message: result.message });
      }

      if (!onlyPortal) {
        router.push({
          pathname: '/register',
          query: { minerKey, type: 'weatherxm' }
        });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'weatherxm');
        }
        router.push('/devices');
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'We were unable to verify your key. Please try again later, if the problem persists, open a ticket on FryNetworks Discord.'
      });
      return false;
    }
    return true;
  };

  const handleLacrosse = async (
    email: string,
    password: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/getTemperature`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            email,
            password,
            address: session?.user.address
          })
        }
      );

      const result = await response.json();
      if (!response.ok) {
        toast.error({ heading: 'Error', message: result.message });
        return false;
      } else {
        toast.success({ heading: 'Success', message: result.message });
      }

      if (!onlyPortal) {
        router.push({
          pathname: '/register',
          query: { minerKey, type: 'lacrosse' }
        });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'lacrosse');
        }
        router.push('/devices');
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'We were unable to verify your key. Please try again later, if the problem persists, open a ticket on FryNetworks Discord.'
      });
      return false;
    }
    return true;
  };

  const handleSensecap = async (
    deviceId: string,
    token: string,
    apiKey: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitSenseCAPKey`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            username: token,
            password: apiKey,
            deviceId,
            address: session?.user.address
          })
        }
      );

      const result = await response.json();
      if (!response.ok) {
        toast.error({ heading: 'Error', message: result.message });
        return false;
      } else {
        toast.success({ heading: 'Success', message: result.message });
      }

      if (!onlyPortal) {
        router.push({
          pathname: '/register',
          query: { minerKey, type: 'sensecap' }
        });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'sensecap');
        }
        router.push('/devices');
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'We were unable to verify your key. Please try again later, if the problem persists, open a ticket on FryNetworks Discord.'
      });
      return false;
    }
    return true;
  };

  const handleTempest = async (
    stationID: string,
    token: string
  ): Promise<boolean> => {
    try {
      const response = await fetch('/api/weather/tempest', {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          miner_key: minerKey,
          stationID,
          token,
          address: session?.user.address
        })
      });

      const result = await response.json();
      if (!response.ok) {
        toast.error({ heading: 'Error', message: result.message });
        return false;
      } else {
        toast.success({ heading: 'Success', message: result.message });
      }

      if (!onlyPortal) {
        router.push({
          pathname: '/register',
          query: { minerKey, type: 'tempest' }
        });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'tempest');
        }
        router.push('/devices');
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'We were unable to verify your key. Please try again later, if the problem persists, open a ticket on FryNetworks Discord.'
      });
      return false;
    }
    return true;
  };

  return (
    <div className="w-full">
      <div className="relative flex">
        <Image
          src={bgImg}
          className="w-full h-[30vh] object-cover"
          alt="Background Image"
        />
        <Flex
          flexDirection="col"
          className="absolute w-full h-full justify-center gap-6"
        >
          <Title className="text-white text-4xl sm:text-5xl w-full text-center">
            Weather Portal
          </Title>
          <p className="text-lg text-center px-2 text-gray-300">
            You can register your miners to onboard on Fry Networks and can
            verify and manage miner information here.
          </p>
        </Flex>
      </div>
      <div className="px-2 sm:px-20">
        <Flex className="mt-6 gap-3 flex-wrap" justifyContent="start">
          <Button
            className="min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
            onClick={async () => {
              try {
                const key =
                  typeof minerKey === 'string'
                    ? minerKey
                    : Array.isArray(minerKey)
                      ? minerKey[0]
                      : undefined;

                if (!isEditMode && key && session?.user.address) {
                  await fetch('/api/registrations/cancel', {
                    method: 'POST',
                    headers: { 'Content-type': 'application/json' },
                    body: JSON.stringify({
                      miner_key: key,
                      address: session.user.address
                    })
                  });
                }
              } catch (e) {
                // ignore cancel failures for navigation
              } finally {
                router.push('/devices');
              }
            }}
          >
            Back
          </Button>
          {resolvedPortalType && (
            <Button
              className="min-w-[150px] bg-transparent border-slate-500 text-slate-200 hover:bg-slate-600 hover:border-slate-600"
              onClick={handleUnregister}
              disabled={isUnregistering}
            >
              {isUnregistering ? 'Unlinking...' : 'Unlink'}
            </Button>
          )}
        </Flex>
      </div>
      <Flex
        flexDirection="row"
        justifyContent="evenly"
        className="flex-wrap gap-24 px-2 sm:px-20 mt-10"
      >
        {portals.map((portal, index) => {
          const color =
            index % 3 === 0 ? 'gray' : index % 3 === 1 ? 'green' : 'red';
          const isAvailable = isPortalAvailable(portal.id);

          return (
            <div
              onClick={() => handlePortalClick(portal.id)}
              key={portal.name}
              className={`${isAvailable ? 'cursor-pointer' : 'cursor-not-allowed'} flex flex-col items-center justify-center rounded-xl p-5 bg-neutral-950 shadow-md shadow-${color}-600 min-w-[200px] w-full sm:w-auto gap-2 ${!isAvailable ? 'opacity-50' : ''}`}
            >
              <Image
                src={portal.logo}
                className="w-36 h-24 object-contain"
                alt={`${portal.name} Logo`}
              />
              <Title
                className={`${isAvailable ? 'text-white' : 'text-gray-400'} text-center`}
              >
                {portal.name}
                {!isAvailable && (
                  <span className="block text-center text-xs text-gray-500 mt-1">
                    (Unavailable)
                  </span>
                )}
              </Title>
            </div>
          );
        })}
      </Flex>
      <AmbientModal
        modalName={'ambient'}
        minerKey={minerKey}
        handle={handleAmbient}
      />
      <EcowittModal
        modalName={'ecowitt'}
        minerKey={minerKey}
        handle={handleEcowitt}
      />
      <WeatherXMModal
        modalName={'weatherxm'}
        minerKey={minerKey}
        handle={handleWeatherXM}
      />
      <LacrosseModal
        modalName={'lacrosse'}
        minerKey={minerKey}
        handle={handleLacrosse}
      />
      <SensecapModal
        modalName={'sensecap'}
        minerKey={minerKey}
        handle={handleSensecap}
      />
      <TempestModal
        modalName={'tempest'}
        minerKey={minerKey}
        handle={handleTempest}
      />
    </div>
  );
};

export default WeatherPortal;
