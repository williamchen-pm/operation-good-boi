// ---------------------------------------------------------------------------
// World bounds for characters. Wall collision stops a character's FEET, but
// the sprite extends up to ~2 tiles above its feet and a few pixels past them
// sideways, so without this the head poked past the north wall into the void.
// Each character is clamped so its whole opaque sprite (measured from the
// texture's alpha over every animation frame) stays inside the walls' inner
// faces.
// ---------------------------------------------------------------------------
import { TILE_SIZE, FLOOR_X, FLOOR_Y, WALL_THICKNESS } from './constants.js';

export const WORLD_INNER = {
  minX: FLOOR_X[0] + WALL_THICKNESS / 2,
  maxX: FLOOR_X[1] - WALL_THICKNESS / 2,
  minY: FLOOR_Y[0] + WALL_THICKNESS / 2,
  maxY: FLOOR_Y[1] - WALL_THICKNESS / 2,
};

const extentsCache = new Map();

// How far the opaque pixels reach from the sprite's anchor, in tiles:
// { left, right, up, down }. Characters anchor at the feet (origin 0.5,1);
// the puppy at its center (0.5,0.5). Sprites are drawn at native size.
export function spriteExtents(scene, key, originY = 1) {
  const cacheKey = `${key}@${originY}`;
  if (extentsCache.has(cacheKey)) return extentsCache.get(cacheKey);
  const texture = scene.textures.get(key);
  const src = texture.getSourceImage();
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  // CPU-backed canvas: a GPU-accelerated one made each first alpha read a slow
  // readback (tens of ms per texture at load).
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, src.width, src.height).data;
  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  for (const name of texture.getFrameNames()) {
    const f = texture.get(name);
    const anchorY = f.height * originY;
    for (let y = 0; y < f.height; y++) {
      for (let x = 0; x < f.width; x++) {
        if (data[((f.cutY + y) * src.width + (f.cutX + x)) * 4 + 3] < 128) continue;
        left = Math.max(left, f.width / 2 - x);
        right = Math.max(right, x + 1 - f.width / 2);
        up = Math.max(up, anchorY - y);
        down = Math.max(down, y + 1 - anchorY);
      }
    }
  }
  const ext = { left: left / TILE_SIZE, right: right / TILE_SIZE, up: up / TILE_SIZE, down: down / TILE_SIZE };
  extentsCache.set(cacheKey, ext);
  return ext;
}

export function clampToWorld(pos, ext) {
  pos.x = Math.min(Math.max(pos.x, WORLD_INNER.minX + ext.left), WORLD_INNER.maxX - ext.right);
  pos.y = Math.min(Math.max(pos.y, WORLD_INNER.minY + ext.up), WORLD_INNER.maxY - ext.down);
}
