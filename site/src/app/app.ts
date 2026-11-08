import type { View } from '../router';
export const mount: View['mount'] = (root) => { root.textContent = 'auth: phase 3'; };
