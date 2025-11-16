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

let milepostIconLoaded = false;
let milepostVisible = true;
let accessPointsVisible = true;
let accessIconLoaded = false;
let accessPointsFeatures = [];
let accessPointsReady = false;
let lastUserLocation = null;

async function ensureMilepostIcon() {
  if (milepostIconLoaded || map.hasImage('milepost-icon')) return;

  return new Promise((resolve) => {
    map.loadImage('mp-icon.png', (error, image) => {
      if (error || !image) {
        console.warn('Unable to load custom milepost icon (mp-icon.png); falling back to default marker.', error);
        return resolve();
      }
      map.addImage('milepost-icon', image);
      milepostIconLoaded = true;
      resolve();
    });
  });
}

async function ensureAccessIcon() {
  if (accessIconLoaded || map.hasImage('access-icon')) return;

  return new Promise((resolve) => {
    map.loadImage('access-icon.png', (error, image) => {
      if (error || !image) {
        console.warn('Unable to load access point icon (access-icon.png); falling back to default marker.', error);
        return resolve();
      }
      map.addImage('access-icon', image);
      accessIconLoaded = true;
      resolve();
    });
  });
}

function applyMilepostVisibility() {
  const visibility = milepostVisible ? 'visible' : 'none';
  ['mileposts-layer', 'mileage-csv-layer'].forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visibility);
    }
  });
}

function applyAccessPointsVisibility() {
  const visibility = accessPointsVisible ? 'visible' : 'none';
  ['access-points-layer'].forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visibility);
    }
  });
}

function haversineDistance(lngLat1, lngLat2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const [lon1, lat1] = lngLat1;
  const [lon2, lat2] = lngLat2;
  const R = 6371000; // meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function showNearestAccessPoint(userLngLat) {
  if (!accessPointsFeatures.length) return;
  let best = null;
  let bestDist = Infinity;
  for (const feature of accessPointsFeatures) {
    const coords = feature.geometry?.coordinates;
    if (!coords) continue;
    const dist = haversineDistance(userLngLat, coords);
    if (dist < bestDist) {
      bestDist = dist;
      best = feature;
    }
  }
  if (!best) return;

  const { ELR, mileage, name, type } = best.properties || {};
  new mapboxgl.Popup()
    .setLngLat(best.geometry.coordinates)
    .setHTML(
      `<strong>${name || 'Access Point'}</strong><br/>
       <strong>Type:</strong> ${type || 'N/A'}<br/>
       <strong>ELR:</strong> ${ELR || 'N/A'}<br/>
       <strong>Mileage:</strong> ${mileage || 'N/A'}<br/>
       <strong>Distance:</strong> ${(bestDist / 1000).toFixed(2)} km`
    )
    .addTo(map);

  map.easeTo({ center: best.geometry.coordinates, zoom: Math.max(map.getZoom(), 14) });
}

function addMilepostToggleControl() {
  const container = document.createElement('div');
  container.style.cssText =
    'position:absolute;top:10px;left:10px;z-index:1;background:#fff;padding:8px 10px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,0.2);font-family:sans-serif;font-size:13px;';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'milepost-toggle';
  checkbox.checked = milepostVisible;
  checkbox.addEventListener('change', () => {
    milepostVisible = checkbox.checked;
    applyMilepostVisibility();
  });

  const label = document.createElement('label');
  label.setAttribute('for', 'milepost-toggle');
  label.textContent = 'Show mileposts';
  label.style.marginLeft = '6px';

  const apCheckbox = document.createElement('input');
  apCheckbox.type = 'checkbox';
  apCheckbox.id = 'accesspoints-toggle';
  apCheckbox.checked = accessPointsVisible;
  apCheckbox.style.marginLeft = '12px';
  apCheckbox.addEventListener('change', () => {
    accessPointsVisible = apCheckbox.checked;
    applyAccessPointsVisibility();
  });

  const apLabel = document.createElement('label');
  apLabel.setAttribute('for', 'accesspoints-toggle');
  apLabel.textContent = 'Show access points';
  apLabel.style.marginLeft = '6px';

  container.appendChild(checkbox);
  container.appendChild(label);
  container.appendChild(apCheckbox);
  container.appendChild(apLabel);
  map.getContainer().appendChild(container);
}

