/**
 * The room and the device (SPEC §2, H3; 3d-look.md §3, §5.2, §7–9): floor and walls, the 1 × 2 m
 * table at 0.60 m, the 2.30 m mast with the projector at the top and the 31.5" screen centred at
 * 1.30 m, the room lights, the projector's two SpotLights (layer crossfades) and its light cone. Static parts sharing a material are merged to keep draw calls low.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, LENS, SPOT, TABLE } from './constants.ts';

export interface Room {
  group: THREE.Group;
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  glow: THREE.PointLight;
  spotA: THREE.SpotLight;
  spotB: THREE.SpotLight;
  lensMat: THREE.MeshBasicMaterial;
  screenMat: THREE.MeshBasicMaterial;
  cone: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
}

function boxAt(w: number, d: number, h: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, d, h);
  g.translate(x, y, z);
  g.deleteAttribute('uv');
  return g;
}

function solid(geos: THREE.BufferGeometry[], color: string, roughness: number, metalness = 0): THREE.Mesh {
  const m = new THREE.Mesh(
    mergeGeometries(geos)!,
    new THREE.MeshStandardMaterial({ color, roughness, metalness }),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Open rectangular pyramid from the lens to the table corners; additive, hazier near the lens. */
function lightCone(): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const w = TABLE.length,
    d = TABLE.width;
  const corners = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  const pos: number[] = [];
  const fade: number[] = [];
  for (let n = 0; n < 4; n++) {
    const [ax, ay] = corners[n]!;
    const [bx, by] = corners[(n + 1) % 4]!;
    pos.push(LENS.x, LENS.y, LENS.z - 0.015, ax!, ay!, 0.002, bx!, by!, 0.002);
    fade.push(1, 0, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('fade', new THREE.Float32BufferAttribute(fade, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(COLORS.cone) }, strength: { value: 0 } },
    vertexShader:
      'attribute float fade; varying float vF; void main(){ vF = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'uniform vec3 color; uniform float strength; varying float vF; void main(){ gl_FragColor = vec4(color * strength * (0.25 + 0.75 * vF * vF), 1.0); }',
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return mesh;
}

function spot(castShadow: boolean, mapSize: number): THREE.SpotLight {
  const s = new THREE.SpotLight('#ffffff', 0, 0, THREE.MathUtils.degToRad(SPOT.angleDeg), 0, 0);
  s.position.set(LENS.x, LENS.y, LENS.z);
  s.target.position.set(LENS.x, LENS.y, 0);
  // z-up world, light looking straight down: the default up is parallel to the view direction and
  // the projection degenerates (3d-look §7). North (+y) is the texture's up.
  s.shadow.camera.up.set(0, 1, 0);
  s.shadow.focus = SPOT.focus; // vertical fov = angle → the map spans the 1 m table width
  s.shadow.mapSize.set(mapSize * SPOT.aspect, mapSize); // aspect 2 : 1 → the map spans the 2 m length
  s.shadow.camera.near = 0.8;
  s.shadow.camera.far = 2.4;
  s.shadow.bias = -0.00005;
  s.shadow.normalBias = 0.0008;
  s.castShadow = castShadow;
  return s;
}

export function buildRoom(opts: { shadowSize: number }): Room {
  const group = new THREE.Group();
  group.name = 'room';
  const F = TABLE.floor;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.95 }),
  );
  floor.position.z = F;
  floor.receiveShadow = true;
  group.add(floor);
  const back = new THREE.PlaneGeometry(12, 4);
  back.rotateX(Math.PI / 2);
  back.translate(0, 2.3, F + 2);
  const left = new THREE.PlaneGeometry(10, 4);
  left.rotateX(Math.PI / 2);
  left.rotateZ(Math.PI / 2); // normal +x, facing the room
  left.translate(-3.6, 0, F + 2);
  const walls = new THREE.Mesh(
    mergeGeometries([back, left])!,
    new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.95 }),
  );
  walls.receiveShadow = true;
  group.add(walls);

  // table: top at z = −PLATE_T (baseplates sit on it, their tops at z = 0)
  const top = new THREE.Mesh(
    boxAt(TABLE.length, TABLE.width, 0.03, 0, 0, -0.0018 - 0.015),
    new THREE.MeshStandardMaterial({ color: COLORS.table, roughness: 0.55 }),
  );
  top.castShadow = true;
  top.receiveShadow = true;
  group.add(top);
  const legs = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sy) => boxAt(0.045, 0.045, 0.57, sx * 0.94, sy * 0.44, F + 0.285)),
  );
  group.add(solid(legs, COLORS.tableLegs, 0.45, 0.3));

  // mast (2.30 m) on the long side, foot, arm to the projector
  const mastY = 0.56;
  group.add(
    solid(
      [
        boxAt(0.045, 0.045, 2.3, 0, mastY, F + 1.15),
        boxAt(0.36, 0.3, 0.012, 0, mastY + 0.06, F + 0.006),
        boxAt(0.035, 0.56, 0.035, 0, 0.29, 1.72),
        // screen bracket
        boxAt(0.08, 0.05, 0.12, 0, mastY - 0.03, 0.7),
      ],
      COLORS.metal,
      0.42,
      0.55,
    ),
  );
  const projector = new THREE.Mesh(
    boxAt(0.3, 0.26, 0.11, 0, 0.04, 1.675),
    new THREE.MeshStandardMaterial({ color: COLORS.projector, roughness: 0.5 }),
  );
  projector.castShadow = true;
  group.add(projector);
  const lensMat = new THREE.MeshBasicMaterial({ color: COLORS.lensOff });
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.02, 24), lensMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(LENS.x, LENS.y, LENS.z);
  group.add(lens);

  // 31.5" screen: active 0.697 × 0.392 m, centre at 1.30 m from the floor (z = 0.70), facing −y
  const bezel = new THREE.Mesh(
    boxAt(0.72, 0.03, 0.415, 0, 0.52, 0.7),
    new THREE.MeshStandardMaterial({ color: COLORS.bezel, roughness: 0.35 }),
  );
  bezel.castShadow = true;
  group.add(bezel);
  const screenMat = new THREE.MeshBasicMaterial({ color: '#08090b', toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.697, 0.392), screenMat);
  screen.rotation.x = Math.PI / 2;
  screen.position.set(0, 0.504, 0.7);
  group.add(screen);

  // lights (3d-look §5.2)
  const hemi = new THREE.HemisphereLight('#a7b0ca', '#3a342e', 1.1);
  const key = new THREE.DirectionalLight('#ffe7c7', 2.4);
  key.position.set(-1.2, -2.6, 3.0);
  key.target.position.set(0, 0, 0);
  key.castShadow = opts.shadowSize > 0;
  key.shadow.mapSize.set(opts.shadowSize || 512, opts.shadowSize || 512);
  Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 2.2, bottom: -2.2, near: 0.5, far: 9 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.002;
  key.shadow.radius = 3;
  const glow = new THREE.PointLight('#9fb0ff', 0, 2.2, 2);
  glow.position.set(0, 0.35, 0.72);
  // both projector lights cast shadows (bricks shadow the baseplates, which makes projected roofs
  // read as 3D); a light's shadow pass is skipped while it is off (stage.ts)
  const spotA = spot(opts.shadowSize > 0, opts.shadowSize >= 2048 ? 1024 : 512);
  const spotB = spot(opts.shadowSize > 0, opts.shadowSize >= 2048 ? 1024 : 512);
  group.add(hemi, key, key.target, glow, spotA, spotA.target, spotB, spotB.target);

  const cone = lightCone();
  group.add(cone);
  return { group, hemi, key, glow, spotA, spotB, lensMat, screenMat, cone };
}
