// ---------------------------------------------------------------------------
// Puppy — pickup/carry logic ported verbatim from the original game
// (checkPuppyPickup / updatePuppyCarry). The dog spritesheet is a different
// pack (the original "Topdown - Pet - Dog" CC0 asset from this project's
// very first phase) with its own row order — up/left/right/down, 4 walk
// frames per row, 64x64 native — so it gets its own small direction helper
// rather than reusing anim.js's RPG-Maker-style row order.
// ---------------------------------------------------------------------------
import { TILE_SIZE, PUPPY_PICKUP_DIST, PUPPY_TRAIL_DIST, PUPPY_FOLLOW_RATE, PUPPY_SPAWN } from './constants.js';
import { headingToDir4 } from './anim.js';
import { spriteExtents, clampToWorld } from './bounds.js';

const DOG_ROW = { up: 0, left: 1, right: 2, down: 3 };

function createDogAnims(scene) {
  for (const [dir, row] of Object.entries(DOG_ROW)) {
    if (!scene.anims.exists(`dog-walk-${dir}`)) {
      scene.anims.create({
        key: `dog-walk-${dir}`,
        frames: scene.anims.generateFrameNumbers('dog-walk', { start: row * 4, end: row * 4 + 3 }),
        frameRate: 8,
        repeat: -1,
      });
    }
    if (!scene.anims.exists(`dog-idle-${dir}`)) {
      scene.anims.create({
        key: `dog-idle-${dir}`,
        frames: scene.anims.generateFrameNumbers('dog-idle', { start: row * 4, end: row * 4 + 3 }),
        frameRate: 4,
        repeat: -1,
      });
    }
  }
}

export function createPuppy(scene) {
  createDogAnims(scene);
  const puppy = scene.add.sprite(PUPPY_SPAWN.x * TILE_SIZE, PUPPY_SPAWN.y * TILE_SIZE, 'dog-idle', 3 * 4);
  puppy.setDepth(puppy.y);
  puppy.play('dog-idle-down');
  puppy.lastDir = 'down';
  const idle = spriteExtents(scene, 'dog-idle', 0.5);
  const walk = spriteExtents(scene, 'dog-walk', 0.5);
  puppy.worldExtents = {
    left: Math.max(idle.left, walk.left),
    right: Math.max(idle.right, walk.right),
    up: Math.max(idle.up, walk.up),
    down: Math.max(idle.down, walk.down),
  };
  return puppy;
}

// The dog's feet in tiles: the guard-vision test point, the same ground
// anchor the player is seen at. The dog is drawn from its center, and its paws
// sit on the frames' bottom opaque row, worldExtents.down (1 tile, measured
// from alpha) below. Vision used to test the sprite center instead, near the
// top of the dog.
export function puppyFeet(puppy) {
  return { x: puppy.x / TILE_SIZE, y: puppy.y / TILE_SIZE + puppy.worldExtents.down };
}

export function checkPuppyPickup(player, puppy, puppyCarried, onPickup) {
  if (puppyCarried) return puppyCarried;
  const dx = player.x - puppy.x;
  const dy = player.y - puppy.y;
  if (Math.hypot(dx, dy) <= PUPPY_PICKUP_DIST * TILE_SIZE) {
    onPickup();
    return true;
  }
  return puppyCarried;
}

export function updatePuppyCarry(player, puppy, puppyCarried, dt) {
  puppy.setDepth(puppy.y);
  if (!puppyCarried) return;
  const targetX = player.x - player.lastMoveDir.x * PUPPY_TRAIL_DIST * TILE_SIZE;
  const targetY = player.y - player.lastMoveDir.y * PUPPY_TRAIL_DIST * TILE_SIZE;
  const t = 1 - Math.exp(-PUPPY_FOLLOW_RATE * dt);
  const dx = targetX - puppy.x;
  const dy = targetY - puppy.y;
  const pos = { x: (puppy.x + dx * t) / TILE_SIZE, y: (puppy.y + dy * t) / TILE_SIZE };
  clampToWorld(pos, puppy.worldExtents);
  puppy.x = pos.x * TILE_SIZE;
  puppy.y = pos.y * TILE_SIZE;
  const moved = Math.hypot(dx * t, dy * t);
  const dir = moved > 0.05 ? headingToDir4(Math.atan2(dy, dx)) : puppy.lastDir;
  if (dir !== puppy.lastDir || !puppy.anims.isPlaying) {
    puppy.play(`dog-walk-${dir}`, true);
    puppy.lastDir = dir;
  }
}

export function resetPuppy(puppy) {
  puppy.x = PUPPY_SPAWN.x * TILE_SIZE;
  puppy.y = PUPPY_SPAWN.y * TILE_SIZE;
  puppy.play('dog-idle-down');
  puppy.lastDir = 'down';
}
