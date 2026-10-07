/**
 * The home animation's 3D stage (lazy chunk, loaded after the poster, SPEC H10).
 * `renderAt(t)` draws the frame for a loop time t; every property is a pure function of t
 * (timeline.ts), so frames are reproducible (poster, tests) and the loop is seamless.
 */
import * as THREE from 'three';
import { makeAnimUniforms } from './animMaterial.ts';
import { buildBrickMeshes, type BrickMeshes } from './bricks.ts';
import { BRICK_H, COLORS } from './constants.ts';
import { deriveUrbanData } from './derive.ts';
import { Figures } from './figures.ts';
import { loadHomeModel, type HomeModel } from './model.ts';
import { ProjectionLayers, type LegendLabels } from './projection.ts';
import { buildRoom, type Room } from './room.ts';
import { ScreenContent } from './screen.ts';
import {
  BUILD,
  cameraAt,
  type CameraPose,
  PLATES,
  POSTER_T,
  projectionAt,
  projectorPower,
  roomLightsAt,
  screenPower,
  wrap,
} from '../timeline.ts';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

// A projector emits nothing outside its image: three lights a spot's cone at full strength where
// the map frustum does not reach (the floor around the table). Make that region dark instead.
THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
  'directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;',
  'directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : vec3( 0.0 );',
);

export type Layout = 'desktop' | 'phone';

export interface StageOptions {
  labels: LegendLabels;
  /** 'high' on capable devices, 'low' on phones / low memory. */
  quality?: 'high' | 'low';
}

export interface StageSnapshot {
  t: number;
  camera: { position: number[]; quaternion: number[]; projection: number[] };
  projector: number;
  screen: number;
  spots: [number, number];
  lights: { hemi: number; key: number; glow: number };
  layers: [string, string];
}

/** Quality steps (storyboard §7): shadows 2048 → 1024 → off, then DPR 1, then a static screen. */
const STEPS = ['full', 'shadows-1024', 'no-shadows', 'dpr-1', 'static-screen'] as const;
export type QualityStep = (typeof STEPS)[number];

const yieldToMain = (): Promise<void> =>
  new Promise((resolve) => {
    const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (s?.yield) void s.yield().then(resolve);
    else setTimeout(resolve, 0);
  });

