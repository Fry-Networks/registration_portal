import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import mapboxgl, { LngLat, Map } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useSession } from 'next-auth/react';
import MessageUpdate from './messageUpdate';
import { LatLng } from 'leaflet';
const MapboxAutocomplete = dynamic(() => import('react-mapbox-autocomplete'), {
  ssr: false
});

mapboxgl.accessToken =
  'REDACTED_ROTATE_ME';

const MapInfo = ({ status, minerKey, data, setData, onNext, onSkip }) => {
  const router = useRouter();
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isComplete, setIsComplete] = useState(false);
  const [lng, setLng] = useState(0.0);
  const [lat, setLat] = useState(0.0);
  const { data: session } = useSession();

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

      setData({ latitude: lngLat.lat, longitude: lngLat.lng });

      mapRef.current?.flyTo({
        center: [lngLat.lng, lngLat.lat],
        zoom: mapRef.current.getZoom()
      });

      if (!marker.current) {
        const newMarker = new mapboxgl.Marker({
          color: `#FF0000` // Specify the color here using a hex code, RGB, RGBA, or HSLA value
        })
          .setLngLat(lngLat)
          .addTo(initializedMap);
        marker.current = newMarker;
      } else {
        // Marker exists, move it to the new location
        marker.current.setLngLat(lngLat);
      }
    });

    return () => mapRef.current?.remove();
  }, []);

  useEffect(() => {
    mapRef.current?.flyTo({
      center: [data.longitude, data.latitude],
      zoom: mapRef.current.getZoom()
    });

    if (!marker.current) {
      const newMarker = new mapboxgl.Marker({
        color: `#FF0000` // Specify the color here using a hex code, RGB, RGBA, or HSLA value
      })
        .setLngLat(new LngLat(data.longitude, data.latitude))
        .addTo(mapRef.current!);
      marker.current = newMarker;
    } else {
      // Marker exists, move it to the new location
      marker.current.setLngLat(new LngLat(data.longitude, data.latitude));
    }
  }, [data]);

  const handleLocationSearch = (result: string, lat: number, long: number) => {
    mapRef.current?.flyTo({ center: [long, lat], zoom: 8 });

    setData({ latitude: lat, longitude: long });
  };

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};
    if (!lat || isNaN(Number(lat))) newErrors.latitude = 'Invalid latitude';
    if (!lng || isNaN(Number(lng))) newErrors.longitude = 'Invalid longitude';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleConfirmLocation = async () => {
    if (validateForm()) {
      const latitude = lat;
      const longitude = lng;
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 8 });
      setData({ latitude: lat, longitude: longitude });
    }
  };

  const handleNext = async () => {
    if (validateForm()) {
      const latitude = lat;
      const longitude = lng;
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 8 });
      setData({ latitude: latitude, longitude: longitude });

      // const saveData = {
      //   miner_key: minerKey,
      //   position: {
      //     lat: lat,
      //     lng: lng
      //   },
      //   address: session?.user.address
      // };
      // // Optionally send to backend
      // const response = await fetch('/api/registrations/save-map-info', {
      //   method: 'POST',
      //   body: JSON.stringify(saveData),
      //   headers: { 'Content-Type': 'application/json' }
      // });

      // if (response.ok) {
      onNext();
      // } else {
      //   const data = await response.json();

      // }
    }
  };

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  return (
    <div className="flex h-full">
      <div className="flex flex-col w-full p-4">
        <div className="flex flex-row flex-wrap md:flex-nowrap items-center md:gap-4 mt-2 justify-between">
          <MapboxAutocomplete
            //@ts-ignore
            publicKey={mapboxgl.accessToken!}
            inputClass="form-control search rounded border border-red-600 p-2 !mb-1"
            onSuggestionSelect={handleLocationSearch}
            resetSearch={true}
            placeholder="Search location..."
          />
          <div className="w-full md:w-1/4 mb-1 flex flex-wrap md:flex-nowrap md:justify-center items-center">
            <label className="mr-2">Latitude</label>
            <input
              type="text"
              className="p-2 rounded border border-red-600 w-full "
              placeholder="Latitude"
              value={data.latitude.toString()}
              onChange={(e) => {
                const input = e.target.value;

                if (/^-?\d*\.?\d*$/.test(input)) {
                  setLat(Number(input)); // Store the string value in state
                }
              }}
            />
            {errors.latitude && (
              <span className="text-red-500">{errors.latitude}</span>
            )}
          </div>

          <div className="w-full md:w-1/4 mb-1 flex flex-wrap md:flex-nowrap md:justify-center items-center">
            <label className="mr-2">Longitude</label>
            <input
              type="text"
              className="p-2 rounded border border-red-600 w-full"
              placeholder="Longitude"
              value={data.longitude.toString()}
              onChange={(e) => {
                const input = e.target.value;

                if (/^-?\d*\.?\d*$/.test(input)) {
                  setLat(Number(input)); // Store the string value in state
                }
              }}
            />
            {errors.longitude && (
              <span className="text-red-500">{errors.longitude}</span>
            )}
          </div>

          <button
            onClick={handleConfirmLocation}
            className="px-4 py-2 text-white border border-red-600 rounded mb-1 hover:bg-red-600"
          >
            Confirm
          </button>
        </div>

        <div className="relative flex-1">
          <div id="map" className="w-full h-full border rounded"></div>
        </div>

        <div className="flex justify-end gap-4 mt-4 text-white">
          <button
            type="button"
            className="px-4 py-2 border border-gray-500 rounded hover:bg-gray-500"
            onClick={onSkip}
          >
            Back
          </button>
          <button
            type="button"
            className="px-4 py-2 border border-red-600 rounded hover:bg-red-600"
            onClick={handleNext}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default MapInfo;
