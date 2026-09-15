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
import { hotspots } from './content.js?v=4';
import { study } from './study.js?v=1';
import { renderQuestionnaire } from './questionnaire.js?v=1';

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
// walk around it. The model brings its own sand surface, which sat at almost
// exactly the same height as this plane — two coplanar surfaces fighting over
// the same depth values, which is what made the ground shimmer and flicker.
// Three things fix it, and all three are worth keeping:
//   - polygonOffset biases this plane backwards in the depth buffer, so where
//     the two overlap the model's own sand always wins;
//   - the plane is dropped just under the model's real sand height once that
//     is known (see the loader below) so they aren't coplanar at all;
//   - the colour is sand rather than grey-brown, so the join where the
//     model's ground ends is no longer a hard line.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(300, 300),
  new THREE.MeshStandardMaterial({
    color: 0xbda87f,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// The GridHelper that used to sit here was Session 1 scaffolding for checking
// scale. It drew its lines at exactly ground height, so it was part of the
// same flickering, and a measuring grid across the sand has no place in the
// build students will actually walk through.

// --- Sun position from time-of-day -----------------------------------
// Filled in properly once the model loads (see below); safe defaults so
// the slider doesn't break if someone drags it before then.
let modelCenter = new THREE.Vector3(0, 0, 0);
let modelMaxDim = 300;
// The model's actual footprint corners, filled in once it loads — the
// minimap below uses these to convert a world X/Z position into a pixel
// position on the plan image.
const modelBoxMin = new THREE.Vector3();
const modelBoxMax = new THREE.Vector3();

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
// Near plane at 0.2 m rather than 0.1: with the far plane at 1000 m that
// doubles the depth-buffer precision everywhere, which is the other half of
// the ground-flicker fix. Still well inside the held torch (~0.65 m away),
// so nothing clips.
const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.2,
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

// Every change to the torch goes through here so the study log catches all of
// them — the deliberate presses AND the automatic blow-out on stepping back
// into daylight. Where someone reaches for light is the behavioural half of
// this project's argument, so it should never be recorded half-way.
function setTorch(lit) {
  if (lit === torchLit) return;
  torchLit = lit;
  study.torchEvent(lit ? 'lit' : 'out', playerOffset());
}

// The player's position as an offset from spawn — the same x/y/z convention
// content.js, the minimap and the coordinate readout all use, so every number
// in the study data means the same thing as every number in the source.
function playerOffset() {
  return {
    x: camera.position.x - spawnPoint.x,
    y: camera.position.y - spawnPoint.y,
    z: camera.position.z - spawnPoint.z,
  };
}

const torchHint = document.getElementById('torch-hint');
const upRay = new THREE.Raycaster();
const ROOF_CHECK_DISTANCE = 25; // m — "is there a ceiling close overhead?"

// --- Sign-in, then entry overlay -----------------------------------------
// The sign-in screen comes first and asks who this is (student or other, plus
// an optional student ID so a walkthrough can be matched to a questionnaire)
// and takes consent for the recording. Only after that does the walkthrough
// become reachable. See study.js for what is recorded.
const signinOverlay = document.getElementById('signin-overlay');
const studentIdField = document.getElementById('student-id-field');
const studentIdInput = document.getElementById('student-id');
const consentCheck = document.getElementById('consent-check');
const signinStart = document.getElementById('signin-start');
const signinError = document.getElementById('signin-error');
const enterOverlay = document.getElementById('enter-overlay');
const finishButton = document.getElementById('finish-button');
const finishedOverlay = document.getElementById('finished-overlay');
const finishedDetail = document.getElementById('finished-detail');

const CONSENT_TEXT =
  'I agree that my movement and interaction inside this walkthrough is ' +
  'recorded for this study.';

let chosenRole = null;

for (const button of document.querySelectorAll('.role-btn')) {
  button.addEventListener('click', () => {
    chosenRole = button.dataset.role;
    for (const other of document.querySelectorAll('.role-btn')) {
      other.classList.toggle('selected', other === button);
    }
    studentIdField.classList.toggle('hidden', chosenRole !== 'student');
    refreshSigninState();
  });
}

consentCheck.addEventListener('change', refreshSigninState);

function refreshSigninState() {
  const ready = Boolean(chosenRole) && consentCheck.checked;
  signinStart.disabled = !ready;
  if (ready) signinError.classList.add('hidden');
}

signinStart.addEventListener('click', () => {
  if (!chosenRole || !consentCheck.checked) {
    signinError.classList.remove('hidden');
    return;
  }

  study.begin({
    role: chosenRole,
    studentId: chosenRole === 'student' ? studentIdInput.value.trim() : '',
    consentedAt: new Date().toISOString(),
    consentText: CONSENT_TEXT,
  });

  signinOverlay.classList.add('hidden');
  enterOverlay.classList.remove('hidden');
});

enterOverlay.addEventListener('click', (e) => {
  // The Finish button lives inside this overlay; clicking it must not also
  // re-lock the pointer and drop the participant back into the temple.
  if (e.target.closest('#finish-button')) return;
  controls.lock();
});

controls.addEventListener('lock', () => enterOverlay.classList.add('hidden'));
controls.addEventListener('unlock', () => {
  if (!study.active) return;   // already finished; leave the thank-you screen up
  if (questionnaireOpen) return; // the questionnaire is the screen now
  enterOverlay.classList.remove('hidden');
});

// --- Ending the visit ----------------------------------------------------
// Two ways in, both leading to the same place. Reaching the sanctuary raises
// a prompt so the walkthrough has a real destination and a proper close; Esc
// then Finish covers anyone who stops early or wanders off. Either way the
// questionnaire comes before the session is written, so the answers travel
// with the behaviour rather than in a separate pile of paper.
const endHint = document.getElementById('end-hint');
const questionnaireOverlay = document.getElementById('questionnaire-overlay');
const questionnaireBody = document.getElementById('questionnaire-body');
const questionnaireSubmit = document.getElementById('questionnaire-submit');

let reachedSanctuary = false;
let questionnaireOpen = false;
let collectAnswers = null;

function updateEndPrompt(offset) {
  if (!study.active) return;
  if (!reachedSanctuary && offset.z <= -155) reachedSanctuary = true;
  const show = reachedSanctuary && controls.isLocked && !bookOpen;
  endHint.classList.toggle('hidden', !show);
}

function openQuestionnaire() {
  if (questionnaireOpen || !study.active) return;
  questionnaireOpen = true;
  if (controls.isLocked) controls.unlock();
  enterOverlay.classList.add('hidden');
  endHint.classList.add('hidden');
  collectAnswers = renderQuestionnaire(questionnaireBody);
  questionnaireOverlay.classList.remove('hidden');
  questionnaireOverlay.scrollTop = 0;
}

finishButton.addEventListener('click', openQuestionnaire);

questionnaireSubmit.addEventListener('click', async () => {
  questionnaireSubmit.disabled = true;
  questionnaireSubmit.textContent = 'Saving…';

  const answers = collectAnswers ? collectAnswers() : {};
  const result = await study.finish('finished', answers);

  questionnaireOverlay.classList.add('hidden');
  enterOverlay.classList.add('hidden');
  if (result) {
    const s = result.record.summary;
    const minutes = Math.round(result.record.session.activeSec / 6) / 10;
    finishedDetail.textContent =
      `${minutes} minutes inside · ${s.distanceWalkedM} m walked · ` +
      `${s.uniqueScrollsOpened} of ${hotspots.length} scrolls read` +
      (s.reachedSanctuary ? ' · you reached the sanctuary' : '');
  }
  finishedOverlay.classList.remove('hidden');
});

// If the tab is closed mid-session, try one last send. There is no chance to
// download at that point, which is why the Finish button matters.
window.addEventListener('pagehide', () => study.abandon());

// --- Footstep audio -----------------------------------------------------
// Synthesized on the fly (filtered noise bursts) instead of an external
// sound file — no asset to source or license, and it fits how the torch
// flame and sky were done here too (procedural, not authored art). Browsers
// block audio until a user gesture, so the AudioContext is created/resumed
// on the same click that locks the mouse.
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
enterOverlay.addEventListener('click', () => {
  if (audioCtx.state === 'suspended') audioCtx.resume();
});

function playFootstepSound(running) {
  const now = audioCtx.currentTime;
  const duration = 0.09;
  const bufferSize = Math.floor(audioCtx.sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    // White noise with a built-in linear decay — a dull, short "thud"
    // once it's been through the lowpass filter below, rather than a
    // harsh click.
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 450 + Math.random() * 250; // slight variation per step
  filter.Q.value = 0.6;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(running ? 0.16 : 0.1, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  source.start(now);
  source.stop(now + duration);
}

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
  if (e.code === 'KeyE' && !e.repeat) setTorch(!torchLit);
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
  // Freeze movement while reading a hotspot's book — you can still look
  // around (the panel is a fixed screen overlay), but WASD does nothing
  // until it's closed, so you don't wander off mid-read.
  if (bookOpen) {
    playerVelocity.x = 0;
    playerVelocity.z = 0;
    return;
  }

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

// --- Minimap -----------------------------------------------------------
// A static plan drawing with a live dot + heading cone drawn on top of it
// each frame — this is the paper's "beyond the plan" argument made
// literal: the same flat drawing an architectural plan gives you, but
// gaining meaning once it's bound to a moving body's actual position.
// The plan image is cropped tight to the temple's own footprint, so
// mapping a world X/Z onto it is a straight linear conversion using the
// model's own bounding box corners (set once temple.glb finishes loading).
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');
// Temporary calibration readout, visible on-screen — the "5 m in front of
// the gate" gap turned out to be too small a fraction of the temple's
// ~140-237 m length to ever show up just by adding more blank margin (the
// margin fraction and the 5 m gap are both scaled by the same huge span,
// so they shrink together). This prints the real numbers so the actual
// fix can be calibrated from data instead of guessing again. Remove once
// the gap looks right.
const minimapDebug = document.getElementById('minimap-debug');
const planImage = new Image();
let planImageLoaded = false;
planImage.onload = () => {
  planImageLoaded = true;
  minimapCanvas.width = planImage.naturalWidth;
  minimapCanvas.height = planImage.naturalHeight;
};
// Cache-busted with a version query string — browsers otherwise keep
// showing an old cached copy of this image on a normal refresh even after
// the file on disk has changed, since the filename itself never changes.
planImage.src = 'assets/temple_plan.png?v=4';

// --- Minimap calibration ------------------------------------------------
// The dot is anchored directly to the SPAWN point rather than stretched
// across the model's bounding box (which is unreliable here — the box's
// Z-span is inflated by the model sitting at an angle plus some stray
// geometry, so it can't be trusted for scale). At the instant of spawn the
// dot sits exactly at MAP_SPAWN_(U,V) — a spot placed in the blank
// parchment in FRONT of the drawn pylon gate — and every step away moves
// it by a fixed image-fraction per real-world metre. So the start position
// is exact by construction, and only the travel scale below needs tuning.
const MAP_SPAWN_U = 0.5;    // horizontal image fraction at spawn (temple centre line)
// Calibrated from TWO live readings (Provat, 14 Sep), fitting a straight
// line through both so the map matches the walkthrough at both ends:
//   - at the pylon gate:      dz = -41 m  -> gate drawn at v = 0.749
//   - in front of sanctuary:  dz = -159 m -> sanctuary spot at v = 0.218
// Slope = (0.749 - 0.218) / (-41 - -159) = 0.531 / 118 = 0.0045 per metre.
// Intercept (spawn, dz=0) = 0.749 + 41 * 0.0045 = 0.9335. This replaced an
// earlier single-point estimate (0.0051) that reached the sanctuary ~14 m
// too early.
const MAP_SPAWN_V = 0.9335; // vertical image fraction at spawn — well in front of the gate
// Sign chosen so walking INTO the temple (world Z decreasing) moves the dot
// UP the image.
const MAP_V_PER_METRE = 0.0045;
// The plan image is tall and narrow (382 x 1368 px) drawn at one uniform
// scale, so a metre of world X spans a larger *fraction* of the narrow width
// than a metre of world Z spans of the tall height — by the aspect ratio,
// 1368/382 ~= 3.58. So the horizontal metre-scale is that much larger.
const MAP_U_PER_METRE = 0.0045 * (1368 / 382); // ~= 0.0161

function updateMinimap() {
  if (!planImageLoaded || !templeModel) return;

  minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);
  // A little see-through so the map reads as an overlay rather than a
  // solid tile sitting on the view; the dot and cone stay fully opaque
  // below so the player's position is never hard to pick out.
  minimapCtx.globalAlpha = 0.72;
  minimapCtx.drawImage(planImage, 0, 0, minimapCanvas.width, minimapCanvas.height);
  minimapCtx.globalAlpha = 1;

  // Displacement from the spawn point, in world metres. dz > 0 means the
  // player has drifted back out toward/past the gate; dz < 0 means deeper
  // into the temple.
  const dz = camera.position.z - spawnPoint.z;
  const dx = camera.position.x - spawnPoint.x;

  const u = THREE.MathUtils.clamp(MAP_SPAWN_U + dx * MAP_U_PER_METRE, 0, 1);
  const v = THREE.MathUtils.clamp(MAP_SPAWN_V + dz * MAP_V_PER_METRE, 0, 1);
  const px = u * minimapCanvas.width;
  const py = v * minimapCanvas.height;

  // On-screen calibration readout: how far, in world metres, the player has
  // moved from the spawn point along each axis. Read this at the far
  // sanctuary wall to pin the travel scale exactly. Remove once dialed in.
  minimapDebug.textContent = `moved  X ${dx.toFixed(0)}  Z ${dz.toFixed(0)}`;

  camera.getWorldDirection(playerDirection);
  const heading = Math.atan2(playerDirection.z, playerDirection.x);

  // Heading cone, pointing the way the camera is actually looking.
  const coneLength = 34;
  const coneSpread = 0.5;
  minimapCtx.fillStyle = 'rgba(94, 170, 255, 0.4)';
  minimapCtx.beginPath();
  minimapCtx.moveTo(px, py);
  minimapCtx.lineTo(
    px + Math.cos(heading - coneSpread) * coneLength,
    py + Math.sin(heading - coneSpread) * coneLength
  );
  minimapCtx.lineTo(
    px + Math.cos(heading + coneSpread) * coneLength,
    py + Math.sin(heading + coneSpread) * coneLength
  );
  minimapCtx.closePath();
  minimapCtx.fill();

  // Position dot.
  minimapCtx.fillStyle = '#4d9fff';
  minimapCtx.strokeStyle = '#ffffff';
  minimapCtx.lineWidth = 3;
  minimapCtx.beginPath();
  minimapCtx.arc(px, py, 16, 0, Math.PI * 2);
  minimapCtx.fill();
  minimapCtx.stroke();
}

// --- Hotspots (Session 6) ------------------------------------------------
// Small glowing markers dropped at points of interest (content + rough
// positions live in content.js, kept separate so it's easy to edit without
// touching the game logic). Getting close and looking roughly at one shows
// a "Click to read" hint; left-click opens a book-style panel with the
// content, right-click (or Escape) closes it.
const MARKER_VISIBLE_DISTANCE = 60; // m — dot starts fading in from this far
// 18 m rather than a close-up radius because the measured checkpoints sit on
// the features themselves, and several of those are high up — the hypostyle
// hall dot is 13.6 m off the floor, so standing underneath it you are still
// ~12 m away from it. A tight radius would make those unclickable.
const MARKER_ACTIVATE_DISTANCE = 18; // m
const MARKER_ACTIVATE_COS = Math.cos(THREE.MathUtils.degToRad(9)); // "looking at it" tolerance
const MARKER_SCALE = 0.7; // m — world size of the dot; it swells when aimed at

// A white dot with a soft glow around it and a dark rim, drawn once onto a
// canvas and reused as every marker's sprite texture — no external art asset
// needed, same approach as the torch flame and the footstep audio. The dark
// rim matters: a pure additive white glow washes out completely against the
// bright sky and pale sandstone outside, and these markers have to read both
// out in the sunlit court and inside the dark sanctuary.
function makeMarkerTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;

  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
  gradient.addColorStop(0.45, 'rgba(255, 245, 210, 0.25)');
  gradient.addColorStop(1, 'rgba(255, 245, 210, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(c, c, size * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = size * 0.045;
  ctx.strokeStyle = 'rgba(30, 20, 10, 0.75)';
  ctx.stroke();

  return new THREE.CanvasTexture(canvas);
}

const markerTexture = makeMarkerTexture();

const hotspotMarkers = hotspots.map((hotspot) => {
  const material = new THREE.SpriteMaterial({
    map: markerTexture,
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(MARKER_SCALE);
  sprite.visible = false; // stays hidden until placed, once spawn is known
  scene.add(sprite);
  return { hotspot, sprite, material };
});

// Marker positions in content.js are offsets FROM THE SPAWN POINT, not raw
// model coordinates — spawn is nowhere near coordinate zero (it's ~41 m in
// front of the pylon gate, at whatever X/Z the model happens to sit at), so
// raw coordinates put every marker 100+ m away and out of range. This can
// only run once the model has loaded and spawnPoint holds its real value,
// so the loader calls it; until then the markers stay hidden.
let markersPlaced = false;

function placeHotspotMarkers() {
  for (const marker of hotspotMarkers) {
    const offset = marker.hotspot.offset;
    marker.sprite.position.set(
      spawnPoint.x + offset.x,
      spawnPoint.y + offset.y,
      spawnPoint.z + offset.z
    );
  }
  markersPlaced = true;
}

// --- Placement mode (temporary authoring tool) ---------------------------
// Guessing coordinates from outside the model does not work: the first
// attempt buried most markers inside walls or under the floor (the temple
// floor rises toward the sanctuary, so a fixed height above the SPAWN floor
// is underground by the time you reach the chapels). Rather than guess,
// adjust, push, re-test one marker at a time, this mode lets the positions
// be authored from inside the walkthrough itself:
//   M         toggle placement mode
//   [ and ]   step through the checkpoint list
//   P         drop the selected checkpoint on whatever you're aiming at
//   O         copy every position to the clipboard, ready to paste back
// In placement mode every marker is drawn through walls with its name above
// it, so nothing can hide. Delete this whole section once the positions are
// settled.
// OFF by default — all nine checkpoints were placed and measured on 14 Sep,
// so normal play shows plain white dots and no text of any kind. Press M if
// a position ever needs moving, or to add the two offering rooms.
let placementMode = false;
let placementIndex = 0;

const placementPanel = document.getElementById('placement-panel');
const placementRay = new THREE.Raycaster();

// Name labels, only shown in placement mode.
function makeLabelSprite(text) {
  const canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d');
  const font = 'bold 40px system-ui, sans-serif';
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + 44;
  const height = 76;
  canvas.width = width;
  canvas.height = height;

  ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.fillStyle = 'rgba(11, 13, 16, 0.78)';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 22, height / 2);

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
  );
  const scale = 1.1;
  sprite.scale.set((width / height) * scale, scale, 1);
  sprite.renderOrder = 999;
  return sprite;
}

for (const marker of hotspotMarkers) {
  marker.label = makeLabelSprite(marker.hotspot.title);
  marker.label.visible = false;
  scene.add(marker.label);
}

// Where a dropped marker lands: on the surface you're aiming at, lifted
// slightly off it so it doesn't z-fight with the stone — which is what
// "a dot appears on the object" actually means. If you're aiming at open
// sky, it lands a couple of metres in front of you instead.
function placementTargetPoint() {
  camera.getWorldDirection(playerDirection);

  if (templeModel) {
    placementRay.set(camera.position, playerDirection);
    placementRay.far = 60;
    const hits = placementRay.intersectObject(templeModel, true);
    if (hits.length > 0) {
      const hit = hits[0];
      const point = hit.point.clone();
      if (hit.face) {
        const normal = hit.face.normal
          .clone()
          .transformDirection(hit.object.matrixWorld)
          .multiplyScalar(0.25);
        point.add(normal);
      }
      return point;
    }
  }

  return camera.position.clone().add(playerDirection.multiplyScalar(2));
}

function dropSelectedMarker() {
  const marker = hotspotMarkers[placementIndex];
  marker.sprite.position.copy(placementTargetPoint());
  marker.placed = true;

  // Step to the next checkpoint that hasn't been dropped yet, so holding to
  // one key walks the whole list without needing to select each one.
  const next = hotspotMarkers.findIndex((m, i) => i > placementIndex && !m.placed);
  if (next !== -1) placementIndex = next;
}

function offsetTextForExport() {
  const lines = hotspotMarkers.map((marker) => {
    const p = marker.sprite.position;
    const x = (p.x - spawnPoint.x).toFixed(1);
    const y = (p.y - spawnPoint.y).toFixed(1);
    const z = (p.z - spawnPoint.z).toFixed(1);
    const mark = marker.placed ? '' : '   // not placed yet, still a guess';
    return `  { id: '${marker.hotspot.id}', offset: { x: ${x}, y: ${y}, z: ${z} } },${mark}`;
  });
  return lines.join('\n');
}

function copyOffsets() {
  const text = offsetTextForExport();
  console.log('[hotspots] positions:\n' + text);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showPlacementFlash('Copied all positions to clipboard'),
      () => showPlacementFlash('Clipboard blocked — positions printed to console (F12)')
    );
  } else {
    showPlacementFlash('Positions printed to console (F12)');
  }
}

let placementFlash = '';
let placementFlashUntil = 0;

function showPlacementFlash(message) {
  placementFlash = message;
  placementFlashUntil = performance.now() + 2600;
}

function updatePlacementMode() {
  if (!markersPlaced) return;

  for (let i = 0; i < hotspotMarkers.length; i++) {
    const marker = hotspotMarkers[i];
    const selected = i === placementIndex;

    marker.label.visible = placementMode;
    if (placementMode) {
      marker.label.position.copy(marker.sprite.position);
      marker.label.position.y += 1.0;
      marker.label.material.opacity = selected ? 1 : 0.55;
      // Drawn through walls while authoring, so a marker stuck inside a
      // column or below the floor can still be seen and moved.
      marker.material.depthTest = false;
      marker.sprite.renderOrder = 998;
      marker.material.color.set(selected ? 0xffc04d : 0xffffff);
    } else {
      marker.material.depthTest = true;
      marker.sprite.renderOrder = 0;
      marker.material.color.set(0xffffff);
    }
  }

  if (!placementMode) {
    placementPanel.classList.add('hidden');
    return;
  }

  placementPanel.classList.remove('hidden');
  const marker = hotspotMarkers[placementIndex];
  const placedCount = hotspotMarkers.filter((m) => m.placed).length;
  const flash =
    performance.now() < placementFlashUntil ? `<div class="flash">${placementFlash}</div>` : '';

  placementPanel.innerHTML =
    `<div class="pm-title">PLACEMENT MODE <span>· M to exit</span></div>` +
    `<div class="pm-current">${placementIndex + 1}/${hotspotMarkers.length} — ${marker.hotspot.title}</div>` +
    `<div class="pm-keys">P drop on what you're aiming at · [ ] change · O copy all</div>` +
    `<div class="pm-count">placed this session: ${placedCount} of ${hotspotMarkers.length}</div>` +
    flash;
}

const hotspotRay = new THREE.Raycaster();
const infoBook = document.getElementById('info-book');
const infoBookPage = document.getElementById('info-book-page');

let activeHotspot = null; // the marker currently in range + in view, if any
let bookOpen = false;

// Each checkpoint's page is a single piece of scroll artwork, so opening the
// book is just swapping the image — there is no text layer on top of it.
// Three of the nine are Provat's own scrolls from his animation; the rest
// were built on the same parchment to match (see content.js).
const SCROLL_DIR = 'assets/scrolls/';

// Preloaded at startup so a scroll never unrolls onto a blank frame the
// first time a checkpoint is opened.
const scrollImages = new Map();
for (const hotspot of hotspots) {
  for (const file of [hotspot.page, hotspot.morePage]) {
    if (file && !scrollImages.has(file)) {
      const img = new Image();
      img.src = SCROLL_DIR + file;
      scrollImages.set(file, img);
    }
  }
}

// A hotspot can carry a second scroll via an optional `morePage`, which is
// what the "...More Info" line on Provat's Horus scroll points at. With one
// set, left-clicking again turns to it; right-click still closes.
let bookPages = [];
let bookPageIndex = 0;

function renderBookPage() {
  infoBookPage.src = SCROLL_DIR + bookPages[bookPageIndex];
}

function openBook(hotspot) {
  bookPages = hotspot.morePage ? [hotspot.page, hotspot.morePage] : [hotspot.page];
  bookPageIndex = 0;
  renderBookPage();
  infoBook.classList.remove('hidden');
  bookOpen = true;
  study.scrollOpened(hotspot.id, playerOffset());
}

function closeBook() {
  infoBook.classList.add('hidden');
  bookOpen = false;
  study.scrollClosed();
}

function updateHotspots(elapsedTime) {
  if (!markersPlaced) return;

  if (!controls.isLocked || bookOpen) return;

  camera.getWorldDirection(playerDirection);

  let nearest = null;
  let nearestDistSq = Infinity;
  nearestMarkerDistance = Infinity;

  for (const marker of hotspotMarkers) {
    const toMarker = marker.sprite.position.clone().sub(camera.position);
    const distance = toMarker.length();
    if (distance < nearestMarkerDistance) nearestMarkerDistance = distance;

    // Gentle pulse so the markers read as "alive" rather than static dots,
    // echoing the torch flame's own flicker elsewhere in this scene.
    const pulse = 0.75 + 0.25 * Math.sin(elapsedTime * 2.4 + marker.sprite.position.x);
    const fade = THREE.MathUtils.clamp(1 - distance / MARKER_VISIBLE_DISTANCE, 0, 1);

    // While authoring positions, every marker stays fully visible at any
    // distance and through any wall — otherwise a marker that landed inside
    // a column is invisible and therefore impossible to fix.
    if (placementMode) {
      marker.sprite.visible = true;
      marker.material.opacity = 1;
      continue;
    }

    let occluded = false;
    if (fade > 0 && templeModel && distance > 0.01) {
      hotspotRay.set(camera.position, toMarker.normalize());
      hotspotRay.far = distance - 0.15;
      occluded = hotspotRay.intersectObject(templeModel, true).length > 0;
    }

    const visible = fade > 0 && !occluded;
    marker.sprite.visible = visible;
    marker.material.opacity = visible ? fade * pulse : 0;
    marker.sprite.scale.setScalar(MARKER_SCALE);

    if (visible && distance < MARKER_ACTIVATE_DISTANCE) {
      const cos = playerDirection.dot(toMarker.clone().normalize());
      if (cos > MARKER_ACTIVATE_COS && distance * distance < nearestDistSq) {
        nearest = marker;
        nearestDistSq = distance * distance;
      }
    }
  }

  activeHotspot = nearest;

  // No label, no prompt, no text of any kind out in the world — Provat's
  // call, and it keeps the temple itself uncluttered. The only signal that a
  // dot is live is the dot: aim at one and it brightens and swells slightly.
  // Everything it has to say waits until the scroll opens.
  if (activeHotspot) {
    activeHotspot.material.opacity = 1;
    activeHotspot.sprite.scale.setScalar(MARKER_SCALE * 1.45);
  }
}

document.addEventListener('mousedown', (e) => {
  if (!controls.isLocked) return;

  if (e.button === 0) {
    if (bookOpen) {
      // Turn to the "...More Info" scroll, if this hotspot has one.
      if (bookPageIndex < bookPages.length - 1) {
        bookPageIndex++;
        renderBookPage();
        study.scrollPageTurned();
      }
    } else if (activeHotspot) {
      openBook(activeHotspot.hotspot);
    }
  } else if (e.button === 2 && bookOpen) {
    closeBook();
  }
});

// Stop the browser's right-click menu from popping up over the game —
// right-click is repurposed above to close the book.
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;

  if (e.code === 'Escape' && bookOpen) closeBook();

  // F ends the visit, but only once the sanctuary has actually been reached,
  // so it cannot be pressed by accident on the way in.
  if (e.code === 'KeyF' && reachedSanctuary && !bookOpen) {
    openQuestionnaire();
    return;
  }

  // Placement-mode keys (temporary authoring tool, see above).
  if (e.code === 'KeyM') {
    placementMode = !placementMode;
    return;
  }
  if (!placementMode || !markersPlaced) return;

  if (e.code === 'BracketLeft') {
    placementIndex = (placementIndex - 1 + hotspotMarkers.length) % hotspotMarkers.length;
  } else if (e.code === 'BracketRight') {
    placementIndex = (placementIndex + 1) % hotspotMarkers.length;
  } else if (e.code === 'KeyP') {
    dropSelectedMarker();
  } else if (e.code === 'KeyO') {
    copyOffsets();
  }
});

