// Theme-aware BYOD conversion modal that replaces the old standalone page.
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Button,
  Dialog,
  DialogPanel,
  TextInput,
  Select,
  SelectItem,
  Title,
  Flex
} from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { useTheme } from 'next-themes';
import { useModal } from '../../app/modalcontext';
import { useToastContext } from '../../hooks/ToastContext';

interface ByodConvertModalProps {
  modalName: string;
  address?: string;
  handleRegister: (minerKey: string) => void;
}

const ByodConvertModal: React.FC<ByodConvertModalProps> = ({
  modalName,
  handleRegister,
  address
}: ByodConvertModalProps) => {
  const { modals, closeModal } = useModal();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const toast = useToastContext();
  const [products, setProducts] = useState<Array<{ name: string; key: string }>>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [byodLicense, setByodLicense] = useState('');
  const [minerKey, setMinerKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Allowed product names from docs/products.md; client filters to prevent showing unsupported BYOD targets.
  // Allowlist from docs/products.md but excluding Water/Energy/Radiation until enabled for BYOD.
  const allowedProductNames = useMemo(
    () => new Set<string>([
      '$FRY Fry Edge Miner',
      '$FRY Bandwidth Miner',
      '$FRY Indoor Decibel Miner',
      '$FRY Outdoor Decibel Miner',
      '$FRY Indoor Satellite Miner',
      '$FRY Outdoor Satellite Miner',
      '$FRY High-End Weather Miner',
      '$FRY Low-End Weather Miner',
      '$FRY AI Outdoor Wildlife Camera Miner',
      '$FRY AI Outdoor Traffic Camera Miner',
      '$FRY AI Outdoor Weather Station Camera Miner',
      '$FRY AI Indoor Wildlife Camera Miner',
      '$FRY AI Indoor Weather Station Camera Miner',
      '$FRY AI Indoor Sky Camera Miner',
      '$FRY AI Outdoor Sky Camera Miner',
      '$FRY AI Indoor Traffic Camera Miner',
      '$FRY Outdoor Mid-End Air Quality Miner',
      '$FRY Indoor Mid-End Air Quality Miner',
      '$FRY Indoor Low-End Air Quality Miner'
    ]),
    []
  );

  // Map product name to a BYOD category for grouped display.
  const categorizeProduct = useCallback((name: string): string | null => {
    if (!name) return null;
    const lower = name.toLowerCase();
    if (
      lower.includes('ai edge') ||
      lower.includes('bandwidth') ||
      lower.includes('satellite') ||
      lower.includes('decibel')
    ) {
      return 'Mini PC Miners';
    }
    if (lower.includes('weather miner')) {
      return 'Weather Miners';
    }
    if (lower.includes('air quality miner')) {
      return 'Air Miners';
    }
    if (lower.includes('camera miner')) {
      return 'Camera Miners';
    }
    return null;
  }, []);

  // Deterministic sort so SKUs stay paired (indoor/outdoor) and in a clear visual order per category.
  const sortProductsForCategory = useCallback(
    (list: Array<{ name: string; key: string }>, category: string) => {
      const priority = (name: string): number => {
          const lower = name.toLowerCase();
          if (category === 'Mini PC Miners') {
          // Order: Edge, Bandwidth, Satellite (Indoor first), Decibel (Indoor first).
          if (lower.includes('ai edge')) return 4;
          if (lower.includes('bandwidth')) return 3;
          if (lower.includes('indoor satellite')) return 2.5;
          if (lower.includes('outdoor satellite')) return 2;
          if (lower.includes('indoor decibel')) return 1.5;
          if (lower.includes('outdoor decibel')) return 1;
          }
          if (category === 'Camera Miners') {
          // Keep indoor/outdoor variants adjacent; group by root name with indoor first for weather/wildlife.
          if (lower.includes('outdoor traffic')) return 6;
          if (lower.includes('indoor traffic')) return 5;
          if (lower.includes('outdoor sky')) return 4;
          if (lower.includes('indoor sky')) return 3;
          // Weather: outdoor first so indoor sits in the right column next to it.
          if (lower.includes('outdoor weather')) return 2.5;
          if (lower.includes('indoor weather')) return 2;
          // Wildlife: indoor should land in the right column.
          if (lower.includes('outdoor wildlife')) return 1.5;
          if (lower.includes('indoor wildlife')) return 1;
          }
          return 0;
        };
      return [...list].sort((a, b) => priority(b.name) - priority(a.name));
    },
    []
  );
  const categoryOrder = useMemo(
    () => ['Mini PC Miners', 'Weather Miners', 'Air Miners', 'Camera Miners'],
    []
  );
  const findFirstProductKey = useCallback(
    (list: Array<{ name: string; key: string }>): string | undefined => {
      // Pick the first item based on the visual category order so the default highlight matches what users see at the top.
      for (const category of categoryOrder) {
        const items = sortProductsForCategory(
          list.filter((p) => categorizeProduct(p.name) === category),
          category
        );
        if (items.length > 0) {
          return items[0].key;
        }
      }
      return list[0]?.key;
    },
    [categorizeProduct, categoryOrder, sortProductsForCategory]
  );

  const handleConvert = async () => {
    // Prevent duplicate submits while the request is in flight.
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/convert-byod', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ address, byod: byodLicense.trim(), key: selectedProduct })
      });
      const data = await response.json();
      if (response.ok) {
        toast.success({
          heading: 'BYOD convert success',
          message: 'Converted your BYOD license to a miner key, scroll down to see it and start onboarding.'
        });
        setMinerKey(data.miner_key);
      } else {
        setByodLicense('');
        toast.error({
          heading: 'BYOD Convert Error',
          message: data?.message ?? 'Failed to convert BYOD license'
        });
      }
    } catch (error) {
      toast.error({
        heading: 'BYOD Convert Error',
        message: 'Unexpected error converting BYOD license'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const fetchProducts = async () => {
      const response = await fetch('/api/get_miner_types', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ address })
      });
      const data = await response.json();
      if (data.message === 'ok') {
        // Filter to the allowlisted BYOD products only and keep category metadata for grouping.
        const filtered = (data.data as Array<{ key: string; name: string }>).filter(
          (product) => allowedProductNames.has(product.name) && categorizeProduct(product.name) !== null
        );
        setProducts(filtered);
      }
    };
    fetchProducts();
    // Reset state when reopening.
    setMinerKey('');
    setByodLicense('');
  }, [address, allowedProductNames, categorizeProduct, modals[modalName]]);

  // Default to the first visible product (by category order) when the modal opens so the highlight matches the top of the list.
  useEffect(() => {
    if (!modals[modalName] || products.length === 0) return;
    const firstKey = findFirstProductKey(products);
    if (firstKey) {
      setSelectedProduct(firstKey);
    }
  }, [findFirstProductKey, modalName, modals, products]);

  return (
    <Dialog
      open={modals[modalName]}
      onClose={() => closeModal(modalName)}
      static={true}
      className="z-[200]" // Match staking modal stacking so navbar Lottie remains behind
    >
      <DialogPanel
        className={`sm:max-w-2xl ${
          isDark
            ? 'bg-[#0b0b0f] text-white border border-gray-800 shadow-[0_18px_45px_rgba(0,0,0,0.6)]'
            : 'bg-white text-slate-900 border border-slate-200 shadow-[0_18px_45px_rgba(15,23,42,0.15)]'
        }`}
        style={{ marginTop: '2.5rem', position: 'relative', zIndex: 1 }} // Nudge down from navbar; keep panel above seasonal chrome
      >
        <div className="absolute right-0 top-0 pr-3 pt-3">
          <button
            type="button"
            className={`rounded-tremor-small p-2 transition ${
              isDark
                ? 'text-gray-400 hover:bg-white/5 hover:text-white'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            }`}
            onClick={() => closeModal(modalName)}
            aria-label="Close"
          >
            <RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
          </button>
        </div>
        <Title className={`mb-5 ${isDark ? 'text-white' : 'text-slate-900'}`}>
          Convert your BYOD license to a Miner Key
        </Title>

        <div className="space-y-3">
          <div>
            <div className={`text-xs uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>
              BYOD license
            </div>
            <TextInput
              type="text"
              value={byodLicense}
              onChange={(e) => setByodLicense(e.target.value)}
              placeholder="Enter your BYOD license"
              className={`mt-2 ${
                isDark
                  ? [
                      // Force dark input even on focus; target Tremor's inner input element explicitly.
                      'bg-[#0f0f16] text-white placeholder:text-gray-500 border border-gray-700 focus:border-red-500',
                      '[&_input]:bg-[#0f0f16] [&_input]:text-white [&_input]:placeholder:text-gray-500 [&_input]:border-gray-700',
                      '[&_input:focus]:bg-[#0f0f16] [&_input:focus]:text-white [&_input:focus]:placeholder:text-gray-400 [&_input:focus]:border-red-500'
                    ].join(' ')
                  : 'bg-white text-slate-900 placeholder:text-slate-400 border border-slate-200 focus:border-red-500'
              }`}
              error={byodLicense !== '' && !/^[A-Z0-9]+$/.test(byodLicense)}
              errorMessage="Invalid BYOD license"
            />
          </div>

          <div className="space-y-2">
            <div className={`text-xs uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-slate-600'}`}>
              Choose product
            </div>
            <div className="space-y-2">
              {['Mini PC Miners', 'Weather Miners', 'Air Miners', 'Camera Miners'].map((category) => {
                const items = sortProductsForCategory(
                  products.filter((p) => categorizeProduct(p.name) === category),
                  category
                );
                if (items.length === 0) return null;
                return (
                  <div
                    key={category}
                    className={`rounded-lg border p-3 ${
                      isDark ? 'border-gray-800/70 bg-black/30' : 'border-slate-200 bg-white shadow-sm'
                    }`}
                  >
                    <div className={`text-[0.75rem] font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>
                      {category}
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {items.map((product) => {
                        const selected = selectedProduct === product.key;
                        return (
                          <button
                            key={product.key}
                            type="button"
                            onClick={() => setSelectedProduct(product.key)}
                            className={`w-full rounded-md border px-3 py-2 text-left transition text-sm ${
                              selected
                                ? isDark
                                  ? 'border-red-500 bg-red-500/15 text-white'
                                  : 'border-red-400 bg-red-50 text-slate-900'
                                : isDark
                                  ? 'border-gray-800 bg-black/20 text-gray-200 hover:border-red-500/60 hover:bg-red-500/10'
                                  : 'border-slate-200 bg-white text-slate-900 hover:border-red-300 hover:bg-red-50'
                            }`}
                          >
                            <div className="font-semibold leading-snug text-sm">{product.name}</div>
                            <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>{product.key}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <Flex flexDirection="row" justifyContent="center" className="gap-3 w-full mt-5">
          <Button
            className={
              isDark
                ? 'bg-transparent text-white border-red-500 hover:bg-red-600 hover:border-red-500'
                : 'bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600'
            }
            onClick={() => {
              closeModal(modalName);
              setMinerKey('');
              setByodLicense('');
            }}
          >
            Close
          </Button>
          <Button
            className={
              isDark
                ? 'bg-red-600 text-white border-red-500 hover:bg-red-500 hover:border-red-400 disabled:opacity-60'
                : 'bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:text-white hover:border-red-600 disabled:opacity-60'
            }
            disabled={
              isSubmitting ||
              byodLicense.trim() === '' ||
              selectedProduct === '' ||
              !/^[A-Z0-9]+$/.test(byodLicense)
            }
            onClick={handleConvert}
          >
            {isSubmitting ? 'Converting…' : 'Convert'}
          </Button>
        </Flex>

        {minerKey && (
          <div
            className={`mt-4 rounded-lg border p-3 text-sm ${
              isDark ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            <div className="font-semibold">Your miner key</div>
            <div className={`mt-1 break-all font-mono ${isDark ? 'text-white' : 'text-slate-900'}`}>{minerKey}</div>
            <div className="mt-2 flex gap-2">
              <Button
                size="xs"
                className={
                  isDark
                    ? 'bg-transparent text-white border-red-500 hover:bg-red-600 hover:border-red-500'
                    : 'bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600 hover:text-white'
                }
                onClick={() => {
                  // Reuse the shared onboarding handler so validation + navigation stay consistent.
                  closeModal(modalName);
                  setMinerKey('');
                  setByodLicense('');
                  handleRegister(minerKey);
                }}
              >
                Start onboarding
              </Button>
            </div>
          </div>
        )}
      </DialogPanel>
    </Dialog>
  );
};

export default ByodConvertModal;
