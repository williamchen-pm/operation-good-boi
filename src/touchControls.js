// ---------------------------------------------------------------------------
// On-screen joystick for touch devices (phones, tablets).
//
// A floating stick: during play, touching anywhere puts the stick's base under
// the thumb, and dragging sets the movement direction and speed (see
// constants.js#TOUCH_STICK_*). Lifting the thumb stops the player at once, the
// most important move in a stealth game. Dragging past the edge pulls the base
// along, so reversing direction responds immediately. It writes to the shared
// touchStick vector that the scene reads like a second keyboard, so keyboard
// controls keep working unchanged.
//
// Shown only on touch devices: a coarse primary pointer at load, or the first
// real touch (e.g. a touchscreen laptop). Mouse input never drives the stick.
// ---------------------------------------------------------------------------
import { touchStick, touchState } from './game/touchInput.js';

export function setupTouchControls({ onEnable } = {}) {
  const layer = document.createElement('div');
  layer.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:4', // above the canvas, below the timer (5) and every overlay (10+)
    'display:none',
    'touch-action:none', // no scrolling, pinch-zoom or double-tap zoom while playing
    'user-select:none',
    '-webkit-user-select:none',
    '-webkit-touch-callout:none',
  ].join(';');

  const base = document.createElement('div');
  const knob = document.createElement('div');
  const hint = document.createElement('div');
  base.style.cssText = [
    'position:absolute',
    'left:0',
    'top:0',
    'border-radius:50%',
    'border:2px solid rgba(234,234,234,0.35)',
    'background:rgba(0,0,0,0.25)',
    'pointer-events:none',
  ].join(';');
  knob.style.cssText = [
    'position:absolute',
    'left:50%',
    'top:50%',
    'border-radius:50%',
    'background:rgba(63,182,211,0.75)',
    'box-shadow:0 2px 8px rgba(0,0,0,0.5)',
    'pointer-events:none',
  ].join(';');
  hint.textContent = 'DRAG TO MOVE';
  hint.style.cssText = [
    'position:absolute',
    'left:50%',
    'transform:translateX(-50%)',
    'font:700 13px/1 system-ui,sans-serif',
    'letter-spacing:0.12em',
    'color:#e8c088',
    'text-shadow:0 1px 3px #000',
    'white-space:nowrap',
    'pointer-events:none',
  ].join(';');
  base.append(knob);
  layer.append(base, hint);
  document.body.appendChild(layer);

  let enabled = false;
  let visible = false;
  let activeId = null;
  let originX = 0;
  let originY = 0;

  // Stick size scales a little with the screen; R is how far the knob travels.
  const radius = () => Math.round(Math.max(44, Math.min(64, Math.min(innerWidth, innerHeight) * 0.13)));

  function drawBase(cx, cy, active) {
    const R = radius();
    const knobSize = Math.round(R * 0.85);
    base.style.width = base.style.height = `${R * 2}px`;
    base.style.transform = `translate(${cx - R}px, ${cy - R}px)`;
    base.style.opacity = active ? '1' : '0.45';
    knob.style.width = knob.style.height = `${knobSize}px`;
    knob.style.marginLeft = knob.style.marginTop = `${-knobSize / 2}px`;
  }

  function setKnob(dx, dy) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  // Idle: a faint stick near the bottom of the screen showing where to start.
  function drawIdle() {
    const cx = innerWidth / 2;
    const cy = innerHeight - radius() - Math.max(28, innerHeight * 0.06);
    drawBase(cx, cy, false);
    setKnob(0, 0);
    hint.style.display = 'block';
    hint.style.top = `${cy + radius() + 10}px`;
  }

  function release() {
    activeId = null;
    touchStick.x = 0;
    touchStick.y = 0;
    drawIdle();
  }

  layer.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || activeId !== null) return;
    e.preventDefault();
    activeId = e.pointerId;
    try {
      layer.setPointerCapture(e.pointerId);
    } catch {
      // not capturable (e.g. a synthetic event); moves still arrive on the layer
    }
    originX = e.clientX;
    originY = e.clientY;
    hint.style.display = 'none';
    drawBase(originX, originY, true);
    setKnob(0, 0);
  });

  layer.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    e.preventDefault();
    const R = radius();
    let dx = e.clientX - originX;
    let dy = e.clientY - originY;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      originX = e.clientX - (dx / d) * R;
      originY = e.clientY - (dy / d) * R;
      dx = (dx / d) * R;
      dy = (dy / d) * R;
      drawBase(originX, originY, true);
    }
    setKnob(dx, dy);
    touchStick.x = dx / R;
    touchStick.y = dy / R;
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    layer.addEventListener(type, (e) => {
      if (e.pointerId === activeId) release();
    });
  }
  layer.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', () => {
    if (activeId === null) drawIdle();
  });

  function enable() {
    if (enabled) return;
    enabled = true;
    touchState.enabled = true;
    drawIdle();
    if (onEnable) onEnable();
  }

  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) enable();
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') enable();
    },
    { capture: true, passive: true }
  );

  return {
    get enabled() {
      return enabled;
    },
    // Call every frame with whether gameplay is running; the stick only shows
    // (and only moves the player) during play, and lets go when play stops.
    setPlaying(playing) {
      const show = enabled && playing;
      if (show === visible) return;
      visible = show;
      layer.style.display = show ? 'block' : 'none';
      release();
    },
  };
}
