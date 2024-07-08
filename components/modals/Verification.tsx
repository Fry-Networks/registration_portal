import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Dialog, DialogPanel, Button, Text } from '@tremor/react';
import dynamic from 'next/dynamic';
import { useModal } from '../../app/modalcontext';
import { RiCloseLine } from '@remixicon/react';

// Dynamically import the Map component with SSR disabled
const Map = dynamic(() => import('../Map'), {
  ssr: false,
  loading: () => (<Text>Loading map...</Text>)
});
interface VerificationModalProps {
  modalName: string;
  onSubmit: (data: any) => void;
}
const VerificationModal: React.FC<VerificationModalProps> = ({ modalName, onSubmit }) => {
  const { modals, closeModal } = useModal();
  const { register, handleSubmit, setValue, formState: { errors } } = useForm();
  const [geolocation, setGeolocation] = useState(false);
  const [position, setPosition] = useState<{ lat: number, lng: number } | null>(null);
  const handleFormSubmit = (data: any) => {
    console.log("Form data to be submitted:", data);
    onSubmit(data);
  };
  useEffect(() => {
    if (typeof window !== 'undefined') {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        if(result.state === 'denied') {
          console.log('Geolocation permission denied.');
          setGeolocation(false);
          return;
        } else if (result.state === 'granted') {
          setGeolocation(true);
        }
        navigator.geolocation.getCurrentPosition((position) => {
          console.log(position);
          const newPosition = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setPosition(newPosition);
          setValue('latitude', newPosition.lat);
          setValue('longitude', newPosition.lng);
        });
      });
    }
  }, [setValue]);

  const handlePositionChange = (newPosition: { lat: number, lng: number }) => {
    setPosition(newPosition);
    setValue('latitude', newPosition.lat);
    setValue('longitude', newPosition.lng);
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
        <form onSubmit={handleSubmit(handleFormSubmit)}>
          <h4 className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
            Verify Your Location
          </h4>
          <div className="mt-2">
            <input
              type="hidden"
              {...register('latitude', { required: true })}
            />
            <input
              type="hidden"
              {...register('longitude', { required: true })}
            />
            {errors.latitude && <p className="text-red-500">Latitude is required.</p>}
            {errors.longitude && <p className="text-red-500">Longitude is required.</p>}
            {!geolocation && <p className="text-red-500">Geolocation is disabled.</p>}
          </div>
          <div className="mt-4">
            {position && (
              <Map position={position} onPositionChange={handlePositionChange} />
            )}
          </div>
          <Button type="submit" className="mt-4 w-full" disabled={!position}>
            Submit
          </Button>
        </form>
      </DialogPanel>
    </Dialog>
  );
};

export default VerificationModal;