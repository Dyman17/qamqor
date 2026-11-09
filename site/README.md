Status: implemented (v0.1, prototype; see docs/frontend/site-brief.md for the spec and docs/frontend/qa/site/ for screenshots)

# site: landing and web dashboard

Plain TypeScript + Vite. Runtime dependencies: `three` (lazy chunk, landing only) and `maplibre-gl` (lazy chunk, map route only). Dev dependencies: `vite`, `typescript`.

```
npm install
npm run dev        # http://localhost:5173, proxies /api and /health to http://localhost:4000
npm run build      # tsc --noEmit + vite build -> dist/ (served by the Nest server, see server/src/config/site.ts)
npm run preview    # http://127.0.0.1:4173
npm run build:model  # rebuild public/models/qamqor.glb from hardware/enclosure/stl/*.stl (no dependencies)
```

QA helpers (need Chrome or Edge; no extra packages): `scripts/qa-shots.mjs` (screenshots, overflow, console errors),
`scripts/bake-posters.mjs` (re-bake `public/posters/scene-N.webp` from the GLB; needs `npm run dev`),
`scripts/qa-app.mjs` (dashboard checks against a mocked `/api/v1`, never against a real server).

Notes: Inter is a self-hosted subset (Latin, Cyrillic, Kazakh letters, wght axis only). Icons: Phosphor (MIT, `public/licenses/`).
Kazakh strings are a copy of Russian until the translation arrives (owner decision 2026-11-08).
