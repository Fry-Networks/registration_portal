import React, { useEffect, useState } from 'react';
import { Button, Flex, Title, TextInput } from '@tremor/react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useModal } from '../app/modalcontext';
import { useToastContext } from '../hooks/ToastContext';

import Image from 'next/image';
import bgImg from '../assets/background.png';

const MAC_ADDRESS_REGEX = /^(?:[0-9A-F]{2}-){5}[0-9A-F]{2}$/i;

const HardwarePortal = () => {
  const router = useRouter();
  const { data: session } = useSession();
  const toast = useToastContext();
  const { minerKey, portalType, onlyPortal } = router.query;

  const [deviceMac, setDeviceMac] = useState('');

  const setPortalType = async (minerKey: string | string[] | undefined, type: string) => {
    try {
      const response = await fetch(`/api/devices/save-portal-type`, {
        method: 'POST',
        headers: {'Content-type': 'application/json'},
        body: JSON.stringify({miner_key: minerKey, type, address: session?.user.address})
      });
      if (response.ok) {
        toast.success({
          heading: 'Success',
          message: 'Device information for portal type updated successfully'
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
  }

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}/api/getDeviceCredential`, {
          method: 'POST',
          headers: {'Content-type': 'application/json'},
          body: JSON.stringify({ miner_key: minerKey, type: 'hardware' })
        });
  
        const result = await response.json();
        if (result.data !== null) {
          setDeviceMac(result.data.device_id);
        }
      } catch (error) {
        console.error(error);
        return;
      }
      return;
    }

    fetchData();
  }, [minerKey]);

  const trimmedDeviceMac = deviceMac.trim();
  const isDeviceMacValid = trimmedDeviceMac !== '' && MAC_ADDRESS_REGEX.test(trimmedDeviceMac);

  const handleSubmit = async (): Promise<boolean> => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_HOST}/api/submitRegisterHD`,
        {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          body: JSON.stringify({
            miner_key: minerKey,
            device_id: trimmedDeviceMac,
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
        router.push({ pathname: '/register', query: { minerKey, type: "hardware" } });
      } else {
        if (portalType === undefined) {
          await setPortalType(minerKey, 'hardware');
        }
        router.push('/devices');
      }
    } catch (error) {
      console.error(error);
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
            Hardware Portal
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
              // ignore cancel failures
            } finally {
              router.push('/devices');
            }
          }}
        >
          Back
        </Button>
      </div>
      <Flex
        flexDirection="col"
        justifyContent="center"
        className="flex-wrap gap-2 px-6 sm:px-96 mt-20"
      >
        <TextInput
          type="text"
          value={deviceMac}
          onChange={(e) => setDeviceMac(e.target.value)}
          placeholder="Enter your device MAC address"
          className="mt-2 mb-2"
          error={trimmedDeviceMac !== '' && !isDeviceMacValid}
          errorMessage="Invalid MAC address format"
        />
        <Button
          className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
          onClick={handleSubmit}
          disabled={!isDeviceMacValid}
        >
          Register
        </Button>
      </Flex>
    </div>
  );
};

export default HardwarePortal;