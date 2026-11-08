#!/usr/bin/env node
// Builds site/public/models/qamqor.glb from hardware/3d-models/qamqor_base.stl and qamqor_lid.stl.
// Pure Node, no dependencies (site-brief 2.1): ASCII STL -> welded indexed mesh -> Int16 quantized positions
// (KHR_mesh_quantization) + Uint16 indices. Normals are NOT written: the page computes creased normals on load.
//
// Scene units: 1 unit = 100 mm. The assembly centre (0, 0, 45) mm is the origin; the node rotation bakes STL Z-up -> Y-up
// (-90 deg about X), so the front with the latches (-Y in the STL) faces +Z (the camera), the left speaker side (-X) is on the left.
//
// Usage: node scripts/stl-to-glb.mjs   (from site/)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const PARTS = [
  { name: 'base', file: resolve(repo, 'hardware/3d-models/qamqor_base.stl') },
  { name: 'lid', file: resolve(repo, 'hardware/3d-models/qamqor_lid.stl') },
];
const OUT = resolve(here, '../public/models/qamqor.glb');
const MAX_RAW_BYTES = 400 * 1024; // site-brief 2.1 build threshold
const WELD = 0.001; // mm
const CENTER = [0, 0, 45]; // mm

function parseAsciiStl(path) {
  const text = readFileSync(path, 'utf8');
  if (!text.trimStart().startsWith('solid')) throw new Error(`${path}: not an ASCII STL`);
  const verts = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let m;
  while ((m = re.exec(text))) verts.push(+m[1], +m[2], +m[3]);
  if (verts.length % 9 !== 0 || verts.length === 0) throw new Error(`${path}: bad vertex count ${verts.length / 3}`);
  return verts;
}

function weld(verts) {
  const map = new Map();
  const pos = [];
  const idx = [];
  let degenerate = 0;
  const key = (x, y, z) => `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
  const tri = [0, 0, 0];
  for (let t = 0; t < verts.length / 9; t++) {
    for (let k = 0; k < 3; k++) {
      const x = verts[t * 9 + k * 3], y = verts[t * 9 + k * 3 + 1], z = verts[t * 9 + k * 3 + 2];
      const kk = key(x, y, z);
      let i = map.get(kk);
      if (i === undefined) { i = pos.length / 3; map.set(kk, i); pos.push(x, y, z); }
      tri[k] = i;
    }
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) { degenerate++; continue; }
    idx.push(tri[0], tri[1], tri[2]);
  }
  return { pos, idx, degenerate };
}

const parts = PARTS.map((p) => ({ ...p, ...weld(parseAsciiStl(p.file)) }));

// Common quantization scale: the largest |coordinate - centre| over both parts maps to 32767.
let maxAbs = 0;
for (const p of parts) for (let i = 0; i < p.pos.length; i++) maxAbs = Math.max(maxAbs, Math.abs(p.pos[i] - CENTER[i % 3]));
const step = (maxAbs * 1.0001) / 32767; // mm per integer step

const chunks = []; // binary pieces with byteOffset tracking
let binLen = 0;
const bufferViews = [];
const accessors = [];
const meshes = [];
const nodes = [];

function pushBinary(buf, target, byteStride) {
  const pad = (4 - (binLen % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); binLen += pad; }
  const view = { buffer: 0, byteOffset: binLen, byteLength: buf.length, target };
  if (byteStride) view.byteStride = byteStride;
  bufferViews.push(view);
  chunks.push(buf);
  binLen += buf.length;
  return bufferViews.length - 1;
}

const report = [];
for (const p of parts) {
  const n = p.pos.length / 3;
  // Int16 VEC3 must be 4-byte aligned per element (KHR_mesh_quantization): stride 8, 2 bytes of padding.
  const posBuf = Buffer.alloc(n * 8);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const q = Math.round((p.pos[i * 3 + k] - CENTER[k]) / step);
      posBuf.writeInt16LE(q, i * 8 + k * 2);
      min[k] = Math.min(min[k], q); max[k] = Math.max(max[k], q);
    }
  }
  const idxBuf = Buffer.alloc(p.idx.length * 2);
  p.idx.forEach((v, i) => idxBuf.writeUInt16LE(v, i * 2));
  if (n > 65535) throw new Error('too many vertices for Uint16 indices');

  const posView = pushBinary(posBuf, 34962, 8);
  const idxView = pushBinary(idxBuf, 34963);
  accessors.push({ bufferView: posView, componentType: 5122, count: n, type: 'VEC3', min, max });
  const posAcc = accessors.length - 1;
  accessors.push({ bufferView: idxView, componentType: 5123, count: p.idx.length, type: 'SCALAR' });
  const idxAcc = accessors.length - 1;
  meshes.push({ name: p.name, primitives: [{ attributes: { POSITION: posAcc }, indices: idxAcc, mode: 4 }] });
  // STL Z-up -> Y-up, mm -> scene units (1 unit = 100 mm): rotation -90 deg about X, scale step / 100.
  const s = step / 100;
  nodes.push({ name: p.name, mesh: meshes.length - 1, rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], scale: [s, s, s] });
  report.push(`${p.name}: ${p.idx.length / 3} triangles, ${n} vertices, ${p.degenerate} degenerate dropped`);
}

const json = {
  asset: { version: '2.0', generator: 'qamqor site/scripts/stl-to-glb.mjs' },
  extensionsUsed: ['KHR_mesh_quantization'],
  extensionsRequired: ['KHR_mesh_quantization'],
  scene: 0,
  scenes: [{ name: 'qamqor', nodes: nodes.map((_, i) => i) }],
  nodes, meshes, accessors, bufferViews,
  buffers: [{ byteLength: 0 }],
};
const padTo4 = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
const bin = padTo4(Buffer.concat(chunks), 0);
json.buffers[0].byteLength = bin.length;
const jsonBuf = padTo4(Buffer.from(JSON.stringify(json)), 0x20);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // 'glTF'
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4); // JSON
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4); // BIN
const glb = Buffer.concat([header, jh, jsonBuf, bh, bin]);

if (glb.length > MAX_RAW_BYTES) {
  console.error(`GLB is ${glb.length} bytes, over the ${MAX_RAW_BYTES} byte limit`);
  process.exit(1);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, glb);
console.log(report.join('\n'));
console.log(`quantization step: ${step.toFixed(5)} mm`);
console.log(`wrote ${OUT}: ${glb.length} bytes (${(glb.length / 1024).toFixed(1)} KB)`);
