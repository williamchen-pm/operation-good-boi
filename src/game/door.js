// ---------------------------------------------------------------------------
// Door — ported from the original game. Same trigger point/distance, same
// locked(red)/unlocked(green) color logic. Drawn with Phaser Graphics for
// now (a frame outline + threshold panel + arrow) — a placeholder for a
// proper door tile from the tileset in a later art pass.
// ---------------------------------------------------------------------------
import { TILE_SIZE, DOOR_XZ, DOOR_W, DOOR_D } from './constants.js';

const LOCKED = 0xd0342a;
const UNLOCKED = 0x2fd06a;

export function createDoor(scene) {
  const cx = DOOR_XZ.x * TILE_SIZE;
  const cy = DOOR_XZ.y * TILE_SIZE;
  const w = DOOR_W * TILE_SIZE;
  const d = DOOR_D * TILE_SIZE;

  const frame = scene.add.graphics();
  frame.lineStyle(2, 0xdcdad0, 1);
  frame.strokeRect(cx - w / 2 - 3, cy - d / 2 - 3, w + 6, d + 6);
  frame.setDepth(cy - d);

  const panel = scene.add.rectangle(cx, cy, w, d, LOCKED);
  panel.setDepth(cy - d + 1);

  const arrow = scene.add.triangle(cx, cy, 0, -8, -8, 8, 8, 8, 0xf6f3e7);
  arrow.setDepth(cy - d + 2);

  return {
    setLocked(locked) {
      panel.fillColor = locked ? LOCKED : UNLOCKED;
    },
    x: cx,
    y: cy,
  };
}

export function checkDoor(player, door, puppyCarried, onRescued) {
  const dx = player.x - door.x;
  const dy = player.y - door.y;
  if (Math.hypot(dx, dy) > (2.2 * TILE_SIZE)) return;
  if (puppyCarried) onRescued();
}
