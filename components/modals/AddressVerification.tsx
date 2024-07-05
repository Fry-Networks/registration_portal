import React from 'react';
import { useForm } from 'react-hook-form';
import { Button, Dialog, DialogPanel, TextInput } from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import Autocomplete from 'react-google-autocomplete';
import { useModal } from '../../app/modalcontext';

interface AddressVerificationModalProps {
    modalName: string;
    onSubmit: (data: any) => void;
  }
  const AddressVerificationModal: React.FC<AddressVerificationModalProps> = ({ modalName, onSubmit }) => {
    const { modals, closeModal } = useModal();
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm();

  const handlePlaceSelected = (place: any) => {
    setValue('address', place.formatted_address);
  };

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
        <form onSubmit={handleSubmit(onSubmit)}>
          <h4 className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
            Verify Your Address
          </h4>
          <div className="mt-2">
            <Autocomplete
              apiKey="YOUR_GOOGLE_MAPS_API_KEY" // Replace with your Google Maps API key
              onPlaceSelected={handlePlaceSelected}
              types={['address']}
              className="w-full p-2 border border-gray-300 rounded"
            />
            <input
              type="hidden"
              {...register('address', { required: true })}
            />
            {errors.address && <p className="text-red-500">Address is required.</p>}
          </div>
          <Button type="submit" className="mt-4 w-full">
            Submit
          </Button>
        </form>
      </DialogPanel>
    </Dialog>
  );
};

export default AddressVerificationModal;
