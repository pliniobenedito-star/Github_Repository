// Minimal Mapbox GL JS initializer.
// Expects a token set at `window.MAPBOX_TOKEN`.
if (!window.MAPBOX_TOKEN || window.MAPBOX_TOKEN === 'pk.eyJ1IjoicGxpbmlvLXBpY2NpbiIsImEiOiJjbWh0NWFwN20xOWIyMmtyNHJ1M3AyZXJzIn0.nv6q66EUGokaNIM92SK-1g') {
  console.warn('Mapbox token not set. Please set window.MAPBOX_TOKEN in index.html or replace the placeholder.');
}

mapboxgl.accessToken = window.MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/plinio-piccin/cmhw00fii000m01qwcuwq9yje', // neutral demo style that works with Mapbox GL-compatible runtimes
  center: [-2.639, 53.480],
  zoom: 15
});

// Add a default navigation control (zoom buttons)
map.addControl(new mapboxgl.NavigationControl());

// Add geolocate control to the map.
const geolocate = new mapboxgl.GeolocateControl({
  positionOptions: {
    enableHighAccuracy: true
  },
  trackUserLocation: true,
  showUserLocation: true
});

map.addControl(geolocate);

map.on('load', () => {
  console.log('Map loaded');
  geolocate.trigger(); // Automatically trigger location search on map load
});
