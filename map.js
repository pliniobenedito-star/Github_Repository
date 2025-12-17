// Minimal Mapbox GL JS initializer.
// Expects a token set at `window.MAPBOX_TOKEN`.
if (!window.MAPBOX_TOKEN || window.MAPBOX_TOKEN === 'pk.eyJ1IjoicGxpbmlvLXBpY2NpbiIsImEiOiJjbWh0NWFwN20xOWIyMmtyNHJ1M3AyZXJzIn0.nv6q66EUGokaNIM92SK-1g') {
  console.warn('Mapbox token not set. Please set window.MAPBOX_TOKEN in index.html or replace the placeholder.');
}

mapboxgl.accessToken = window.MAPBOX_TOKEN;

const CONTROL_SCALE = 1.5;
const CUSTOM_CONTROL_SIZE = Math.round(32 * CONTROL_SCALE); // previously 32px
const CUSTOM_ICON_SIZE = Math.round(22 * CONTROL_SCALE); // previously 22px
const CUSTOM_PADDING = Math.round(4 * CONTROL_SCALE); // previously 4px
const CUSTOM_MARGIN_SMALL = Math.round(8 * CONTROL_SCALE); // previously 8px
const CUSTOM_MARGIN_LARGE = Math.round(12 * CONTROL_SCALE); // previously 12px
const MAPBOX_CONTROL_SIZE = Math.round(29 * CONTROL_SCALE); // Mapbox default is 29px

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/plinio-piccin/cmhw00fii000m01qwcuwq9yje', // neutral demo style that works with Mapbox GL-compatible runtimes
  center: [-2.639, 53.480],
  zoom: 15
});

applyControlSizingOverrides();

// Add a default navigation control (zoom buttons)
map.addControl(new mapboxgl.NavigationControl());

let milepostIconLoaded = false;
let milepostVisible = true;
let accessPointsVisible = true;
let railLinesVisible = true; // show reference lines by default
let accessIconLoaded = false;
let accessPointsFeatures = [];
let accessPointsReady = false;
let lastUserLocation = null;
let nearestAccessVisible = false; // default off
let nearestAccessFeature = null;
let nearestAccessShown = false;
let nearestAccessPopup = null;
const lineSegmentsCache = new Map();
const chainageCalibrationCache = new Map();
let milepostChainageIndex = new Map();
let chainagePointsByLine = new Map();
let chainagePointsReady = false;
let lastChainageInterpolation = null;
let chainageSourceReady = false;
let fallbackChainageShown = false;

const CHAINAGE_TILESET_URL = 'mapbox://plinio-piccin.cmaat8tq';
const CHAINAGE_SOURCE_LAYER = 'NR_pts_wgs84-d5a8vl';
const CHAINAGE_SEARCH_RADIUS_METERS = 10000;
const TRACK_ID_TILESET_URL = 'mapbox://plinio-piccin.akrtnldh';
const TRACK_ID_SOURCE_LAYER = 'NetworkLinks_wgs84-5ofi5m';
// Zoom handoff: zoomed out shows the overview tileset, zoomed in shows the detailed tileset (not both).
// Mapbox layer visibility is: zoom >= minzoom and zoom < maxzoom.
const RAIL_TILESET_SWITCH_ZOOM = 5;
const TRACK_ID_MINZOOM = RAIL_TILESET_SWITCH_ZOOM;
const TRACK_ID_LABEL_MINZOOM = TRACK_ID_MINZOOM + 1.5;
const OVERVIEW_RAIL_TILESET_URL = 'mapbox://plinio-piccin.76fsxt78';
const OVERVIEW_RAIL_SOURCE_LAYER = 'railway_lines_wgs84-d26b87';
const OVERVIEW_RAIL_MINZOOM = 0;
const OVERVIEW_RAIL_MAXZOOM = RAIL_TILESET_SWITCH_ZOOM;
const RAIL_REFERENCE_MAX_ZOOM = 13.9;

function applyControlSizingOverrides() {
  const style = document.createElement('style');
  style.textContent = `
    .mapboxgl-ctrl-top-right .mapboxgl-ctrl-group button {
      width: ${MAPBOX_CONTROL_SIZE}px;
      height: ${MAPBOX_CONTROL_SIZE}px;
    }
  `;
  document.head.appendChild(style);
}

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
  ['mileage-csv-layer'].forEach((layerId) => {
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

function applyRailLinesVisibility() {
  const visibility = railLinesVisible ? 'visible' : 'none';
  [
    'rail-reference-lines-layer',
    'rail-reference-lines-label',
    'overview-rail-lines',
    'track-identification-lines',
    'track-identification-labels'
  ].forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visibility);
    }
  });
}

function applyNearestAccessVisibility() {
  const visibility = nearestAccessVisible ? 'visible' : 'none';
  if (map.getLayer('nearest-access-layer')) {
    map.setLayoutProperty('nearest-access-layer', 'visibility', visibility);
  }
  if (!nearestAccessVisible) {
    const source = map.getSource('nearest-access');
    if (source) {
      source.setData({ type: 'FeatureCollection', features: [] });
    }
  }
}

class RailLinesControl {
  onAdd(mapInstance) {
    this._map = mapInstance;
    const container = document.createElement('div');
    container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
    container.style.marginTop = `${CUSTOM_MARGIN_LARGE}px`; // breathing room beneath geolocate for touch targets

    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Toggle reference lines';
    button.setAttribute('aria-label', 'Toggle reference lines');
    button.style.padding = `${CUSTOM_PADDING}px`;
    button.style.width = `${CUSTOM_CONTROL_SIZE}px`;
    button.style.height = `${CUSTOM_CONTROL_SIZE}px`;
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.innerHTML = `<img src="Icon%20button/Reference_line.png" alt="Rail lines" width="${CUSTOM_ICON_SIZE}" height="${CUSTOM_ICON_SIZE}" />`;

    const setActiveState = () => {
      button.classList.toggle('active', railLinesVisible);
      button.style.backgroundColor = railLinesVisible ? '#dbeafe' : '#fff';
    };
    setActiveState();

    button.addEventListener('click', () => {
      railLinesVisible = !railLinesVisible;
      applyRailLinesVisibility();
      setActiveState();
    });

    container.appendChild(button);
    this._button = button;
    this._container = container;
    return container;
  }

  onRemove() {
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._map = undefined;
  }
}

class MilepostControl {
  onAdd(mapInstance) {
    this._map = mapInstance;
    const container = document.createElement('div');
    container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
    container.style.marginTop = `${CUSTOM_MARGIN_SMALL}px`;

    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Toggle mileposts';
    button.setAttribute('aria-label', 'Toggle mileposts');
    button.style.padding = `${CUSTOM_PADDING}px`;
    button.style.width = `${CUSTOM_CONTROL_SIZE}px`;
    button.style.height = `${CUSTOM_CONTROL_SIZE}px`;
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.innerHTML = `<img src="Icon%20button/milepost_icon.png" alt="Mileposts" width="${CUSTOM_ICON_SIZE}" height="${CUSTOM_ICON_SIZE}" />`;

    const setActiveState = () => {
      button.classList.toggle('active', milepostVisible);
      button.style.backgroundColor = milepostVisible ? '#dbeafe' : '#fff';
    };
    setActiveState();

    button.addEventListener('click', () => {
      milepostVisible = !milepostVisible;
      applyMilepostVisibility();
      setActiveState();
    });

    container.appendChild(button);
    this._button = button;
    this._container = container;
    return container;
  }

