import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
const MapboxAutocomplete = dynamic(() => import('react-mapbox-autocomplete'), { ssr: false });

mapboxgl.accessToken = 'REDACTED_ROTATE_ME';

const MapInfo = ({ data, setData, onNext, onSkip }) => {
    const router = useRouter();
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [errors, setErrors] = useState<{ [key: string]: string }>({});
    const [isComplete, setIsComplete] = useState(false);

    useEffect(() => {
        const initializedMap = new mapboxgl.Map({
            container: 'map',
            style: 'mapbox://styles/mapbox/streets-v11',
            center: [40, 40],
            zoom: 3,
        });
        mapRef.current = initializedMap;

        return () => mapRef.current?.remove();
    }, []);

    const handleLocationSearch = (result: string, lat: number, long: number) => {
        mapRef.current?.flyTo({ center: [long, lat], zoom: 8 });
        setData({ ...data, latitude: lat.toString(), longitude: long.toString() });
    };

    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};
        if (!data.latitude || isNaN(Number(data.latitude))) newErrors.latitude = 'Invalid latitude';
        if (!data.longitude || isNaN(Number(data.longitude))) newErrors.longitude = 'Invalid longitude';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleConfirmLocation = async () => {
        if (validateForm()) {
            const latitude = parseFloat(data.latitude);
            const longitude = parseFloat(data.longitude);
            mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 8 });
        }
    };

    const handleNext = async () => {
        if (validateForm()) {
            const latitude = parseFloat(data.latitude);
            const longitude = parseFloat(data.longitude);
            mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 8 });

            // Optionally send to backend
            await fetch('/api/saveLocation', {
                method: 'POST',
                body: JSON.stringify({ latitude, longitude }),
                headers: { 'Content-Type': 'application/json' },
            });

            setIsComplete(true);
            onNext(); // Call the onNext function to proceed to the next section
        }
    }

    const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

    return (
        <div className="flex h-full">
            <div className="flex flex-col w-full p-4">
                <div className="flex flex-col md:flex-row items-center gap-4 mt-2">
                    <div className="w-1/2">
                        <MapboxAutocomplete
                            publicKey={mapboxgl.accessToken!}
                            inputClass="form-control search rounded border border-red-600 w-full md:w-1/4 p-2"
                            onSuggestionSelect={handleLocationSearch}
                            resetSearch={true}
                            placeholder="Search location..."
                        />
                    </div>
                    <input
                        type="text"
                        className="p-2 rounded border border-red-600 w-full md:w-1/4 mb-6"
                        placeholder="Latitude"
                        value={data.latitude}
                        onChange={(e) => setData({ ...data, latitude: e.target.value })}
                    />
                    {errors.latitude && <span className="text-red-500">{errors.latitude}</span>}
                    <input
                        type="text"
                        className="p-2 rounded border border-red-600 w-full md:w-1/4 mb-6"
                        placeholder="Longitude"
                        value={data.longitude}
                        onChange={(e) => setData({ ...data, longitude: e.target.value })}
                    />
                    {errors.longitude && <span className="text-red-500">{errors.longitude}</span>}
                    <button
                        onClick={handleConfirmLocation}
                        className="px-4 py-2 text-white border border-red-600 rounded mb-6"
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
                        className="px-4 py-2 border border-gray-500 rounded"
                        onClick={onSkip}
                    >
                        Skip
                    </button>
                    <button
                        type="button"
                        className="px-4 py-2 border border-red-600 rounded"
                        onClick={handleNext}
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MapInfo;
