const fs = require('fs');
const path = require('path');

const filePath = path.resolve('Rail_reference_line.geojson');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const R = 6371000; // meters

const toRad = (deg) => (deg * Math.PI) / 180;
const haversine = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return 0;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

const lineLengthMeters = (coords) => {
  if (!Array.isArray(coords)) return 0;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    if (!a || !b) continue;
    total += haversine(a, b);
  }
  return total;
};

const geometryLengthMeters = (geometry) => {
  if (!geometry || !geometry.coordinates) return 0;
  if (geometry.type === 'LineString') return lineLengthMeters(geometry.coordinates);
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.reduce((sum, line) => sum + lineLengthMeters(line), 0);
  }
  return 0;
};

const featuresByElr = new Map();
(data.features || []).forEach((feature) => {
  const elr = feature?.properties?.ELR || 'UNKNOWN';
  if (!featuresByElr.has(elr)) featuresByElr.set(elr, []);
  featuresByElr.get(elr).push(feature);
});

let updated = 0;
for (const [elr, feats] of featuresByElr.entries()) {
  // Sort by current start mileage; fallback to 0 if missing/non-numeric.
  feats.sort((a, b) => {
    const aVal = Number(a?.properties?.L_M_FROM);
    const bVal = Number(b?.properties?.L_M_FROM);
    const aNum = Number.isFinite(aVal) ? aVal : 0;
    const bNum = Number.isFinite(bVal) ? bVal : 0;
    return aNum - bNum;
  });

  let cursor = Number.isFinite(Number(feats[0]?.properties?.L_M_FROM))
    ? Number(feats[0].properties.L_M_FROM)
    : 0;

  for (let i = 0; i < feats.length; i++) {
    const feature = feats[i];
    const props = feature.properties || {};
    const lengthMeters = geometryLengthMeters(feature.geometry);
    const lengthMiles = lengthMeters / 1609.344;

    // For the first feature, keep its existing start if valid; otherwise start at 0.
    if (i === 0 && Number.isFinite(Number(props.L_M_FROM))) {
      cursor = Number(props.L_M_FROM);
    }

    props.L_M_FROM = Number(cursor.toFixed(6));
    props.L_M_TO = Number((cursor + lengthMiles).toFixed(6));
    cursor = props.L_M_TO;
    feature.properties = props;
    updated += 1;
  }
}

fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
console.log(`Updated features: ${updated}`);
