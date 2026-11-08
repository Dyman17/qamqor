import { common } from './common';
import { app } from './app';
import { landing } from './landing';

export const ru = { ...common.ru, ...landing.ru, ...app.ru };
export const en = { ...common.en, ...landing.en, ...app.en };
// kk: перевод ожидается (owner decision 2026-11-08: Kazakh is a copy of Russian for now; the switcher stays available).
export const kk: typeof ru = ru;

export type Key = keyof typeof ru;
