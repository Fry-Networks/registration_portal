import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icon
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

interface MapProps {
    position: { lat: number; lng: number };
    onPositionChange: (position: { lat: number; lng: number }) => void;
}

const MAX_DISTANCE_KM = 1; // Maximum allowed distance in kilometers

const Map: React.FC<MapProps> = ({ position, onPositionChange }) => {
    const [originalPosition] = useState(position);
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
        setIsClient(true);
    }, []);

    useEffect(() => {
        if (isClient) {
            const L = require('leaflet');
            delete L.Icon.Default.prototype._getIconUrl;
            L.Icon.Default.mergeOptions({
                iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
                iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
                shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
            });
        }
    }, [isClient]);

    const calculateDistance = (pos1: any, pos2: any) => {
        if (!isClient) return 0;
        const L = require('leaflet');
        return L.latLng(pos1).distanceTo(L.latLng(pos2)) / 1000;
    };

    const limitPosition = (newPos: any) => {
        if (!isClient) return newPos;
        const L = require('leaflet');
        const originalLatLng = L.latLng(originalPosition);
        const newLatLng = L.latLng(newPos);
        const distance = calculateDistance(originalLatLng, newLatLng);

        if (distance <= MAX_DISTANCE_KM) {
            return newLatLng;
        } else {
            const direction = originalLatLng.bearingTo(newLatLng);
            return originalLatLng.destinationPoint(MAX_DISTANCE_KM * 1000, direction);
        }
    };

    if (!isClient) {
        return <div>Loading map...</div>;
    }

    return (
        <div style={{ height: '400px', width: '100%' }}>
            <MapContainer center={position} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                <Marker
                    draggable={true}
                    position={position}
                    eventHandlers={{
                        dragend: (e) => {
                            const marker = e.target;
                            const newPosition = marker.getLatLng();
                            const limitedPosition = limitPosition(newPosition);
                            onPositionChange({ lat: limitedPosition.lat, lng: limitedPosition.lng });
                        },
                    }}
                />
            </MapContainer>
        </div>
    );
};


export default Map;