/** Desktop text-safe zone (storyboard §2.2, 3d-look §10): the subject sits in the right ~65 %. */
const SAFE_OFFSET = 1.45;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.05, 30);
  readonly model: HomeModel;
  private readonly uniforms = makeAnimUniforms();
  private readonly room: Room;
  private readonly bricks: BrickMeshes;
  private readonly figures: Figures;
  private readonly layers: ProjectionLayers;
  private readonly screen: ScreenContent;
  private layout: Layout = 'desktop';
  private width = 1;
  private height = 1;
  private step = 0;
  private dprCap = 2;
  private staticScreenAt = -1;
  private lastLayers: [string, string] = ['plain', 'plain'];

  private constructor(
    canvas: HTMLCanvasElement,
    parts: {
      model: HomeModel;
      room: Room;
      bricks: BrickMeshes;
      figures: Figures;
      layers: ProjectionLayers;
      screen: ScreenContent;
    },
    renderer: THREE.WebGLRenderer,
  ) {
    this.renderer = renderer;
    this.model = parts.model;
    this.room = parts.room;
    this.bricks = parts.bricks;
    this.figures = parts.figures;
    this.layers = parts.layers;
    this.screen = parts.screen;
    void canvas;
    this.scene.background = new THREE.Color(COLORS.background);
    this.scene.fog = new THREE.Fog(COLORS.background, 5.5, 11);
    this.scene.add(this.room.group, this.bricks.group, this.figures.group);
    this.room.screenMat.map = this.screen.target.texture;
    this.room.screenMat.needsUpdate = true;
    this.room.spotA.map = this.layers.texture('plain');
    this.room.spotB.map = this.layers.texture('plain');
  }

  static async create(canvas: HTMLCanvasElement, opts: StageOptions): Promise<Stage> {
    const quality = opts.quality ?? 'high';
    // timings for docs/perf.md (performance.measure entries "lz:stage:*")
    let mark = performance.now();
    const step = (name: string) => {
      const n = performance.now();
      performance.measure(`lz:stage:${name}`, { start: mark, end: n });
      mark = n;
    };
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping; // keeps projected hues true (3d-look §2)
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(COLORS.background, 1);
    step('renderer');
    await yieldToMain();
    mark = performance.now();
    const model = loadHomeModel();
    const derived = deriveUrbanData(model.cols, model.rows, model.heights);
    step('model');
    await yieldToMain();
    mark = performance.now();
    const uniformsHolder = makeAnimUniforms();
    const room = buildRoom({ shadowSize: quality === 'high' ? 2048 : 1024 });
    const bricks = buildBrickMeshes(model, uniformsHolder, { studSegments: quality === 'high' ? 8 : 6 });
    step('bricks');
    await yieldToMain();
    mark = performance.now();
    const figures = new Figures();
    const layers = new ProjectionLayers(model, derived, opts.labels, quality === 'high' ? 'high' : 'low', 6);
    const screen = new ScreenContent(model, derived, quality);
    const stage = new Stage(canvas, { model, room, bricks, figures, layers, screen }, renderer);
    // the instanced materials were built with `uniformsHolder`; share it with the stage
    Object.assign(stage.uniforms, uniformsHolder);
    stage.uniforms.uFall.value = 2 * BRICK_H;
    stage.uniforms.uDropDur.value = BUILD.fall;
    stage.uniforms.uLiftDur.value = BUILD.liftDur;
    stage.uniforms.uSlideIn.value = PLATES.inDur;
    stage.uniforms.uSlideOut.value = PLATES.outDur;
    stage.uniforms.uTravel.value = PLATES.travel;
    if (quality === 'low') stage.dprCap = 1.5;
    // prepare every projected layer up front, one per task (no long task, no hitch later)
    step('scene');
    for (const key of ['functions', 'functions-green', 'functions-tram', 'change-1', 'change-2'] as const) {
      await yieldToMain();
      mark = performance.now();
      renderer.initTexture(layers.texture(key));
      step(`layer-${key}`);
    }
    await yieldToMain();
    stage.setSize(canvas.clientWidth || 1280, canvas.clientHeight || 720, 'desktop');
    stage.update(POSTER_T);
    // compile every program without blocking (KHR_parallel_shader_compile when available)
    mark = performance.now();
    await renderer.compileAsync(stage.scene, stage.camera);
    step('compile');
    return stage;
  }

  get stats(): { drawCalls: number; triangles: number; bricks: number; studs: number; quality: QualityStep } {
    const info = this.renderer.info.render;
    return {
      drawCalls: info.calls,
      triangles: info.triangles,
      bricks: this.bricks.stats.bricks,
      studs: this.bricks.stats.studs,
      quality: STEPS[this.step]!,
    };
  }

  setLabels(labels: LegendLabels): void {
    this.layers.setLabels(labels);
    this.lastLayers = ['', ''];
  }

  setSize(width: number, height: number, layout: Layout): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.layout = layout;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    // keep the drawing buffer under ~3.7 MP (integrated GPUs, SPEC §6.2)
    const budget = Math.sqrt(3.7e6 / (this.width * this.height));
    this.renderer.setPixelRatio(Math.max(1, Math.min(dpr, this.dprCap, budget)));
    this.renderer.setSize(this.width, this.height, false);
  }

  /** Lower the quality one step; false when nothing is left to drop (the caller stops on the poster). */
  degrade(): boolean {
    if (this.step >= STEPS.length - 1) return false;
    this.step++;
    const s = STEPS[this.step]!;
    const { key, spotA, spotB } = this.room;
    if (s === 'shadows-1024') {
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.radius = 1;
      for (const sp of [spotA, spotB]) sp.shadow.mapSize.set(1024, 512);
      for (const l of [key, spotA, spotB]) {
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
    } else if (s === 'no-shadows') {
      this.renderer.shadowMap.enabled = false;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
      });
    } else if (s === 'dpr-1') {
      this.dprCap = 1;
      this.setSize(this.width, this.height, this.layout);
    } else if (s === 'static-screen') {
      this.staticScreenAt = -1;
    }
    return true;
  }

  get quality(): QualityStep {
    return STEPS[this.step]!;
  }

  /** Camera pose at t with the responsive framing of storyboard §2.2. */
  private poseOverride: CameraPose | null = null;

  private placeCamera(t: number): CameraPose {
    const p = this.poseOverride ?? cameraAt(t);
    const aspect = this.width / this.height;
    let dist = p.dist;
    const target = [...p.target] as [number, number, number];
    if (this.layout === 'phone' && !this.poseOverride) {
      // narrow canvas: pull back until each keyframe's subject box fits (storyboard §2.2)
      dist *= Math.min(2.2, Math.max(1, Math.pow(1.75 / aspect, 0.6)));
      target[2] += 0.12;
    }
    const a = THREE.MathUtils.degToRad(p.az);
    const e = THREE.MathUtils.degToRad(p.el);
    const cam = this.camera;
    cam.position.set(
      target[0] + Math.sin(a) * Math.cos(e) * dist,
      target[1] - Math.cos(a) * Math.cos(e) * dist,
      target[2] + Math.sin(e) * dist,
    );
    cam.up.set(0, 0, 1);
    cam.lookAt(target[0], target[1], target[2]);
    if (this.layout === 'desktop') {
      cam.aspect = (SAFE_OFFSET * this.width) / this.height;
      cam.setViewOffset(SAFE_OFFSET * this.width, this.height, 0, 0, this.width, this.height);
    } else {
      cam.clearViewOffset();
      cam.aspect = aspect;
    }
    cam.updateProjectionMatrix();
    return { ...p, dist, target };
  }

  /** Update every animated property for loop time t (pure function of t). */
  update(time: number): void {
    const t = wrap(time);
    this.uniforms.uTime.value = t;
    this.placeCamera(t);
    const lights = roomLightsAt(t);
    const { hemi, key, glow, spotA, spotB, lensMat, screenMat, cone } = this.room;
    hemi.intensity = lights.hemi;
    key.intensity = lights.key;
    glow.intensity = lights.glow;
    const power = projectorPower(t);
    const proj = projectionAt(t);
    const texA = this.layers.texture(proj.a, proj.tram);
    const texB = this.layers.texture(proj.b, proj.tram);
    spotA.map = texA;
    spotB.map = texB;
    spotA.intensity = 9 * power * (1 - proj.mix);
    spotB.intensity = 9 * power * proj.mix;
    // skip the shadow pass of a projector light that is off; every shadow map must exist once
    // (an unrendered map leaves the shadow sampler without a depth texture)
    for (const sp of [spotA, spotB]) {
      sp.shadow.autoUpdate = sp.intensity > 0;
      if (!sp.shadow.map) sp.shadow.needsUpdate = true;
    }
    this.lastLayers = [proj.a, proj.b];
    lensMat.color.set(COLORS.lensOff).lerp(new THREE.Color(COLORS.lensOn), power);
    cone.material.uniforms.strength!.value = 0.035 * power;
    cone.visible = power > 0;
    const sp = screenPower(t);
    screenMat.color.setScalar(sp); // off = black glass
    this.figures.update(t);
    this.screenPowerNow = sp;
  }

  private screenPowerNow = 0;

  /** Render the frame for loop time t. */
  renderAt(time: number): void {
    const t = wrap(time);
    this.update(t);
    if (this.screenPowerNow > 0) {
      const staticScreen = this.quality === 'static-screen';
      // static screen (degraded): re-render only when the content changes state
      const bucket = staticScreen ? Math.floor(t / 0.5) : -2;
      if (!staticScreen || bucket !== this.staticScreenAt) {
        this.screen.render(this.renderer, t);
        this.staticScreenAt = bucket;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** State for tests: loop seam, determinism. */
  snapshot(time: number): StageSnapshot {
    const t = wrap(time);
    this.update(t);
    const r = (v: number) => Math.round(v * 1e6) / 1e6;
    return {
      t,
      camera: {
        position: this.camera.position.toArray().map(r),
        quaternion: this.camera.quaternion.toArray().map(r),
        projection: this.camera.projectionMatrix.toArray().map(r),
      },
      projector: r(projectorPower(t)),
      screen: r(screenPower(t)),
      spots: [r(this.room.spotA.intensity), r(this.room.spotB.intensity)],
      lights: roomLightsAt(t),
      layers: this.lastLayers,
    };
  }

  /**
   * Render one still at a given size into a data URL (poster and stills script). `pose` replaces
   * the timeline camera (close-ups for the page's stills); the scene state still follows t.
   */
  still(
    time: number,
    width: number,
    height: number,
    layout: Layout,
    opts: { pose?: CameraPose; fov?: number; type?: string; quality?: number } = {},
  ): string {
    const prev = { w: this.width, h: this.height, layout: this.layout };
    this.renderer.setPixelRatio(1);
    this.width = width;
    this.height = height;
    this.layout = opts.pose ? 'phone' : layout;
    this.poseOverride = opts.pose ?? null;
    this.camera.fov = opts.fov ?? 35;
    this.renderer.setSize(width, height, false);
    this.renderAt(time);
    const url = this.renderer.domElement.toDataURL(opts.type ?? 'image/webp', opts.quality ?? 0.86);
    this.poseOverride = null;
    this.camera.fov = 35;
    this.setSize(prev.w, prev.h, prev.layout);
    return url;
  }

  /** Free GPU resources. */
  dispose(): void {
    this.layers.dispose();
    this.screen.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.dispose();
    });
    this.renderer.dispose();
  }
}

export async function createStage(canvas: HTMLCanvasElement, opts: StageOptions): Promise<Stage> {
  return Stage.create(canvas, opts);
}
