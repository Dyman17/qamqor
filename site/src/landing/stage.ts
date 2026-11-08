// The three.js stage: model, lights, scroll-driven pose, callouts, dimension lines (site-brief 2, 3, 4.3).
// Loaded lazily (dynamic import) so three.js is not part of the first paint. All three.js types are `any` (no @types/three).
import {
  ACESFilmicToneMapping, BoxGeometry, BufferGeometry, CanvasTexture, DirectionalLight, Euler, Float32BufferAttribute,
  Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, PMREMGenerator,
  Quaternion, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CALLOUTS, DIMS, BLEND, SCENES, keyframeAt, lerp, sceneAt, smoother, type V3 } from './storyboard';

const DEG = Math.PI / 180;
const LID_LIFT = 0.55; // 55 mm in scene units
const PANEL_LIFT = 0.48; // 48 mm more
const MODEL_MM = { x: [-105, 105], y: [-46.5, 47.9], z: [0, 89.5] } as const;

export interface StageOptions {
  canvas: HTMLCanvasElement;
  root: HTMLElement; // the sticky block: holds callouts, leaders and dimension svg
  glb: Promise<ArrayBuffer>;
  onFirstFrame(): void;
  onLost(): void;
  onRestored(): void;
  onLightStep(step: 1 | 2 | 3): void;
}

export interface StageApi {
  setProgress(P: number): void;
  setActive(on: boolean): void;
  resize(): void;
  snapshotAt(P: number, w: number, h: number): Promise<Blob | null>;
  dispose(): void;
}

function stlToScene(p: V3, lidLift = 0): V3 {
  return [p[0] * 0.01, (p[2] - 45) * 0.01 + lidLift, -p[1] * 0.01];
}