  onRemove() {
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._map = undefined;
  }
}

class AccessPointsControl {
  onAdd(mapInstance) {
    this._map = mapInstance;
    const container = document.createElement('div');
    container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
    container.style.marginTop = `${CUSTOM_MARGIN_SMALL}px`;

    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Toggle access points';
    button.setAttribute('aria-label', 'Toggle access points');
    button.style.padding = `${CUSTOM_PADDING}px`;
    button.style.width = `${CUSTOM_CONTROL_SIZE}px`;
    button.style.height = `${CUSTOM_CONTROL_SIZE}px`;
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.innerHTML = `<img src="Icon%20button/access_icon.png" alt="Access points" width="${CUSTOM_ICON_SIZE}" height="${CUSTOM_ICON_SIZE}" />`;

    const setActiveState = () => {
      button.classList.toggle('active', accessPointsVisible);
      button.style.backgroundColor = accessPointsVisible ? '#dbeafe' : '#fff';
    };
    setActiveState();

    button.addEventListener('click', () => {
      accessPointsVisible = !accessPointsVisible;
      applyAccessPointsVisibility();
      setActiveState();
    });

    container.appendChild(button);
    this._button = button;
    this._container = container;
    return container;
  }

  onRemove() {
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._map = undefined;
  }
}

class NearestAccessControl {
  onAdd(mapInstance) {
    this._map = mapInstance;
    const container = document.createElement('div');
    container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
    container.style.marginTop = `${CUSTOM_MARGIN_SMALL}px`;

    const button = document.createElement('button');
    button.type = 'button';
    button.title = 'Show nearest access point';
    button.setAttribute('aria-label', 'Show nearest access point');
    button.style.padding = `${CUSTOM_PADDING}px`;
    button.style.width = `${CUSTOM_CONTROL_SIZE}px`;
    button.style.height = `${CUSTOM_CONTROL_SIZE}px`;
    button.style.display = 'flex';
    button.style.alignItems = 'center';
    button.style.justifyContent = 'center';
    button.innerHTML = `<img src="Icon%20button/Show_access.png" alt="Nearest access" width="${CUSTOM_ICON_SIZE}" height="${CUSTOM_ICON_SIZE}" />`;

    const setActiveState = () => {
      button.classList.toggle('active', nearestAccessVisible);
      button.style.backgroundColor = nearestAccessVisible ? '#dbeafe' : '#fff';
    };
    setActiveState();

    button.addEventListener('click', () => {
      nearestAccessVisible = !nearestAccessVisible;
      if (nearestAccessVisible) {
        nearestAccessShown = false; // allow one jump after toggling on
        ensureNearestAccessLayer();
        if (accessPointsReady && lastUserLocation) {
          showNearestAccessPoint(lastUserLocation);
        }
      } else {
        nearestAccessShown = false;
        applyNearestAccessVisibility();
        if (nearestAccessPopup) {
          nearestAccessPopup.remove();
          nearestAccessPopup = null;
        }
      }
      applyNearestAccessVisibility();
      setActiveState();
    });

    container.appendChild(button);
    this._button = button;
    this._container = container;
    return container;
  }

  onRemove() {
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._map = undefined;
  }
}

async function fetchGeoJSONWithFallback(urls) {
  const errors = [];
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        return { url, data };
      }
      errors.push(`${url} (${response.status})`);
    } catch (error) {
      errors.push(`${url} (${error.message})`);
    }
  }
  throw new Error(`Unable to fetch GeoJSON: ${errors.join('; ')}`);
}

async function fetchGeoJSONIfAvailable(url) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      return { url, data };
    }
    console.warn(`GeoJSON not available at ${url} (${response.status})`);
  } catch (error) {
    console.warn(`Unable to reach ${url}:`, error);
  }
  return null;
}

function resolveStaticAssetUrl(path) {
  if (!path) return path;
  try {
    return new URL(path, window.location.href).toString();
  } catch (error) {
    console.warn('Unable to resolve asset URL:', path, error);
    return path;
  }
}

const WEB_MERCATOR_RADIUS = 6378137;
const METERS_PER_MILE = 1609.344;
const METERS_PER_YARD = 0.9144;
const MAX_MILEPOST_MATCH_DISTANCE_METERS = 500;
const OSGB36_PROJ4_DEF =
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs +type=crs';


function normalizeElr(value) {
  return value ? String(value).trim().toUpperCase() : '';
}

function toWebMercatorCoord(coord) {
  if (!Array.isArray(coord) || coord.length < 2) return null;
  const [lon, lat] = coord;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const x = (lon * Math.PI * WEB_MERCATOR_RADIUS) / 180;
  const y = WEB_MERCATOR_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

function flattenLineGeometry(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function buildSegmentsForGeometry(geometry) {
  const lines = flattenLineGeometry(geometry);
  if (!lines.length) return null;
  const segments = [];
  let totalLength = 0;
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const start = toWebMercatorCoord(line[i]);
      const end = toWebMercatorCoord(line[i + 1]);
      if (!start || !end) continue;
      const [ax, ay] = start;
      const [bx, by] = end;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      segments.push({ ax, ay, bx, by, len, start: totalLength });
      totalLength += len;
    }
  }
  return segments.length ? { segments, totalLength } : null;
}

function getFeatureKey(feature) {
  return feature?.properties?.__featureId ?? feature?.id ?? null;
}

function getSegmentsForFeature(feature) {
  if (!feature?.geometry) return null;
  const cacheKey = getFeatureKey(feature);
  if (!cacheKey) {
    return buildSegmentsForGeometry(feature.geometry);
  }
  if (lineSegmentsCache.has(cacheKey)) {
    return lineSegmentsCache.get(cacheKey);
  }
  const result = buildSegmentsForGeometry(feature.geometry);
  lineSegmentsCache.set(cacheKey, result);
  return result;
}

function projectAlongSegments(segmentsData, lngLat) {
  if (!segmentsData?.segments?.length || !lngLat) return null;
  const mercatorPoint = toWebMercatorCoord(lngLat);
  if (!mercatorPoint) return null;
  let best = null;
  for (const seg of segmentsData.segments) {
    const vx = seg.bx - seg.ax;
    const vy = seg.by - seg.ay;
    const wx = mercatorPoint[0] - seg.ax;
    const wy = mercatorPoint[1] - seg.ay;
    const segLenSq = vx * vx + vy * vy;
    let t = segLenSq === 0 ? 0 : (wx * vx + wy * vy) / segLenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = seg.ax + t * vx;
    const projY = seg.ay + t * vy;
    const dx = mercatorPoint[0] - projX;
    const dy = mercatorPoint[1] - projY;
    const dist = Math.hypot(dx, dy);
    const along = seg.start + t * seg.len;
    if (!best || dist < best.dist) {
      best = { dist, along };
    }
  }
  return best ? { along: best.along, totalLength: segmentsData.totalLength, dist: best.dist } : null;
}

