// ---------------------------------------------------------------------------
// Door — a real door sprite (prop_door, a front-elevation double door cropped
// from the purchased RCC Streets tileset) standing in for the flat graphics
// placeholder this used to be. Locked/unlocked reads as a clear color swap
// (red vs green tint, same convention already used for the door's own
// original placeholder and for cluster overlap warnings on the guards'
// vision cones elsewhere) rather than a fresh visual language to learn.
// ---------------------------------------------------------------------------
import { TILE_SIZE, DOOR_XZ, DOOR_W, DOOR_D } from './constants.js';

const LOCKED = 0xff6b5a;
const UNLOCKED = 0x6bffa0;

export function createDoor(scene) {
  const cx = DOOR_XZ.x * TILE_SIZE;
  const cy = DOOR_XZ.y * TILE_SIZE;

  const sprite = scene.add.image(cx, cy, 'prop_door');
  sprite.setDisplaySize(DOOR_W * TILE_SIZE, DOOR_D * TILE_SIZE);
  sprite.setTint(LOCKED);
  sprite.setDepth(cy + (DOOR_D * TILE_SIZE) / 2);
  sprite.setPipeline('Light2D'); // lit like every other environmental prop — the entrance's own light pool keeps it readable

  return {
    setLocked(locked) {
      sprite.setTint(locked ? LOCKED : UNLOCKED);
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