function panelTexture(): any {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0B1B2E';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#2A4A6A';
  g.lineWidth = 3;
  const n = 6; // decorative cell count
  for (let i = 0; i <= n; i++) {
    const p = 12 + (i * (512 - 24)) / n;
    g.beginPath(); g.moveTo(p, 12); g.lineTo(p, 500); g.stroke();
    g.beginPath(); g.moveTo(12, p); g.lineTo(500, p); g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function shadowTexture(): any {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

interface CalloutRt {
  def: (typeof CALLOUTS)[number];
  el: HTMLElement;
  lines: SVGLineElement[];
  dots: SVGCircleElement[];
  w: number;
  h: number;
  shown: boolean;
}

export async function createStage(opts: StageOptions): Promise<StageApi> {
  const { canvas, root } = opts;
  const dpr0 = window.devicePixelRatio || 1;
  const renderer = new WebGLRenderer({ canvas, antialias: dpr0 < 2, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new Scene();
  const camera = new PerspectiveCamera(28, 1, 0.1, 40);

  // ---- lights (site-brief 2.2) ----
  const pmrem = new PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;
  const key = new DirectionalLight(0xfff4e5, 2.2); key.position.set(-3, 4, 4);
  const rim = new DirectionalLight(0x7fd6a0, 3.0); rim.position.set(3.5, 2, -4);
  const fill = new HemisphereLight(0xbfd3c4, 0x06140d, 0.35);
  scene.add(key, rim, fill);

  // ---- model ----
  const buf = await opts.glb;
  const gltf: any = await new GLTFLoader().parseAsync(buf, '');
  const pivot = new Group();
  const modelRoot: any = gltf.scene;
  pivot.add(modelRoot);
  const bodyMat = new MeshStandardMaterial({ color: '#141816', roughness: 0.82, metalness: 0, envMapIntensity: 0.9 });
  const geoms: any[] = [];
  let lidNode: any = null;
  modelRoot.traverse((o: any) => {
    if (o.name === 'lid') lidNode = o;
    if (!o.isMesh) return;
    // positions are Int16 (KHR_mesh_quantization): copy to Float32, then creased normals (30 deg)
    const src = o.geometry.attributes.position;
    const arr = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) { arr[i * 3] = src.getX(i); arr[i * 3 + 1] = src.getY(i); arr[i * 3 + 2] = src.getZ(i); }
    let g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(arr, 3));
    g.setIndex(o.geometry.index);
    g = toCreasedNormals(g, 0.52);
    o.geometry.dispose();
    o.geometry = g;
    o.material = bodyMat;
    geoms.push(g);
  });
  const lidRestY = lidNode ? lidNode.position.y : 0;

  const panelTex = panelTexture();
  const panelSide = new MeshStandardMaterial({ color: '#0B1B2E', roughness: 0.35, metalness: 0.4 });
  const panelTop = new MeshStandardMaterial({ color: '#ffffff', map: panelTex, roughness: 0.35, metalness: 0.4, emissive: 0x7fd6a0, emissiveMap: panelTex, emissiveIntensity: 0 });
  const panelGeo = new BoxGeometry(0.55, 0.03, 0.55);
  const panel = new Mesh(panelGeo, [panelSide, panelSide, panelTop, panelSide, panelSide, panelSide]);
  const panelY0 = (88 - 45) * 0.01;
  panel.position.set(-0.2, panelY0, 0);
  const gpsGeo = new PlaneGeometry(0.25, 0.25);
  const gpsMat = new MeshBasicMaterial({ color: '#05100A' });
  const gps = new Mesh(gpsGeo, gpsMat);
  gps.rotation.x = -Math.PI / 2;
  const gpsY0 = (88 - 45) * 0.01;
  gps.position.set(0.3, gpsY0, 0);
  pivot.add(panel, gps);
  scene.add(pivot);

  const shadowTex = shadowTexture();
  const shadowMat = new MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.45, depthWrite: false });
  const shadowGeo = new PlaneGeometry(1, 1);
  const shadow = new Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  // ---- DOM: callouts, leaders, dimension lines ----
  const leaderSvg = root.querySelector<SVGSVGElement>('svg.leaders')!;
  const dimsSvg = root.querySelector<SVGSVGElement>('svg.dims')!;
  const NS = 'http://www.w3.org/2000/svg';
  const callouts: CalloutRt[] = CALLOUTS.map((def) => {
    const el = root.querySelector<HTMLElement>(`[data-co="${def.id}"]`)!;
    const lines = def.points.map(() => {
      const l = document.createElementNS(NS, 'line');
      leaderSvg.appendChild(l);
      return l;
    });
    const dots = def.points.map(() => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', '3.5');
      leaderSvg.appendChild(c);
      return c;
    });
    return { def, el, lines, dots, w: 0, h: 0, shown: false };
  });
  const dimPaths = DIMS.map((d) => ({
    d,
    line: dimsSvg.querySelector<SVGPathElement>(`[data-dim-line="${d.id}"]`)!,
    ticks: dimsSvg.querySelector<SVGPathElement>(`[data-dim-ticks="${d.id}"]`)!,
    label: root.querySelector<HTMLElement>(`[data-dim-label="${d.id}"]`)!,
  }));

  // ---- state ----
  let W = 1, H = 1, dpr = Math.min(dpr0, window.innerWidth < 768 ? 1.5 : 2);
  let target = 0, x = 0, v = 0;
  let active = true, raf = 0, last = 0, disposed = false, lost = false, firstFrame = false;
  let introStart = -1;
  let envOn = true;
  const quat = new Quaternion(), eul = new Euler(0, 0, 0, 'YXZ');
  const tmp = new Vector3();
  const camPos = new Vector3();
  const frameTimes: number[] = [];
  let lightStep = 0;
  let bake = false; // poster baking: model centred, no scene offsets

  function mobile(): boolean { return W < 768; }

  /** Vertical zone (fractions of the viewport height) where the model must sit; text lives elsewhere. */
  const ZONES_DESKTOP: [number, number][] = [[0.56, 0.97], [0.12, 0.96], [0.12, 0.96], [0.12, 0.96], [0.1, 0.7], [0.12, 0.96]];
  const ZONES_MOBILE: [number, number][] = [[0.64, 0.97], [0.1, 0.56], [0.1, 0.56], [0.1, 0.56], [0.1, 0.56], [0.1, 0.56]];
  function zone(P: number): [number, number] {
    if (bake) return [0.07, 0.93];
    const arr = mobile() ? ZONES_MOBILE : ZONES_DESKTOP;
    const i = sceneAt(P);
    const sc = SCENES[i];
    const mix = (a: [number, number], b: [number, number], k: number): [number, number] => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
    if (i > 0 && P < sc.a + BLEND) return mix(arr[i - 1], arr[i], smoother((P - (sc.a - BLEND)) / (2 * BLEND)));
    if (i < SCENES.length - 1 && P > sc.b - BLEND) return mix(arr[i], arr[i + 1], smoother((P - (sc.b - BLEND)) / (2 * BLEND)));
    return arr[i];
  }

  function corners(e: number): V3[] {
    const zMax = MODEL_MM.z[1] + (LID_LIFT + PANEL_LIFT) * 100 * e;
    const out: V3[] = [];
    for (const xx of MODEL_MM.x) for (const yy of MODEL_MM.y) for (const zz of [MODEL_MM.z[0], zMax]) out.push(stlToScene([xx, yy, zz]));
    return out;
  }

  /** Projected extents (ndc) of the model bbox for a camera at distance d. */
  function extents(d: number, pos: V3, e: number, scale: number): { xExt: number; yHalf: number; yMid: number } {
    const tanH = Math.tan(14 * DEG);
    let xMax = 0, yMin = Infinity, yMax = -Infinity;
    for (const c of corners(e)) {
      tmp.set(c[0] * scale, c[1] * scale, c[2] * scale).applyQuaternion(quat);
      const X = tmp.x + pos[0], Y = tmp.y + pos[1], depth = d - (tmp.z + pos[2]);
      const nx = X / (depth * tanH * (W / H)), ny = Y / (depth * tanH);
      xMax = Math.max(xMax, Math.abs(nx)); yMin = Math.min(yMin, ny); yMax = Math.max(yMax, ny);
    }
    return { xExt: xMax, yHalf: (yMax - yMin) / 2, yMid: (yMax + yMin) / 2 };
  }

  function project(p: V3, out: { x: number; y: number }): void {
    tmp.set(p[0], p[1], p[2]).applyMatrix4(pivot.matrixWorld).project(camera);
    out.x = (tmp.x * 0.5 + 0.5) * W;
    out.y = (-tmp.y * 0.5 + 0.5) * H;
  }

  const pt = { x: 0, y: 0 };
  const pt2 = { x: 0, y: 0 };

  function updateScene(P: number, intro: number): void {
    const kf = keyframeAt(P);
    eul.set(kf.euler[0] * DEG, kf.euler[1] * DEG, kf.euler[2] * DEG, 'YXZ');
    quat.setFromEuler(eul);
    const scale = lerp(0.94, 1, intro);
    const tablet = W >= 768 && W < 1100;
    const pos: V3 = [mobile() || bake ? 0 : kf.pos[0] * (tablet ? 0.7 : 1), kf.pos[1], kf.pos[2]];
    // fit: never closer than the storyboard distance, never clipped (4% margin) inside the zone
    const [z0, z1] = zone(P);
    const zc = 1 - (z0 + z1); // ndc centre of the zone
    const zh = (z1 - z0) - 0.08; // allowed half-height in ndc: the zone half-height minus a 4% margin
    let d = kf.d * (tablet ? 1.12 : 1);
    for (let i = 0; i < 4; i++) {
      const ex = extents(d, pos, kf.e, scale);
      const s = Math.max(ex.xExt / (bake ? 0.86 : 0.92), ex.yHalf / Math.max(0.2, bake ? 0.86 : zh));
      if (bake) d *= s; // posters: fill the frame
      else if (s > 1.001) d *= s; else break;
    }
    const ex = extents(d, pos, kf.e, scale);
    pivot.position.set(pos[0], pos[1], pos[2]);
    pivot.quaternion.copy(quat);
    pivot.scale.setScalar(scale);
    pivot.updateMatrixWorld(true);
    camera.position.set(0, 0, d);
    camera.lookAt(0, 0, 0);
    // vertical shift so the bbox centre sits at the zone centre
    const shift = (zc - ex.yMid) * (H / 2);
    camera.setViewOffset(W, H, 0, shift, W, H);
    camera.updateMatrixWorld(true);
    camPos.copy(camera.position);

    // explode
    if (lidNode) lidNode.position.y = lidRestY + LID_LIFT * kf.e;
    panel.position.y = panelY0 + (LID_LIFT + PANEL_LIFT) * kf.e;
    gps.position.y = gpsY0 + LID_LIFT * kf.e;
    const bump = smoother((P - 0.14) / 0.08) * (1 - smoother((P - 0.3) / 0.04));
    panelTop.emissiveIntensity = 0.35 * bump;
    rim.intensity = 3 * intro;
    renderer.toneMappingExposure = lerp(0.2, 1, intro);
    shadow.visible = !mobile();
    shadow.position.set(pos[0], pos[1] - 0.95 * scale, pos[2]);
    shadow.scale.set(2.6 * scale, 1.1 * scale, 1);
    shadow.rotation.z = 0;

    updateOverlays(P, kf, intro);
  }

  function updateOverlays(P: number, kf: ReturnType<typeof keyframeAt>, intro: number): void {
    const showCo = !mobile() && intro >= 1;
    for (const c of callouts) {
      const d = c.def;
      let on = showCo && P >= d.from && P <= d.to;
      if (on) {
        const lift = d.lid ? LID_LIFT * kf.e : 0;
        const pts = d.points.map((p) => stlToScene(p, lift));
        project(pts[0], pt);
        // facing test
        tmp.set(d.normal[0], d.normal[2], -d.normal[1]).normalize().applyQuaternion(pivot.quaternion);
        const n = tmp.clone();
        const wp = new Vector3(pts[0][0], pts[0][1], pts[0][2]).applyMatrix4(pivot.matrixWorld);
        const toCam = camPos.clone().sub(wp).normalize();
        const facing = n.dot(toCam);
        if (facing < (d.facing ?? 0.15)) on = false;
        const inView = pt.x > 8 && pt.x < W - 8 && pt.y > 8 && pt.y < H - 8;
        if (!inView) on = false;
        if (on) {
          if (!c.w) { c.w = c.el.offsetWidth; c.h = c.el.offsetHeight; }
          let lx = pt.x + d.off[0], ly = pt.y + d.off[1];
          lx = Math.min(W - 12 - c.w, Math.max(12, lx - c.w / 2)); // centre the label on the offset point
          ly = Math.min(H - 12 - c.h, Math.max(84, ly - c.h / 2));
          c.el.style.transform = `translate(${lx.toFixed(1)}px, ${ly.toFixed(1)}px)`;
          const cx = lx + c.w / 2, cy = ly + c.h / 2;
          pts.forEach((p, i) => {
            project(p, i === 0 ? pt : pt2);
            const q = i === 0 ? pt : pt2;
            const l = c.lines[i];
            l.setAttribute('x1', q.x.toFixed(1)); l.setAttribute('y1', q.y.toFixed(1));
            l.setAttribute('x2', cx.toFixed(1)); l.setAttribute('y2', cy.toFixed(1));
            c.dots[i].setAttribute('cx', q.x.toFixed(1)); c.dots[i].setAttribute('cy', q.y.toFixed(1));
          });
        }
      }
      if (on !== c.shown) {
        c.shown = on;
        c.el.dataset.on = on ? '1' : '0';
        c.lines.forEach((l) => l.setAttribute('opacity', on ? '1' : '0'));
        c.dots.forEach((l) => l.setAttribute('opacity', on ? '1' : '0'));
      }
    }
    // dimension lines
    dimPaths.forEach((dp, i) => {
      const prog = kf.dims[i];
      const a = stlToScene(dp.d.a), b = stlToScene(dp.d.b);
      if (prog <= 0) {
        dp.line.setAttribute('stroke-dashoffset', '1');
        dp.ticks.setAttribute('opacity', '0');
        dp.label.dataset.on = '0';
        return;
      }
      project(a, pt); project(b, pt2);
      dp.line.setAttribute('d', `M${pt.x.toFixed(1)} ${pt.y.toFixed(1)}L${pt2.x.toFixed(1)} ${pt2.y.toFixed(1)}`);
      dp.line.setAttribute('stroke-dashoffset', String(1 - prog));
      const dx = pt2.x - pt.x, dy = pt2.y - pt.y, len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * 7, ny = (dx / len) * 7;
      dp.ticks.setAttribute('d', `M${(pt.x - nx).toFixed(1)} ${(pt.y - ny).toFixed(1)}L${(pt.x + nx).toFixed(1)} ${(pt.y + ny).toFixed(1)}M${(pt2.x - nx).toFixed(1)} ${(pt2.y - ny).toFixed(1)}L${(pt2.x + nx).toFixed(1)} ${(pt2.y + ny).toFixed(1)}`);
      dp.ticks.setAttribute('opacity', prog >= 1 ? '1' : '0');
      project(stlToScene(dp.d.label), pt);
      const lw = dp.label.offsetWidth || 60, lh = dp.label.offsetHeight || 30;
      dp.label.style.transform = `translate(${(pt.x - lw / 2 + (dp.d.id === 'width' ? 34 : 0) + (dp.d.id === 'height' ? -38 : 0)).toFixed(1)}px, ${(pt.y - lh / 2 + (dp.d.id === 'length' ? 26 : 0)).toFixed(1)}px)`;
      dp.label.dataset.on = prog >= 1 ? '1' : '0';
    });
  }

  function render(): void {
    const now = performance.now();
    let intro = 1;
    if (introStart >= 0) {
      const t = Math.min(1, (now - introStart) / 1200);
      intro = 1 - Math.pow(1 - t, 4);
      if (t >= 1) introStart = -1;
    }
    updateScene(x, intro);
    renderer.render(scene, camera);
    if (!firstFrame) { firstFrame = true; opts.onFirstFrame(); }
  }

  function frame(now: number): void {
    raf = 0;
    if (disposed || lost || !active || document.hidden) { last = 0; return; }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    if (last) trackFrame(now - last);
    last = now;
    // critically damped spring toward target, k = 9 1/s
    const k = 9;
    const sub = 4, h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const a = k * k * (target - x) - 2 * k * v;
      v += a * h; x += v * h;
    }
    const settled = Math.abs(target - x) < 0.0005 && Math.abs(v) < 0.0005;
    if (settled) { x = target; v = 0; }
    render();
    if (!settled || introStart >= 0) raf = requestAnimationFrame(frame); else { last = 0; frameTimes.length = 0; }
  }

  function kick(): void {
    if (!raf && active && !disposed && !lost && !document.hidden) raf = requestAnimationFrame(frame);
  }

  // ---- watchdog (site-brief 4.5): average frame time over 60 consecutive frames > 24 ms steps the quality down ----
  function trackFrame(ms: number): void {
    if (ms > 120) { frameTimes.length = 0; return; }
    frameTimes.push(ms);
    if (frameTimes.length < 60) return;
    const avg = frameTimes.reduce((s, n) => s + n, 0) / frameTimes.length;
    frameTimes.length = 0;
    if (avg <= 24 || lightStep >= 3) return;
    lightStep++;
    if (lightStep === 1) { dpr = Math.min(dpr, 1.25); applySize(); document.documentElement.dataset.light = '1'; }
    else if (lightStep === 2) {
      dpr = 1; applySize();
      if (envOn) { envOn = false; scene.environment = null; fill.intensity = 0.9; key.intensity = 3; }
    }
    opts.onLightStep(lightStep as 1 | 2 | 3);
  }

  function applySize(): void {
    const r = canvas.parentElement!.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    callouts.forEach((c) => { c.w = 0; });
    kick();
  }

  const ro = new ResizeObserver(() => { applySize(); render(); });
  ro.observe(canvas.parentElement!);
  applySize();

  const onLost = (e: Event) => { e.preventDefault(); lost = true; opts.onLost(); };
  const onRestored = () => { lost = false; opts.onRestored(); kick(); };
  const onVis = () => { if (!document.hidden) { last = 0; kick(); } };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  document.addEventListener('visibilitychange', onVis);

  // first frame with the intro (the caller turns reduced motion off by not loading this chunk at all)
  introStart = performance.now();
  x = target;
  render();
  kick();

  return {
    setProgress(P: number) { target = Math.min(1, Math.max(0, P)); kick(); },
    setActive(on: boolean) { active = on; if (on) { last = 0; kick(); } },
    resize() { applySize(); render(); },
    async snapshotAt(P: number, w: number, h: number) {
      const prevPR = dpr;
      const holdActive = active; active = false;
      dpr = 1; renderer.setPixelRatio(1); renderer.setSize(w, h, false);
      W = w; H = h; camera.aspect = w / h; camera.updateProjectionMatrix();
      callouts.forEach((c) => { c.el.dataset.on = '0'; });
      introStart = -1;
      const prev = renderer.toneMappingExposure;
      bake = true;
      updateScene(P, 1);
      renderer.render(scene, camera);
      bake = false;
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.88));
      renderer.toneMappingExposure = prev; dpr = prevPR; active = holdActive; applySize(); render();
      return blob;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      document.removeEventListener('visibilitychange', onVis);
      geoms.forEach((g) => g.dispose());
      [bodyMat, panelSide, panelTop, gpsMat, shadowMat].forEach((m) => m.dispose());
      [panelGeo, gpsGeo, shadowGeo].forEach((g) => g.dispose());
      [panelTex, shadowTex, envRT.texture].forEach((t) => t.dispose());
      envRT.dispose?.();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
