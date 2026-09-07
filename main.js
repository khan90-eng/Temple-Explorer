// Temple Explorer
// Session 1: skeleton — ground plane, orbit camera, FPS counter, local server.
// Session 2: load temple.glb, loading screen, print bounding box.
//   Confirmed 6 Sep 2026: bounding box x=137.45 matches Edfu's real ~137-140 m
//   length almost exactly, so the model is already in real-world meters — no
//   scale correction needed. (z came out larger than the ~79 m pylon width
//   because the model sits at a slight angle to SketchUp's own axes, which
//   inflates an axis-aligned bounding box; harmless for now.)
// Session 3: first-person walking — PointerLockControls + Octree/Capsule
//   collision, using the fixed method parameters: eye height 1.6 m, walking
//   1.4 m/s, running 3 m/s (Shift to run). Speeds later bumped to 3.0 / 6.0
//   m/s at Provat's request for a more game-like feel.
// Session 4: a real sun with shadow mapping (fixed at mid-morning — a
//   time-of-day slider was tried and dropped, it wasn't adding anything),
//   a procedural sky, and a torch (E to light/extinguish) that automatically
//   goes out once you step back into open sky, for exploring the darker
//   enclosed spaces the sun's shadows create. This darkening is the paper's
//   key argument against static plan drawings — a perceptual effect a 2D
//   plan can't show — and it comes from real shadows cast by the model's
//   own geometry, not a hand-authored effect.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Sky } from 'three/addons/objects/Sky.js';
import Stats from 'three/addons/libs/stats.module.js';

const canvas = document.getElementById('app');

// --- Method parameters (also reported in the paper) ---------------------
const EYE_HEIGHT = 1.6; // m
// Bumped up from real walking pace (1.4 / 3.0 m/s) for a more game-like,
// responsive exploration feel — easy to tune, and whatever values we land
// on before the actual student session are what should get reported in
// the paper's method section.
const WALK_SPEED = 3.0; // m/s
const RUN_SPEED = 6.0; // m/s
const CAPSULE_RADIUS = 0.35; // m, roughly shoulder-width
const GRAVITY = 30; // m/s^2
const STEPS_PER_FRAME = 5; // physics substeps for stable collision at low fps
// Egyptian temples like Edfu step the floor UP toward the sanctuary in
// stages, so a small hop is the practical way past a ledge rather than
// something we special-case per level change.
const JUMP_VELOCITY = 8.5; // m/s upward impulse, ~1.2 m apex

// --- Renderer ---------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x0b0d10);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// --- Scene --------------------------------------------------------------
const scene = new THREE.Scene();
// Hazy pale blue, matched to the sky dome's horizon color — the old
// near-black fog was there to hide the ground plane's edge, but it made
// the sky (added below) look dark and wrong in the distance.
scene.fog = new THREE.Fog(0xcfe0ee, 60, 420);

// --- Sky ------------------------------------------------------------------
// three.js's built-in atmospheric scattering sky — no texture needed, and
// it reads the same sun direction we compute in updateSun() below so the
// sky brightness/color always matches the sun position and the shadows.
const sky = new Sky();
sky.scale.setScalar(20000);
scene.add(sky);
sky.material.uniforms['turbidity'].value = 6;
sky.material.uniforms['rayleigh'].value = 1.8;
sky.material.uniforms['mieCoefficient'].value = 0.006;
sky.material.uniforms['mieDirectionalG'].value = 0.8;

// Low ambient fill so shadowed areas are dim, not pure black — real
// enclosed Egyptian interiors weren't lit only by direct sun (some light
// bounces in from the doorway/courtyard), but the sun below is what does
// almost all the work of making court vs. sanctuary look different.
const ambient = new THREE.HemisphereLight(0xbfd6ff, 0x3a2f22, 0.35);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xfff3d6, 1.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
scene.add(sun);
scene.add(sun.target);

