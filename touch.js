// Temple Explorer — touch controls (phones and tablets)
//
// The same site and the same link serve everyone. index.html adds a `touch`
// class to <html> when the primary pointer is a finger (or when the address
// ends in ?touch=1, handy for testing on a laptop; ?touch=0 forces it off),
// and this module is only wired up in that case. Desktop behaviour is not
// touched at all.
//
// Controls:
//   left half of the screen   floating joystick (appears where the thumb lands)
//   right half of the screen  drag to look around, tap a white dot to read it
//   buttons                   Jump, Run (latching), Torch, and Pause (top-left)

export const IS_TOUCH = document.documentElement.classList.contains('touch');

// Read each frame by main.js. moveX: -1 left .. +1 right, moveY: -1 forward .. +1 back.
export const touchState = { moveX: 0, moveY: 0, run: false };

const JOY_RADIUS = 62;      // px of thumb travel for full deflection
const JOY_DEADZONE = 0.18;  // fraction of the radius ignored, so a resting thumb doesn't drift
const TAP_MAX_MS = 350;
const TAP_MAX_MOVE = 12;    // px

const $ = (id) => document.getElementById(id);

let joyId = null;
let lookId = null;
let resetHooks = [];

export function resetTouch() {
  touchState.moveX = 0;
  touchState.moveY = 0;
  joyId = null;
  lookId = null;
  for (const hook of resetHooks) hook();
}

export function initTouch({ onLook, onTap, onJump, onTorch, onPause }) {
  const left = $('touch-left');
  const right = $('touch-right');
  const base = $('joy-base');
  const knob = $('joy-knob');

  // --- Joystick (left zone) ------------------------------------------------
  let joyOriginX = 0;
  let joyOriginY = 0;
  let joyDownAt = 0;
  let joyMoved = false;

  resetHooks.push(() => {
    base.classList.remove('active');
    knob.style.transform = 'translate(0, 0)';
  });

  left.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (joyId !== null) return;
    joyId = e.pointerId;
    left.setPointerCapture(e.pointerId);
    joyOriginX = e.clientX;
    joyOriginY = e.clientY;
    joyDownAt = performance.now();
    joyMoved = false;
    base.style.left = `${joyOriginX}px`;
    base.style.top = `${joyOriginY}px`;
    base.classList.add('active');
    knob.style.transform = 'translate(0, 0)';
  });

  left.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joyId) return;
    e.preventDefault();
    let dx = e.clientX - joyOriginX;
    let dy = e.clientY - joyOriginY;
    const len = Math.hypot(dx, dy);
    if (len > TAP_MAX_MOVE) joyMoved = true;
    if (len > JOY_RADIUS) {
      dx = (dx / len) * JOY_RADIUS;
      dy = (dy / len) * JOY_RADIUS;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = Math.min(1, len / JOY_RADIUS);
    if (mag < JOY_DEADZONE) {
      touchState.moveX = 0;
      touchState.moveY = 0;
    } else {
      touchState.moveX = dx / JOY_RADIUS;
      touchState.moveY = dy / JOY_RADIUS;
    }
  });

  function endJoy(e) {
    if (e.pointerId !== joyId) return;
    joyId = null;
    touchState.moveX = 0;
    touchState.moveY = 0;
    base.classList.remove('active');
    knob.style.transform = 'translate(0, 0)';
    // A quick, motionless touch is a tap (used to close a scroll).
    if (e.type === 'pointerup' && !joyMoved && performance.now() - joyDownAt < TAP_MAX_MS) {
      onTap(e.clientX, e.clientY);
    }
  }
  left.addEventListener('pointerup', endJoy);
  left.addEventListener('pointercancel', endJoy);

  // --- Look + tap (right zone) -----------------------------------------------
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let lookDownAt = 0;
  let lookMoved = false;

  right.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (lookId !== null) return;
    lookId = e.pointerId;
    right.setPointerCapture(e.pointerId);
    lastX = downX = e.clientX;
    lastY = downY = e.clientY;
    lookDownAt = performance.now();
    lookMoved = false;
  });

  right.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    e.preventDefault();
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > TAP_MAX_MOVE) lookMoved = true;
    onLook(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  });

  function endLook(e) {
    if (e.pointerId !== lookId) return;
    lookId = null;
    if (e.type === 'pointerup' && !lookMoved && performance.now() - lookDownAt < TAP_MAX_MS) {
      onTap(e.clientX, e.clientY);
    }
  }
  right.addEventListener('pointerup', endLook);
  right.addEventListener('pointercancel', endLook);

  // --- Buttons ---------------------------------------------------------------
  function press(id, handler) {
    const button = $(id);
    button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handler(button);
    });
    // Swallow the synthesized click so nothing underneath reacts to it.
    button.addEventListener('click', (e) => e.stopPropagation());
  }

  press('btn-jump', () => onJump());
  press('btn-torch', () => onTorch());
  press('btn-run', (button) => {
    touchState.run = !touchState.run;
    button.classList.toggle('on', touchState.run);
  });
  press('touch-pause', () => onPause());

  resetHooks.push(() => {
    touchState.run = false;
    $('btn-run').classList.remove('on');
  });
}
