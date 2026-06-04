import { useState, useEffect } from 'react';
import { XIcon } from '@heroicons/react/outline';
import { Button } from '@tremor/react';
import { useRouter } from 'next/router';
import { useTheme } from 'next-themes';
import { useToastContext } from '../hooks/ToastContext';
import { fetchWithFingerprintRetry } from '../lib/api/fetchWithFingerprintRetry';
import { useFingerprintReady } from '../app/fingerprintcontext';

export interface PendingVirtualDevice {
  miner_key: string;
  name: string;
  order?: string;
  created_at?: string;
}

interface VirtualActivationBannerProps {
  devices: PendingVirtualDevice[];
  sessionAddress: string;
  dismissKey?: string;
}

export default function VirtualActivationBanner({
  devices: initialDevices,
  sessionAddress,
  dismissKey = 'virtualBannerDismissed',
}: VirtualActivationBannerProps) {
  const [devices, setDevices] = useState<PendingVirtualDevice[]>(initialDevices);
  const [activatingKeys, setActivatingKeys] = useState<Set<string>>(new Set());
  const [activatingAll, setActivatingAll] = useState(false);
  const [cancelingKeys, setCancelingKeys] = useState<Set<string>>(new Set());
  const [cancelingAll, setCancelingAll] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [manualError, setManualError] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDismissed(sessionStorage.getItem(dismissKey) === 'true');
    }
  }, [dismissKey]);

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(dismissKey, 'true');
    }
  };
  const router = useRouter();
  const toast = useToastContext();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const { refresh: refreshFingerprint } = useFingerprintReady();

  if (dismissed || (devices.length === 0 && !showManual)) return null;

  const activateSingle = async (miner_key: string) => {
    setActivatingKeys((prev) => new Set(prev).add(miner_key));
    try {
      const response = await fetchWithFingerprintRetry(
        () =>
          fetch('/api/devices/activate-virtual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ miner_key }),
          }),
        refreshFingerprint
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || data.userMessage || 'Activation failed');
      }

      setDevices((prev) => prev.filter((d) => d.miner_key !== miner_key));
      toast.success({ heading: 'Device activated', message: `${miner_key} is now active.` });
      router.replace(router.asPath);
    } catch (err: any) {
      toast.error({ heading: 'Activation failed', message: err.message || 'Please try again.' });
    } finally {
      setActivatingKeys((prev) => {
        const next = new Set(prev);
        next.delete(miner_key);
        return next;
      });
    }
  };

  const cancelSingle = async (miner_key: string) => {
    setCancelingKeys((prev) => new Set(prev).add(miner_key));
    try {
      const response = await fetchWithFingerprintRetry(
        () =>
          fetch('/api/devices/cancel-virtual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ miner_key }),
          }),
        refreshFingerprint
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || data.userMessage || 'Cancellation failed');
      }

      setDevices((prev) => prev.filter((d) => d.miner_key !== miner_key));
      toast.success({ heading: 'Device canceled', message: `${miner_key} has been canceled.` });
      router.replace(router.asPath);
    } catch (err: any) {
      toast.error({ heading: 'Cancellation failed', message: err.message || 'Please try again.' });
    } finally {
      setCancelingKeys((prev) => {
        const next = new Set(prev);
        next.delete(miner_key);
        return next;
      });
    }
  };

  const activateAll = async () => {
    setActivatingAll(true);
    try {
      const miner_keys = devices.map((d) => d.miner_key);
      const response = await fetchWithFingerprintRetry(
        () =>
          fetch('/api/devices/activate-virtual-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ miner_keys }),
          }),
        refreshFingerprint
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || data.userMessage || 'Batch activation failed');
      }

      const data = await response.json();
      const succeeded = (data.results || [])
        .filter((r: any) => r.success)
        .map((r: any) => r.miner_key);

      setDevices((prev) => prev.filter((d) => !succeeded.includes(d.miner_key)));

      if (data.activated > 0) {
        toast.success({
          heading: 'Devices activated',
          message: `${data.activated} virtual device${data.activated > 1 ? 's' : ''} activated successfully.`,
        });
        router.replace(router.asPath);
      }

      const failures = (data.results || []).filter((r: any) => !r.success);
      if (failures.length > 0) {
        toast.error({
          heading: 'Some activations failed',
          message: `${failures.length} device${failures.length > 1 ? 's' : ''} could not be activated.`,
        });
      }
    } catch (err: any) {
      toast.error({ heading: 'Batch activation failed', message: err.message || 'Please try again.' });
    } finally {
      setActivatingAll(false);
    }
  };

  const cancelAll = async () => {
    setCancelingAll(true);
    try {
      let canceled = 0;
      let failed = 0;
      for (const device of devices) {
        try {
          const response = await fetchWithFingerprintRetry(
            () =>
              fetch('/api/devices/cancel-virtual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ miner_key: device.miner_key }),
              }),
            refreshFingerprint
          );
          if (response.ok) {
            canceled++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }
      setDevices((prev) => prev.filter((d) => !prev.find((p) => p.miner_key === d.miner_key)));
      if (canceled > 0) {
        toast.success({
          heading: 'Devices canceled',
          message: `${canceled} virtual device${canceled > 1 ? 's' : ''} canceled successfully.`,
        });
        router.replace(router.asPath);
      }
      if (failed > 0) {
        toast.error({
          heading: 'Some cancellations failed',
          message: `${failed} device${failed > 1 ? 's' : ''} could not be canceled.`,
        });
      }
    } catch (err: any) {
      toast.error({ heading: 'Batch cancellation failed', message: err.message || 'Please try again.' });
    } finally {
      setCancelingAll(false);
    }
  };

  const handleManualActivate = async () => {
    const key = manualKey.trim().toUpperCase();
    if (!key) return;

    const VIRTUAL_PREFIXES = ['VRDN', 'VSDN', 'VSVN'];
    const prefix = key.split('-')[0];
    if (!VIRTUAL_PREFIXES.includes(prefix)) {
      setManualError('This miner key is not a virtual device. Virtual keys start with VRDN, VSDN, or VSVN.');
      return;
    }

    if (!/^[A-Z]{2,6}-[A-Z0-9]{32}$/.test(key)) {
      setManualError('Invalid miner key format.');
      return;
    }

    setManualError('');
    setActivatingKeys((prev) => new Set(prev).add(key));

    try {
      const response = await fetchWithFingerprintRetry(
        () =>
          fetch('/api/devices/activate-virtual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ miner_key: key }),
          }),
        refreshFingerprint
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || data.userMessage || 'Activation failed');
      }

      setManualKey('');
      setShowManual(false);
      toast.success({ heading: 'Device activated', message: `${key} is now active.` });
      router.replace(router.asPath);
    } catch (err: any) {
      setManualError(err.message || 'Activation failed. Please check the miner key.');
    } finally {
      setActivatingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const cardBg = isDark
    ? 'border-purple-500/30 bg-purple-500/5'
    : 'border-purple-300 bg-purple-50';
  const cardText = isDark ? 'text-purple-200' : 'text-purple-900';
  const mutedText = isDark ? 'text-purple-300/70' : 'text-purple-700/70';

  return (
    <div className="relative">
      <button
        onClick={handleDismiss}
        className={`absolute top-3 right-3 z-10 p-1.5 rounded-lg transition hover:bg-white/10 ${isDark ? 'text-white/60' : 'text-slate-500'}`}
        aria-label="Dismiss"
      >
        <XIcon className="h-5 w-5" />
      </button>
    <div className={`mx-2 sm:mx-20 mt-6 rounded-2xl border-2 p-5 ${cardBg}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className={`text-lg font-semibold ${cardText}`}>
            Virtual Devices Pending Activation
          </h3>
          <p className={`text-sm ${mutedText}`}>
            {devices.length} device{devices.length !== 1 ? 's' : ''} ready to activate.
            Activating links your wallet and enables rewards.
          </p>
        </div>
        {devices.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={activateAll}
              loading={activatingAll}
              disabled={activatingAll || cancelingAll}
              className={
                isDark
                  ? 'bg-purple-600 text-white border-purple-500 hover:bg-purple-500'
                  : 'bg-purple-600 text-white border-purple-600 hover:bg-purple-700'
              }
            >
              Activate All ({devices.length})
            </Button>
            <Button
              onClick={cancelAll}
              loading={cancelingAll}
              disabled={activatingAll || cancelingAll}
              className={
                isDark
                  ? 'bg-red-600/80 text-white border-red-500/50 hover:bg-red-500'
                  : 'bg-red-600 text-white border-red-600 hover:bg-red-700'
              }
            >
              Cancel All ({devices.length})
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {devices.map((device) => {
          const isActivating = activatingKeys.has(device.miner_key);
          const isCanceling = cancelingKeys.has(device.miner_key);
          return (
            <div
              key={device.miner_key}
              className={`flex flex-col justify-between rounded-xl border p-3 ${
                isDark
                  ? 'border-purple-500/20 bg-purple-900/10'
                  : 'border-purple-200 bg-white'
              }`}
            >
              <div className="mb-2">
                <div className={`text-sm font-medium ${cardText}`}>{device.name}</div>
                <div className={`text-xs font-mono ${mutedText}`}>{device.miner_key}</div>
                {device.order && (
                  <div className={`text-xs ${mutedText}`}>Order #{device.order}</div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="xs"
                  onClick={() => activateSingle(device.miner_key)}
                  loading={isActivating}
                  disabled={isActivating || isCanceling || activatingAll || cancelingAll}
                  className={
                    isDark
                      ? 'bg-purple-600/80 text-white border-purple-500/50 hover:bg-purple-500'
                      : 'bg-purple-600 text-white border-purple-600 hover:bg-purple-700'
                  }
                >
                  Activate
                </Button>
                <Button
                  size="xs"
                  onClick={() => cancelSingle(device.miner_key)}
                  loading={isCanceling}
                  disabled={isActivating || isCanceling || activatingAll || cancelingAll}
                  className={
                    isDark
                      ? 'bg-red-600/80 text-white border-red-500/50 hover:bg-red-500'
                      : 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                  }
                >
                  Cancel
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Manual claim section */}
      <div className="mt-4 pt-3 border-t border-purple-500/20">
        {!showManual ? (
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className={`text-sm underline ${mutedText} hover:opacity-80`}
          >
            Have a virtual device miner key? Enter it manually
          </button>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className={`text-xs font-medium ${mutedText}`}>Miner Key</label>
              <input
                type="text"
                value={manualKey}
                onChange={(e) => { setManualKey(e.target.value); setManualError(''); }}
                placeholder="VSVN-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono ${
                  isDark
                    ? 'bg-[#0f0f16] text-white border-purple-500/30 placeholder:text-gray-500'
                    : 'bg-white text-slate-900 border-purple-200 placeholder:text-slate-400'
                }`}
              />
              {manualError && (
                <p className="mt-1 text-xs text-red-400">{manualError}</p>
              )}
            </div>
            <Button
              size="xs"
              onClick={handleManualActivate}
              loading={activatingKeys.has(manualKey.trim().toUpperCase())}
              disabled={!manualKey.trim()}
              className={
                isDark
                  ? 'bg-purple-600/80 text-white border-purple-500/50 hover:bg-purple-500'
                  : 'bg-purple-600 text-white border-purple-600 hover:bg-purple-700'
              }
            >
              Activate
            </Button>
            <button
              type="button"
              onClick={() => { setShowManual(false); setManualKey(''); setManualError(''); }}
              className={`text-sm ${mutedText} hover:opacity-80`}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
