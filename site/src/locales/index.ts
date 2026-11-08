import { common } from './common';
import { app } from './app';
import { landing } from './landing';
import { landing2 } from './landing2';

export const ru = { ...common.ru, ...landing.ru, ...landing2.ru, ...app.ru };
export const en = { ...common.en, ...landing.en, ...landing2.en, ...app.en };
// kk: перевод ожидается (owner decision 2026-11-08: Kazakh is a copy of Russian for now; the switcher stays available).
export const kk: typeof ru = ru;

export type Key = keyof typeof ru;
