// ---------------------------------------------------------------------------
// Shared angle/animation helpers.
//
// Every character sheet in the purchased Retro Cybercity character packs
// uses the same layout: a 3-frame walk cycle (left-foot, stand, right-foot)
// across 4 rows in the classic order down/left/right/up, native 32x32 per
// frame. `approachAngle` is ported verbatim from the original game — it's
// the one thing that makes both the player's and every NPC's turning share
// an identical speed cap regardless of how either is drawn.
// ---------------------------------------------------------------------------
export const ROW_DOWN = 0;
export const ROW_LEFT = 1;
export const ROW_RIGHT = 2;
export const ROW_UP = 3;
export const FRAMES_PER_ROW = 3;
export const IDLE_COL = 1; // the "standing" frame in each 3-frame cycle

const DIR_ROW = { down: ROW_DOWN, left: ROW_LEFT, right: ROW_RIGHT, up: ROW_UP };

// Step `current` toward `target` angle by at most `maxDelta`, via the short way.
export function approachAngle(current, target, maxDelta) {
  let diff = ((target - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI; // -PI..PI
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

// Snap a continuous heading (radians, 0 = east/+X, PI/2 = south/+Y — same
// convention Phaser's atan2(dy,dx) already uses, so no sign flip needed vs.
// the original XZ-plane version) to the nearest of the 4 sprite directions.
export function headingToDir4(heading) {
  const twoPi = Math.PI * 2;
  let h = ((heading % twoPi) + twoPi) % twoPi;
  if (h >= Math.PI * 0.25 && h < Math.PI * 0.75) return 'down';
  if (h >= Math.PI * 0.75 && h < Math.PI * 1.25) return 'left';
  if (h >= Math.PI * 1.25 && h < Math.PI * 1.75) return 'up';
  return 'right';
}

// Registers the 4 walk animations (`${key}-walk-down` etc.) for a character
// texture loaded as a 3-col x 4-row spritesheet. Call once per texture key.
export function createDirectionalAnims(scene, key) {
  for (const dir of ['down', 'left', 'right', 'up']) {
    const row = DIR_ROW[dir];
    const animKey = `${key}-walk-${dir}`;
    if (scene.anims.exists(animKey)) continue;
    scene.anims.create({
      key: animKey,
      frames: [0, 1, 2, 1].map((col) => ({ key, frame: row * FRAMES_PER_ROW + col })),
      frameRate: 8,
      repeat: -1,
    });
  }
}

let lastDirByTexture = new WeakMap();

// Plays the walk animation for `dir` if moving, otherwise stops on that
// direction's standing frame. Cheap no-ops if already in the right state.
export function playAnimForDir(sprite, key, dir, moving) {
  const state = lastDirByTexture.get(sprite) || {};
  if (moving) {
    const animKey = `${key}-walk-${dir}`;
    if (state.dir !== dir || !state.moving) {
      sprite.play(animKey, true);
    }
  } else {
    if (state.dir !== dir || state.moving) {
      sprite.anims.stop();
      sprite.setFrame(DIR_ROW[dir] * FRAMES_PER_ROW + IDLE_COL);
    }
  }
  lastDirByTexture.set(sprite, { dir, moving });
}
