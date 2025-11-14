# Mapbox demo (minimal)

This repository is a minimal static demo that shows how to use Mapbox GL JS from the `mapbox-gl` dependency installed via NPM.

Quick start

1. Install dependencies:

```powershell
npm ci
```

2. Edit `index.html` and replace the placeholder `REPLACE_WITH_YOUR_MAPBOX_TOKEN` with your Mapbox token, or set `window.MAPBOX_TOKEN` programmatically.

3. Start a static server:

```powershell
npm start
```

4. Open `http://localhost:5000` (or the address printed by the server) and you should see the map.

Files added

- `index.html` — simple page that loads `node_modules/mapbox-gl/dist/mapbox-gl.js` and reads the token from `window.MAPBOX_TOKEN`.
- `map.js` — minimal Mapbox initialization.
- `.env.example` — shows `MAPBOX_TOKEN` env variable format.

Notes

- This demo references Mapbox GL assets from `node_modules/` so you must run `npm ci` before using `npm start`.
- For production usage, inject the token securely (server-side, secret manager, or during build), and avoid committing secrets into the repo.
