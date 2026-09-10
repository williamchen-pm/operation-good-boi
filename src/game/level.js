// ---------------------------------------------------------------------------
// Warehouse layout. Two things changed from the first pass, per feedback:
//
// 1. FLOOR is now a baked mosaic of 5 tile variants (not one repeated tile),
//    with the tiles nearest each wall darkened slightly — a cheap but real
//    stand-in for a proper wall/floor transition tile.
// 2. The obstacle course is composed, not scattered: a clear north-south
//    center aisle (roughly the spawn->puppy path) with two "shelving rows"
//    hugging the west/east walls (long axis parallel to the wall, like real
//    warehouse racking), landmark pieces (forklift/car) in the corners near
//    spawn, and 2 small "island" pieces breaking up the aisle's monotony
//    without blocking it. Same footprint sizes/collision rules as before —
//    every placement still goes through the same placeObstacleSafe net.
// ---------------------------------------------------------------------------
import { TILE_SIZE, FLOOR_X, FLOOR_Y, WALL_THICKNESS, PLAYER_SPAWN, PUPPY_SPAWN } from './constants.js';
import { registerObstacle, placeObstacleSafe } from './obstacles.js';

const px = (u) => u * TILE_SIZE;
const FLOOR_VARIANTS = ['floor_a', 'floor_b', 'floor_c', 'floor_d', 'floor_e'];

// Small deterministic PRNG (mulberry32) so the floor mosaic looks the same
// on every load/reset instead of re-shuffling — a stable level, not noise.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildFloor(scene) {
  const cols = FLOOR_X[1] - FLOOR_X[0];
  const rows = FLOOR_Y[1] - FLOOR_Y[0];
  const w = px(cols);
  const h = px(rows);
  const key = 'floor_baked';
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const canvasTexture = scene.textures.createCanvas(key, w, h);
  const ctx = canvasTexture.getContext();
  const rand = mulberry32(20260909);
  const sourceImgs = FLOOR_VARIANTS.map((k) => scene.textures.get(k).getSourceImage());

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const img = sourceImgs[Math.floor(rand() * sourceImgs.length)];
      ctx.drawImage(img, c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      // Darken the tile row/column nearest each wall — a cheap stand-in for
      // a proper floor/wall transition tile (this pack's sheets don't
      // include one at the density we need).
      const nearWall = c === 0 || c === cols - 1 || r === 0 || r === rows - 1;
      if (nearWall) {
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.fillRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }
  canvasTexture.refresh();

  const floorCx = px((FLOOR_X[0] + FLOOR_X[1]) / 2);
  const floorCy = px((FLOOR_Y[0] + FLOOR_Y[1]) / 2);
  const floor = scene.add.image(floorCx, floorCy, key);
  floor.setDepth(-1000);
  floor.setPipeline('Light2D');
  return floor;
}

// Every obstacle type shares this "tinted rectangle-footprint prop" builder
// — swappable for bespoke per-type art in a later pass. Applies the Light2D
// pipeline immediately so it responds to the warehouse's lighting regardless
// of whether placeObstacleSafe later accepts or rejects this placement.
function propBuilder(scene, textureKey, tint) {
  return (cx, cy, sx, sy) => {
    const img = scene.add.image(px(cx), px(cy), textureKey);
    img.setDisplaySize(px(sx), px(sy));
    if (tint != null) img.setTint(tint);
    img.setDepth(px(cy) + px(sy) / 2);
    img.setPipeline('Light2D');
    const obstacle = registerObstacle(cx, cy, sx, sy);
    return { gameObjects: [img], obstacle };
  };
}

