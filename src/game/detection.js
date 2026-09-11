// ---------------------------------------------------------------------------
// Detection — ported verbatim from the original game. Two independent fail
// conditions: seen (cone + range + line-of-sight) or physically touched.
// ---------------------------------------------------------------------------
import { TILE_SIZE, VISION_RANGE, VISION_HALF_ANGLE, NPC_RADIUS, PLAYER_RADIUS } from './constants.js';
import { segmentBlocked } from './obstacles.js';
import { npcs } from './npc.js';
import { puppyFeet } from './puppy.js';
import { frameRowSpans } from './bounds.js';

const cosHalf = Math.cos(VISION_HALF_ANGLE);

// `player` and `puppy` are Phaser sprites (world position in pixels);
// everything here works in tile units, same as the rest of the game logic.
// Both characters are seen at their feet. For touch, the player keeps its body
// radius; the puppy is tested pixel-for-pixel against each guard
// (spritesTouch), instead of the old 0.8-tile radius around its sprite
// center, which counted a ~24-29px visible gap as touching.
export function detectionPoints(player, puppy, puppyCarried) {
  const points = [{ x: player.x / TILE_SIZE, y: player.y / TILE_SIZE, radius: PLAYER_RADIUS }];
  if (puppyCarried) {
    const feet = puppyFeet(puppy);
    points.push({ x: feet.x, y: feet.y, sprite: puppy });
  }
  return points;
}

// True once two sprites' opaque pixels (current frames, read from texture
// alpha) overlap or are neighbours, sideways, vertically or diagonally, i.e.
// once they touch on screen. Compares each row's opaque runs, so neither a
// guard's arms against the dog's paws on another row nor a gap between legs
// counts as contact.
function spritesTouch(a, b) {
  const aSpans = frameRowSpans(a.scene, a.texture.key, a.frame.name);
  const bSpans = frameRowSpans(b.scene, b.texture.key, b.frame.name);
  const aLeft = a.x - a.frame.width * a.originX;
  const aTop = a.y - a.frame.height * a.originY;
  const bLeft = b.x - b.frame.width * b.originX;
  const bTop = b.y - b.frame.height * b.originY;
  for (let i = 0; i < aSpans.length; i++) {
    const aRuns = aSpans[i];
    if (!aRuns) continue;
    // b's rows that overlap or neighbour row i
    const jFrom = Math.max(0, Math.ceil(aTop + i - 1 - bTop));
    const jTo = Math.min(bSpans.length - 1, Math.floor(aTop + i + 1 - bTop));
    for (let j = jFrom; j <= jTo; j++) {
      const bRuns = bSpans[j];
      if (!bRuns) continue;
      for (let p = 0; p < aRuns.length; p += 2) {
        for (let q = 0; q < bRuns.length; q += 2) {
          if (bLeft + bRuns[q] <= aLeft + aRuns[p + 1] && aLeft + aRuns[p] <= bLeft + bRuns[q + 1]) return true;
        }
      }
    }
  }
  return false;
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
      if (pt.sprite ? spritesTouch(pt.sprite, npc.sprite) : Math.hypot(pt.x - ox, pt.y - oy) <= pt.radius + NPC_RADIUS) return npc;
    }
  }
  return null;
}