// --- Live coordinate readout (Session 6 calibration aid) ------------------
// Same idea as the minimap's temporary debug line in Session 5: print the
// player's position so each hotspot's placeholder offset in content.js can
// be walked-to and measured exactly, instead of guessed. Deliberately prints
// the position as an OFFSET FROM SPAWN, in the exact same x/y/z convention
// content.js uses, so a reading can be pasted straight across with no
// conversion. Also prints how far the nearest marker is, which is the quick
// way to tell "no marker in range" apart from "markers aren't working".
// Remove all of this once every hotspot has a confirmed real position.
const coordReadout = document.getElementById('coord-readout');
let nearestMarkerDistance = Infinity;

function updateCoordReadout() {
  const dx = camera.position.x - spawnPoint.x;
  const dy = camera.position.y - spawnPoint.y;
  const dz = camera.position.z - spawnPoint.z;

  const nearestText =
    nearestMarkerDistance === Infinity ? '—' : `${nearestMarkerDistance.toFixed(0)} m`;

  coordReadout.textContent =
    `offset  x ${dx.toFixed(1)}  y ${dy.toFixed(1)}  z ${dz.toFixed(1)}` +
    `   ·   markers ${hotspotMarkers.length}` +
    `   ·   nearest ${nearestText}`;
}

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
    setTorch(false);
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

