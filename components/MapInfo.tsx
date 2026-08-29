import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import mapboxgl, { LngLat } from 'mapbox-gl';
import type { MapMouseEvent } from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useSession } from 'next-auth/react';
import type { SearchBoxRetrieveResponse } from '@mapbox/search-js-core';

const MapboxAutocomplete = dynamic(
  () => import('@mapbox/search-js-react').then((mod) => ({ default: mod.SearchBox })),
  { ssr: false }
);


mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

interface MapInfoData {
  latitude: number;
  longitude: number;
  [key: string]: unknown;
}

interface MapInfoProps {
  status?: string;
  minerKey?: string;
  data: MapInfoData;
  setData: (next: MapInfoData) => void;
  onNext: () => void;
  onSkip: () => void;
  onCancel: () => void;
}

const MapInfo = ({ status: _status, minerKey: _minerKey, data, setData, onNext, onSkip, onCancel }: MapInfoProps) => {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const marker = useRef<mapboxgl.Marker | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { data: session } = useSession();

  const initialCenterRef = useRef<[number, number]>([data.longitude, data.latitude]);
  const setDataRef = useRef(setData);

  useEffect(() => {
    setDataRef.current = setData;
  }, [setData]);

  useEffect(() => {
    const initializedMap = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v11',
      center: initialCenterRef.current,
      zoom: 3
    });

    mapRef.current = initializedMap;

    const handleMapClick = (event: MapMouseEvent) => {
      const lngLat = event.lngLat;

      setDataRef.current({ latitude: lngLat.lat, longitude: lngLat.lng });

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
    };

    initializedMap.on('click', handleMapClick);

    return () => {
      initializedMap.off('click', handleMapClick);
      initializedMap.remove();
    };
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

  const handleLocationRetrieve = (result: SearchBoxRetrieveResponse) => {
    const feature = result.features?.[0];
    const coordinates = Array.isArray(feature?.geometry?.coordinates)
      ? feature.geometry.coordinates
      : null;

    if (!coordinates || coordinates.length < 2) {
      return;
    }

    const [lng, lat] = coordinates;
    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
      return;
    }

    mapRef.current?.flyTo({ center: [parsedLng, parsedLat], zoom: 8 });
    setData({ latitude: parsedLat, longitude: parsedLng });
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
      const latitude = data.latitude;
      const longitude = data.longitude;
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 8 });
    }
  };

  const handleNext = async () => {
    if (validateForm()) {
      const { latitude, longitude } = data;
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 8 });
      setData({ latitude, longitude });

      // const saveData = {
      //   miner_key: _minerKey,
      //   position: {
      //     lat: latitude,
      //     lng: longitude
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

  return (
    <div className="flex h-full">
      <div className="flex flex-col w-full p-4">
        <div className="flex flex-row flex-wrap md:flex-nowrap items-center md:gap-4 mt-2 justify-between">
          <div className="w-full mb-1">
            <MapboxAutocomplete
              accessToken={mapboxgl.accessToken!}
              onRetrieve={handleLocationRetrieve}
              placeholder="Search location..."
            />
          </div>
          <div className="w-full md:w-1/4 mb-1 flex flex-wrap md:flex-nowrap md:justify-center items-center">
            <label className="mr-2 text-white">Latitude</label>
            <input
              type="text"
              className="p-2 rounded border border-red-600 w-full text-black"
              placeholder="Latitude"
              value={data.latitude.toString()}
              onChange={(e) => {
                const input = e.target.value;

                if (/^-?\d*\.?\d*$/.test(input)) {
                  setData({ ...data, latitude: Number(input) }); // Store the string value in state
                }
              }}
            />
            {errors.latitude && (
              <span className="text-red-500">{errors.latitude}</span>
            )}
          </div>

          <div className="w-full md:w-1/4 mb-1 flex flex-wrap md:flex-nowrap md:justify-center items-center">
            <label className="mr-2 text-white">Longitude</label>
            <input
              type="text"
              className="p-2 rounded border border-red-600 w-full text-black"
              placeholder="Longitude"
              value={data.longitude.toString()}
              onChange={(e) => {
                const input = e.target.value;

                if (/^-?\d*\.?\d*$/.test(input)) {
                  setData({ ...data, longitude: Number(input) }); // Store the string value in state
                }
              }}
            />
            {errors.longitude && (
              <span className="text-red-500">{errors.longitude}</span>
            )}
          </div>

          <button
            onClick={handleConfirmLocation}
            className="px-4 py-2 text-white border border-red-600 rounded mb-1 hover:bg-red-600" type="button"
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
            onClick={onCancel}
          >
            Cancel
          </button>
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
