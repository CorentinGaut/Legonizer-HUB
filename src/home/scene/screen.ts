/**
 * The 31.5" screen's content (SPEC §2): the 3D digital twin of the same area
 * (matte massing on a dark ground, changed buildings tinted from 17 s) rendered into a texture,
 * with the circular focus timeline (paper Fig. 4) on the left third from 16 s.
 */
import * as THREE from 'three';
import type { Derived } from './derive.ts';
import { COLORS } from './constants.ts';
import type { HomeModel } from './model.ts';
import { LOOP, ramp, screenModeAt, smooth } from '../timeline.ts';

const VERSIONS = 7;

export class ScreenContent {
  readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly overlay = new THREE.Scene();
  private readonly overlayCam = new THREE.OrthographicCamera(0, 16, 9, 0, -1, 1);
  private readonly uChange = { value: 0 };
  private readonly overlayMats: THREE.MeshBasicMaterial[] = [];
  private readonly focusDot: THREE.Mesh;
  private readonly ring = { cx: 2.65, cy: 4.5, r: 1.9 };
  private readonly centre: THREE.Vector3;
  private readonly radius: number;

  constructor(model: HomeModel, derived: Derived, size: 'high' | 'low' = 'high') {
    const [w, h] = size === 'high' ? [1024, 576] : [640, 360];
    this.target = new THREE.WebGLRenderTarget(w, h, { samples: size === 'high' ? 4 : 0 });
    this.scene.background = new THREE.Color(COLORS.screenBg);
    this.scene.add(new THREE.HemisphereLight('#f4f6ff', '#5a5f6b', 1.4));
    const sun = new THREE.DirectionalLight('#fff6ea', 2.2);
    sun.position.set(-120, -160, 220);
    this.scene.add(sun);

    const { cols, rows } = model;
    this.centre = new THREE.Vector3(cols / 2, rows / 2, 0);
    this.radius = Math.hypot(cols, rows) / 2;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(cols + 40, rows + 40),
      new THREE.MeshLambertMaterial({ color: COLORS.screenGround }),
    );
    ground.position.set(cols / 2, rows / 2, 0);
    this.scene.add(ground);
    this.scene.add(this.massing(model, derived));
    this.camera = new THREE.PerspectiveCamera(30, w / h, 1, 2000);

