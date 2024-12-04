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
import MessageUpdate from '../MessageUpdate';

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

  return (
    <Dialog
      open={modals[modalName]}
      onClose={() => closeModal(modalName)}
      static={true}
      className="z-[100]"
    >
      <DialogPanel className="sm:max-w-2xl">
        <div className="absolute right-0 top-0 pr-3 pt-3">
          <button
            type="button"
            className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
            onClick={() => closeModal(modalName)}
            aria-label="Close"
          >
            <RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
          </button>
        </div>
        <Title className="mb-5">Register a new device</Title>

        <TextInput
          type="text"
          value={miner_key}
          onChange={(e) => setMinerKey(e.target.value)}
          placeholder="Enter your miner key to onboard"
          className="mt-2 mb-2"
          error={!/\b([A-Z]{2,6})-[A-Z0-9]{32}\b/gm.test(miner_key)}
          errorMessage="Invalid miner key"
        />
        <Flex
          flexDirection="row"
          justifyContent="center"
          className="gap-3 w-full mt-5"
        >
          <Button
            className="bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600"
            onClick={() => closeModal(modalName)}
          >
            Close
          </Button>
          <Button
            className="bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600"
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