function projectAlongFeature(feature, lngLat) {
  const segmentsData = getSegmentsForFeature(feature);
  if (!segmentsData) return null;
  return projectAlongSegments(segmentsData, lngLat);
}

function extractChainBreakpoints(feature) {
  const raw = feature?.properties?.chain_breakpoints;
  if (!Array.isArray(raw) || !raw.length) return null;
  const pairs = raw
    .map((entry) => {
      if (Array.isArray(entry)) {
        const ratio = Number(entry[0]);
        const mileage = Number(entry[1]);
        if (!Number.isFinite(ratio) || !Number.isFinite(mileage)) return null;
        return { ratio, mileage };
      }
      if (entry && typeof entry === 'object') {
        const ratio = Number(entry.ratio ?? entry.r ?? entry[0]);
        const mileage = Number(entry.miles ?? entry.m ?? entry.miles_dec ?? entry[1]);
        if (!Number.isFinite(ratio) || !Number.isFinite(mileage)) return null;
        return { ratio, mileage };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.ratio - b.ratio);
  return pairs.length ? pairs : null;
}

function buildMilepostIndex(features) {
  const index = new Map();
  for (const feature of features || []) {
    const elr = normalizeElr(feature?.properties?.ELR ?? feature?.properties?.elr);
    let mileage =
      Number(
        feature?.properties?.mileage ??
          feature?.properties?.Mileage ??
          feature?.properties?.miles_dec ??
          feature?.properties?.original_mileage ??
          feature?.properties?.projected_mileage
      );
    if (!Number.isFinite(mileage)) {
      const chainageMeters = Number(feature?.properties?.chainage ?? feature?.properties?.Chainage);
      if (Number.isFinite(chainageMeters)) {
        mileage = chainageMeters / METERS_PER_MILE;
      }
    }
    const coords = feature?.geometry?.coordinates;
    if (!elr || !Number.isFinite(mileage) || !Array.isArray(coords)) continue;
    if (!index.has(elr)) {
      index.set(elr, []);
    }
    index.get(elr).push({ mileage, coordinates: coords });
  }
  for (const posts of index.values()) {
    posts.sort((a, b) => a.mileage - b.mileage);
  }
  return index;
}

function ensureChainageCalibration(feature, posts) {
  const cacheKey = getFeatureKey(feature);
  if (!cacheKey) return null;
  if (chainageCalibrationCache.has(cacheKey)) {
    return chainageCalibrationCache.get(cacheKey);
  }
  const segmentsData = getSegmentsForFeature(feature);
  if (!segmentsData) {
    chainageCalibrationCache.set(cacheKey, null);
    return null;
  }
  let calibration = null;
  if (posts?.length) {
    const pairs = [];
    for (const post of posts) {
      const projection = projectAlongSegments(segmentsData, post.coordinates);
      if (!projection || !projection.totalLength) continue;
      if (Number.isFinite(projection.dist) && projection.dist > MAX_MILEPOST_MATCH_DISTANCE_METERS) {
        continue; // avoid pulling mileposts that are too far from this line
      }
      const ratio = projection.along / projection.totalLength;
      if (!Number.isFinite(ratio)) continue;
      pairs.push({ ratio, mileage: post.mileage });
    }
    pairs.sort((a, b) => a.ratio - b.ratio);
    const deduped = [];
    for (const pair of pairs) {
      const last = deduped[deduped.length - 1];
      if (last && Math.abs(pair.ratio - last.ratio) < 1e-6) {
        deduped[deduped.length - 1] = pair;
      } else {
        deduped.push(pair);
      }
    }
    calibration = deduped.length > 0 ? { pairs: deduped, totalLength: segmentsData.totalLength } : null;
  }

  if (!calibration) {
    const breakpointPairs = extractChainBreakpoints(feature);
    if (breakpointPairs?.length) {
      calibration = { pairs: breakpointPairs, totalLength: segmentsData.totalLength };
    }
  }

  chainageCalibrationCache.set(cacheKey, calibration);
  return calibration;
}

function interpolateMileageFromPairs(pairs, ratio) {
  if (!pairs?.length || !Number.isFinite(ratio)) return null;
  if (ratio <= pairs[0].ratio) return pairs[0].mileage;
  for (let i = 0; i < pairs.length - 1; i++) {
    const current = pairs[i];
    const next = pairs[i + 1];
    if (ratio >= current.ratio && ratio <= next.ratio) {
      const span = next.ratio - current.ratio;
      if (span === 0) {
        return next.mileage;
      }
      const localRatio = (ratio - current.ratio) / span;
      return current.mileage + localRatio * (next.mileage - current.mileage);
    }
  }
  return pairs[pairs.length - 1].mileage;
}

function mileageFromMileposts(feature, lngLat) {
  const props = feature?.properties || {};
  const elr = normalizeElr(props.ELR ?? props.elr);
  const posts = elr ? milepostChainageIndex.get(elr) : undefined;
  const calibration = ensureChainageCalibration(feature, posts);
  if (!calibration?.pairs?.length || !calibration.totalLength) return null;
  const projection = projectAlongFeature(feature, lngLat);
  if (!projection || !projection.totalLength) return null;
  const ratio = projection.along / projection.totalLength;
  return interpolateMileageFromPairs(calibration.pairs, ratio);
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

function ensureNearestAccessLayer() {
  if (!nearestAccessVisible) {
    applyNearestAccessVisibility();
    return;
  }
  if (!map.getSource('nearest-access')) {
    map.addSource('nearest-access', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!map.getLayer('nearest-access-layer')) {
    const iconName = map.hasImage('access-icon')
      ? 'access-icon'
      : map.hasImage('milepost-icon')
      ? 'milepost-icon'
      : 'marker-15';
    map.addLayer({
      id: 'nearest-access-layer',
      type: 'symbol',
      source: 'nearest-access',
      minzoom: 10,
      layout: {
        'icon-image': iconName,
        'icon-size': 0.336, // keep highlight larger while matching reduced base size
        'icon-pitch-scale': 'viewport',
        'icon-allow-overlap': true,
        'visibility': nearestAccessVisible ? 'visible' : 'none'
      }
    });
  }
  applyNearestAccessVisibility();
}

function showNearestAccessPoint(userLngLat) {
  if (!nearestAccessVisible) return;
  if (!accessPointsFeatures.length) return;
  if (nearestAccessShown) return; // only jump/open once per toggle
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
  if (nearestAccessPopup) {
    nearestAccessPopup.remove();
  }
  nearestAccessPopup = new mapboxgl.Popup()
    .setLngLat(best.geometry.coordinates)
    .setHTML(
      `<strong>${name || 'Access Point'}</strong><br/>
       <strong>Type:</strong> ${type || 'N/A'}<br/>
       <strong>ELR:</strong> ${ELR || 'N/A'}<br/>
       <strong>Mileage:</strong> ${mileage || 'N/A'}<br/>
       <strong>Distance:</strong> ${(bestDist / 1000).toFixed(2)} km`
    )
    .addTo(map);

  nearestAccessFeature = best;
  nearestAccessShown = true;
  ensureNearestAccessLayer();
  const source = map.getSource('nearest-access');
  if (source) {
    source.setData({
      type: 'FeatureCollection',
      features: [best]
    });
  }
  applyNearestAccessVisibility();
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

map.addControl(geolocate, 'top-right');
map.addControl(new RailLinesControl(), 'top-right');
map.addControl(new MilepostControl(), 'top-right');
map.addControl(new AccessPointsControl(), 'top-right');
map.addControl(new NearestAccessControl(), 'top-right');
geolocate.on('geolocate', (event) => {
  lastUserLocation = [event.coords.longitude, event.coords.latitude];
  if (accessPointsReady && nearestAccessVisible && !nearestAccessShown) {
    showNearestAccessPoint(lastUserLocation);
  }
  updateInterpolationForLocation(lastUserLocation, 'Your location chainage');
});

geolocate.on('error', () => {
  setInterpolationStatus('Location unavailable. Tap the map to see chainage there, or enable location services.');
  const center = map.getCenter();
  const fallbackLocation = [center.lng, center.lat];
  fallbackChainageShown = true;
  updateInterpolationForLocation(
    fallbackLocation,
    'Map center chainage (tap map or enable location to update for you)'
  );
});

function ensureOsgbProjection() {
  if (typeof window === 'undefined' || !window.proj4) {
    return false;
  }
  if (!window.proj4.defs('EPSG:27700')) {
    window.proj4.defs('EPSG:27700', OSGB36_PROJ4_DEF);
    console.log('Defined proj4 EPSG:27700');
  }
  return true;
}

function convertOsgbToWgs84(coord) {
  if (!Array.isArray(coord) || coord.length < 2) return null;
  if (!ensureOsgbProjection()) return null;
  const [x, y] = coord;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const [lon, lat] = window.proj4('EPSG:27700', 'EPSG:4326', [x, y]);
  return [lon, lat];
}

function reprojectRailGeoJSONToWgs84(geojson) {
  const crsName = geojson?.crs?.properties?.name || '';
  // If file already uses lon/lat (CRS84/EPSG:4326), return as-is to avoid double transforming.
  if (crsName.includes('CRS84') || crsName.includes('4326')) {
    return geojson;
  }

  if (!ensureOsgbProjection()) {
    console.warn('proj4 is not available; rail reference lines will not be reprojected.');
    return geojson;
  }

  const toLonLat = (coord) => {
    const converted = convertOsgbToWgs84(coord);
    return converted ?? coord;
  };

  const convertCoordinates = (coordinates, type) => {
    if (type === 'LineString') {
      return coordinates.map(toLonLat);
    }
    if (type === 'MultiLineString') {
      return coordinates.map((line) => line.map(toLonLat));
    }
    return coordinates;
  };

  return {
    ...geojson,
    features: (geojson.features || []).map((feature) => {
      if (!feature?.geometry?.coordinates) {
        return feature;
      }
      return {
        ...feature,
        geometry: {
          ...feature.geometry,
          coordinates: convertCoordinates(feature.geometry.coordinates, feature.geometry.type)
        }
      };
    })
  };
}

function reprojectPointGeoJSONToWgs84(geojson) {
  const crsName = geojson?.crs?.properties?.name || '';
  if (crsName.includes('CRS84') || crsName.includes('4326')) {
    return geojson;
  }
  if (!ensureOsgbProjection()) {
    console.warn('proj4 is not available; route points will not be reprojected.');
    return geojson;
  }

  return {
    ...geojson,
    features: (geojson.features || []).map((feature) => {
      const coords = feature?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) {
        return feature;
      }
      const converted = convertOsgbToWgs84(coords);
      return {
        ...feature,
        geometry: {
          ...feature.geometry,
          coordinates: converted ?? coords
        }
      };
    })
  };
}

function buildChainagePointIndex(features) {
  const byLine = new Map();
  for (const feature of features || []) {
    const props = feature?.properties || {};
    const lineRaw = props.lcat ?? props.line_id ?? props.route_id ?? props.RouteID;
    const lineId = lineRaw === 0 ? '0' : lineRaw ? String(lineRaw) : 'default';
    const chainMeters = Number(props.chainage ?? props.Chainage ?? props.chain ?? props.Chain);
    const coords = feature?.geometry?.coordinates;
    if (!Number.isFinite(chainMeters) || !Array.isArray(coords) || coords.length < 2) continue;
    const [lng, lat] = coords;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (!byLine.has(lineId)) {
      byLine.set(lineId, []);
    }
    byLine.get(lineId).push({
      chainMeters,
      lngLat: [lng, lat],
      properties: props
    });
  }

  for (const points of byLine.values()) {
    points.sort((a, b) => a.chainMeters - b.chainMeters);
  }

  return byLine;
}

async function loadChainagePoints() {
  try {
    console.log('Loading Network Rail chainage points from Mapbox tiles.');
    if (!map.getSource('chainage-points')) {
      map.addSource('chainage-points', {
        type: 'vector',
        url: CHAINAGE_TILESET_URL
      });
    }

    if (!map.getLayer('chainage-points-layer')) {
      map.addLayer({
        id: 'chainage-points-layer',
        type: 'circle',
        source: 'chainage-points',
        'source-layer': CHAINAGE_SOURCE_LAYER,
        minzoom: 0,
        layout: { visibility: 'visible' },
        paint: {
          'circle-radius': 0,
          'circle-opacity': 0
        }
      });
    }

    chainageSourceReady = true;
    chainagePointsReady = false;
    chainagePointsByLine = new Map();
    setInterpolationStatus('Loading Network Rail chainage points from Mapbox tiles...');
    if (lastUserLocation) {
      updateInterpolationForLocation(lastUserLocation, 'Your location chainage');
    } else if (!fallbackChainageShown) {
      const center = map.getCenter();
      const fallbackLocation = [center.lng, center.lat];
      fallbackChainageShown = true;
      updateInterpolationForLocation(
        fallbackLocation,
        'Map center chainage (tap map or enable location to update for you)'
      );
    }
  } catch (error) {
    console.error('Unable to load Network Rail chainage points from Mapbox tiles:', error);
    setInterpolationStatus('Unable to load Network Rail chainage points from Mapbox.');
  }
}

function refreshChainagePointsNear(userLngLat) {
  if (!chainageSourceReady || !map.getSource('chainage-points')) {
    return false;
  }

  const features = map.querySourceFeatures('chainage-points', { sourceLayer: CHAINAGE_SOURCE_LAYER }) || [];
  if (!features.length) {
    chainagePointsReady = false;
    return false;
  }

  const filtered = [];
  for (const feature of features) {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    if (userLngLat) {
      const distance = haversineDistance(userLngLat, coords);
      if (!Number.isFinite(distance) || distance > CHAINAGE_SEARCH_RADIUS_METERS) continue;
    }
    filtered.push({
      type: 'Feature',
      geometry: feature.geometry,
      properties: feature.properties
    });
  }

  if (!filtered.length) {
    chainagePointsReady = false;
    return false;
  }

  chainagePointsByLine = buildChainagePointIndex(filtered);
  chainagePointsReady = chainagePointsByLine.size > 0;
  lastChainageInterpolation = null;
  return chainagePointsReady;
}

function projectToSegmentRatio(startLngLat, endLngLat, targetLngLat) {
  const start = toWebMercatorCoord(startLngLat);
  const end = toWebMercatorCoord(endLngLat);
  const target = toWebMercatorCoord(targetLngLat);
  if (!start || !end || !target) return null;
  const vx = end[0] - start[0];
  const vy = end[1] - start[1];
  const wx = target[0] - start[0];
  const wy = target[1] - start[1];
  const denom = vx * vx + vy * vy;
  if (denom === 0) {
    return { ratio: 0, distanceMeters: Math.hypot(wx, wy) };
  }
  let t = (wx * vx + wy * vy) / denom;
  t = Math.max(0, Math.min(1, t));
  const projX = start[0] + t * vx;
  const projY = start[1] + t * vy;
  const distanceMeters = Math.hypot(target[0] - projX, target[1] - projY);
  return { ratio: t, distanceMeters };
}

function findNearestChainagePoint(userLngLat) {
  if (!chainagePointsByLine?.size) return null;
  let best = null;
  for (const [lineId, points] of chainagePointsByLine.entries()) {
    for (let i = 0; i < points.length; i++) {
      const distance = haversineDistance(userLngLat, points[i].lngLat);
      if (!best || distance < best.distance) {
        best = { lineId: String(lineId), index: i, point: points[i], distance };
      }
    }
  }
  return best;
}

function findChainageAnchors(nearest, userLngLat) {
  if (!nearest) return null;
  const points = chainagePointsByLine.get(nearest.lineId);
  if (!points?.length) return null;

  const prev = points[nearest.index - 1];
  const next = points[nearest.index + 1];
  let anchorB = null;

  if (prev && next) {
    const prevDist = haversineDistance(userLngLat, prev.lngLat);
    const nextDist = haversineDistance(userLngLat, next.lngLat);
    anchorB = prevDist < nextDist ? prev : next;
  } else {
    anchorB = next ?? prev ?? null;
  }

  if (!anchorB) return null;

  return {
    lineId: nearest.lineId,
    anchorA: nearest.point,
    anchorB,
    distanceMeters: nearest.distance
  };
}

function interpolateChainageFromNetworkRail(userLngLat) {
  const nearest = findNearestChainagePoint(userLngLat);
  const anchors = findChainageAnchors(nearest, userLngLat);
  if (!anchors?.anchorA || !anchors.anchorB) return null;
  const projection = projectToSegmentRatio(anchors.anchorA.lngLat, anchors.anchorB.lngLat, userLngLat);
  if (!projection) return null;
  const chainMeters =
    anchors.anchorA.chainMeters + projection.ratio * (anchors.anchorB.chainMeters - anchors.anchorA.chainMeters);

  return {
    ...anchors,
    chainMeters,
    distanceMeters: projection.distanceMeters
  };
}

let interpolationStatusEl = null;
let interpolationFillEl = null;
let interpolationSrText = null;
let interpolationTextEl = null;

function ensureInterpolationStyles() {
  if (document.getElementById('interpolation-style')) return;
  const style = document.createElement('style');
  style.id = 'interpolation-style';
  style.textContent = `
    @keyframes interpolation-indeterminate {
      0% { transform: translateX(-40%); }
      50% { transform: translateX(60%); }
      100% { transform: translateX(160%); }
    }
  `;
  document.head.appendChild(style);
}

function addInterpolationStatusControl() {
  if (interpolationStatusEl) return;
  ensureInterpolationStyles();
  const container = document.createElement('div');
  container.style.cssText =
    'position:absolute;left:0;right:0;bottom:0;z-index:2;pointer-events:none;';

  const track = document.createElement('div');
  track.style.cssText =
    'width:100%;height:6px;background:rgba(229,231,235,0.9);border-radius:0;overflow:hidden;';

  const fill = document.createElement('div');
  fill.style.cssText =
    'width:40%;height:100%;background:linear-gradient(90deg,#60a5fa,#2563eb,#60a5fa);animation:interpolation-indeterminate 1.1s linear infinite;border-radius:inherit;';
  track.appendChild(fill);

  const text = document.createElement('div');
  text.style.cssText =
    'width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:14px 16px;background:rgba(15,23,42,0.9);color:#e5e7eb;border-radius:0;font-size:20px;font-weight:700;line-height:1.3;box-shadow:0 -2px 10px rgba(0,0,0,0.18);pointer-events:none;text-align:center;white-space:normal;';
  text.textContent = 'Loading Network Rail chainage points...';

  const srText = document.createElement('span');
  srText.style.cssText = 'position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;';
  srText.textContent = 'Loading Network Rail chainage points...';

  container.appendChild(track);
  container.appendChild(text);
  container.appendChild(srText);
  container.style.display = 'none';
  interpolationStatusEl = container;
  interpolationFillEl = fill;
  interpolationSrText = srText;
  interpolationTextEl = text;
  map.getContainer().appendChild(container);
}

function setInterpolationStatus(message) {
  if (!interpolationStatusEl) {
    console.log(message);
    return;
  }
  const text = message || '';
  if (interpolationSrText) {
    interpolationSrText.textContent = text;
  }
  if (interpolationTextEl) {
    interpolationTextEl.textContent = text;
  }
  const isLoading = typeof message === 'string' && /loading/i.test(message);
  if (interpolationFillEl) {
    interpolationFillEl.style.animation = isLoading ? 'interpolation-indeterminate 1.1s linear infinite' : 'none';
    interpolationFillEl.style.width = isLoading ? '40%' : '100%';
    interpolationFillEl.style.opacity = isLoading ? '1' : '0.55';
  }
  const hasMessage = text.trim().length > 0;
  interpolationStatusEl.style.display = hasMessage ? 'block' : 'none';
}

function renderChainageInterpolationResult(result, contextLabel = 'Network Rail chainage') {
  lastChainageInterpolation = result;
  if (!result) {
    setInterpolationStatus(`${contextLabel} not available near you.`);
    return;
  }
  const chainText = formatMetersValue(result.chainMeters);
  const milesYardsText = formatMilesAndYardsFromMeters(result.chainMeters);
  setInterpolationStatus(`${contextLabel}: ${chainText} | ${milesYardsText}`);
}

function updateInterpolationForLocation(userLngLat, contextLabel = 'Network Rail chainage') {
  if (!userLngLat) {
    setInterpolationStatus('Tap the map or enable location services to see chainage at your position.');
    return;
  }
  if (!chainageSourceReady) {
    setInterpolationStatus('Loading Network Rail chainage tiles...');
    return;
  }

  const refreshed = refreshChainagePointsNear(userLngLat);
  if (!refreshed) {
    setInterpolationStatus('Network Rail chainage points are still loading from Mapbox tiles...');
    map.once('idle', () => {
      updateInterpolationForLocation(userLngLat, contextLabel);
    });
    return;
  }

  const result = interpolateChainageFromNetworkRail(userLngLat);
  renderChainageInterpolationResult(result, contextLabel);
}
function parseCoordText(text) {
  if (!text) return null;
  const parts = text
    .trim()
    .split(/\s+/)
    .map((value) => Number(value));
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
    return null;
  }
  return [parts[0], parts[1]];
}

function formatChainageMeters(value) {
  if (!Number.isFinite(value)) return 'N/A';
  const kilometers = Math.floor(value / 1000);
  const remainder = Math.abs(value - kilometers * 1000);
  const remainderStr = remainder.toFixed(3).padStart(7, '0');
  return `${kilometers}+${remainderStr}`;
}

function formatChainagePlain(value) {
  if (!Number.isFinite(value)) return 'N/A';
  return value.toFixed(3);
}

function formatMiles(value) {
  if (!Number.isFinite(value)) return 'N/A';
  return `${value.toFixed(3)} miles`;
}

function formatChainageWithMiles(chainageMeters) {
  return `${formatChainageMeters(chainageMeters)} (${formatMiles(chainageMeters / METERS_PER_MILE)})`;
}

function formatMetersValue(value) {
  if (!Number.isFinite(value)) return 'N/A';
  return `${value.toFixed(3)} m`;
}

function formatMilesFromMeters(meters) {
  if (!Number.isFinite(meters)) return 'N/A';
  return `${(meters / METERS_PER_MILE).toFixed(3)} mi`;
}

function formatYardsFromMeters(meters) {
  if (!Number.isFinite(meters)) return 'N/A';
  return `${(meters / METERS_PER_YARD).toFixed(1)} yd`;
}

function formatMilesYardsFromMeters(meters) {
  if (!Number.isFinite(meters)) return 'N/A';
  const miles = Math.floor(meters / METERS_PER_MILE);
  const yards = Math.round((meters - miles * METERS_PER_MILE) / METERS_PER_YARD);
  const yardsPadded = String(Math.max(0, yards)).padStart(4, '0');
  return `${miles}m ${yardsPadded}yds`;
}

function formatMilesAndYardsFromMeters(meters) {
  if (!Number.isFinite(meters)) return 'N/A';
  let miles = Math.floor(meters / METERS_PER_MILE);
  let yards = Math.round((meters - miles * METERS_PER_MILE) / METERS_PER_YARD);
  if (yards >= 1760) {
    miles += 1;
    yards -= 1760;
  }
  return `${miles} mile${miles === 1 ? '' : 's'} ${yards} yards`;
}

// Utility: approximate a mileage at a clicked point along a line/multiline
function mileageAtLocation(feature, lngLat) {
  const props = feature?.properties || {};
  const startMileage = Number(props.L_M_FROM ?? props.l_m_from);
  const endMileage = Number(props.L_M_TO ?? props.l_m_to);
  if (!Number.isFinite(startMileage) || !Number.isFinite(endMileage)) {
    return null;
  }
  const projection = projectAlongFeature(feature, lngLat);
  if (!projection || !projection.totalLength) {
    return null;
  }
  const ratio = projection.along / projection.totalLength;
  const mileage = startMileage + ratio * (endMileage - startMileage);
  return Number.isFinite(mileage) ? mileage : null;
}

function interpolateChainageFromPairs(pairs, ratio) {
  if (!pairs?.length || !Number.isFinite(ratio)) return null;
  if (ratio <= pairs[0].ratio) return pairs[0].chainage;
  for (let i = 0; i < pairs.length - 1; i++) {
    const current = pairs[i];
    const next = pairs[i + 1];
    if (ratio >= current.ratio && ratio <= next.ratio) {
      const span = next.ratio - current.ratio;
      if (span === 0) {
        return next.chainage;
      }
      const localRatio = (ratio - current.ratio) / span;
      return current.chainage + localRatio * (next.chainage - current.chainage);
    }
  }
  return pairs[pairs.length - 1].chainage;
}

function chainageAtLngLatFromFeature(feature, lngLat) {
  const pairs = feature?.properties?.chainagePairs;
  if (!pairs?.length) return null;
  const projection = projectAlongFeature(feature, lngLat);
  if (!projection || !projection.totalLength) return null;
  const ratio = projection.along / projection.totalLength;
  return interpolateChainageFromPairs(pairs, ratio);
}

function indexMilepostsByElr(features) {
  const mapByElr = new Map();
  for (const feature of features || []) {
    const elr = normalizeElr(feature?.properties?.ELR ?? feature?.properties?.elr);
    const mileage = Number(
      feature?.properties?.mileage ?? feature?.properties?.Mileage ?? feature?.properties?.miles_dec
    );
    const coords = feature?.geometry?.coordinates;
    if (!elr || !Number.isFinite(mileage) || !Array.isArray(coords)) continue;
    if (!mapByElr.has(elr)) {
      mapByElr.set(elr, []);
    }
    mapByElr.get(elr).push({ mileage, coordinates: coords });
  }
  return mapByElr;
}

function mergeProjectedMilepostsWithOriginal(projectedGeojson, originalGeojson) {
  if (!projectedGeojson && !originalGeojson) return null;
  if (!projectedGeojson || !originalGeojson) return projectedGeojson ?? originalGeojson;

  const originalIndex = indexMilepostsByElr(originalGeojson.features);

  const mergedFeatures = (projectedGeojson.features || []).map((feature) => {
    const elr = normalizeElr(feature?.properties?.ELR ?? feature?.properties?.elr);
    const coords = feature?.geometry?.coordinates;
    let bestMatch = null;

    if (elr && Array.isArray(coords) && originalIndex.has(elr)) {
      for (const candidate of originalIndex.get(elr)) {
        const distance = haversineDistance(coords, candidate.coordinates);
        if (!bestMatch || distance < bestMatch.distance) {
          bestMatch = { distance, mileage: candidate.mileage };
        }
      }
    }

    const projectedMileage = Number(
      feature?.properties?.mileage ?? feature?.properties?.Mileage ?? feature?.properties?.miles_dec
    );
    const shouldUseOriginal =
      bestMatch && Number.isFinite(bestMatch.mileage) && bestMatch.distance <= MAX_MILEPOST_MATCH_DISTANCE_METERS;
    const mileageToUse = shouldUseOriginal ? bestMatch.mileage : projectedMileage;

    const properties = {
      ...feature.properties,
      mileage: Number.isFinite(mileageToUse) ? mileageToUse : feature?.properties?.mileage,
      miles_dec: Number.isFinite(mileageToUse) ? mileageToUse : feature?.properties?.miles_dec,
      original_mileage: shouldUseOriginal ? bestMatch.mileage : undefined,
      projected_mileage: Number.isFinite(projectedMileage) ? projectedMileage : undefined,
      mileage_source: shouldUseOriginal
        ? 'original'
        : Number.isFinite(projectedMileage)
        ? 'projected'
        : 'unknown'
    };

    return { ...feature, properties };
  });

  return { ...projectedGeojson, features: mergedFeatures };
}

function describeTrackCode(trcodeRaw) {
  if (trcodeRaw === null || trcodeRaw === undefined) return 'Unknown';
  const codeStr = String(trcodeRaw).trim();
  if (!codeStr) return 'Unknown';

  const overrides = {
    '99': 'Siding',
    '39': 'Siding',
    '38': 'Bi-Directional',
    '49': 'Siding'
  };
  if (overrides[codeStr]) {
    return overrides[codeStr];
  }

  const directionMap = { '1': 'Up', '2': 'Down', '3': 'Bi-Directional', '4': 'Loop' };
  const trackTypeMap = {
    '1': 'Main',
    '2': 'Relief',
    '3': 'Goods',
    '4': 'Single',
    '5': 'Loop',
    '6': 'Bay Line',
    '7': 'Crossover',
    '8': 'Other',
    '9': 'Siding'
  };

  const direction = directionMap[codeStr[0]];
  const trackType = trackTypeMap[codeStr[1]];
  if (direction || trackType) {
    return [direction, trackType].filter(Boolean).join(' ');
  }
  return 'Unknown';
}

async function loadTrackIdentificationLines() {
  try {
    console.log('Loading track identification lines.');
    if (!map.getSource('track-identification')) {
      map.addSource('track-identification', {
        type: 'vector',
        url: TRACK_ID_TILESET_URL
      });
    }

    const trcodeValue = [
      'coalesce',
      ['to-string', ['get', 'TRCODE']],
      ['to-string', ['get', 'trcode']],
      ['to-string', ['get', 'tr_code']],
      ''
    ];
    const trackLabelExpression = [
      'match',
      trcodeValue,
      '11',
      'Up Main',
      '12',
      'Up Relief',
      '13',
      'Up Goods',
      '14',
      'Up Single',
      '15',
      'Up Loop',
      '16',
      'Up Bay Line',
      '17',
      'Up Crossover',
      '18',
      'Up Other',
      '19',
      'Up Siding',
      '21',
      'Down Main',
      '22',
      'Down Relief',
      '23',
      'Down Goods',
      '24',
      'Down Single',
      '25',
      'Down Loop',
      '26',
      'Down Bay Line',
      '27',
      'Down Crossover',
      '28',
      'Down Other',
      '29',
      'Down Siding',
      '31',
      'Bi-Directional Main',
      '32',
      'Bi-Directional Relief',
      '33',
      'Bi-Directional Goods',
      '34',
      'Bi-Directional Single',
      '35',
      'Bi-Directional Loop',
      '36',
      'Bi-Directional Bay Line',
      '37',
      'Bi-Directional Crossover',
      '38',
      'Bi-Directional',
      '39',
      'Siding',
      '41',
      'Loop Main',
      '42',
      'Loop Relief',
      '43',
      'Loop Goods',
      '44',
      'Loop Single',
      '45',
      'Loop Loop',
      '46',
      'Loop Bay Line',
      '47',
      'Loop Crossover',
      '48',
      'Loop Other',
      '49',
      'Siding',
      '99',
      'Siding',
      'Unknown'
    ];
    const trackLabelField = ['case', ['==', trackLabelExpression, 'Unknown'], '', trackLabelExpression];

    if (!map.getLayer('track-identification-lines')) {
      map.addLayer({
        id: 'track-identification-lines',
        type: 'line',
        source: 'track-identification',
        'source-layer': TRACK_ID_SOURCE_LAYER,
        minzoom: TRACK_ID_MINZOOM,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: railLinesVisible ? 'visible' : 'none'
        },
        paint: {
          'line-color': '#1d4ed8',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            TRACK_ID_MINZOOM,
            2.25,
            TRACK_ID_MINZOOM + 2,
            3.5,
            TRACK_ID_MINZOOM + 4,
            5
          ],
          'line-opacity': 0.9
        }
      });

      if (!map.getLayer('track-identification-labels')) {
        map.addLayer({
          id: 'track-identification-labels',
          type: 'symbol',
          source: 'track-identification',
          'source-layer': TRACK_ID_SOURCE_LAYER,
          minzoom: TRACK_ID_LABEL_MINZOOM,
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 250,
            'text-field': trackLabelField,
            'text-size': [
              'interpolate',
              ['linear'],
              ['zoom'],
              TRACK_ID_LABEL_MINZOOM,
              12,
              TRACK_ID_LABEL_MINZOOM + 2,
              14.5,
              TRACK_ID_LABEL_MINZOOM + 4,
              16
            ],
            'text-allow-overlap': false,
            'text-keep-upright': true,
            'text-pitch-alignment': 'map',
            'text-rotation-alignment': 'map',
            visibility: railLinesVisible ? 'visible' : 'none'
          },
          paint: {
            'text-color': '#0f172a',
            'text-halo-color': '#e5e7eb',
            'text-halo-width': 1.2
          }
        });
      }

      map.on('click', 'track-identification-lines', (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const trcode = feature.properties?.TRCODE ?? feature.properties?.trcode ?? feature.properties?.tr_code;
        const description = describeTrackCode(trcode);
        new mapboxgl.Popup()
          .setLngLat(event.lngLat)
          .setHTML(
            `<strong>TRCODE:</strong> ${trcode ?? 'N/A'}<br/>` +
              `<strong>Track:</strong> ${description}`
          )
          .addTo(map);
      });

      map.on('mouseenter', 'track-identification-lines', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'track-identification-lines', () => {
        map.getCanvas().style.cursor = '';
      });
    }

    applyRailLinesVisibility();
  } catch (error) {
    console.error('Unable to load track identification lines:', error);
  }
}

