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

async function loadMileagePoints() {
  try {
    const response = await fetch('mileposts.geojson');
    if (!response.ok) {
      throw new Error(`Failed to fetch mileage data (${response.status})`);
    }
    const geojson = await response.json();

    map.addSource('mileposts', {
      type: 'geojson',
      data: geojson
    });

    map.addLayer({
      id: 'mileposts-layer',
      type: 'symbol',
      source: 'mileposts',
      layout: {
        'icon-image': 'marker-15', // built-in marker icon from the style sprite
        'icon-size': 1.1,
        'icon-allow-overlap': true
      }
    });

    map.on('click', 'mileposts-layer', (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const { ELR, mileage } = feature.properties || {};
      new mapboxgl.Popup()
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>ELR:</strong> ${ELR || 'N/A'}<br/><strong>Mileage:</strong> ${
            mileage ?? 'N/A'
          }`
        )
        .addTo(map);
    });

    map.on('mouseenter', 'mileposts-layer', () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'mileposts-layer', () => {
      map.getCanvas().style.cursor = '';
    });
  } catch (error) {
    console.error('Unable to load mileage GeoJSON:', error);
  }
}

map.on('load', () => {
  console.log('Map loaded');
  geolocate.trigger(); // Automatically trigger location search on map load
  loadMileagePoints();
  loadMileageCsv();
});

// Utility: Convert the simple mileage CSV (elr,mileage,lat,lon) into GeoJSON.
function csvToGeoJSON(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  const headers = lines.shift()?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
  const idx = {
    elr: headers.indexOf('elr'),
    mileage: headers.indexOf('mileage'),
    lat: headers.indexOf('lat'),
    lon: headers.indexOf('lon')
  };

  const features = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const values = line.split(',').map((v) => v.trim());
    const lat = parseFloat(values[idx.lat]);
    const lon = parseFloat(values[idx.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const mileageRaw = values[idx.mileage];
    const mileage = mileageRaw === undefined ? null : Number(mileageRaw) || mileageRaw;

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { ELR: values[idx.elr] ?? 'N/A', mileage }
    });
  }

  return { type: 'FeatureCollection', features };
}

// Load markers directly from the CSV in Access and Mile Post/Mileage database.csv.
async function loadMileageCsv() {
  try {
    // Use a flat path that works in static hosting (e.g., Vercel/public root)
    const response = await fetch('mileage-database.csv');
    if (!response.ok) throw new Error(`Failed to fetch mileage CSV (${response.status})`);

    const csvText = await response.text();
    const geojson = csvToGeoJSON(csvText);

    map.addSource('mileage-csv', { type: 'geojson', data: geojson });
    map.addLayer({
      id: 'mileage-csv-layer',
      type: 'symbol',
      source: 'mileage-csv',
      layout: {
        'icon-image': 'marker-15',
        'icon-size': 1.1,
        'icon-allow-overlap': true
      }
    });

    map.on('click', 'mileage-csv-layer', (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const { ELR, mileage } = feature.properties || {};
      new mapboxgl.Popup()
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>ELR:</strong> ${ELR || 'N/A'}<br/><strong>Mileage:</strong> ${
            mileage ?? 'N/A'
          }`
        )
        .addTo(map);
    });

    map.on('mouseenter', 'mileage-csv-layer', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'mileage-csv-layer', () => {
      map.getCanvas().style.cursor = '';
    });
  } catch (error) {
    console.error('Unable to load mileage CSV:', error);
  }
}
