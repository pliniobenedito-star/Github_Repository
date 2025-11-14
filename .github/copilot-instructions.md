## Purpose
Provide focused, actionable guidance for AI coding agents working in this repository.

## Quick facts (auto-discovered)
- Single dependency listed in `package.json`: `mapbox-gl@^3.16.0`.
- No `scripts` or build/test configuration present in `package.json`.
- Repository currently contains `node_modules/` and `package-lock.json` at the root.

## What an agent should do first
1. Install dependencies before running or modifying code: prefer `npm ci` to get a reproducible install.
2. If you need to run the app locally and there is no build or start script, ask the user where the entry HTML/JS files live or propose adding a simple `start` script that runs a static server.

## Files & patterns to inspect
- `package.json` — confirmed dependency on `mapbox-gl`; no scripts.
- `package-lock.json` — shows exact dependency tree; consult when reproducing environments.
- Search the repository for `mapboxgl`, `mapbox-gl`, `new mapboxgl.Map`, or `Mapbox` to find where the map is initialized.

## Project-specific conventions (discoverable)
- Mapbox GL is a core dependency; expect mapping-related components to import `mapbox-gl` directly from NPM.
- There are currently no explicit build or test conventions in repo metadata — don’t assume a framework (React/Vue/etc.) unless you find source files that indicate one.

## Integration & external dependencies
- Mapbox requires a token at runtime. No `.env` or token file was discovered; if code references a `MAPBOX_TOKEN` or similar, prompt the user for how secrets are provided.

## Typical agent actions and examples
- To locate map initialization, use repo-wide search for:
  - `new mapboxgl.Map` or `mapboxgl.Map`
  - `import mapboxgl` or `require('mapbox-gl')`
- If asked to add a development workflow and none exists, propose a minimal set of `npm` scripts in `package.json` (example):
  - `"start": "npx serve ."` — for a simple static server
  ## Purpose
  Provide focused, actionable guidance for AI coding agents working in this repository.

  ## Quick facts (auto-discovered)
  - Single dependency listed in `package.json`: `mapbox-gl@^3.16.0`.
  - `package.json` now contains `scripts.start` (a minimal `npx serve .`) and `scripts.ci` (`npm ci`).
  - The repo now includes a minimal Mapbox demo: `index.html`, `map.js`, `.env.example`, and `README.md`.

  ## What an agent should do first
  1. Install dependencies before running or modifying code: prefer `npm ci` to get a reproducible install.
  2. Run `npm start` to serve the demo statically (uses `npx serve .`).

  ## Files & patterns to inspect
  - `package.json` — `mapbox-gl` dependency and start/ci scripts.
  - `index.html` — the demo entrypoint. It sets `window.MAPBOX_TOKEN` (placeholder) which `map.js` reads.
  - `map.js` — minimal Mapbox GL initialization; look for `mapboxgl.Map` usage.
  - `.env.example` — shows the `MAPBOX_TOKEN` env variable format.
  - `README.md` — quick start for the demo.

  ## Project-specific conventions (discoverable)
  - Mapbox GL is used directly from the `mapbox-gl` package and the demo references `node_modules/mapbox-gl/dist/*` for the CSS/JS bundles when served statically.
  - Token provisioning is manual in this demo (placeholder in `index.html`). For production code, tokens should be injected at build time or provided by a secure backend.

  ## Integration & external dependencies
  - Mapbox requires a token at runtime. The demo expects `window.MAPBOX_TOKEN` to be set in `index.html` (replace the placeholder) or set programmatically before `map.js` runs.

  ## Typical agent actions and examples
  - To locate map initialization, search for `new mapboxgl.Map`, `mapboxgl.Map`, `import mapboxgl`, or `require('mapbox-gl')`.
  - Suggested minimal scripts added to `package.json`:
    - `"start": "npx serve ."` — simple static server (used by the demo)
    - `"ci": "npm ci"`

  ## Merge policy for existing instructions
  - If a `.github/copilot-instructions.md` or AGENT files are present, merge by preserving any project-specific rules and tokens, and append updated quick facts and explicit search patterns above.

  ## When to ask the user
  - Ask whether they want the demo token to be stored directly in `index.html` (quick) or injected via an environment/build step (recommended for non-local use).
  - Ask for the real app entrypoint or source directory if it is not `index.html` and the repo contains a larger application.

  ## How to report back
  - Summarize changed files and commands to run locally (e.g., `npm ci` then `npm start`).
  - Provide code references (file path + line snippet) for any added or modified behavior related to the map.

  If any of the above items are unclear or you want me to integrate repository-specific examples (e.g., wiring tokens into a build), tell me which files to inspect or grant me permission to search the workspace further.
