import React from 'react';
import { Button, Dialog, DialogPanel, TextInput } from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { useModal } from '../../app/modalcontext';

interface UpdateRewardModalProps {
  modalName: string;
  handleUpdateRewardWallet: (e: React.FormEvent) => void;
  rewardWallet: string;
  setRewardWallet: (value: string) => void;
  isValid: boolean;
}

const UpdateRewardModal: React.FC<UpdateRewardModalProps> = ({
  modalName,
  handleUpdateRewardWallet,
  rewardWallet,
  setRewardWallet,
  isValid
}) => {
  const { modals, closeModal } = useModal();

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
            <RiCloseLine
              className="h-5 w-5 shrink-0"
              aria-hidden={true}
            />
          </button>
        </div>
        <form onSubmit={handleUpdateRewardWallet}>
          <h4 className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
            Update Reward Wallet
          </h4>
          <TextInput
            type="text"
            value={rewardWallet}
            onChange={(e) => setRewardWallet(e.target.value)}
            placeholder="Enter new reward wallet"
            className="mt-2"
          />
          <Button type="submit" className={`mt-4 w-full ${isValid ? '' : 'bg-blue-300 cursor-not-allowed'}`} disabled={!isValid}>
            Update
          </Button>
        </form>
      </DialogPanel>
    </Dialog>
  );
};

export default UpdateRewardModal;
