import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useSession } from 'next-auth/react';
import MessageUpdate from './messageUpdate';
const MapboxAutocomplete = dynamic(() => import('react-mapbox-autocomplete'), {
  ssr: false
});

mapboxgl.accessToken =
  'REDACTED_ROTATE_ME';

const MapInfo = ({ status, minerKey, data, setData, onNext, onSkip }) => {
  const router = useRouter();
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isComplete, setIsComplete] = useState(false);
  const [lng, setLng] = useState(0);
  const [lat, setLat] = useState(0);
  const { data: session } = useSession();
  const [updateSuccess, setUpdateSuccess] = useState({
    status: 'success',
    message: ''
  });

  useEffect(() => {
    const initializedMap = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v11',
      center: [data.longitude, data.latitude],
      zoom: 3
    });
    mapRef.current = initializedMap;

    mapRef.current?.on('click', (e: any) => {
      const lngLat = e.lngLat;
      setLng(lngLat.lng);
      setLat(lngLat.lat);

      mapRef.current?.flyTo({
        center: [lngLat.lng, lngLat.lat],
        zoom: mapRef.current.getZoom()
      });
    });

    return () => mapRef.current?.remove();
  }, []);

  useEffect(() => {
    setLat(data.latitude);
    setLng(data.longitude);
    mapRef.current?.flyTo({
      center: [lng, lat],
      zoom: mapRef.current.getZoom()
    });
  }, [data]);

  const handleLocationSearch = (result: string, lat: number, long: number) => {
    mapRef.current?.flyTo({ center: [long, lat], zoom: 8 });
    setLng(long);
    setLat(lat);
  };

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};
    if (!data.latitude || isNaN(Number(data.latitude)))
      newErrors.latitude = 'Invalid latitude';
    if (!data.longitude || isNaN(Number(data.longitude)))
      newErrors.longitude = 'Invalid longitude';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleConfirmLocation = async () => {
    if (validateForm()) {
      const latitude = lat;
      const longitude = lng;
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 8 });
    }
  };

  const handleNext = async () => {
    if (validateForm()) {
      const latitude = lat;
      const longitude = lng;
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 8 });

      const saveData = {
        miner_key: minerKey,
        position: {
          lat: lat,
          lng: lng
        },
        address: session?.user.address
      };
      // Optionally send to backend
      const response = await fetch('/api/registrations/save-map-info', {
        method: 'POST',
        body: JSON.stringify(saveData),
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        onNext();
      } else {
        const data = await response.json();
        setUpdateSuccess({ status: 'error', message: data.message });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 5_000);
      }
    }
  };

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  return (
    <div className="flex h-full">
      <div className="flex flex-col w-full p-4">
        <div className="flex flex-col md:flex-row items-center gap-4 mt-2">
          <div className="w-1/2">
            <MapboxAutocomplete
              //@ts-ignore
              publicKey={mapboxgl.accessToken!}
              inputClass="form-control search rounded border border-red-600 w-full md:w-1/4 p-2"
              onSuggestionSelect={handleLocationSearch}
              resetSearch={true}
              placeholder="Search location..."
            />
          </div>
          <div className="px-16 md:px-24">
            <MessageUpdate updateSuccess={updateSuccess} />
          </div>
          <input
            type="text"
            className="p-2 rounded border border-red-600 w-full md:w-1/4 mb-6"
            placeholder="Latitude"
            value={lat}
            onChange={(e) => setLat(Number(e.target.value))}
          />
          {errors.latitude && (
            <span className="text-red-500">{errors.latitude}</span>
          )}
          <input
            type="text"
            className="p-2 rounded border border-red-600 w-full md:w-1/4 mb-6"
            placeholder="Longitude"
            value={lng}
            onChange={(e) => setLng(Number(e.target.value))}
          />
          {errors.longitude && (
            <span className="text-red-500">{errors.longitude}</span>
          )}
          <button
            onClick={handleConfirmLocation}
            className="px-4 py-2 text-white border border-red-600 rounded mb-6 hover:bg-red-600"
          >
            Confirm
          </button>
        </div>

        <div className="relative flex-1">
          <div id="map" className="w-full h-full border rounded"></div>
        </div>

        <div className="flex justify-end gap-4 mt-4 text-white">
          {/* <button
            type="button"
            className="px-4 py-2 border border-gray-500 rounded hover:bg-gray-500"
            onClick={onSkip}
          >
            Skip
          </button> */}
          <button
            type="button"
            className="px-4 py-2 border border-red-600 rounded hover:bg-red-600"
            onClick={handleNext}
          >
            {status ? 'Edit' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MapInfo;
