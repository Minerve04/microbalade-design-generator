import { useEffect } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface Props {
  geometry: [number, number][]; // [lon, lat]
  waypoints: { lat: number; lon: number; label: string }[];
}

const numberIcon = (n: number) =>
  L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;border-radius:9999px;background:hsl(var(--primary));color:hsl(var(--primary-foreground));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:2px solid hsl(var(--background));box-shadow:0 1px 4px rgba(0,0,0,.3)">${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

const FitBounds = ({ points }: { points: [number, number][] }) => {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
  }, [map, points]);
  return null;
};

const BaladeMap = ({ geometry, waypoints }: Props) => {
  const latlngs = geometry.map(([lon, lat]) => [lat, lon] as [number, number]);
  const center = latlngs[0] ?? [waypoints[0]?.lat ?? 46.6, waypoints[0]?.lon ?? 2.5];
  return (
    <MapContainer center={center} zoom={15} scrollWheelZoom={false} zoomControl={false} className="absolute inset-0 z-0" attributionControl>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      {latlngs.length > 1 && (
        <Polyline positions={latlngs} pathOptions={{ color: "hsl(var(--primary))", weight: 5, opacity: 0.9 }} />
      )}
      {waypoints.map((w, i) => (
        <Marker key={i} position={[w.lat, w.lon]} icon={numberIcon(i + 1)} title={w.label} />
      ))}
      <FitBounds points={latlngs} />
    </MapContainer>
  );
};

export default BaladeMap;
