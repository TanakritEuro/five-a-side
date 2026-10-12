import * as THREE from 'three';
import {
  BALL_RADIUS,
  BOARD_HEIGHT,
  BOARD_THICKNESS,
  CAGE_HEIGHT,
  CENTRE_CIRCLE_RADIUS,
  GOAL_AREA_RADIUS,
  GOAL_DEPTH,
  GOAL_HEIGHT,
  GOAL_WIDTH,
  HALF_LENGTH,
  HALF_WIDTH,
  PENALTY_SPOT_DISTANCE,
  PITCH_LENGTH,
  PITCH_WIDTH,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  POST_RADIUS,
} from './constants';

export interface GameScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  ball: THREE.Mesh;
}

export function createScene(canvas: HTMLCanvasElement): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b2430);
  scene.fog = new THREE.Fog(0x1b2430, 70, 160);

  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 400);

  addLights(scene);
  scene.add(createPitch());
  scene.add(createMarkings());
  scene.add(createWalls());
  for (const end of [1, -1] as const) scene.add(createGoal(end));

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 32, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }),
  );
  ball.castShadow = true;
  scene.add(ball);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, ball };
}

function addLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x24402a, 1.0));

  // An indoor/floodlit cage: one key light high above, casting the shadows.
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(-8, 30, 14);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const s = key.shadow.camera;
  s.left = -HALF_LENGTH - 4;
  s.right = HALF_LENGTH + 4;
  s.top = HALF_WIDTH + 8;
  s.bottom = -HALF_WIDTH - 8;
  s.near = 1;
  s.far = 80;
  scene.add(key);
}

/** Artificial turf with mown-style stripes across the pitch, drawn to a canvas texture. */
function createPitch(): THREE.Group {
  const stripes = 10;
  const canvas = document.createElement('canvas');
  canvas.width = stripes * 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#3d8a3c' : '#357a34';
    ctx.fillRect(i * 16, 0, 16, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;

  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH_LENGTH, PITCH_WIDTH),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;

  // Concrete apron around the cage.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH_LENGTH + 30, PITCH_WIDTH + 30),
    new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.01;
  apron.receiveShadow = true;

  const group = new THREE.Group();
  group.add(pitch, apron);
  return group;
}

function createMarkings(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xf4f4f4 });
  const lineWidth = 0.08;
  const y = 0.005;
  const inset = 0.25; // boundary lines sit just inside the boards

  const line = (x1: number, z1: number, x2: number, z2: number) => {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(lineWidth, length), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.atan2(x2 - x1, z2 - z1);
    mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    group.add(mesh);
  };
  /** Ring arc on the ground; angles measured from +X towards -Z (the ring's own frame). */
  const arc = (cx: number, cz: number, radius: number, start: number, length: number) => {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(radius - lineWidth / 2, radius + lineWidth / 2, 64, 1, start, length),
      mat,
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cx, y, cz);
    group.add(mesh);
  };
  const spot = (x: number, z: number, r: number) => {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 24), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    group.add(mesh);
  };

  const L = HALF_LENGTH - inset;
  const W = HALF_WIDTH - inset;
  line(-L, -W, L, -W);
  line(-L, W, L, W);
  line(-HALF_LENGTH, -W, -HALF_LENGTH, W);
  line(HALF_LENGTH, -W, HALF_LENGTH, W);
  line(0, -W, 0, W);
  arc(0, 0, CENTRE_CIRCLE_RADIUS, 0, Math.PI * 2);
  spot(0, 0, 0.12);

  // Goal areas: a quarter circle round each post, joined by a line parallel to the goal line.
  const postZ = GOAL_WIDTH / 2;
  for (const end of [1, -1]) {
    const gx = end * HALF_LENGTH;
    const frontX = gx - end * GOAL_AREA_RADIUS;
    line(frontX, -postZ, frontX, postZ);
    // In the ring's frame, angle 0 is +X and π/2 is -Z; each arc spans from the goal line into the pitch.
    arc(gx, -postZ, GOAL_AREA_RADIUS, end === 1 ? Math.PI / 2 : 0, Math.PI / 2);
    arc(gx, postZ, GOAL_AREA_RADIUS, end === 1 ? Math.PI : (3 * Math.PI) / 2, Math.PI / 2);
    spot(gx - end * PENALTY_SPOT_DISTANCE, 0, 0.1);
  }
  return group;
}

