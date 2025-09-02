import { Button, Flex, Title } from '@tremor/react';
import Link from 'next/link';
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

const WeatherPortal = () => {
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

  const handleModal = (id: string) => {
    openModal(id);
  };

  // Check if a portal is available based on portalType
  const isPortalAvailable = (portalId: string) => {
    if (!portalType) return true;
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
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitTempest`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            stationID,
            token,
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
        <Link href="/devices">
          <Button className="mt-6 min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600">
            Back
          </Button>
        </Link>
      </div>
      <Flex
        flexDirection="row"
        justifyContent="evenly"
        className="flex-wrap gap-24 px-2 sm:px-20 mt-10"
      >
        {portals.map((portal, index) => {
          const color = index % 3 === 0 ? 'gray' : index % 3 === 1 ? 'green' : 'red';
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
              <Title className={`${isAvailable ? 'text-white' : 'text-gray-400'} text-center`}>
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
