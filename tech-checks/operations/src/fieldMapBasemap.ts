import L from 'leaflet';

/** Shared by the operational Field Map, the Fleet dashboard map and the TV display.
 *
 * A real dark basemap, not a light one turned inside out. The board used to draw
 * OpenStreetMap's standard (light) tiles and then darken them in CSS with
 * `grayscale(1) invert(1) ... contrast(.75)`. Greyscaling throws away the colour
 * that separates a motorway from a side street from water *before* the re-tint,
 * and the contrast cut flattens what survives, so streets and labels washed out
 * and the map read as empty at every zoom. CARTO's dark_all tiles are drawn dark
 * at source, so the road hierarchy and the labels stay legible and no filter is
 * needed. If you add a filter to `.leaflet-tile-pane` again, this comes back.
 */
export function addFieldMapBasemap(map:L.Map) {
  return L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
    subdomains:'abcd',
    maxZoom:20,
    attribution:'&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(map);
}