// --- Head bob + footsteps --------------------------------------------
// Purely a visual/audio flourish layered on top of the actual movement —
// it nudges the rendered camera up and down each step, but never touches
// playerCollider, so it can't affect collision, the reported walk/run
// speeds, or the minimap (which reads camera.position directly and would
// otherwise pick up any side-to-side sway as jitter — that's why this is
// vertical-only). Amplitude eases in/out rather than snapping on/off so
// starting and stopping don't jolt the view.
const BOB_FREQUENCY_WALK = 8; // radians/sec of bob phase while walking
const BOB_FREQUENCY_RUN = 13;
const BOB_AMPLITUDE_WALK = 0.035; // m, vertical
const BOB_AMPLITUDE_RUN = 0.06;

let bobPhase = 0;
let bobAmplitude = 0;
let lastStepIndex = 0;

function updateHeadBob(frameDeltaTime) {
  const running = keyStates['ShiftLeft'] || keyStates['ShiftRight'];
  const horizontalSpeedSq = playerVelocity.x * playerVelocity.x + playerVelocity.z * playerVelocity.z;
  const isWalking = controls.isLocked && playerOnFloor && horizontalSpeedSq > 0.01;

  const targetAmplitude = isWalking ? (running ? BOB_AMPLITUDE_RUN : BOB_AMPLITUDE_WALK) : 0;
  bobAmplitude += (targetAmplitude - bobAmplitude) * Math.min(1, frameDeltaTime * 8);

  if (isWalking) {
    bobPhase += frameDeltaTime * (running ? BOB_FREQUENCY_RUN : BOB_FREQUENCY_WALK);

    // A footstep sound once per half-cycle (heel-strike on each leg), so
    // the pace naturally matches whichever frequency is active above.
    const stepIndex = Math.floor(bobPhase / Math.PI);
    if (stepIndex !== lastStepIndex) {
      lastStepIndex = stepIndex;
      playFootstepSound(running);
    }
  }

  camera.position.y += Math.sin(bobPhase) * bobAmplitude;
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
    modelBoxMin.copy(box.min);
    modelBoxMax.copy(box.max);

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

    // Now that the model's real sand height is known, tuck the backdrop plane
    // just beneath it. 3 cm is far too small to see or to feel underfoot, but
    // it's enough that the two surfaces are no longer coplanar, which is the
    // actual cause of the flicker (polygonOffset above is the belt to this
    // braces). Done before the octree is built so collision matches what is
    // drawn.
    ground.position.y = floorY - 0.03;

    // Build the collision mesh from everything currently in the scene
    // (ground + temple), now that the model has finished loading and the
    // ground plane is at its final height.
    worldOctree.fromGraphNode(scene);

    spawnPoint = new THREE.Vector3(spawnX, floorY, spawnZ);
    spawnPlayerAt(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    camera.lookAt(spawnX, floorY + EYE_HEIGHT, box.min.z);

    // Hotspot markers are positioned relative to spawn, so they can only be
    // placed now that spawnPoint holds its real value.
    placeHotspotMarkers();
    console.log('[hotspots] placed', hotspotMarkers.length, 'markers around spawn', spawnPoint);

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

  const frameDeltaTime = Math.min(0.05, clock.getDelta());
  const deltaTime = frameDeltaTime / STEPS_PER_FRAME;

  if (controls.isLocked) {
    if (jumpRequested && playerOnFloor && !bookOpen) {
      playerVelocity.y = JUMP_VELOCITY;
    }
    jumpRequested = false;

    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      controlsInput();
      updatePlayer(deltaTime);
    }
  }

  // Bob runs after the physics substeps (which set camera.position to the
  // real collider height each substep) so its offset is the last thing
  // applied to the rendered camera each frame, and isn't overwritten or
  // compounded by the substep loop above.
  updateHeadBob(frameDeltaTime);
  updateTorch();
  updateMinimap();
  updateHotspots(clock.elapsedTime);
  updatePlacementMode();
  updateCoordReadout();

  // Only count time the participant is actually in the temple — not time
  // spent sitting on the pause screen with the pointer unlocked.
  if (controls.isLocked) {
    study.tick(frameDeltaTime, playerOffset(), 1 / Math.max(frameDeltaTime, 0.001));
  }
  updateEndPrompt(playerOffset());

  renderer.render(scene, camera);

  stats.end();
});
