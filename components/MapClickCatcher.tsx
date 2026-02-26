// components/MapClickCatcher.tsx
import { useMapEvents } from 'react-leaflet';

export default function MapClickCatcher({ onClick }: { onClick: (latlng: [number, number]) => void }) {
  useMapEvents({
    click(e) {
      onClick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