// Add geolocate control to the map.
const geolocate = new mapboxgl.GeolocateControl({
  positionOptions: {
    enableHighAccuracy: true
  },
  trackUserLocation: true,
  showUserLocation: true
});

map.addControl(geolocate);
geolocate.on('geolocate', (event) => {
  lastUserLocation = [event.coords.longitude, event.coords.latitude];
  if (accessPointsReady) {
    showNearestAccessPoint(lastUserLocation);
  }
});

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

  const iconName = map.hasImage('milepost-icon') ? 'milepost-icon' : 'marker-15';
  map.addLayer({
    id: 'mileposts-layer',
      type: 'symbol',
      source: 'mileposts',
      minzoom: 13, // only show when zoomed in
      layout: {
        'icon-image': iconName, // custom icon if loaded, otherwise built-in marker
        'icon-size': 0.28, // smaller marker
        'icon-pitch-scale': 'viewport', // keep icon size consistent when zooming/pitching
        'icon-allow-overlap': true
      }
    });
    applyMilepostVisibility();

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
  ensureMilepostIcon().finally(() => {
    loadMileagePoints();
    loadMileageCsv();
    loadAccessPointsCsv();
  });
  addMilepostToggleControl();
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

// Convert Access Points CSV (elr,mileage,name,type,lat,lon) into GeoJSON.
function csvToAccessPointsGeoJSON(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  const headers = lines.shift()?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
  const idx = {
    elr: headers.indexOf('elr'),
    mileage: headers.indexOf('mileage'),
    name: headers.indexOf('name'),
    type: headers.indexOf('type'),
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

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        ELR: values[idx.elr] ?? 'N/A',
        mileage: values[idx.mileage] ?? 'N/A',
        name: values[idx.name] ?? 'N/A',
        type: values[idx.type] ?? 'N/A'
      }
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
  const iconName = map.hasImage('milepost-icon') ? 'milepost-icon' : 'marker-15';
  map.addLayer({
    id: 'mileage-csv-layer',
      type: 'symbol',
      source: 'mileage-csv',
      minzoom: 13,
      layout: {
        'icon-image': iconName,
        'icon-size': 0.28, // smaller marker
        'icon-pitch-scale': 'viewport',
      'icon-allow-overlap': true
    }
  });
    applyMilepostVisibility();

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

// Load Access Points from CSV.
async function loadAccessPointsCsv() {
  try {
    const response = await fetch('access-points.csv');
    if (!response.ok) throw new Error(`Failed to fetch access points CSV (${response.status})`);

    const csvText = await response.text();
    const geojson = csvToAccessPointsGeoJSON(csvText);
    accessPointsFeatures = geojson.features || [];

    await ensureAccessIcon();

    map.addSource('access-points', { type: 'geojson', data: geojson });
    const iconName = map.hasImage('access-icon')
      ? 'access-icon'
      : map.hasImage('milepost-icon')
      ? 'milepost-icon'
      : 'marker-15';
    map.addLayer({
      id: 'access-points-layer',
      type: 'symbol',
      source: 'access-points',
      minzoom: 13,
      layout: {
        'icon-image': iconName,
        'icon-size': 0.36, // 30% larger than milepost icon (0.28)
        'icon-pitch-scale': 'viewport',
        'icon-allow-overlap': true
      }
    });
    applyAccessPointsVisibility();

    map.on('click', 'access-points-layer', (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const { ELR, mileage, name, type } = feature.properties || {};
      new mapboxgl.Popup()
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>${name || 'Access Point'}</strong><br/>
           <strong>Type:</strong> ${type || 'N/A'}<br/>
           <strong>ELR:</strong> ${ELR || 'N/A'}<br/>
           <strong>Mileage:</strong> ${mileage || 'N/A'}`
        )
        .addTo(map);
    });

    map.on('mouseenter', 'access-points-layer', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'access-points-layer', () => {
      map.getCanvas().style.cursor = '';
    });

    accessPointsReady = true;
    if (lastUserLocation) {
      showNearestAccessPoint(lastUserLocation);
    }
  } catch (error) {
    console.error('Unable to load access points CSV:', error);
  }
}
