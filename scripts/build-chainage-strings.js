const fs = require('fs');
const path = require('path');
const proj4 = require('proj4');

const INPUT_CHAINAGE_CSV = path.resolve('Chainage.csv');
const REFERENCE_GEOJSON = path.resolve('Rail_reference_line.geojson');
const OUTPUT_LINES = path.resolve('chainage-strings.geojson');
const OUTPUT_MILEPOSTS = path.resolve('chainage-mileposts.geojson');

const EPSG_27700 =
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs +type=crs';
const WEB_MERCATOR_RADIUS = 6378137;

proj4.defs('EPSG:27700', EPSG_27700);

function normalizeElr(value) {
  return value ? String(value).trim().toUpperCase() : '';
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
}

function toWebMercator([lon, lat]) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const x = (lon * Math.PI * WEB_MERCATOR_RADIUS) / 180;
  const y =
    WEB_MERCATOR_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function flattenGeometry(geometry) {
  if (!geometry || !geometry.coordinates) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function appendUniqueCoordinate(list, coord) {
  if (!coord || coord.length < 2) return;
  const candidate = [coord[0], coord[1]];
  const last = list[list.length - 1];
  if (!last || Math.abs(last[0] - candidate[0]) > 1e-9 || Math.abs(last[1] - candidate[1]) > 1e-9) {
    list.push(candidate);
  }
}

function buildPathData(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const points = [];
  coords.forEach((coord) => {
    if (Array.isArray(coord) && coord.length >= 2) {
      appendUniqueCoordinate(points, coord);
    }
  });
  if (points.length < 2) return null;

  const segments = [];
  let totalLength = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const startMerc = toWebMercator(points[i]);
    const endMerc = toWebMercator(points[i + 1]);
    if (!startMerc || !endMerc) continue;
    const dx = endMerc[0] - startMerc[0];
    const dy = endMerc[1] - startMerc[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    segments.push({
      startIndex: i,
      endIndex: i + 1,
      startDistance: totalLength,
      length,
      startMerc,
      endMerc
    });
    totalLength += length;
  }

  return segments.length ? { points, segments, totalLength } : null;
}

function coordinateAtDistance(path, distance) {
  if (!path || !Array.isArray(path.segments) || path.segments.length === 0) return null;
  if (distance <= 0) return [...path.points[0]];
  if (distance >= path.totalLength) return [...path.points[path.points.length - 1]];
  for (const segment of path.segments) {
    const endDistance = segment.startDistance + segment.length;
    if (distance > endDistance) continue;
    const localLength = segment.length || 1;
    const t = Math.max(0, Math.min(1, (distance - segment.startDistance) / localLength));
    const start = path.points[segment.startIndex];
    const end = path.points[segment.endIndex];
    const lon = start[0] + t * (end[0] - start[0]);
    const lat = start[1] + t * (end[1] - start[1]);
    return [lon, lat];
  }
  return [...path.points[path.points.length - 1]];
}

function slicePath(path, startDistance, endDistance) {
  if (!path || !Array.isArray(path.segments)) return [];
  if (!Number.isFinite(startDistance) || !Number.isFinite(endDistance)) return [];
  if (endDistance <= startDistance) return [];
  const coords = [];

  const startCoord = coordinateAtDistance(path, startDistance);
  if (!startCoord) return [];
  appendUniqueCoordinate(coords, startCoord);

  for (const segment of path.segments) {
    const segStart = segment.startDistance;
    const segEnd = segment.startDistance + segment.length;
    if (segEnd <= startDistance) continue;
    if (segStart >= endDistance) break;
    if (segEnd < endDistance) {
      appendUniqueCoordinate(coords, path.points[segment.endIndex]);
    }
  }

  const endCoord = coordinateAtDistance(path, endDistance);
  if (endCoord) {
    appendUniqueCoordinate(coords, endCoord);
  }

  return coords.length >= 2 ? coords : [];
}

function projectPointOntoPath(path, coordinate) {
  if (!path || !Array.isArray(path.segments) || !coordinate) return null;
  const mercator = toWebMercator(coordinate);
  if (!mercator) return null;
  let best = null;
  for (const segment of path.segments) {
    const vx = segment.endMerc[0] - segment.startMerc[0];
    const vy = segment.endMerc[1] - segment.startMerc[1];
    const wx = mercator[0] - segment.startMerc[0];
    const wy = mercator[1] - segment.startMerc[1];
    const segLenSq = vx * vx + vy * vy;
    if (segLenSq === 0) continue;
    let t = (wx * vx + wy * vy) / segLenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = segment.startMerc[0] + t * vx;
    const projY = segment.startMerc[1] + t * vy;
    const dx = mercator[0] - projX;
    const dy = mercator[1] - projY;
    const distSq = dx * dx + dy * dy;
    const along = segment.startDistance + t * segment.length;
    if (!best || distSq < best.distSq) {
      best = { distSq, along };
    }
  }
  return best;
}

function loadChainagePoints() {
  ensureFileExists(INPUT_CHAINAGE_CSV);
  const raw = fs.readFileSync(INPUT_CHAINAGE_CSV, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) {
    throw new Error('Chainage CSV is empty.');
  }

  const header = parseCsvLine(lines.shift());
  const columns = header.map((col) => col.trim().toLowerCase());
  const required = ['x', 'y', 'elr', 'miles_dec', 'chainage'];

  const indexes = {};
  required.forEach((name) => {
    const idx = columns.indexOf(name);
    if (idx === -1) {
      throw new Error(`Column "${name}" not found in Chainage CSV header.`);
    }
    indexes[name] = idx;
  });

  const optionalFields = ['assetid', 'mile', 'yards', 'chains'];
  optionalFields.forEach((name) => {
    const idx = columns.indexOf(name);
    indexes[name] = idx;
  });

  const pointsByElr = new Map();
  let skipped = 0;

  for (const line of lines) {
    const cells = parseCsvLine(line);
    const elrRaw = cells[indexes.elr];
    const elr = normalizeElr(elrRaw);
    const x = toNumber(cells[indexes.x]);
    const y = toNumber(cells[indexes.y]);
    const milesDec = toNumber(cells[indexes.miles_dec]);
    const chainage = toNumber(cells[indexes.chainage]);

    if (!elr || x === null || y === null) {
      skipped += 1;
      continue;
    }

    let lonLat;
    try {
      lonLat = proj4('EPSG:27700', 'EPSG:4326', [x, y]);
    } catch (error) {
      skipped += 1;
      continue;
    }

    if (!Array.isArray(lonLat) || lonLat.length < 2) {
      skipped += 1;
      continue;
    }

    const entry = {
      elr,
      lonLat: [lonLat[0], lonLat[1]],
      milesDec,
      chainage,
      assetId: indexes.assetid >= 0 ? cells[indexes.assetid] : null,
      mile: indexes.mile >= 0 ? toNumber(cells[indexes.mile]) : null,
      yards: indexes.yards >= 0 ? toNumber(cells[indexes.yards]) : null,
      chains: indexes.chains >= 0 ? toNumber(cells[indexes.chains]) : null
    };

    if (!pointsByElr.has(elr)) {
      pointsByElr.set(elr, []);
    }
    pointsByElr.get(elr).push(entry);
  }

  return { pointsByElr, skipped };
}

function buildReferencePaths() {
  ensureFileExists(REFERENCE_GEOJSON);
  const raw = fs.readFileSync(REFERENCE_GEOJSON, 'utf8');
  const geojson = JSON.parse(raw);
  const paths = new Map();

  (geojson.features || []).forEach((feature) => {
    const elr = normalizeElr(feature?.properties?.ELR ?? feature?.properties?.elr);
    if (!elr) return;
    if (!paths.has(elr)) {
      paths.set(elr, []);
    }
    paths.get(elr).push(feature);
  });

  const pathDataByElr = new Map();

  for (const [elr, features] of paths.entries()) {
    const sorted = features
      .slice()
      .sort((a, b) => {
        const aVal = Number(a?.properties?.L_M_FROM ?? a?.properties?.l_m_from);
        const bVal = Number(b?.properties?.L_M_FROM ?? b?.properties?.l_m_from);
        const safeA = Number.isFinite(aVal) ? aVal : 0;
        const safeB = Number.isFinite(bVal) ? bVal : 0;
        return safeA - safeB;
      });

    const coords = [];
    for (const feature of sorted) {
      const lines = flattenGeometry(feature.geometry);
      for (const line of lines) {
        for (const coord of line) {
          if (!coord || coord.length < 2) continue;
          appendUniqueCoordinate(coords, coord);
        }
      }
    }

    const pathData = buildPathData(coords);
    if (pathData) {
      pathDataByElr.set(elr, pathData);
    }
  }

  return pathDataByElr;
}

function sliceBetweenPosts(path, startPost, endPost) {
  if (!path || !startPost || !endPost) return [];
  if (!startPost.projection || !endPost.projection) return [];
  if (endPost.projection.along <= startPost.projection.along) return [];
  const coords = slicePath(path, startPost.projection.along, endPost.projection.along);
  if (!coords.length) return [];
  coords[0] = [startPost.lonLat[0], startPost.lonLat[1]];
  coords[coords.length - 1] = [endPost.lonLat[0], endPost.lonLat[1]];
  return coords;
}

function buildChainageLines(pointsByElr, referencePaths) {
  const features = [];
  let missingElr = 0;
  let skippedSegments = 0;

  for (const [elr, posts] of pointsByElr.entries()) {
    const path = referencePaths.get(elr);
    if (!path) {
      missingElr += 1;
      continue;
    }

    const annotated = posts
      .map((post) => {
        const projection = projectPointOntoPath(path, post.lonLat);
        if (!projection) return null;
        return { ...post, projection };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aVal = Number.isFinite(a.chainage)
          ? a.chainage
          : Number.isFinite(a.milesDec)
          ? a.milesDec
          : 0;
        const bVal = Number.isFinite(b.chainage)
          ? b.chainage
          : Number.isFinite(b.milesDec)
          ? b.milesDec
          : 0;
        return aVal - bVal;
      });

    if (annotated.length < 2) continue;

    const breakpoints = [];
    const coordinates = [];

    for (let i = 0; i < annotated.length; i += 1) {
      const post = annotated[i];
      const ratio = path.totalLength
        ? Number((post.projection.along / path.totalLength).toFixed(6))
        : 0;
      const miles =
        Number.isFinite(post.milesDec)
          ? Number(post.milesDec.toFixed(6))
          : Number.isFinite(post.chainage)
          ? Number((post.chainage / 1609.344).toFixed(6))
          : null;
      const chainageMeters = Number.isFinite(post.chainage)
        ? Number(post.chainage.toFixed(3))
        : null;
      const breakpoint = { ratio, miles };
      if (chainageMeters !== null) {
        breakpoint.chainage = chainageMeters;
      }
      breakpoints.push(breakpoint);

      if (i < annotated.length - 1) {
        const nextPost = annotated[i + 1];
        const section = sliceBetweenPosts(path, post, nextPost);
        if (!section.length) {
          skippedSegments += 1;
          continue;
        }
        if (coordinates.length) {
          section.shift();
        }
        coordinates.push(...section);
      }
    }

    if (coordinates.length < 2) continue;

    const featureId = `${elr}-${features.length + 1}`;
    features.push({
      type: 'Feature',
      id: featureId,
      properties: {
        ELR: elr,
        __featureId: featureId,
        posts: annotated.length,
        start_miles_dec: breakpoints[0]?.miles ?? null,
        end_miles_dec: breakpoints[breakpoints.length - 1]?.miles ?? null,
        start_chainage: breakpoints[0]?.chainage ?? null,
        end_chainage: breakpoints[breakpoints.length - 1]?.chainage ?? null,
        chain_breakpoints: breakpoints
      },
      geometry: {
        type: 'LineString',
        coordinates
      }
    });
  }

  return { features, missingElr, skippedSegments };
}

function buildMilepostFeatures(pointsByElr) {
  const features = [];
  for (const posts of pointsByElr.values()) {
    for (const post of posts) {
      if (!Array.isArray(post.lonLat)) continue;
      features.push({
        type: 'Feature',
        properties: {
          ELR: post.elr,
          miles_dec: post.milesDec ?? null,
          chainage: post.chainage ?? null,
          assetId: post.assetId ?? null,
          mile: post.mile ?? null,
          yards: post.yards ?? null,
          chains: post.chains ?? null
        },
        geometry: {
          type: 'Point',
          coordinates: post.lonLat
        }
      });
    }
  }
  return features;
}

function writeGeojson(filePath, features) {
  const collection = {
    type: 'FeatureCollection',
    features
  };
  fs.writeFileSync(filePath, JSON.stringify(collection, null, 2), 'utf8');
}

function main() {
  try {
    const { pointsByElr, skipped } = loadChainagePoints();
    const referencePaths = buildReferencePaths();
    const { features, missingElr, skippedSegments } = buildChainageLines(
      pointsByElr,
      referencePaths
    );

    if (!features.length) {
      console.warn('No chainage lines were generated.');
    } else {
      writeGeojson(OUTPUT_LINES, features);
      console.log(
        `Wrote ${features.length} chainage line features to ${path.relative(
          process.cwd(),
          OUTPUT_LINES
        )}`
      );
    }

    const milepostFeatures = buildMilepostFeatures(pointsByElr);
    if (milepostFeatures.length) {
      writeGeojson(OUTPUT_MILEPOSTS, milepostFeatures);
      console.log(
        `Wrote ${milepostFeatures.length} milepost features to ${path.relative(
          process.cwd(),
          OUTPUT_MILEPOSTS
        )}`
      );
    }

    console.log(
      `Skipped rows without valid data: ${skipped}. Missing ELRs in reference: ${missingElr}. Skipped sections: ${skippedSegments}.`
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