    // overlay: timeline panel, ring, version dots, focus dot, title bars
    const mat = (color: string, opacity = 1) => {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false });
      this.overlayMats.push(m);
      (m.userData as { base: number }).base = opacity;
      return m;
    };
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 9), mat(COLORS.screenBg, 0.82));
    panel.position.set(2.65, 4.5, 0);
    this.overlay.add(panel);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.ring.r - 0.035, this.ring.r + 0.035, 96),
      mat(COLORS.screenRing),
    );
    ring.position.set(this.ring.cx, this.ring.cy, 0);
    this.overlay.add(ring);
    for (let n = 0; n < VERSIONS; n++) {
      const a = Math.PI / 2 - (n * Math.PI * 2) / VERSIONS;
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.14, 20), mat(COLORS.screenDot));
      d.position.set(this.ring.cx + Math.cos(a) * this.ring.r, this.ring.cy + Math.sin(a) * this.ring.r, 0);
      this.overlay.add(d);
    }
    this.focusDot = new THREE.Mesh(new THREE.CircleGeometry(0.27, 28), mat(COLORS.screenFocus));
    this.overlay.add(this.focusDot);
    const bar1 = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.16), mat('#eeede9'));
    bar1.position.set(this.ring.cx, this.ring.cy + 0.12, 0);
    const bar2 = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.12), mat('#8b90a0'));
    bar2.position.set(this.ring.cx, this.ring.cy - 0.22, 0);
    this.overlay.add(bar1, bar2);
  }

  /** Massing of the heights (runs of equal height merged), changed buildings carry their colour. */
  private massing(model: HomeModel, derived: Derived): THREE.Mesh {
    const { cols, rows, heights } = model;
    const pos: number[] = [];
    const nor: number[] = [];
    const chg: number[] = [];
    const Z = 1.2; // one brick = 7.2 m over a 6 m stud: true scale
    const colourOf = (c: number): [number, number, number] => {
      const b = derived.buildings[derived.buildingOf[c]!];
      if (!b?.change) return [-1, -1, -1];
      const col = new THREE.Color(COLORS[b.change]).convertSRGBToLinear();
      return [col.r, col.g, col.b];
    };
    const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], col: number[]) => {
      for (const p of [a, b, c, a, c, d]) {
        pos.push(p[0]!, p[1]!, p[2]!);
        nor.push(n[0]!, n[1]!, n[2]!);
        chg.push(col[0]!, col[1]!, col[2]!);
      }
    };
    for (let j = 0; j < rows; j++) {
      let i = 0;
      while (i < cols) {
        const c = j * cols + i;
        const h = heights[c]!;
        const b = derived.buildingOf[c]!;
        if (h === 0) {
          i++;
          continue;
        }
        let e = i + 1;
        while (e < cols && heights[j * cols + e] === h && derived.buildingOf[j * cols + e] === b) e++;
        const z = h * Z;
        const col = colourOf(c);
        const x0 = i,
          x1 = e,
          y0 = j,
          y1 = j + 1;
        quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, 1], col);
        quad([x0, y0, 0], [x1, y0, 0], [x1, y0, z], [x0, y0, z], [0, -1, 0], col);
        quad([x1, y1, 0], [x0, y1, 0], [x0, y1, z], [x1, y1, z], [0, 1, 0], col);
        quad([x0, y1, 0], [x0, y0, 0], [x0, y0, z], [x0, y1, z], [-1, 0, 0], col);
        quad([x1, y0, 0], [x1, y1, 0], [x1, y1, z], [x1, y0, z], [1, 0, 0], col);
        i = e;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aChange', new THREE.Float32BufferAttribute(chg, 3));
    const m = new THREE.MeshLambertMaterial({ color: '#f2f0ea' });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uChange = this.uChange;
      shader.vertexShader =
        'attribute vec3 aChange;\nvarying vec3 vChange;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvChange = aChange;');
      shader.fragmentShader =
        'uniform float uChange;\nvarying vec3 vChange;\n' +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nif (vChange.r >= 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vChange, uChange);',
        );
    };
    m.customProgramCacheKey = () => 'lz-screen-massing';
    return new THREE.Mesh(g, m);
  }

  /** Render the screen content for time t into the target. */
  render(renderer: THREE.WebGLRenderer, t: number): void {
    const s = screenModeAt(t);
    this.uChange.value = s.change;
    const az = (-20 + 14 * Math.sin((2 * Math.PI * t) / LOOP)) * (Math.PI / 180);
    const el = 36 * (Math.PI / 180);
    const d = this.radius * 2.25;
    const target = this.centre.clone().add(new THREE.Vector3(this.radius * 0.18, 0, 4));
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(
      target.x + Math.sin(az) * Math.cos(el) * d,
      target.y - Math.cos(az) * Math.cos(el) * d,
      target.z + Math.sin(el) * d,
    );
    this.camera.lookAt(target);
    const timeline = smooth(ramp(t % LOOP, 16.0, 16.4)) * (s.mode === 'timeline' ? 1 : 0);
    for (const m of this.overlayMats) m.opacity = (m.userData as { base: number }).base * timeline;
    const a = Math.PI / 2 - (s.focus * Math.PI * 2) / VERSIONS;
    this.focusDot.position.set(
      this.ring.cx + Math.cos(a) * this.ring.r,
      this.ring.cy + Math.sin(a) * this.ring.r,
      0,
    );
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.setRenderTarget(this.target);
    renderer.autoClear = true;
    renderer.render(this.scene, this.camera);
    if (timeline > 0) {
      renderer.autoClear = false;
      renderer.render(this.overlay, this.overlayCam);
    }
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.target.dispose();
  }
}
