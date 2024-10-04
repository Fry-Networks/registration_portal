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
interface PositionModalProps {
  modalName: string;
  onSubmit: (data: any) => void;
}
const PositionModal: React.FC<PositionModalProps> = ({ modalName, onSubmit }) => {
  const { modals, closeModal } = useModal();
  const { register, handleSubmit, setValue, formState: { errors } } = useForm();
  const [geolocation, setGeolocation] = useState(false);
  const [position, setPosition] = useState<{ lat: number, lng: number } | null>(null);
  const handleFormSubmit = (data: any) => {
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
          <h4 className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong text-lg md:text-xl">
            Verify Your Location
          </h4>

          {/* Input Section */}
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Latitude input */}
            <div className="flex flex-col">
              <label htmlFor="latitude" className="block text-sm font-medium">
                Latitude:
              </label>
              <input
                id="latitude"
                type="number"
                step="any"
                {...register('latitude', { required: true })}
                className="border rounded-md p-2 w-full"
                placeholder="Enter Latitude"
                onChange={(e) => {
                  const newLat = parseFloat(e.target.value);
                  if (!isNaN(newLat) && position) {
                    handlePositionChange({ lat: newLat, lng: position.lng });
                  }
                }}
              />
              {errors.latitude && <p className="text-red-500">Latitude is required.</p>}
            </div>

            {/* Longitude input */}
            <div className="flex flex-col">
              <label htmlFor="longitude" className="block text-sm font-medium">
                Longitude:
              </label>
              <input
                id="longitude"
                type="number"
                step="any"
                {...register('longitude', { required: true })}
                className="border rounded-md p-2 w-full"
                placeholder="Enter Longitude"
                onChange={(e) => {
                  const newLng = parseFloat(e.target.value);
                  if (!isNaN(newLng) && position) {
                    handlePositionChange({ lat: position.lat, lng: newLng });
                  }
                }}
              />
              {errors.longitude && <p className="text-red-500">Longitude is required.</p>}
            </div>
          </div>

          {/* Map Section */}
          <div className="mt-4 h-64 md:h-96 w-full">
            {position && (
              <Map position={position} onPositionChange={handlePositionChange} />
            )}
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            className="mt-4 w-full md:w-auto px-6 py-2"
            disabled={!position && !errors.latitude && !errors.longitude}
          >
            Submit
          </Button>
        </form>
      </DialogPanel>
    </Dialog>
  );
};

export default PositionModal;