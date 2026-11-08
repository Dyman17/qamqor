import test from 'node:test';
import assert from 'node:assert/strict';
import { makeScaleWith } from './scaleCore.ts';

const id = (n: number) => n;
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('s table from brief 5.5.1', () => {
  near(makeScaleWith(320, id).s, 0.9);
  near(makeScaleWith(337, id).s, 0.9);
  near(makeScaleWith(338, id).s, 0.9013);
  near(makeScaleWith(340, id).s, 0.9067);
  near(makeScaleWith(360, id).s, 0.96);
  assert.equal(makeScaleWith(375, id).s, 1);
  assert.equal(makeScaleWith(430, id).s, 1);
  assert.equal(makeScaleWith(767, id).s, 1);
});

test('tablet uses s = 1 and is never compact', () => {
  const t = makeScaleWith(768, id);
  assert.equal(t.s, 1);
  assert.equal(t.tablet, true);
  assert.equal(t.compact, false);
  assert.equal(makeScaleWith(767, id).tablet, false);
});

test('compact is a binary switch at 337.5', () => {
  assert.equal(makeScaleWith(320, id).compact, true);
  assert.equal(makeScaleWith(337, id).compact, true);
  assert.equal(makeScaleWith(337.49, id).compact, true);
  assert.equal(makeScaleWith(337.5, id).compact, false);
  assert.equal(makeScaleWith(338, id).compact, false);
  assert.equal(makeScaleWith(375, id).compact, false);
});

test('s = 1 is the identity (acceptance criterion)', () => {
  const sc = makeScaleWith(375, id);
  for (const n of [4, 12, 13, 16, 17, 26, 40, 56]) {
    assert.equal(sc.sz(n), n);
    assert.equal(sc.lh(n), n);
  }
  for (const n of [11, 12, 13, 16, 17, 26, 40]) assert.equal(sc.fs(n), n);
});

test('font floor 11: nav 12 at s = 0.9 gives 11, caption 13 gives 11.7', () => {
  const sc = makeScaleWith(320, id);
  assert.equal(sc.fs(12), 11);
  near(sc.fs(13), 11.7);
  near(sc.fs(40), 36);
  near(sc.fs(17), 15.3);
  assert.equal(sc.fs(8), 11);
});

test('lh goes through the injected rounder', () => {
  const sc = makeScaleWith(320, Math.round);
  assert.equal(sc.lh(44), 40); // 39.6
  assert.equal(sc.lh(26), 23); // 23.4
});

test('slop: touch zone is at least 44', () => {
  const sc = makeScaleWith(320, id);
  near(sc.slop(48), 0.4);
  near(sc.slop(36), 5.8);
  assert.equal(sc.slop(56), 0);
  assert.equal(makeScaleWith(375, id).slop(48), 0);
  assert.deepEqual(makeScaleWith(375, id).hit(36), { top: 4, bottom: 4, left: 4, right: 4 });
});

test('hairline is the literal 1', () => {
  assert.equal(makeScaleWith(320, id).hairline, 1);
});