async function loadOverviewRailLines() {
  try {
    console.log('Loading overview railway lines.');
    if (!map.getSource('overview-rail-lines')) {
      map.addSource('overview-rail-lines', {
        type: 'vector',
        url: OVERVIEW_RAIL_TILESET_URL
      });
    }

    if (!map.getLayer('overview-rail-lines')) {
      map.addLayer({
        id: 'overview-rail-lines',
        type: 'line',
        source: 'overview-rail-lines',
        'source-layer': OVERVIEW_RAIL_SOURCE_LAYER,
        minzoom: OVERVIEW_RAIL_MINZOOM,
        maxzoom: OVERVIEW_RAIL_MAXZOOM,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
          visibility: railLinesVisible ? 'visible' : 'none'
        },
        paint: {
          'line-color': '#2563eb',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            OVERVIEW_RAIL_MINZOOM,
            1.1,
            OVERVIEW_RAIL_MAXZOOM,
            2.1
          ],
          'line-opacity': 0.8
        }
      });
    }

    applyRailLinesVisibility();
  } catch (error) {
    console.error('Unable to load overview railway lines:', error);
  }
}

async function loadRailReferenceLines() {
  try {
    console.log('Loading rail reference lines.');
    const { data: rawGeojson, url } = await fetchGeoJSONWithFallback([
      resolveStaticAssetUrl('chainage-strings.geojson'),
      resolveStaticAssetUrl('Rail_reference_line.geojson')
    ]);
    const shouldReproject = !url.includes('chainage-strings.geojson');
    const geojson = shouldReproject ? reprojectRailGeoJSONToWgs84(rawGeojson) : rawGeojson;
    const featureCount = (geojson.features || []).length;
    console.log(`Rail reference lines loaded from ${url}: ${featureCount} features`);
    (geojson.features || []).forEach((feature, index) => {
      if (!feature.properties) {
        feature.properties = {};
      }
      if (!feature.properties.__featureId) {
        const fallbackId =
          feature.properties.OBJECTID ??
          feature.properties.ASSETID ??
          `${feature.properties.ELR ?? 'line'}-${index}`;
        feature.properties.__featureId = String(fallbackId);
      }
    });
    lineSegmentsCache.clear();
    chainageCalibrationCache.clear();

    map.addSource('rail-reference-lines', {
      type: 'geojson',
      data: geojson
    });

    map.addLayer({
      id: 'rail-reference-lines-layer',
      type: 'line',
      source: 'rail-reference-lines',
      maxzoom: RAIL_REFERENCE_MAX_ZOOM,
      layout: {
        'line-cap': 'round',
        'line-join': 'round'
      },
      paint: {
        'line-color': '#ff0000',
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8,
          3,
          12,
          5,
          16,
          8
        ],
        'line-opacity': 1
      }
    });

    map.addLayer({
      id: 'rail-reference-lines-label',
      type: 'symbol',
      source: 'rail-reference-lines',
      minzoom: 9,
      maxzoom: RAIL_REFERENCE_MAX_ZOOM,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 200,
        'text-field': ['coalesce', ['get', 'ELR'], ['get', 'elr'], ''],
        'text-size': 13,
        'text-allow-overlap': false,
        'text-keep-upright': true,
        'text-pitch-alignment': 'map',
        'text-rotation-alignment': 'map'
      },
      paint: {
        'text-color': '#b71c1c',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5
      }
    });
    applyRailLinesVisibility();

    map.on('click', 'rail-reference-lines-layer', (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const { ELR, elr, L_M_FROM, l_m_from, L_M_TO, l_m_to } = feature.properties || {};
      const elrValue = ELR ?? elr ?? 'N/A';
      const clickedLngLat = [event.lngLat.lng, event.lngLat.lat];
      const chainageResult = chainagePointsReady ? interpolateChainageFromNetworkRail(clickedLngLat) : null;
      const chainMeters = Number(chainageResult?.chainMeters);
      const mileageFromPosts = mileageFromMileposts(feature, clickedLngLat);
      const fallbackMileage = mileageAtLocation(feature, clickedLngLat);
      const startMileage = Number(L_M_FROM ?? l_m_from);
      const endMileage = Number(L_M_TO ?? l_m_to);

      const mileageText = Number.isFinite(chainMeters)
        ? formatMilesYardsFromMeters(chainMeters)
        : Number.isFinite(mileageFromPosts)
        ? formatMilesYardsFromMeters(mileageFromPosts * METERS_PER_MILE)
        : Number.isFinite(fallbackMileage)
        ? formatMilesYardsFromMeters(fallbackMileage * METERS_PER_MILE)
        : Number.isFinite(startMileage) && Number.isFinite(endMileage)
        ? `${formatMilesYardsFromMeters(startMileage * METERS_PER_MILE)} - ${formatMilesYardsFromMeters(
            endMileage * METERS_PER_MILE
          )}`
        : 'N/A';

      new mapboxgl.Popup()
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>ELR:</strong> ${elrValue}<br/>
           <strong>Mileage:</strong> ${mileageText}`
        )
        .addTo(map);
    });

    map.on('mouseenter', 'rail-reference-lines-layer', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'rail-reference-lines-layer', () => {
      map.getCanvas().style.cursor = '';
    });
  } catch (error) {
    console.error('Unable to load rail reference lines:', error);
  }
}

map.on('load', () => {
  console.log('Map loaded');
  addInterpolationStatusControl();
  setInterpolationStatus('Loading Network Rail chainage points...');
  loadChainagePoints();
  ensureMilepostIcon().finally(() => {
    loadMileageCsv();
    loadAccessPointsCsv();
    loadRailReferenceLines();
    loadOverviewRailLines();
    loadTrackIdentificationLines();
  });
  geolocate.trigger(); // Automatically trigger location search on map load

  // Clicking anywhere simulates a GPS fix and refreshes interpolation overlays.
  map.on('click', (event) => {
    lastUserLocation = [event.lngLat.lng, event.lngLat.lat];
    updateInterpolationForLocation(lastUserLocation, 'Chainage at clicked point');
  });
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
    milepostChainageIndex = buildMilepostIndex(geojson.features || []);
    chainageCalibrationCache.clear();

    if (map.getSource('mileage-csv')) {
      map.getSource('mileage-csv').setData(geojson);
    } else {
      map.addSource('mileage-csv', { type: 'geojson', data: geojson });
    }

    const iconName = map.hasImage('milepost-icon') ? 'milepost-icon' : 'marker-15';
    if (!map.getLayer('mileage-csv-layer')) {
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
    }
    applyMilepostVisibility();

    map.on('click', 'mileage-csv-layer', (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const { ELR, mileage } = feature.properties || {};
      const mileageMiles = Number(mileage);
      const mileageText = Number.isFinite(mileageMiles)
        ? formatMilesYardsFromMeters(mileageMiles * METERS_PER_MILE)
        : mileage ?? 'N/A';
      new mapboxgl.Popup()
        .setLngLat(event.lngLat)
        .setHTML(
          `<strong>ELR:</strong> ${ELR || 'N/A'}<br/><strong>Mileage:</strong> ${
            mileageText
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
        'icon-size': 0.288, // reduced ~20% from previous size
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
    if (nearestAccessVisible && !nearestAccessShown && lastUserLocation) {
      showNearestAccessPoint(lastUserLocation);
    }
  } catch (error) {
    console.error('Unable to load access points CSV:', error);
  }
}
