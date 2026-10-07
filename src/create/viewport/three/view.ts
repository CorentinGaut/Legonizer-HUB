/**
 * A three.js viewport for the create page and the build guide (docs/ui/3d-look.md §2, §5.1, §10, §12):
 * transparent canvas over the CSS scene gradient, Khronos PBR Neutral tone mapping, sRGB output,
 * studio rig (hemisphere + key light attached to the camera azimuth + fill), contact shadows on a
 * ShadowMaterial ground, orbit controls (Z up), orthographic top view (north up), render on demand.
 */
import {
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MOUSE,
  NeutralToneMapping,
  type Object3D,
  OrthographicCamera,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const DEG = Math.PI / 180;

export interface FrameOptions {
  /** Degrees from the south, toward the east (ux: azimuth −32° = from the south-west). */
  azimuth?: number;
  elevation?: number;
  margin?: number;
  /** Instant (reduced motion) or animated camera move. */
  animate?: boolean;
}

export class ThreeView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly content = new Group();
  readonly overlay = new Group();
  readonly persp: PerspectiveCamera;
  readonly ortho: OrthographicCamera;
  camera: PerspectiveCamera | OrthographicCamera;
  controls: OrbitControls;
  private key: DirectionalLight;
  private fill: DirectionalLight;
  private ground: Mesh;
  private ro: ResizeObserver;
  private pending = 0;
  private disposed = false;
  private bounds = new Box3();
  private frameOpts: FrameOptions = {};
  top = false;
  /** Extra per-frame hook (labels, compass). */
  onRender: (() => void) | null = null;
  readonly canvas: HTMLCanvasElement;
  /** Pixels reserved at the top/bottom for the floating toolbar and legend (UI-9 safe rectangle). */
  safeTop = 60;
  safeBottom = 56;
  shadows: boolean;

  constructor(container: HTMLElement, opts: { label: string; shadows?: boolean; fov?: number }) {
    this.shadows = opts.shadows ?? true;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.shadows;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'lz-viewport__canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', opts.label);
    container.prepend(this.canvas);

    this.persp = new PerspectiveCamera(opts.fov ?? 30, 1, 0.1, 1e6);
    this.persp.up.set(0, 0, 1);
    this.ortho = new OrthographicCamera(-1, 1, 1, -1, -1e6, 1e6);
    this.ortho.up.set(0, 1, 0);
    this.camera = this.persp;

    // studio rig (3d-look §5.1)
    this.scene.add(new HemisphereLight(new Color('#F4F6FF'), new Color('#A49F96'), 0.95));
    this.key = new DirectionalLight(new Color('#FFF6EA'), 3.1);
    this.key.castShadow = this.shadows;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.00015;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 2.5;
    this.scene.add(this.key, this.key.target);
    this.fill = new DirectionalLight(new Color('#E4EBFF'), 0.45);
    this.scene.add(this.fill, this.fill.target);
    this.ground = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.28 }));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground, this.content, this.overlay);

    this.controls = this.makeControls();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.resize();
  }

  private makeControls(): OrbitControls {
    const c = new OrbitControls(this.camera, this.canvas);
    c.enableDamping = false;
    c.screenSpacePanning = true;
    c.minPolarAngle = 1 * DEG;
    c.maxPolarAngle = 80 * DEG; // elevation ≥ 10°
    c.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    if (this.top) {
      c.enableRotate = false;
      c.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    }
    c.addEventListener('change', () => this.requestRender());
    return c;
  }

  resize(): void {
    const el = this.canvas.parentElement;
    if (!el || this.disposed) return;
    const w = Math.max(1, el.clientWidth),
      h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.updateOrtho();
    this.requestRender();
  }

  private orthoHalf = 1;
  private updateOrtho() {
    const el = this.canvas.parentElement;
    if (!el) return;
    const w = Math.max(1, el.clientWidth),
      h = Math.max(1, el.clientHeight);
    const a = w / h;
    this.ortho.left = -this.orthoHalf * a;
    this.ortho.right = this.orthoHalf * a;
    this.ortho.top = this.orthoHalf;
    this.ortho.bottom = -this.orthoHalf;
    this.ortho.updateProjectionMatrix();
  }

  setContent(objects: Object3D[], bounds?: Box3): void {
    for (const c of [...this.content.children]) {
      this.content.remove(c);
      disposeTree(c);
    }
    for (const o of objects) this.content.add(o);
    this.bounds = bounds ?? new Box3().setFromObject(this.content);
    this.placeGround();
    this.requestRender();
  }

  setOverlay(objects: Object3D[]): void {
    for (const c of [...this.overlay.children]) {
      this.overlay.remove(c);
      disposeTree(c);
    }
    for (const o of objects) this.overlay.add(o);
    this.requestRender();
  }

  private placeGround() {
    const b = this.bounds;
    if (b.isEmpty()) return;
    const size = b.getSize(new Vector3());
    const c = b.getCenter(new Vector3());
    const s = Math.max(size.x, size.y) * 4 + 1;
    this.ground.scale.set(s, s, 1);
    this.ground.position.set(c.x, c.y, b.min.z - Math.max(size.z, 1) * 0.002);
    // shadow camera around the content
    const r = Math.max(size.x, size.y, size.z) * 0.75 + 1;
    const cam = this.key.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.01;
    cam.far = r * 6;
    cam.updateProjectionMatrix();
  }

  /** Frames the content (or a box) within the safe rectangle. */
  frame(box?: Box3, o: FrameOptions = {}): void {
    const b = box && !box.isEmpty() ? box : this.bounds;
    if (b.isEmpty()) return;
    this.frameOpts = o;
    const sphere = b.getBoundingSphere(new Sphere());
    const target = sphere.center.clone();
    const el = this.canvas.parentElement!;
    const h = Math.max(1, el.clientHeight);
    const usable = Math.max(0.3, (h - this.safeTop - this.safeBottom) / h);
    if (this.top) {
      const size = b.getSize(new Vector3());
      const w = Math.max(1, el.clientWidth);
      const a = w / h;
      this.orthoHalf = ((Math.max(size.y, size.x / a) / 2) * (o.margin ?? 1.2)) / usable;
      this.updateOrtho();
      this.ortho.position.set(target.x, target.y, b.max.z + 1000);
      this.ortho.zoom = 1;
      this.ortho.lookAt(target.x, target.y, target.z);
      this.ortho.updateProjectionMatrix();
      this.controls.target.copy(target);
    } else {
      const az = (o.azimuth ?? -32) * DEG,
        el2 = (o.elevation ?? 36) * DEG;
      const vf = (this.persp.fov * DEG) / 2;
      const w = Math.max(1, el.clientWidth);
      const tanV = Math.tan(vf) * usable;
      const tanH = Math.tan(vf) * (w / h);
      const dir = new Vector3(Math.sin(az) * Math.cos(el2), -Math.cos(az) * Math.cos(el2), Math.sin(el2));
      // tight fit: every corner of the box inside the frustum (safe rectangle vertically)
      const f = dir.clone().negate();
      const r = new Vector3().crossVectors(f, new Vector3(0, 0, 1)).normalize();
      const u = new Vector3().crossVectors(r, f).normalize();
      let dist = 0;
      const c = new Vector3();
      for (const x of [b.min.x, b.max.x])
        for (const y of [b.min.y, b.max.y])
          for (const z of [b.min.z, b.max.z]) {
            c.set(x, y, z).sub(target);
            const depth = c.dot(f);
            dist = Math.max(dist, Math.abs(c.dot(r)) / tanH - depth, Math.abs(c.dot(u)) / tanV - depth);
          }
      dist = Math.max(dist * (o.margin ?? 1.1), sphere.radius * 0.2, 1e-3);
      this.persp.position.copy(target).addScaledVector(dir, dist);
      this.persp.near = Math.max(0.01, dist / 1000);
      this.persp.far = dist * 20 + sphere.radius * 4;
      this.persp.updateProjectionMatrix();
      this.persp.lookAt(target);
      this.controls.target.copy(target);
      this.controls.minDistance = dist * 0.15;
      this.controls.maxDistance = dist * 4;
    }
    this.controls.update();
    this.requestRender();
  }

  setTop(top: boolean): void {
    if (this.top === top) return;
    this.top = top;
    this.camera = top ? this.ortho : this.persp;
    this.controls.dispose();
    this.controls = this.makeControls();
    this.frame(undefined, this.frameOpts);
  }

  reset(): void {
    this.frame(undefined, this.frameOpts);
  }

  /** Turns the view by `deg` around the target (Turn 90°). */
  turn(deg: number): void {
    if (this.top) {
      // rotate the orthographic "up" (north stays readable through the compass)
      const up = this.ortho.up.clone().applyAxisAngle(new Vector3(0, 0, 1), deg * DEG);
      this.ortho.up.copy(up);
      this.ortho.lookAt(this.controls.target);
    } else {
      const off = this.persp.position.clone().sub(this.controls.target);
      off.applyAxisAngle(new Vector3(0, 0, 1), deg * DEG);
      this.persp.position.copy(this.controls.target).add(off);
      this.persp.lookAt(this.controls.target);
    }
    this.controls.update();
    this.requestRender();
  }

  zoom(factor: number): void {
    if (this.top) {
      this.ortho.zoom = Math.max(0.05, Math.min(50, this.ortho.zoom * factor));
      this.ortho.updateProjectionMatrix();
    } else {
      const off = this.persp.position
        .clone()
        .sub(this.controls.target)
        .multiplyScalar(1 / factor);
      this.persp.position.copy(this.controls.target).add(off);
    }
    this.controls.update();
    this.requestRender();
  }

  /** Camera bearing (degrees, 0 = looking north) for the compass. */
  bearing(): number {
    if (this.top) return (Math.atan2(-this.ortho.up.x, this.ortho.up.y) * 180) / Math.PI;
    const d = this.controls.target.clone().sub(this.persp.position);
    return (Math.atan2(d.x, d.y) * 180) / Math.PI;
  }

  requestRender(): void {
    if (this.pending || this.disposed) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.render();
    });
  }

  render(): void {
    if (this.disposed) return;
    // key light follows the camera azimuth (3d-look §5.1: keyAz = cameraAz − 75°)
    const t = this.controls.target;
    const camAz = Math.atan2(this.camera.position.x - t.x, -(this.camera.position.y - t.y));
    const keyAz = camAz - 75 * DEG;
    const keyEl = (this.top ? 68 : 40) * DEG;
    const r = Math.max(10, this.bounds.isEmpty() ? 100 : this.bounds.getSize(new Vector3()).length());
    this.key.position.set(
      t.x + Math.sin(keyAz) * Math.cos(keyEl) * r,
      t.y - Math.cos(keyAz) * Math.cos(keyEl) * r,
      t.z + Math.sin(keyEl) * r,
    );
    this.key.target.position.copy(t);
    this.fill.position.set(t.x + r, t.y + r, t.z + r * 0.3);
    this.fill.target.position.copy(t);
    this.renderer.render(this.scene, this.camera);
    this.onRender?.();
  }

  /** Projects a world point to CSS pixels in the canvas. */
  project(v: Vector3): { x: number; y: number; visible: boolean } {
    const p = v.clone().project(this.camera);
    const el = this.canvas.parentElement!;
    return {
      x: ((p.x + 1) / 2) * el.clientWidth,
      y: ((1 - p.y) / 2) * el.clientHeight,
      visible: p.z > -1 && p.z < 1,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.pending);
    this.ro.disconnect();
    this.controls.dispose();
    disposeTree(this.content);
    disposeTree(this.overlay);
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.canvas.remove();
  }
}

export function disposeTree(o: Object3D): void {
  o.traverse((x) => {
    const m = x as Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as unknown;
    if (Array.isArray(mat)) mat.forEach((q) => q.dispose?.());
    else (mat as { dispose?: () => void; map?: { dispose(): void } } | undefined)?.dispose?.();
    const map = (mat as { map?: { dispose(): void } } | undefined)?.map;
    map?.dispose?.();
  });
}
