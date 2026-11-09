// three ships no type declarations and @types/three is not an approved dependency (owner decision 2026-11-08).
// The three.js code is confined to src/landing/stage.ts and src/landing/poster-bake.ts; everything there is `any`.
declare module 'three';
declare module 'three/examples/jsm/*';
declare module 'three/addons/*';
declare module '*.svg?raw' { const s: string; export default s; }