// --- Ground plane ---------------------------------------------------------
// Edfu's temple is roughly 140 m long, so a 300x300 m plane gives room to
// walk around it.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(300, 300),
  new THREE.MeshStandardMaterial({ color: 0x6b6459, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(300, 60, 0x8a8f98, 0x3a3f47);
scene.add(grid);

// --- Sun position from time-of-day -----------------------------------
// Filled in properly once the model loads (see below); safe defaults so
// the slider doesn't break if someone drags it before then.
let modelCenter = new THREE.Vector3(0, 0, 0);
let modelMaxDim = 300;

function updateSun(hour) {
  // 0 at 6:00 and 18:00, 1 at noon — clamps to "night" (sun below horizon,
  // ambient-only light) outside that range rather than going negative.
  const dayProgress = THREE.MathUtils.clamp((hour - 6) / 12, 0, 1);
  const arc = Math.sin(Math.PI * dayProgress);

  const elevationAngle = arc * (Math.PI / 2 - 0.05);
  const azimuthAngle = THREE.MathUtils.lerp(-Math.PI / 1.3, Math.PI / 1.3, dayProgress);

  const sunDistance = modelMaxDim * 1.5;
  sun.position.set(
    modelCenter.x + sunDistance * Math.sin(azimuthAngle) * Math.cos(elevationAngle),
    modelCenter.y + Math.max(sunDistance * Math.sin(elevationAngle), 5),
    modelCenter.z + sunDistance * Math.cos(azimuthAngle) * Math.cos(elevationAngle)
  );
  sun.target.position.copy(modelCenter);
  sun.target.updateMatrixWorld();

  // Dim and warm-shift near sunrise/sunset; brighter and neutral at noon.
  sun.intensity = THREE.MathUtils.lerp(0.1, 1.5, arc);
  sun.color.setHSL(0.11 - 0.05 * arc, 0.55, 0.6 + 0.15 * arc);
  ambient.intensity = THREE.MathUtils.lerp(0.15, 0.35, arc);

  // Keep the sky dome's sun in the same direction as the actual light.
  const sunDirection = sun.position.clone().sub(modelCenter).normalize();
  sky.material.uniforms['sunPosition'].value.copy(sunDirection);
}

// --- Camera + first-person look ------------------------------------------
const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);

const controls = new PointerLockControls(camera, renderer.domElement);

// The camera itself needs to be part of the scene graph for anything
// parented to it (the torch, below) to actually render.
scene.add(camera);

// --- Torch ------------------------------------------------------------
// A simple procedural first-person prop (no external art needed): a wood
// handle, a bound cloth head, and a flame, parented directly to the camera
// so it moves and rotates with the view like a held object. A PointLight
// at the flame does the actual work of lighting up dark interiors.
const torchGroup = new THREE.Group();
torchGroup.position.set(0.28, -0.4, -0.65);
torchGroup.rotation.set(0.3, 0, -0.08); // tilted, tip up and slightly across
camera.add(torchGroup);

const torchHandle = new THREE.Mesh(
  new THREE.CylinderGeometry(0.02, 0.025, 0.55, 8),
  new THREE.MeshStandardMaterial({ color: 0x4a3323, roughness: 0.9 })
);
torchHandle.position.y = 0;
torchGroup.add(torchHandle);

const torchHead = new THREE.Mesh(
  new THREE.CylinderGeometry(0.05, 0.045, 0.18, 8),
  new THREE.MeshStandardMaterial({ color: 0x8a7255, roughness: 1 })
);
torchHead.position.y = 0.32;
torchGroup.add(torchHead);

const flameGroup = new THREE.Group();
flameGroup.position.y = 0.3;
torchGroup.add(flameGroup);

// A real procedural fire shader (scrolling fractal noise shaped into a
// flame silhouette, hot-core-to-smoky-edge color ramp) rather than a
// static gradient texture — this is what actually animates and licks
// upward instead of just pulsing in place.
const flameMaterial = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 } },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float amp = 0.5;
      for (int i = 0; i < 4; i++) {
        v += amp * noise(p);
        p *= 2.0;
        amp *= 0.5;
      }
      return v;
    }

    void main() {
      vec2 uv = vUv;

      // Noise scrolls upward and faster near the base, like real flame.
      vec2 noiseUv = vec2(uv.x * 3.0, uv.y * 4.0 - uTime * 3.0);
      float n = fbm(noiseUv);

      // Rounded teardrop silhouette: bulges out to a full, rounded body in
      // the lower-middle then tapers to a soft rounded tip — a single
      // cohesive flame, not a narrow triangle. The width is a smooth bump
      // (rounded at the base, fullest around a third of the way up, soft
      // at the crown), and the whole centerline sways with a slow noise so
      // it licks. Width is clamped to a small floor so the mask bounds can
      // never invert (that inversion was what spawned the stray side lobes).
      float y = uv.y;
      float rise = smoothstep(0.0, 0.22, y);        // rounded base
      float fall = smoothstep(1.02, 0.38, y);       // soft rounded crown
      float bump = pow(rise * fall, 0.75);          // fuller, rounded body
      float halfWidth = max(bump * 0.46, 0.02);
      float sway = (fbm(vec2(y * 3.0 - uTime * 2.0, 7.0)) - 0.5) * 0.12 * (0.3 + y);
      float dist = abs(uv.x - 0.5 - sway);
      float edge = clamp(halfWidth * 0.55, 0.02, halfWidth * 0.95);
      float horizontalMask = 1.0 - smoothstep(halfWidth - edge, halfWidth, dist);

      float shape = horizontalMask;
      float intensity = clamp(n * shape * 1.7, 0.0, 1.0);

      vec3 colorOuter = vec3(0.85, 0.12, 0.02);
      vec3 colorMid = vec3(1.0, 0.55, 0.08);
      vec3 colorCore = vec3(1.0, 0.95, 0.75);

      vec3 color = mix(colorOuter, colorMid, smoothstep(0.15, 0.55, intensity));
      color = mix(color, colorCore, smoothstep(0.6, 0.95, intensity));

      float alpha = smoothstep(0.04, 0.4, intensity) * smoothstep(0.0, 0.15, shape);
      gl_FragColor = vec4(color, alpha);
    }
  `,
});

const flamePlane = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.36), flameMaterial);
flamePlane.position.y = 0.24;
// Cancel out torchGroup's tilt so the flame plane faces straight at the
// camera regardless of how the handle is angled — a flat plane viewed
// edge-on is exactly the "flat triangle" problem we're fixing.
flamePlane.quaternion.copy(new THREE.Quaternion().setFromEuler(torchGroup.rotation).invert());
flameGroup.add(flamePlane);

const torchLight = new THREE.PointLight(0xffa64d, 2.2, 18, 2);
torchLight.position.y = 0.2;
flameGroup.add(torchLight);

torchGroup.visible = false;

let torchLit = false;
let isRoofed = false;
let templeModel = null; // set once temple.glb finishes loading

const torchHint = document.getElementById('torch-hint');
const upRay = new THREE.Raycaster();
const ROOF_CHECK_DISTANCE = 25; // m — "is there a ceiling close overhead?"

// --- Entry overlay: click to lock the mouse and start walking ------------
const enterOverlay = document.getElementById('enter-overlay');

enterOverlay.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => enterOverlay.classList.add('hidden'));
controls.addEventListener('unlock', () => enterOverlay.classList.remove('hidden'));

// Fixed bright mid-morning sun — tried a time-of-day slider but it wasn't
// adding anything for the actual goal here, so this is just a constant now.
// updateSun() itself still takes an hour, so this is easy to change or turn
// back into a control later if that ever becomes useful again.
const FIXED_HOUR = 10;

// --- Player collider ------------------------------------------------------
// A vertical capsule from foot to head, moved around and collided against
// the world octree each physics substep. Spawn point is a guess (model
// center, at floor height) until we confirm it's not inside a wall.
const worldOctree = new Octree();

const playerCollider = new Capsule(
  new THREE.Vector3(0, CAPSULE_RADIUS, 0),
  new THREE.Vector3(0, EYE_HEIGHT, 0),
  CAPSULE_RADIUS
);

const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
let playerOnFloor = false;

function spawnPlayerAt(x, y, z) {
  playerCollider.start.set(x, y + CAPSULE_RADIUS, z);
  playerCollider.end.set(x, y + EYE_HEIGHT, z);
  playerVelocity.set(0, 0, 0);
}

// --- Keyboard state ---------------------------------------------------
const keyStates = {};
let jumpRequested = false;

document.addEventListener('keydown', (e) => {
  keyStates[e.code] = true;
  if (e.code === 'Space') jumpRequested = true;
  // e.repeat guards against the OS's key-repeat firing this many times
  // while E is held — we want exactly one toggle per physical press.
  if (e.code === 'KeyE' && !e.repeat) torchLit = !torchLit;
});
document.addEventListener('keyup', (e) => (keyStates[e.code] = false));

function getForwardVector() {
  camera.getWorldDirection(playerDirection);
  playerDirection.y = 0;
  playerDirection.normalize();
  return playerDirection;
}

function getSideVector() {
  camera.getWorldDirection(playerDirection);
  playerDirection.y = 0;
  playerDirection.normalize();
  playerDirection.cross(camera.up);
  return playerDirection;
}

// We set horizontal speed directly to exactly WALK_SPEED or RUN_SPEED
// (rather than accelerating toward it) so the walking/running speed used
// in the walkthrough is the same number reported in the paper's method,
// not an approximation that depends on framerate or a friction constant.
const inputVelocity = new THREE.Vector3();

function controlsInput() {
  const speed = keyStates['ShiftLeft'] || keyStates['ShiftRight'] ? RUN_SPEED : WALK_SPEED;

  inputVelocity.set(0, 0, 0);

  if (keyStates['KeyW'] || keyStates['ArrowUp']) inputVelocity.add(getForwardVector());
  if (keyStates['KeyS'] || keyStates['ArrowDown']) inputVelocity.add(getForwardVector().clone().multiplyScalar(-1));
  if (keyStates['KeyD'] || keyStates['ArrowRight']) inputVelocity.add(getSideVector());
  if (keyStates['KeyA'] || keyStates['ArrowLeft']) inputVelocity.add(getSideVector().clone().multiplyScalar(-1));

  if (inputVelocity.lengthSq() > 0) {
    inputVelocity.normalize().multiplyScalar(speed);
  }

  playerVelocity.x = inputVelocity.x;
  playerVelocity.z = inputVelocity.z;
}

// --- Collision + movement -------------------------------------------------
function playerCollisions() {
  const result = worldOctree.capsuleIntersect(playerCollider);
  playerOnFloor = false;

  if (result) {
    playerOnFloor = result.normal.y > 0.3;
    playerCollider.translate(result.normal.multiplyScalar(result.depth));

    if (playerOnFloor) {
      // No jumping in this session, so once we're on the ground there's no
      // reason to carry residual fall speed into the next substep.
      playerVelocity.y = 0;
    } else {
      // Sliding along a wall: cancel the velocity component pushing into it.
      playerVelocity.addScaledVector(result.normal, -result.normal.dot(playerVelocity));
    }
  }
}

function updatePlayer(deltaTime) {
  if (!playerOnFloor) {
    playerVelocity.y -= GRAVITY * deltaTime;
  }

  const deltaPosition = playerVelocity.clone().multiplyScalar(deltaTime);
  playerCollider.translate(deltaPosition);

  playerCollisions();

  camera.position.copy(playerCollider.end);

  // Fall-through-the-world safety net: if we somehow clip past all geometry,
  // reset to the spawn area rather than falling forever.
  if (camera.position.y < -50) {
    spawnPlayerAt(spawnPoint.x, spawnPoint.y, spawnPoint.z);
  }
}

let spawnPoint = new THREE.Vector3(0, 0, 30);

// --- Torch behavior: auto on/off + flicker --------------------------------
function updateTorch() {
  if (templeModel) {
    upRay.set(camera.position, new THREE.Vector3(0, 1, 0));
    upRay.far = ROOF_CHECK_DISTANCE;
    const hits = upRay.intersectObject(templeModel, true);
    isRoofed = hits.length > 0;
  }

  // "When he comes outside the torch goes away automatically" — once back
  // under open sky, put it out; pressing E relights it next time it's dark.
  if (!isRoofed && torchLit) {
    torchLit = false;
  }

  torchGroup.visible = torchLit;

  if (torchLit) {
    const t = clock.elapsedTime;
    flameMaterial.uniforms.uTime.value = t;

    // Light intensity flickers in step with the shader's own noise-driven
    // animation (sampled the same way, just cheaply in JS) rather than an
    // unrelated random flicker, so the light and the visible flame agree.
    const breathe = 0.9 + 0.1 * Math.sin(t * 6);
    const jitter = 0.85 + Math.random() * 0.3;
    torchLight.intensity = 2.2 * breathe * jitter;
  }

  torchHint.classList.toggle('hidden', !(isRoofed && !torchLit));
}

// --- Load the temple model ----------------------------------------------
const loadingScreen = document.getElementById('loading-screen');
const loadingText = document.getElementById('loading-text');

new GLTFLoader().load(
  'assets/temple.glb',

  (gltf) => {
    const model = gltf.scene;
    scene.add(model);
    templeModel = model;

    // Double-sided material as insurance against inverted normals from the
    // SketchUp -> OBJ -> glTF trip (a common cause of faces looking black
    // or disappearing from certain angles). Cheap fix now; if it's not
    // enough we revisit properly in Blender later.
    model.traverse((child) => {
      if (child.isMesh) {
        child.material.side = THREE.DoubleSide;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Point the sun rig and its shadow frustum at the model now that we
    // know its actual size, then set the initial time of day.
    modelCenter = center;
    modelMaxDim = Math.max(size.x, size.y, size.z) || 300;

    const shadowExtent = modelMaxDim * 0.6;
    sun.shadow.camera.left = -shadowExtent;
    sun.shadow.camera.right = shadowExtent;
    sun.shadow.camera.top = shadowExtent;
    sun.shadow.camera.bottom = -shadowExtent;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = modelMaxDim * 4;
    sun.shadow.camera.updateProjectionMatrix();

    updateSun(FIXED_HOUR);

    console.log('[temple.glb] bounding box size (x, y, z):', size);
    console.log('[temple.glb] bounding box center:', center);
    console.log('[temple.glb] bounding box min (floor level is around here):', box.min);

    // Build the collision mesh from everything currently in the scene
    // (ground + temple), now that the model has finished loading.
    worldOctree.fromGraphNode(scene);

    // The model's own floor doesn't sit at a single flat height (temples
    // like this one step the floor UP toward the sanctuary), and the
    // overall bounding-box min can belong to some unrelated low point of
    // the mesh — so rather than guess a Y coordinate, cast a ray straight
    // down at the spawn X/Z and use whatever floor it actually hits.
    // box.max.z is the "front" of the model (the pylon facade, based on
    // earlier test spawns) and box.min.z is the far interior/sanctuary
    // end — so a few meters in from box.max.z puts us just outside the
    // pylon gate, facing in.
    const spawnX = center.x;
    const spawnZ = box.max.z - 5;
    const downRay = new THREE.Raycaster(
      new THREE.Vector3(spawnX, box.max.y + 50, spawnZ),
      new THREE.Vector3(0, -1, 0)
    );
    const floorHits = downRay.intersectObject(model, true);
    // Hits are sorted nearest-to-farthest from the ray's starting point
    // above the model, so the FIRST hit is whatever's on top (a roof,
    // here) and the LAST is the lowest surface in that column — the
    // actual floor we want to stand on.
    const floorY =
      floorHits.length > 0 ? floorHits[floorHits.length - 1].point.y : box.min.y;

    spawnPoint = new THREE.Vector3(spawnX, floorY, spawnZ);
    spawnPlayerAt(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    camera.lookAt(spawnX, floorY + EYE_HEIGHT, box.min.z);

    loadingScreen.classList.add('hidden');
  },

  (progress) => {
    if (progress.lengthComputable) {
      const pct = Math.round((progress.loaded / progress.total) * 100);
      loadingText.textContent = `Loading temple… ${pct}%`;
    }
  },

  (error) => {
    console.error('Failed to load temple.glb:', error);
    loadingText.textContent = 'Failed to load temple.glb — check the console.';
  }
);

// --- FPS counter -----------------------------------------------------------
const stats = new Stats();
stats.dom.classList.add('stats-panel');
document.body.appendChild(stats.dom);

// --- Resize handling --------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Animate loop -----------------------------------------------------
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  stats.begin();

  const deltaTime = Math.min(0.05, clock.getDelta()) / STEPS_PER_FRAME;

  if (controls.isLocked) {
    if (jumpRequested && playerOnFloor) {
      playerVelocity.y = JUMP_VELOCITY;
    }
    jumpRequested = false;

    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      controlsInput();
      updatePlayer(deltaTime);
    }
  }

  updateTorch();

  renderer.render(scene, camera);

  stats.end();
});
