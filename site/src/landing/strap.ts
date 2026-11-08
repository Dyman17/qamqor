// Procedural braided neck strap: a 52 mm flat ribbon hangs from both strap lugs (x = +-105 mm) in an oval loop
// and ends at a small matte-black counterweight box (the loop implies the neck). Scene units: 1 = 100 mm.
// The braid is strap-texture.webp (owner's AI-generated texture, 512 px), tiled along the length.
import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, RepeatWrapping,
  SRGBColorSpace, TextureLoader, Vector3, CatmullRomCurve3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const HALF_W = 0.26; // 52 mm band
const HALF_T = 0.018; // 3.6 mm
export const STRAP_DEPTH = 2.64; // lowest point of the loop below the housing centre line, scene units
const HALF_PATH: [number, number][] = [[-1.04, -0.4], [-1.1, -0.8], [-1.42, -1.3], [-1.5, -1.85], [-1.12, -2.32], [-0.55, -2.58], [0, -STRAP_DEPTH]];

export interface Strap {
  group: any;
  /** 0 = in place, 1 = slid away below the frame. */
  setSlide(k: number): void;
  dispose(): void;
}

function ribbon(): any {
  const pts = [...HALF_PATH, ...HALF_PATH.slice(0, -1).reverse().map(([x, y]) => [-x, y] as [number, number])]
    .map(([x, y]) => new Vector3(x, y, 0));
  const curve = new CatmullRomCurve3(pts, false, 'centripetal');
  const N = 240;
  const len = curve.getLength();
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const tile = len / (HALF_W * 2); // texture square = band width
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const nx = -t.y, ny = t.x; // in-plane normal (outwards on the left of travel)
    const v = u * tile;
    // four faces, two vertices each: outer, inner, side +z, side -z
    const faces: [number[], number[], number[], number[], number[]][] = [
      [[p.x + nx * HALF_T, p.y + ny * HALF_T, -HALF_W], [p.x + nx * HALF_T, p.y + ny * HALF_T, HALF_W], [nx, ny, 0], [0, v], [1, v]],
      [[p.x - nx * HALF_T, p.y - ny * HALF_T, -HALF_W], [p.x - nx * HALF_T, p.y - ny * HALF_T, HALF_W], [-nx, -ny, 0], [0, v], [1, v]],
      [[p.x + nx * HALF_T, p.y + ny * HALF_T, HALF_W], [p.x - nx * HALF_T, p.y - ny * HALF_T, HALF_W], [0, 0, 1], [0, v], [0.02, v]],
      [[p.x + nx * HALF_T, p.y + ny * HALF_T, -HALF_W], [p.x - nx * HALF_T, p.y - ny * HALF_T, -HALF_W], [0, 0, -1], [0, v], [0.02, v]],
    ];
    for (const [a, b, n, ua, ub] of faces) { pos.push(...a, ...b); nor.push(...n, ...n); uv.push(...ua, ...ub); }
  }
  for (let i = 0; i < N; i++) {
    for (let f = 0; f < 4; f++) {
      const a = i * 8 + f * 2, b = a + 1, c = a + 8, d = a + 9;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export async function createStrap(texUrl: string, maxAniso: number): Promise<Strap> {
  let tex: any = null;
  try {
    tex = await new TextureLoader().loadAsync(texUrl);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.anisotropy = Math.min(8, maxAniso);
  } catch { tex = null; } // plain matte strap if the texture does not load
  const mat = new MeshStandardMaterial({ color: tex ? '#5c615e' : '#1a1f1c', map: tex, bumpMap: tex, bumpScale: 1, roughness: 1, metalness: 0, side: DoubleSide, envMapIntensity: 0.4 });
  const geo = ribbon();
  const band = new Mesh(geo, mat);
  const wMat = new MeshStandardMaterial({ color: '#101312', roughness: 0.78, metalness: 0.05 });
  const wGeo = new RoundedBoxGeometry(0.8, 0.46, 0.72, 3, 0.08);
  const weight = new Mesh(wGeo, wMat);
  weight.position.set(0, -STRAP_DEPTH, 0);
  const group = new Group();
  group.add(band, weight);
  return {
    group,
    setSlide(k: number) { group.position.y = -k * (STRAP_DEPTH + 1.2); group.visible = k < 0.999; },
    dispose() { [geo, wGeo].forEach((g) => g.dispose()); [mat, wMat].forEach((m) => m.dispose()); tex?.dispose(); },
  };
}