/** Kickboards (solid, ad-panel coloured) and the faint netting above them. */
function createWalls(): THREE.Group {
  const group = new THREE.Group();
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x1d3f7a, roughness: 0.6 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5 });
  const cageMat = new THREE.MeshBasicMaterial({ color: 0xcfd6df, wireframe: true, transparent: true, opacity: 0.12 });
  const t = BOARD_THICKNESS;

  const board = (w: number, d: number, x: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, BOARD_HEIGHT, d), boardMat);
    mesh.position.set(x, BOARD_HEIGHT / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.06, d + 0.01), trimMat);
    trim.position.set(x, BOARD_HEIGHT, z);
    group.add(mesh, trim);
  };
  const cage = (w: number, h: number, x: number, y: number, z: number, alongZ: boolean) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h, Math.ceil(w / 0.5), Math.ceil(h / 0.5)), cageMat);
    mesh.position.set(x, y, z);
    if (alongZ) mesh.rotation.y = Math.PI / 2;
    group.add(mesh);
  };

  const cageH = CAGE_HEIGHT - BOARD_HEIGHT;
  for (const s of [1, -1]) {
    const z = s * (HALF_WIDTH + t / 2);
    board(PITCH_LENGTH + 2 * t, t, 0, z);
    // The broadcast camera looks through the near (+Z) netting, so only the far side is drawn.
    // Its collider is still there (physics.ts).
    if (s === -1) cage(PITCH_LENGTH, cageH, 0, BOARD_HEIGHT + cageH / 2, z, false);
  }
  const goalHalf = GOAL_WIDTH / 2 + 2 * POST_RADIUS;
  const sideLen = HALF_WIDTH - goalHalf;
  const above = CAGE_HEIGHT - GOAL_HEIGHT;
  for (const end of [1, -1]) {
    const x = end * (HALF_LENGTH + t / 2);
    for (const s of [1, -1]) {
      board(t, sideLen, x, s * (goalHalf + sideLen / 2));
      cage(sideLen, cageH, x, BOARD_HEIGHT + cageH / 2, s * (goalHalf + sideLen / 2), true);
    }
    cage(goalHalf * 2, above, x, GOAL_HEIGHT + above / 2, 0, true);
  }
  return group;
}

function createGoal(end: 1 | -1): THREE.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const halfW = GOAL_WIDTH / 2 + POST_RADIUS;
  const topY = GOAL_HEIGHT + POST_RADIUS;
  const lineX = end * HALF_LENGTH;
  const postX = lineX + end * POST_RADIUS;

  const postGeo = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, topY, 12);
  for (const z of [-halfW, halfW]) {
    const post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(postX, topY / 2, z);
    post.castShadow = true;
    group.add(post);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, halfW * 2 + POST_RADIUS * 2, 12), frameMat);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(postX, topY, 0);
  bar.castShadow = true;
  group.add(bar);

  // Net: wireframe panels (placeholder; port the ripple from ../penalty-shootout/src/net.ts).
  const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 });
  const backX = lineX + end * GOAL_DEPTH;
  const midX = lineX + end * (GOAL_DEPTH / 2);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, topY, 16, 10), netMat);
  back.rotation.y = Math.PI / 2;
  back.position.set(backX, topY / 2, 0);
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, halfW * 2, 5, 16), netMat);
  roof.rotation.x = Math.PI / 2;
  roof.position.set(midX, topY, 0);
  group.add(back, roof);
  for (const z of [-halfW, halfW]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, topY, 5, 10), netMat);
    side.position.set(midX, topY / 2, z);
    group.add(side);
  }
  return group;
}

/** Placeholder player: a capsule in the team's shirt colour with a head and a facing marker. */
export function createPlayerMesh(shirt: number, shorts: number): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - 2 * PLAYER_RADIUS - 0.25, 6, 12),
    new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.7 }),
  );
  body.position.y = (PLAYER_HEIGHT - 0.25) / 2;
  body.castShadow = true;
  const legs = new THREE.Mesh(
    new THREE.CylinderGeometry(PLAYER_RADIUS * 0.85, PLAYER_RADIUS * 0.7, 0.55, 12),
    new THREE.MeshStandardMaterial({ color: shorts, roughness: 0.7 }),
  );
  legs.position.y = 0.55;
  legs.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 10),
    new THREE.MeshStandardMaterial({ color: 0xc99a74, roughness: 0.8 }),
  );
  head.position.y = PLAYER_HEIGHT - 0.12;
  head.castShadow = true;
  // A small nose so you can see which way the player faces (+X in the group's frame).
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.06), head.material);
  nose.position.set(0.13, PLAYER_HEIGHT - 0.13, 0);
  group.add(body, legs, head, nose);
  return group;
}

/** Ring on the ground under the player you control. */
export function createMarker(): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(PLAYER_RADIUS + 0.12, PLAYER_RADIUS + 0.24, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 1;
  return marker;
}
