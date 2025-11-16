const fs = require("fs");
const path = require("path");

const inputPath = path.join(
  __dirname,
  "..",
  "Access and Mile Post",
  "Mileage database.csv"
);
const outputPath = path.join(__dirname, "..", "mileposts.geojson");

function toNumber(value) {
  if (value === undefined) return null;
  const num = Number.parseFloat(value.trim());
  return Number.isFinite(num) ? num : null;
}

function main() {
  if (!fs.existsSync(inputPath)) {
    console.error(`Input CSV not found at ${inputPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    console.error("CSV appears to be empty.");
    process.exit(1);
  }

  // Remove potential BOM from the first header value and normalize commas
  const header = lines.shift().replace(/^\uFEFF/, "").split(",");
  const columns = header.map((col) => col.trim().toLowerCase());

  function idx(name) {
    const index = columns.indexOf(name);
    if (index === -1) {
      console.error(`Required column "${name}" not found in CSV header.`);
      process.exit(1);
    }
    return index;
  }

  const elrIdx = idx("elr");
  const mileageIdx = idx("mileage");
  const latIdx = idx("lat");
  const lonIdx = idx("lon");

  const features = [];
  let skipped = 0;

  for (const line of lines) {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length < 4) {
      skipped += 1;
      continue;
    }

    const elr = cells[elrIdx];
    const mileage = toNumber(cells[mileageIdx]);
    const lat = toNumber(cells[latIdx]);
    const lon = toNumber(cells[lonIdx]);

    if (!elr || lat === null || lon === null) {
      skipped += 1;
      continue;
    }

    features.push({
      type: "Feature",
      properties: { ELR: elr, mileage },
      geometry: { type: "Point", coordinates: [lon, lat] },
    });
  }

  const featureCollection = {
    type: "FeatureCollection",
    features,
  };

  fs.writeFileSync(
    outputPath,
    JSON.stringify(featureCollection, null, 2),
    "utf8"
  );

  console.log(
    `Wrote ${features.length} features to ${path.relative(
      process.cwd(),
      outputPath
    )} (${skipped} rows skipped).`
  );
}

main();
