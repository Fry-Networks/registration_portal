import { useEffect, useState } from 'react';
import { Dialog, DialogPanel, Button, Callout } from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { CheckCircleIcon } from '@heroicons/react/outline';
import { useModal } from '../../app/modalcontext';
import { useWallet } from '@txnlab/use-wallet';
import { useRouter } from 'next/router';

interface WithdrawStakeProps {
  modalName: string;
  miner?: string;
  staked?: number;
}

export default function WithdrawStakeVerification({
  modalName,
  miner,
  staked
}: WithdrawStakeProps) {
  const router = useRouter();
  const { modals, closeModal } = useModal();
  const { activeAccount } = useWallet();
  const [updateSuccess, setUpdateSuccess] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [disabled, setDisabled] = useState<boolean>(false);
  const [available, setAvailable] = useState<{
    available: boolean;
    availableIn: number;
  }>({
    available: false,
    availableIn: 0
  });

  // Fetch availability for withdrawal
  useEffect(() => {
    const fetchAvailable = async () => {
      try {
        const response = await fetch('/api/stake-available', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address: activeAccount?.address,
            miner_key: miner
          })
        });

        if (response.ok) {
          const data = await response.json();
          setAvailable(data.data);
        }
      } catch (error) {
        console.error('Error fetching stake availability:', error);
      }
    };

    if (miner) {
      fetchAvailable();
    }
  }, [miner, activeAccount]);

  // Handle stake withdrawal
  const handleWithdrawal = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/stake-withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: activeAccount?.address,
          miner_key: miner
        })
      });

      if (response.ok) {
        const data = await response.json();
        setUpdateSuccess('Your stake has been withdrawn successfully');
        setDisabled(true);
        router.reload();
      } else {
        setUpdateSuccess('error');
      }
    } catch (error) {
      console.error('Error during withdrawal:', error);
      setUpdateSuccess('error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog
      open={modals[modalName]}
      onClose={() => closeModal(modalName)}
      static={true}
      className="z-[100]"
    >
      <DialogPanel className="max-w-xl">
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

        {/* Success Callout */}
        {updateSuccess && updateSuccess !== 'error' && (
          <Callout
            className="mt-4 mb-4"
            title="Success"
            icon={CheckCircleIcon}
            color="teal"
          >
            {updateSuccess}
          </Callout>
        )}

        {/* Error Callout */}
        {updateSuccess === 'error' && (
          <Callout
            className="mt-4 mb-4"
            title="Error"
            icon={CheckCircleIcon}
            color="red"
          >
            Error sending transaction. Please contact us before trying again!
          </Callout>
        )}

        <form onSubmit={(e) => e.preventDefault()}>
          <h4 className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
            Withdraw your verification stake ({staked} $FRY)
          </h4>
          <p className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
            Withdrawing your stake will remove your miner from the verification
            list. You will need to stake again to verify your miner.
          </p>

          <Button
            className="mt-4"
            color="blue"
            onClick={handleWithdrawal}
            disabled={isLoading || !available.available || disabled}
          >
            {available.availableIn > 0
              ? available.availableIn * 24 > 24
                ? `${(available.availableIn / 1).toFixed(0)} days`
                : available.availableIn * 24 > 1
                  ? `${(available.availableIn * 24).toFixed(0)} hours`
                  : `${Math.floor(available.availableIn * 24 * 60)} minutes ${Math.floor(
                      (available.availableIn * 24 * 60 * 60) % 60
                    )} seconds`
              : isLoading
                ? 'Processing...'
                : 'Withdraw'}
          </Button>
        </form>
      </DialogPanel>
    </Dialog>
  );
}
