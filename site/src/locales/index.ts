import { common } from './common';

export const ru = { ...common.ru };
export const en = { ...common.en };
// kk: перевод ожидается (owner decision 2026-11-08: Kazakh is a copy of Russian for now; the switcher stays available).
export const kk: typeof ru = ru;

export type Key = keyof typeof ru;
