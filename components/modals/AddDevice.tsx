import React, { use, useEffect, useState } from 'react';
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
import { useModal } from '../../app/modalcontext';
import MessageUpdate from '../messageUpdate';
import { useTheme } from 'next-themes';

interface AddDeviceModalProps {
  modalName: string;
  handleRegister: (minerKey: string) => Promise<void>;
  address?: string;
}

const AddDeviceModal: React.FC<AddDeviceModalProps> = ({
  modalName,
  handleRegister,
  address
}: AddDeviceModalProps) => {
  const { modals, closeModal } = useModal();
  const [miner_key, setMinerKey] = useState('');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  return (
    <Dialog
      open={modals[modalName]}
      onClose={() => closeModal(modalName)}
      static={true}
      className="z-[100]"
    >
      <DialogPanel
        className={`max-w-full sm:max-w-2xl min-h-[100dvh] sm:min-h-0 rounded-none sm:rounded-2xl ${
          isDark
            ? 'bg-[#0b0b0f] text-white border border-gray-800 shadow-[0_18px_45px_rgba(0,0,0,0.6)]'
            : 'bg-white text-slate-900 border border-slate-200 shadow-[0_18px_45px_rgba(15,23,42,0.15)]'
        }`}
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
            <Title className={`mb-5 ${isDark ? 'text-white' : 'text-slate-900'}`}>Register a new device</Title>
            <TextInput
              type="text"
              value={miner_key}
              onChange={(e) => setMinerKey(e.target.value)}
              placeholder="Enter your miner key to onboard"
              className={`mt-2 mb-2 ${
                isDark
                  ? 'bg-[#0f0f16] text-white placeholder:text-gray-500 border border-gray-700 focus:border-red-500'
                  : 'bg-white text-slate-900 placeholder:text-slate-400 border border-slate-200 focus:border-red-500'
              }`}
              error={miner_key !== '' && !/\b([A-Z]{2,6})-[A-Z0-9]{32}\b/gm.test(miner_key)}
              errorMessage="Invalid miner key"
            />
            <Flex flexDirection="row" justifyContent="center" className="gap-3 w-full mt-5">
              <Button
                className={
                  isDark
                    ? 'bg-transparent text-white border-red-500 hover:bg-red-600 hover:border-red-500'
                    : 'bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600'
                }
                onClick={() => closeModal(modalName)}
              >
                Close
              </Button>
              <Button
                className={
                  isDark
                    ? 'bg-red-600 text-white border-red-500 hover:bg-red-500 hover:border-red-400 disabled:opacity-60'
                    : 'bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600 disabled:opacity-60'
                }
                disabled={!/\b([A-Z]{2,6})-[A-Z0-9]{32}\b/gm.test(miner_key)}
                onClick={() => {
                  closeModal(modalName);
                  handleRegister(miner_key);
                  setMinerKey('');
                }}
              >
                Register
              </Button>
            </Flex>
      </DialogPanel>
    </Dialog>
  );
};

export default AddDeviceModal;
