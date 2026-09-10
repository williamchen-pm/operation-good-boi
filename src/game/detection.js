// ---------------------------------------------------------------------------
// Detection — ported verbatim from the original game. Two independent fail
// conditions: seen (cone + range + line-of-sight) or physically touched.
// ---------------------------------------------------------------------------
import { TILE_SIZE, VISION_RANGE, VISION_HALF_ANGLE, NPC_RADIUS, PLAYER_RADIUS, PUPPY_HEIGHT } from './constants.js';
import { segmentBlocked } from './obstacles.js';
import { npcs } from './npc.js';

const cosHalf = Math.cos(VISION_HALF_ANGLE);

// `player` and `puppy` are Phaser sprites (world position in pixels);
// everything here works in tile units, same as the rest of the game logic.
export function detectionPoints(player, puppy, puppyCarried) {
  const points = [{ x: player.x / TILE_SIZE, y: player.y / TILE_SIZE, radius: PLAYER_RADIUS }];
  if (puppyCarried) {
    points.push({ x: puppy.x / TILE_SIZE, y: puppy.y / TILE_SIZE, radius: PUPPY_HEIGHT });
  }
  return points;
}

export function detectingNpc(player, puppy, puppyCarried) {
  const points = detectionPoints(player, puppy, puppyCarried);
  for (const npc of npcs) {
    const ox = npc.sprite.x / TILE_SIZE;
    const oy = npc.sprite.y / TILE_SIZE;
    for (const pt of points) {
      const dx = pt.x - ox;
      const dy = pt.y - oy;
      const d = Math.hypot(dx, dy);
      if (d > VISION_RANGE || d < 1e-4) continue;
      const dot = (dx / d) * Math.cos(npc.heading) + (dy / d) * Math.sin(npc.heading);
      if (dot < cosHalf) continue;
      if (segmentBlocked(ox, oy, pt.x, pt.y)) continue;
      return npc;
    }
  }
  return null;
}

export function touchingNpc(player, puppy, puppyCarried) {
  const points = detectionPoints(player, puppy, puppyCarried);
  for (const npc of npcs) {
    const ox = npc.sprite.x / TILE_SIZE;
    const oy = npc.sprite.y / TILE_SIZE;
    for (const pt of points) {
      const dx = pt.x - ox;
      const dy = pt.y - oy;
      if (Math.hypot(dx, dy) <= pt.radius + NPC_RADIUS) return npc;
    }
  }
  return null;
}
