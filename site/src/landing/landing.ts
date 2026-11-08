import type { View } from '../router';
export const mount: View['mount'] = (root) => { root.textContent = 'landing: phase 2'; };
