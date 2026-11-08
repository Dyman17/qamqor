/**
 * Content-Security-Policy for the site SPA (Vite + three.js + MapLibre), served same-origin.
 * This is the single place to adjust it. Directive -> allowed sources.
 */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  // MapLibre/three.js set inline styles at runtime.
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://tiles.openfreemap.org'],
  'font-src': ["'self'", 'data:', 'https://tiles.openfreemap.org'],
  // API is same-origin; map style/tiles/glyphs are fetched from these hosts.
  'connect-src': ["'self'", 'https://*.tile.openstreetmap.org', 'https://tiles.openfreemap.org'],
  // MapLibre GL runs its tile workers from blob: URLs.
  'worker-src': ["'self'", 'blob:'],
  'child-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};

export function buildCsp(directives: Record<string, string[]> = CSP_DIRECTIVES): string {
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}
