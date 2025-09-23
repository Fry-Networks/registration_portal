import React, { useEffect, useState } from 'react';
import { Button, Flex, Title, TextInput } from '@tremor/react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import { useToastContext } from '../hooks/ToastContext';

import Image from 'next/image';
import bgImg from '../assets/background.png';

const MAC_ADDRESS_REGEX = /^(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i;

const NodePortal = () => {
  const router = useRouter();
  const { data: session } = useSession();
  const toast = useToastContext();
  const { minerKey, portalType, onlyPortal } = router.query;

  const [deviceMac, setDeviceMac] = useState('');
  const [originalMac, setOriginalMac] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resolvedMinerKey =
    typeof minerKey === 'string'
      ? minerKey
      : Array.isArray(minerKey)
        ? minerKey[0]
        : undefined;

  const setPortalType = async (
    targetMinerKey: string | undefined,
    type: string
  ): Promise<void> => {
    if (!targetMinerKey) {
      return;
    }

    try {
      const response = await fetch(`/api/devices/save-portal-type`, {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({
          miner_key: targetMinerKey,
          type,
          address: session?.user.address
        })
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
  };

  useEffect(() => {
    if (!resolvedMinerKey || !session?.user?.address) {
      setDeviceMac('');
      setOriginalMac('');
      return;
    }

    const fetchData = async () => {
      try {
        const response = await fetch(
          `/api/hardware/register?miner_key=${encodeURIComponent(resolvedMinerKey)}`,
          { credentials: 'include' }
        );

        if (response.status === 404) {
          setDeviceMac('');
          setOriginalMac('');
          return;
        }

        if (response.status === 403) {
          toast.error({
            heading: 'Error',
            message:
              'You are not authorized to view hardware credentials for this miner.'
          });
          setDeviceMac('');
          setOriginalMac('');
          return;
        }

        if (!response.ok) {
          console.error('Failed to fetch hardware credentials');
          let message = 'Failed to fetch hardware credentials.';

          try {
            const payload = (await response.json()) as { message?: string };
            if (payload?.message) {
              message = payload.message;
            }
          } catch (parseError) {
            console.error(parseError);
          }

          toast.error({ heading: 'Error', message });
          return;
        }

        const result = (await response.json()) as { miner_mac?: string | null };
        const fetchedMac =
          typeof result.miner_mac === 'string'
            ? result.miner_mac.trim().toUpperCase()
            : '';

        setDeviceMac(fetchedMac);
        setOriginalMac(fetchedMac);
      } catch (error) {
        console.error(error);
      }
    };

    fetchData();
  }, [resolvedMinerKey, session?.user?.address, toast]);

  const trimmedDeviceMac = deviceMac.trim();
  const normalizedDeviceMac = trimmedDeviceMac.toUpperCase();
  const isDeviceMacValid =
    trimmedDeviceMac !== '' && MAC_ADDRESS_REGEX.test(trimmedDeviceMac);
  const isExistingRegistration = originalMac !== '';
  const isMacChanged =
    isExistingRegistration && normalizedDeviceMac !== originalMac;

  const registerButtonLabel = isExistingRegistration
    ? isMacChanged
      ? 'Update'
      : 'Registered'
    : 'Register';

  const isRegisterDisabled =
    !isDeviceMacValid ||
    isSubmitting ||
    (isExistingRegistration && !isMacChanged);

  const handleSubmit = async (): Promise<boolean> => {
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

    const attemptRegistration = async (): Promise<boolean> => {
      const response = await fetch('/api/hardware/register', {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          miner_key: resolvedMinerKey,
          miner_mac: normalizedDeviceMac
        })
      });

      const result = await response.json().catch(
        () =>
          ({}) as {
            message?: string;
            existingMac?: string;
            conflictMinerKey?: string;
          }
      );

      if (response.ok) {
        const message =
          result.message ??
          (isExistingRegistration
            ? 'Hardware credentials updated.'
            : 'Hardware credentials saved.');

        if (message.toLowerCase().includes('unchanged')) {
          toast.info({ heading: 'Info', message });
        } else {
          toast.success({ heading: 'Success', message });
        }

        setDeviceMac(normalizedDeviceMac);
        setOriginalMac(normalizedDeviceMac);
        return true;
      }

      if (response.status === 409) {
        if (result.conflictMinerKey) {
          toast.error({
            heading: 'Error',
            message: `MAC address already registered to ${result.conflictMinerKey}.`
          });
          return false;
        }

        if (result.existingMac) {
          const shouldDelete = window.confirm(
            `This miner already has MAC ${result.existingMac}. Delete it and continue?`
          );

          if (!shouldDelete) {
            toast.info({
              heading: 'Info',
              message: 'Existing registration kept.'
            });
            return false;
          }

          const deleteResponse = await fetch('/api/hardware/register', {
            method: 'DELETE',
            headers: { 'Content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ miner_key: resolvedMinerKey })
          });

          const deleteResult = await deleteResponse
            .json()
            .catch(() => ({}) as { message?: string });

          if (!deleteResponse.ok) {
            toast.error({
              heading: 'Error',
              message:
                deleteResult.message ??
                'Failed to delete the existing registration.'
            });
            return false;
          }

          toast.success({
            heading: 'Success',
            message: deleteResult.message ?? 'Existing registration deleted.'
          });

          return attemptRegistration();
        }
      }

      toast.error({
        heading: 'Error',
        message: result.message ?? 'Failed to save hardware credentials.'
      });
      return false;
    };

    setIsSubmitting(true);

    try {
      const success = await attemptRegistration();

      if (success) {
        if (!onlyPortal) {
          router.push({
            pathname: '/register',
            query: { minerKey: resolvedMinerKey, type: 'node' }
          });
        } else {
          if (portalType === undefined) {
            await setPortalType(resolvedMinerKey, 'node');
          }

          router.push('/devices');
        }
      }

      return success;
    } catch (error) {
      console.error(error);

      toast.error({
        heading: 'Error',
        message:
          'We were unable to update your hardware credentials. Please try again.'
      });

      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnregister = async (): Promise<void> => {
    if (!resolvedMinerKey) {
      toast.error({ heading: 'Error', message: 'Miner key is missing.' });
      return;
    }

    if (!session?.user.address) {
      toast.error({
        heading: 'Error',
        message: 'Your wallet session has expired.'
      });
      return;
    }

    const shouldContinue = window.confirm(
      'This will remove the registered MAC address. Continue?'
    );

    if (!shouldContinue) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/hardware/register', {
        method: 'DELETE',
        headers: { 'Content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ miner_key: resolvedMinerKey })
      });

      const result = await response
        .json()
        .catch(() => ({}) as { message?: string });

      if (!response.ok) {
        toast.error({
          heading: 'Error',
          message:
            result.message ?? 'Failed to unregister hardware credentials.'
        });
        return;
      }

      toast.success({
        heading: 'Success',
        message: result.message ?? 'Hardware credentials deleted.'
      });

      setOriginalMac('');
      setDeviceMac('');
    } catch (error) {
      console.error(error);
      toast.error({
        heading: 'Error',
        message:
          'We were unable to remove your hardware credentials. Please try again.'
      });
    } finally {
      setIsSubmitting(false);
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
            Fry Node Portal
          </Title>
          <p className="text-lg text-center px-2 text-gray-300">
            You can register your nodes to onboard on Fry Networks and can
            verify and manage node information here.
          </p>
        </Flex>
      </div>
      <div className="px-2 sm:px-20">
        <Button
          className="mt-6 min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
          onClick={async () => {
            try {
              const key =
                typeof minerKey === 'string'
                  ? minerKey
                  : Array.isArray(minerKey)
                    ? minerKey[0]
                    : undefined;
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
        <Flex className="gap-3">
          <Button
            className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
            onClick={handleSubmit}
            disabled={isRegisterDisabled}
          >
            {registerButtonLabel}
          </Button>
          {isExistingRegistration && (
            <Button
              className="bg-transparent border-slate-500 text-slate-200 hover:bg-slate-600 hover:border-slate-600"
              onClick={handleUnregister}
              disabled={isSubmitting}
            >
              Unregister
            </Button>
          )}
        </Flex>
      </Flex>
    </div>
  );
};

export default NodePortal;
