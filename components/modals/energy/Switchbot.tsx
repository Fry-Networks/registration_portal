import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Dialog,
  DialogPanel,
  TextInput,
  Title,
  Subtitle,
  Flex,
  Select,
  SelectItem
} from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { useModal } from '../../../app/modalcontext';
import Loading from '../../Loading';

interface SwitchbotModalProps {
  modalName: string;
  minerKey: string | string[] | undefined;
  address?: string;
  handle: (token: string, secret: string, deviceId: string) => Promise<boolean>;
}

const MIN_TOKEN_LENGTH = 96;
const MIN_SECRET_LENGTH = 32;

const sanitizeDeviceId = (value: string) =>
  value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();

type DeviceOption = {
  deviceId: string;
  deviceName: string;
  deviceType?: string;
};

const SwitchbotModal: React.FC<SwitchbotModalProps> = ({
  modalName,
  minerKey,
  address,
  handle
}: SwitchbotModalProps) => {
  const { modals, closeModal } = useModal();
  const [token, setToken] = useState('');
  const [secret, setSecret] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [deviceName, setDeviceName] = useState<string | undefined>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [deviceOptions, setDeviceOptions] = useState<DeviceOption[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [deviceFetchError, setDeviceFetchError] = useState<string | undefined>();
  const [hasLoadedDevices, setHasLoadedDevices] = useState(false);

  const resolvedMinerKey = useMemo(() => {
    if (typeof minerKey === 'string') return minerKey;
    if (Array.isArray(minerKey)) {
      return minerKey.length > 0 ? minerKey[0] : undefined;
    }
    return undefined;
  }, [minerKey]);

  const isModalOpen = Boolean(modals[modalName]);

  useEffect(() => {
    if (!isModalOpen) {
      setDeviceOptions([]);
      setDeviceFetchError(undefined);
      setHasLoadedDevices(false);
    }
  }, [isModalOpen]);

  useEffect(() => {
    if (!isModalOpen || !resolvedMinerKey) {
      return;
    }

    const fetchData = async () => {
      try {
        const response = await fetch('/api/devices/get-credential', {
          method: 'POST',
          headers: { 'Content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ miner_key: resolvedMinerKey, type: 'switchbot' })
        });

        if (!response.ok) {
          return;
        }

        const result = await response.json();
        if (result.data !== null) {
          if (typeof result.data.token === 'string') {
            setToken(result.data.token.trim());
          }
          if (typeof result.data.secret === 'string') {
            setSecret(result.data.secret.trim());
          }
          if (typeof result.data.deviceId === 'string') {
            setDeviceId(sanitizeDeviceId(result.data.deviceId));
          }
          if (typeof result.data.device_name === 'string') {
            setDeviceName(result.data.device_name);
          }
        }
      } catch (error) {
        console.error(error);
      }
    };

    fetchData();
  }, [isModalOpen, resolvedMinerKey]);

  const sanitizedToken = token.trim();
  const sanitizedSecret = secret.trim();
  const selectedDeviceId = deviceId ? sanitizeDeviceId(deviceId) : '';
  const canLoadDevices =
    sanitizedToken.length >= MIN_TOKEN_LENGTH &&
    sanitizedSecret.length >= MIN_SECRET_LENGTH &&
    Boolean(resolvedMinerKey) &&
    Boolean(address);

  const fetchAvailableDevices = useCallback(async () => {
    if (!resolvedMinerKey || !address) {
      setDeviceFetchError('Missing device context.');
      return;
    }

    if (!canLoadDevices) {
      setDeviceFetchError('Provide token and secret to load devices.');
      setDeviceOptions([]);
      return;
    }

    setIsLoadingDevices(true);
    setDeviceFetchError(undefined);

    try {
      const response = await fetch('/api/energy/switchbot-devices', {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          token: sanitizedToken,
          secret: sanitizedSecret,
          address,
          miner_key: resolvedMinerKey,
          currentDeviceId: selectedDeviceId
        })
      });

      const result = await response.json();

      if (!response.ok) {
        setDeviceOptions([]);
        setDeviceId('');
        setDeviceName(undefined);
        setDeviceFetchError(result.message ?? 'Failed to load SwitchBot devices.');
        return;
      }

      const options = Array.isArray(result.devices)
        ? (result.devices as DeviceOption[])
        : [];

      setDeviceOptions(options);
      setHasLoadedDevices(true);

      if (options.length === 0) {
        setDeviceId('');
        setDeviceName(undefined);
        return;
      }

      const selectedOption = options.find(
        (option) => option.deviceId === selectedDeviceId
      );

      if (!selectedOption) {
        const [first] = options;
        setDeviceId(first.deviceId);
        setDeviceName(first.deviceName);
        return;
      }

      setDeviceName(selectedOption.deviceName);
    } catch (error) {
      console.error('[SwitchbotModal] Failed to load devices', error);
      setDeviceOptions([]);
      setDeviceId('');
      setDeviceName(undefined);
      setDeviceFetchError('Unable to load SwitchBot devices.');
    } finally {
      setIsLoadingDevices(false);
    }
  }, [
    address,
    canLoadDevices,
    resolvedMinerKey,
    sanitizedSecret,
    sanitizedToken,
    selectedDeviceId
  ]);

  useEffect(() => {
    setHasLoadedDevices(false);
    setDeviceFetchError(undefined);
  }, [sanitizedToken, sanitizedSecret, resolvedMinerKey, address]);

  useEffect(() => {
    if (!isModalOpen || !canLoadDevices || hasLoadedDevices) {
      return;
    }

    fetchAvailableDevices();
  }, [isModalOpen, canLoadDevices, fetchAvailableDevices, hasLoadedDevices]);

  const handleSubmit = async () => {
    setIsProcessing(true);
    const result = await handle(
      sanitizedToken,
      sanitizedSecret,
      selectedDeviceId
    );
    if (result) {
      setIsProcessing(false);
      closeModal(modalName);
    }
    setIsProcessing(false);
  };

  const tokenInvalid = token !== '' && sanitizedToken.length < MIN_TOKEN_LENGTH;
  const secretInvalid = secret !== '' && sanitizedSecret.length < MIN_SECRET_LENGTH;
  const canSubmit =
    sanitizedToken.length >= MIN_TOKEN_LENGTH &&
    sanitizedSecret.length >= MIN_SECRET_LENGTH &&
    selectedDeviceId.length === 12;

  return (
    <Dialog
      open={modals[modalName]}
      onClose={() => !isProcessing && closeModal(modalName)}
      static={true}
      className="z-[100]"
    >
      <DialogPanel className="sm:max-w-2xl">
        <div className="absolute right-0 top-0 pr-3 pt-3">
          <button
            type="button"
            className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
            onClick={() => !isProcessing && closeModal(modalName)}
            aria-label="Close"
          >
            <RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
          </button>
        </div>
        <Title className="mb-5">SwitchBot</Title>
        <Subtitle className="mb-4 text-[14px]">
          Provide the long-term token and secret from your SwitchBot account, then select your device from the list. You can generate credentials in the{' '}
          <Link
            href="https://support.switch-bot.com/hc/en-us/articles/12822710195351-How-to-obtain-a-Token"
            target="_blank"
            className="underline"
          >
            SwitchBot developer portal
          </Link>
          .
        </Subtitle>
        {deviceName && (
          <p className="text-sm text-gray-400 mb-2">
            Loaded credential for <span className="font-semibold">{deviceName}</span>
          </p>
        )}
        <TextInput
          type="text"
          value={token}
          onValueChange={setToken}
          placeholder="Enter your SwitchBot token"
          className="mt-2 mb-2 text-slate-900"
          error={tokenInvalid}
          errorMessage="Token looks too short"
        />
        <TextInput
          type="password"
          value={secret}
          onValueChange={setSecret}
          placeholder="Enter your SwitchBot secret"
          className="mt-2 mb-2 text-slate-900"
          error={secretInvalid}
          errorMessage="Secret looks too short"
        />
        <Flex className="mt-2 mb-2 gap-3 flex-wrap" alignItems="center">
          <Select
            value={selectedDeviceId}
            onValueChange={(value) => {
              const sanitizedValue = sanitizeDeviceId(value);
              setDeviceId(sanitizedValue);
              const selectedOption = deviceOptions.find(
                (option) => option.deviceId === sanitizedValue
              );
              if (selectedOption) {
                setDeviceName(selectedOption.deviceName);
              }
            }}
            placeholder={
              isLoadingDevices
                ? 'Loading devices...'
                : 'Select a SwitchBot device'
            }
            disabled={deviceOptions.length === 0 || isLoadingDevices}
            className="min-w-[220px] text-slate-900"
          >
            {deviceOptions.map((option) => (
              <SelectItem key={option.deviceId} value={option.deviceId}>
                {option.deviceName}
                {option.deviceType ? ` (${option.deviceType})` : ''}
              </SelectItem>
            ))}
          </Select>
          <Button
            className="bg-transparent text-slate-900 border-slate-500 hover:bg-slate-600 hover:border-slate-600"
            onClick={() => fetchAvailableDevices()}
            disabled={!canLoadDevices || isLoadingDevices}
          >
            {isLoadingDevices ? <Loading /> : 'Load devices'}
          </Button>
        </Flex>
        {deviceFetchError && (
          <p className="text-sm text-red-500 mb-2">{deviceFetchError}</p>
        )}
        {!deviceFetchError &&
          hasLoadedDevices &&
          !isLoadingDevices &&
          deviceOptions.length === 0 && (
            <p className="text-sm text-gray-400 mb-2">
              No available devices found for this account.
            </p>
          )}
        <Flex
          flexDirection="row"
          justifyContent="center"
          className="gap-3 w-full mt-5"
        >
          <Button
            className="bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600"
            onClick={() => !isProcessing && closeModal(modalName)}
          >
            Close
          </Button>
          <Button
            className={`bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600 \
              ${isProcessing ? 'cursor-not-allowed' : 'cursor-default'}
            `}
            disabled={!canSubmit}
            onClick={() => {
              handleSubmit();
            }}
          >
            {isProcessing ? <Loading /> : 'Submit'}
          </Button>
        </Flex>
      </DialogPanel>
    </Dialog>
  );
};

export default SwitchbotModal;
