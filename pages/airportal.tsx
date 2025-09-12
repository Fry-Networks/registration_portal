import { Button, Flex, Title } from '@tremor/react';
import { getSession, useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useModal } from '../app/modalcontext';
import { useToastContext } from '../hooks/ToastContext';

import Image from 'next/image';
import bgImg from '../assets/background.png';
import ambientLogo from '../assets/portals/ambient.png';
import ecowittLogo from '../assets/portals/ecowitt.png';
import pebbleLogo from '../assets/portals/iotex.svg';
import airthingsLogo from '../assets/portals/air-things.png';
import purpleAirLogo from '../assets/portals/purple-air.png';
import awairLogo from '../assets/portals/awair.svg';
import kaiterraLogo from '../assets/portals/kaiterra.png';
import atmotubeLogo from '../assets/portals/atmotube.png';
import goveeLogo from '../assets/portals/govee.png';
import nrfLogo from '../assets/portals/nrf.png';
import sensecapLogo from '../assets/portals/sensecap.webp';

import AmbientModal from '../components/modals/Ambient';
import EcowittModal from '../components/modals/Ecowitt';
import PebbleModal from '../components/modals/Pebble';
import AirthingsModal from '../components/modals/Airthings';
import PurpleairModal from '../components/modals/Purpleair';
import AwairModal from '../components/modals/Awair';
import KaiterraModal from '../components/modals/Kaiterra';
import AtmotubeModal from '../components/modals/Atmotube';
import GoveeModal from '../components/modals/Govee';
import NrfModal from '../components/modals/Nrf';
import SensecapModal from '../components/modals/Sensecap';

const AirPortal = () => {
  const router = useRouter();
  const { data: session } = useSession();
  const { openModal } = useModal();
  const toast = useToastContext();
  const { minerKey, portalType, onlyPortal } = router.query;

  const portals = [
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
      id: 'pebble',
      name: 'Pebble (IOTEX)',
      logo: pebbleLogo
    },
    {
      id: 'airthings',
      name: 'Airthings',
      logo: airthingsLogo
    },
    {
      id: 'purpleair',
      name: 'Purple Air',
      logo: purpleAirLogo
    },
    {
      id: 'awair',
      name: 'Awair',
      logo: awairLogo
    },
    {
      id: 'kaiterra',
      name: 'Kaiterra',
      logo: kaiterraLogo
    },
    {
      id: 'atmotube',
      name: 'Atmotube',
      logo: atmotubeLogo
    },
    {
      id: 'govee',
      name: 'Govee',
      logo: goveeLogo
    },
    {
      id: 'nrf',
      name: 'Nrf',
      logo: nrfLogo
    },
    {
      id: 'sensecap',
      name: 'Sensecap',
      logo: sensecapLogo
    }
  ];

  const handleModal = (id) => {
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
          'We were unable to verify your key. Please try again later, if the problem persists, contact DevDoctor.'
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
          'We were unable to verify your key. Please try again later, if the problem persists, contact DevDoctor.'
      });
      return false;
    }
    return true;
  };

  const handlePebble = async (
    imei: string,
    ercAddr: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitpebble`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            imei,
            address: session?.user.address,
            erc_addr: ercAddr
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
          query: { minerKey, type: 'pebble' }
        });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'pebble');
        }
        router.push('/devices');
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'We were unable to verify your key. Please try again later, if the problem persists, contact DevDoctor.'
      });
      return false;
    }
    return true;
  };

  const handlePurpleair = async (
    sensorId: string,
    readKey: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitpurple`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            sensor_id: sensorId,
            read_key: readKey,
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
          query: { minerKey, type: 'purple' }
        });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'purple');
        }
        router.push('/devices');
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'We were unable to verify your key. Please try again later, if the problem persists, contact DevDoctor.'
      });
      return false;
    }
    return true;
  };

  const handleAwair = async (
    token: string,
    deviceId: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitAwair`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            token,
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
          query: { minerKey, type: 'awair' }
        });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'awair');
        }
        router.push('/devices');
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'We were unable to verify your key. Please try again later, if the problem persists, contact DevDoctor.'
      });
      return false;
    }
    return true;
  };

  const handleKaiterra = async (
    token: string,
    deviceId: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitKaiterra`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            token,
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
          query: { minerKey, type: 'kaiterra' }
        });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'kaiterra');
        }
        router.push('/devices');
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'We were unable to verify your key. Please try again later, if the problem persists, contact DevDoctor.'
      });
      return false;
    }
    return true;
  };

  const handleAtmotube = async (
    token: string,
    deviceId: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitAtmotube`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            token,
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
          query: { minerKey, type: 'atmotube' }
        });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'atmotube');
        }
        router.push('/devices');
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'We were unable to verify your key. Please try again later, if the problem persists, contact DevDoctor.'
      });
      return false;
    }
    return true;
  };

  const handleGovee = async (
    key: string,
    deviceId: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitGoveeKey`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            apiKey: key,
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
          query: { minerKey, type: 'govee' }
        });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'govee');
        }
        router.push('/devices');
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'We were unable to verify your key. Please try again later, if the problem persists, contact DevDoctor.'
      });
      return false;
    }
    return true;
  };

  const handleNrf = async (
    token: string,
    deviceId: string
  ): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitNRF`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            token,
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
          query: { minerKey, type: 'nrf' }
        });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'nrf');
        }
        router.push('/devices');
      }
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'We were unable to verify your key. Please try again later, if the problem persists, contact DevDoctor.'
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
          'We were unable to verify your key. Please try again later, if the problem persists, contact DevDoctor.'
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
            Air Portal
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
      <PebbleModal
        modalName={'pebble'}
        minerKey={minerKey}
        handle={handlePebble}
      />
      <AirthingsModal
        modalName={'airthings'}
        minerKey={minerKey}
        handle={handleEcowitt}
      />
      <PurpleairModal
        modalName={'purpleair'}
        minerKey={minerKey}
        handle={handlePurpleair}
      />
      <AwairModal
        modalName={'awair'}
        minerKey={minerKey}
        handle={handleAwair}
      />
      <KaiterraModal
        modalName={'kaiterra'}
        minerKey={minerKey}
        handle={handleKaiterra}
      />
      <AtmotubeModal
        modalName={'atmotube'}
        minerKey={minerKey}
        handle={handleAtmotube}
      />
      <GoveeModal
        modalName={'govee'}
        minerKey={minerKey}
        handle={handleGovee}
      />
      <NrfModal modalName={'nrf'} minerKey={minerKey} handle={handleNrf} />
      <SensecapModal
        modalName={'sensecap'}
        minerKey={minerKey}
        handle={handleSensecap}
      />
    </div>
  );
};

export default AirPortal;