export function buildLevel(scene) {
  const spawn = [PLAYER_SPAWN.x, PLAYER_SPAWN.y];
  const goal = [PUPPY_SPAWN.x, PUPPY_SPAWN.y];
  const place = (builder, cx, cy, ...args) =>
    placeObstacleSafe(builder, spawn[0], spawn[1], goal[0], goal[1], cx, cy, ...args);

  const floor = buildFloor(scene);

  // --- Outer walls -------------------------------------------------------
  const zc = (FLOOR_Y[0] + FLOOR_Y[1]) / 2;
  const zLen = FLOOR_Y[1] - FLOOR_Y[0];
  const xc = (FLOOR_X[0] + FLOOR_X[1]) / 2;
  const xLen = FLOOR_X[1] - FLOOR_X[0];
  const addWallSpan = (cx, cy, sx, sy) => {
    const wall = scene.add.tileSprite(px(cx), px(cy), px(sx), px(sy), 'wall_corrugated');
    wall.setDepth(px(cy) + px(sy) / 2 + 1e6); // walls always read above floor/props behind them
    wall.setPipeline('Light2D');
    registerObstacle(cx, cy, sx, sy);
  };
  addWallSpan(FLOOR_X[0], zc, WALL_THICKNESS, zLen); // west
  addWallSpan(FLOOR_X[1], zc, WALL_THICKNESS, zLen); // east
  addWallSpan(xc, FLOOR_Y[1], xLen, WALL_THICKNESS); // south (near player spawn)
  addWallSpan(xc, FLOOR_Y[0], xLen, WALL_THICKNESS); // north (near puppy)

  // --- Obstacle course — composed, not scattered ------------------------
  const addCrateStack = propBuilder(scene, 'prop_container_red', null);
  const addCrateStackSmall = propBuilder(scene, 'prop_container_teal', null);
  const addBarrel = propBuilder(scene, 'prop_tire', 0xcccccc);
  const addShelf = propBuilder(scene, 'prop_dumpster', 0x8fa0c0);
  const addPalletRack = propBuilder(scene, 'prop_dumpster', 0x6f8098);
  const addForklift = propBuilder(scene, 'prop_container_blue', 0xd0d040);
  const addCar = propBuilder(scene, 'prop_container_blue', null);
  const addJunkPile = propBuilder(scene, 'prop_tire', 0x8899aa);
  const addBicycle = propBuilder(scene, 'prop_tire', 0x556677);
  const addPallet = propBuilder(scene, 'prop_dumpster', 0x9c8058);

  // West wall row — long axis (sy) parallel to the wall, like real racking
  // standing flush against it. x kept far enough out for MIN_OBSTACLE_
  // CLEARANCE from the wall; y spaced generously so tall pieces clear each
  // other too. Roughly spawn (y=34) -> puppy (y=-38), corner to corner.
  place(addForklift, -10.0, 32, 3.0, 1.6); // landmark, near the spawn corner
  place(addBicycle, -11.3, 27, 0.6, 1.2);
  place(addShelf, -11.2, 22, 0.9, 2.8);
  place(addCrateStack, -10.5, 12, 2.6, 2.6);
  place(addPalletRack, -11.2, 2, 0.8, 3.4);
  place(addBarrel, -10.6, -8, 1.7, 1.7);
  place(addJunkPile, -10.4, -18, 2.2, 2.2);
  place(addPalletRack, -11.2, -28, 0.8, 3.2);
  place(addCrateStackSmall, -10.5, -36.3, 2.3, 2.3); // near the puppy corner

  // East wall row — mirrors the west row's rhythm with different prop types
  // so the two sides don't read as a copy-paste mirror image.
  place(addCar, 10.6, 32, 1.8, 3.4); // landmark, near the spawn corner
  place(addCrateStackSmall, 10.6, 22, 1.5, 1.5);
  place(addShelf, 11.2, 12, 0.9, 3.8);
  place(addBarrel, 10.6, 2, 1.5, 1.5);
  place(addCrateStack, 10.5, -8, 2.0, 2.0);
  place(addPalletRack, 11.2, -18, 0.8, 3.2);
  place(addJunkPile, 10.6, -28, 2.0, 2.0);
  place(addBarrel, 10.5, -37, 1.3, 1.3); // near the puppy corner

  // A couple of "island" pieces between the wall rows and the center aisle
  // — breaks up the aisle's monotony without narrowing the actual walkway
  // (spawn/puppy sit around x=0..-4; these sit well outside that band).
  place(addShelf, 6.5, 16, 0.9, 2.0);
  place(addCrateStackSmall, -6.5, -12, 1.4, 1.4);

  return { floor };
}
