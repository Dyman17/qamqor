import { common } from './common';
import { landing } from './landing';

export const ru = { ...common.ru, ...landing.ru };
export const en = { ...common.en, ...landing.en };
// kk: перевод ожидается (owner decision 2026-11-08: Kazakh is a copy of Russian for now; the switcher stays available).
export const kk: typeof ru = ru;

export type Key = keyof typeof ru;
