/** A locale area: ru is the source; en must have exactly the same keys (checked by tsc). kk is a copy of ru, see index.ts. */
export function def<R extends Record<string, string>>(p: { ru: R; en: Record<keyof R, string> }): { ru: R; en: Record<keyof R, string> } {
  return p;
}
