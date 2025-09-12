import { Button, Flex, Title } from '@tremor/react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useModal } from '../app/modalcontext';
import { useToastContext } from '../hooks/ToastContext';

import Image from 'next/image';
import bgImg from '../assets/background.png';
import tapoLogo from '../assets/portals/tapo.png';
import ecowittLogo from '../assets/portals/ecowitt.png';
import shellyLogo from '../assets/portals/shelly.png';

import ShellyModal from '../components/modals/energy/Shelly';
import EcowittModal from '../components/modals/energy/Ecowitt';
import TapoModal from '../components/modals/energy/Tapo';

const EnergyPortal = () => {
  const router = useRouter();
  const { data: session } = useSession();
  const { openModal } = useModal();
  const toast = useToastContext();
  const { minerKey, portalType, onlyPortal } = router.query;

  const portals = [
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
    }
  ];

  const handleModal = (id: string) => {
    openModal(id);
  };

  // Check if a portal is available based on portalType
  const isPortalAvailable = (portalId: string) => {
    // If no portalType is specified, all portals are available
    if (!portalType) return true;

    // Check if the portal ID matches the portalType
    return portalId === portalType;
  };

  const handlePortalClick = (portalId: string) => {
    if (isPortalAvailable(portalId)) {
      handleModal(portalId);
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
        if (portalType === undefined) {
          await setPortalType(minerKey, 'tapo');
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
        if (portalType === undefined) {
          await setPortalType(minerKey, 'shelly');
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
            Energy Portal
          </Title>
          <p className="text-lg text-center px-2 text-gray-300">
            You can register your miners to onboard on Fry Networks and can
            verify and manage miner information here.
          </p>
        </Flex>
      </div>
      <div className="px-2 sm:px-20">
        <Button
          className="mt-6 min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
          onClick={async () => {
            try {
              const key = typeof minerKey === 'string' ? minerKey : Array.isArray(minerKey) ? minerKey[0] : undefined;
              if (key && session?.user.address) {
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
    </div>
  );
};

export default EnergyPortal;
