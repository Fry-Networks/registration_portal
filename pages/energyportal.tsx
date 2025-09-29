import { Button, Flex, Title } from '@tremor/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useModal } from '../app/modalcontext';
import { useToastContext } from '../hooks/ToastContext';

import Image from 'next/image';
import bgImg from '../assets/background.png';
import tapoLogo from '../assets/portals/tapo.png';
import ecowittLogo from '../assets/portals/ecowitt.png';
import shellyLogo from '../assets/portals/shelly.png';
import switchbotLogo from '../assets/portals/switchbot.png';

import ShellyModal from '../components/modals/energy/Shelly';
import EcowittModal from '../components/modals/energy/Ecowitt';
import TapoModal from '../components/modals/energy/Tapo';
import SwitchbotModal from '../components/modals/energy/Switchbot';

const ENERGY_PORTALS = [
  {
    id: 'tapo',
    name: 'Tapo',
    logo: tapoLogo
  },
  {
    id: 'ecowitt',
    name: 'Ecowitt / Froggit / MISOL',
    logo: ecowittLogo
  },
  {
    id: 'shelly',
    name: 'Shelly',
    logo: shellyLogo
  },
  {
    id: 'switchbot',
    name: 'SwitchBot',
    logo: switchbotLogo
  }
];

const EnergyPortal = () => {
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

  const portals = ENERGY_PORTALS;

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

    const hasPortal = portals.some((portal) => portal.id === normalizedPortalType);

    if (!hasPortal) {
      return;
    }

    autoOpenedRef.current = true;
    openModal(normalizedPortalType);
  }, [normalizedPortalType, openModal, portals]);

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

  const handleTapo = async (
    email: string,
    pass: string,
    deviceIP: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitTapo`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            minerKey,
            email,
            pass,
            deviceIP,
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
          query: { minerKey, type: 'tapo' }
        });
      } else {
        if (resolvedPortalType === undefined) {
          await setPortalType(resolvedMinerKey ?? minerKey, 'tapo');
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

  const handleShelly = async (
    authKey: string,
    serverURL: string,
    deviceID: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitShelly`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            minerKey,
            authKey,
            serverURL,
            deviceID,
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
          query: { minerKey, type: 'shelly' }
        });
      } else {
        if (resolvedPortalType === undefined) {
          await setPortalType(resolvedMinerKey ?? minerKey, 'shelly');
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
        if (resolvedPortalType === undefined) {
          await setPortalType(resolvedMinerKey ?? minerKey, 'ecowitt');
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

  const handleSwitchbot = async (
    token: string,
    secret: string,
    deviceId: string
  ): Promise<boolean> => {
    try {
      const response = await fetch('/api/energy/switchbot', {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          miner_key: minerKey,
          token,
          secret,
          deviceId,
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
          query: { minerKey, type: 'switchbot' }
        });
      } else {
        if (resolvedPortalType === undefined) {
          await setPortalType(resolvedMinerKey ?? minerKey, 'switchbot');
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
      const response = await fetch('/api/energy/unregister', {
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
          message: result.message ?? 'Failed to unregister energy credential.'
        });
        return;
      }

      toast.success({
        heading: 'Success',
        message: result.message ?? 'Energy credential removed successfully.'
      });

      const updatedQuery = { ...router.query } as Record<string, string | string[]>;
      delete updatedQuery.portalType;
      delete updatedQuery.onlyPortal;

      await router.replace(
        { pathname: router.pathname, query: updatedQuery },
        undefined,
        { shallow: true }
      );
    } catch (error) {
      console.error('[energyportal] unregister error', error);
      toast.error({
        heading: 'Error',
        message: 'Failed to unregister energy credential.'
      });
    } finally {
      setIsUnregistering(false);
    }
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
            Energy Portal
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
                if (!isEditMode && resolvedMinerKey && session?.user.address) {
                  await fetch('/api/registrations/cancel', {
                    method: 'POST',
                    headers: { 'Content-type': 'application/json' },
                    body: JSON.stringify({
                      miner_key: resolvedMinerKey,
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
                  <span className="block text-xs text-gray-500 mt-1 text-center">
                    (Unavailable)
                  </span>
                )}
              </Title>
            </div>
          );
        })}
      </Flex>
      <TapoModal modalName={'tapo'} minerKey={minerKey} handle={handleTapo} />
      <EcowittModal
        modalName={'ecowitt'}
        minerKey={minerKey}
        handle={handleEcowitt}
      />
      <ShellyModal
        modalName={'shelly'}
        minerKey={minerKey}
        handle={handleShelly}
      />
      <SwitchbotModal
        modalName={'switchbot'}
        minerKey={minerKey}
        address={session?.user.address}
        handle={handleSwitchbot}
      />
    </div>
  );
};

export default EnergyPortal;
