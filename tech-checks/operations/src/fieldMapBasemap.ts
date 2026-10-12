import L from 'leaflet';

/** Shared by the operational Field Map and its TV display. */
export function addFieldMapBasemap(map:L.Map) {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,
    attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);
}
