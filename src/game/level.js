// ---------------------------------------------------------------------------
// Warehouse layout.
//
// 1. FLOOR — completely rebuilt after TWO failed attempts at a tile mosaic.
//    Root cause, finally correctly diagnosed: it was never just the jagged
//    floor_d/floor_e variants. EVERY tile in this tileset (floor_a/b/c
//    included) is drawn with its own visible border, because the source
//    pack is meant for sparse decorative pavement, not as 100% coverage of
//    an entire game world. Tiling ANY of them edge-to-edge across a large
//    floor — even the "clean" ones — produces a dense grid of seams that
//    reads exactly like the reported maze/brick pattern; the previous fix
//    only swapped which tiles made the grid, not the grid itself. Confirmed
//    by re-inspecting a real screenshot rather than assuming the prior
//    change had worked. Fixed properly this time: the floor is a flat fill
//    in floor_c's own sampled color (floor_c has no border at all — the one
//    genuinely seamless variant) with SPARSE, LOW-OPACITY procedural stains
//    and hairline cracks drawn directly, not from tile art — the same
//    "soft blotches + jagged crack lines, low count, big/thin enough not to
//    read as noise" approach this project's original Three.js version used
//    for its concrete floor (memory: makeConcreteTexture), which was never
//    flagged as a problem. No tile boundaries anywhere, so there is no grid
//    to read as a maze regardless of zoom or scale.
// 2. The obstacle course is a seeded-random scatter across the whole floor,
//    in three real size tiers from barrels and utility boxes up to vans,
//    generators and scrap bins several times their size, shaped into SOFT
//    ROUTES: two meandering lanes (plus cross links) from the door to the
//    puppy are kept clear and lined with props and tight prop groups, while
//    the 2.8-tile clearance between every pair of props keeps the space
//    between lanes crossable rather than maze-like. Every placement still
//    goes through placeObstacleSafe (clearance + route check). See
//    buildLevel().
// ---------------------------------------------------------------------------
import { TILE_SIZE, FLOOR_X, FLOOR_Y, WALL_THICKNESS, PLAYER_SPAWN, PUPPY_SPAWN, MIN_OBSTACLE_CLEARANCE } from './constants.js';
import { registerWalkObstacle, placeObstacleSafe, walkObstacles, boxGap } from './obstacles.js';

const px = (u) => u * TILE_SIZE;
const FLOOR_BASE_COLOR = '#a293c4'; // sampled directly from floor_c, the one border-free tile

// Small deterministic PRNG (mulberry32) so the floor's stains/cracks look
// the same on every load/reset instead of re-shuffling — a stable level,
// not noise.
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

  // One flat fill — no tile boundaries anywhere, so there is no grid to
  // ever read as a maze, at any zoom.
  ctx.fillStyle = FLOOR_BASE_COLOR;
  ctx.fillRect(0, 0, w, h);

  // Sparse soft stains (low-opacity radial blotches) — count scales with
  // floor area but stays low-density; big/soft enough to break up the flat
  // fill without turning into visible noise.
  const stainCount = Math.round((w * h) / 45000);
  for (let i = 0; i < stainCount; i++) {
    const sx = rand() * w;
    const sy = rand() * h;
    const r = 40 + rand() * 70;
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    grad.addColorStop(0, 'rgba(0,0,0,0.16)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sparse hairline cracks — short jagged multi-segment lines, not tile
  // edges, so they read as fractures in the concrete rather than seams.
  const crackCount = Math.round((w * h) / 60000);
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1;
  for (let i = 0; i < crackCount; i++) {
    let x = rand() * w;
    let y = rand() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segments = 3 + Math.floor(rand() * 3);
    for (let s = 0; s < segments; s++) {
      x += (rand() - 0.5) * 40;
      y += (rand() - 0.5) * 40;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Darken the band nearest each wall — the floor/wall transition
  // treatment, drawn as a plain gradient-free rect so it stays a soft
  // shadow, not another hard edge.
  const bandPx = px(1.5);
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(0, 0, w, bandPx); // north
  ctx.fillRect(0, h - bandPx, w, bandPx); // south
  ctx.fillRect(0, 0, bandPx, h); // west
  ctx.fillRect(w - bandPx, 0, bandPx, h); // east

  canvasTexture.refresh();

  const floorCx = px((FLOOR_X[0] + FLOOR_X[1]) / 2);
  const floorCy = px((FLOOR_Y[0] + FLOOR_Y[1]) / 2);
  const floor = scene.add.image(floorCx, floorCy, key);
  floor.setDepth(-1000);
  floor.setPipeline('Light2D');
  return floor;
}

// Small wall-mounted light fixture — drawn procedurally (no sconce/fixture
// prop exists anywhere in the purchased tileset's sheets, which run to
// containers/dumpsters/vehicles/signage/doors, not wall lamps) rather than
// stretching a mismatched prop into the role. Just a dark mounting bracket
// + a lit warm bulb, native 16x24 so it reads clearly at this game's tile
// scale without needing to be stretched.
function buildWallLampTexture(scene) {
  const key = 'wall_lamp_baked';
  if (scene.textures.exists(key)) return key;
  const w = 16, h = 24;
  const canvasTexture = scene.textures.createCanvas(key, w, h);
  const ctx = canvasTexture.getContext();
  ctx.fillStyle = '#2a2830';
  ctx.fillRect(4, 0, 8, 6); // mounting bracket, flush against the wall
  ctx.fillRect(7, 6, 2, 8); // arm hanging down into the room
  const bx = 8, by = 18;
  const glow = ctx.createRadialGradient(bx, by, 0, bx, by, 8);
  glow.addColorStop(0, 'rgba(255,214,140,0.9)');
  glow.addColorStop(1, 'rgba(255,214,140,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(bx, by, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff3d6';
  ctx.beginPath();
  ctx.arc(bx, by, 3, 0, Math.PI * 2);
  ctx.fill();
  canvasTexture.refresh();
  return key;
}

// A handful of these along the perimeter (sprite + its own small light pool)
// is what makes the map edges read as legible via believable in-world
// lighting instead of one flat, uniformly bright border wrapped around the
// whole level like a UI frame. Positioned just inside each wall's inner
// face — mounted fixtures protrude into the room a little rather than
// sitting flush inside the (very thin) wall span itself — and sized/placed
// as decoration only: no collision box, same as the door.
function buildWallLamps(scene, addLight) {
  const key = buildWallLampTexture(scene);
  const warm = 0xffd9a0;
  const LAMP_W = 0.7, LAMP_H = 1.05;
  // A little brighter than the very first pass (radius 70, intensity 1.0) —
  // boundary lights specifically, per feedback; interior pools/ambient in
  // GameScene#setupLighting are untouched.
  const LAMP_RADIUS = 88, LAMP_INTENSITY = 1.35;
  const rects = [];
  const addLamp = (cx, cy) => {
    rects.push({ minX: cx - LAMP_W / 2, maxX: cx + LAMP_W / 2, minY: cy - LAMP_H / 2, maxY: cy + LAMP_H / 2 });
    const img = scene.add.image(px(cx), px(cy), key);
    img.setDisplaySize(px(LAMP_W), px(LAMP_H));
    // Fixed, always-on-top depth (same +1e6 convention as the walls
    // themselves in addWallSpan below) — NOT the dynamic cy+sy/2 every
    // floor-standing prop uses. This fixture is mounted ON the wall, above
    // head height, not sitting on the floor at some Y a walking player
    // could ever have more Y-sort "priority" than: it must never appear to
    // render in front of/at the same apparent depth as the player just
    // because the player's feet momentarily have a larger Y value.
    img.setDepth(px(cy) + px(LAMP_H) / 2 + 1e6);
    img.setPipeline('Light2D');
    addLight(cx, cy, LAMP_RADIUS, warm, LAMP_INTENSITY);
  };
  const westX = FLOOR_X[0] + 1.1;
  const eastX = FLOOR_X[1] - 1.1;
  for (const y of [-33, -16, 1, 18, 32]) {
    addLamp(westX, y);
    addLamp(eastX, y);
  }
  const northY = FLOOR_Y[0] + 1.1;
  const southY = FLOOR_Y[1] - 1.1;
  for (const x of [-9, 9]) {
    addLamp(x, northY);
    addLamp(x, southY); // clear of the door, which sits at x=0
  }
  return rects;
}

// Textures drawn straight top-down: the whole silhouette IS the floor
// footprint. Everything else in this tileset is 3/4 view (front face + top),
// where only the bottom of the silhouette touches the floor.
const TOP_DOWN_TEXTURES = new Set([
  'car_top_1', 'car_top_2', 'car_top_3', 'car_top_4', 'car_top_teal', 'car_top_red',
  'crate_lidded', 'crate_dark', 'prop_tire',
]);

// In this tileset's 3/4 view a floor footprint of size S is drawn ~S/2 deep.
// S is the art's smaller dimension: a tall narrow prop is as deep as it is
// wide, and a long side-on vehicle is far shallower than it is long.
const BASE_DEPTH_PER_SIZE = 0.5;

const ALPHA_SOLID = 128;
const textureMasks = new Map();

function textureMask(scene, key) {
  if (textureMasks.has(key)) return textureMasks.get(key);
  const src = scene.textures.get(key).getSourceImage();
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  // CPU-backed canvas: a GPU-accelerated one made each first alpha read a slow
  // readback (tens of ms per texture at load).
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, src.width, src.height).data;
  const solid = (x, y) => data[(y * src.width + x) * 4 + 3] >= ALPHA_SOLID;
  let top = -1;
  let bottom = -1;
  let left = src.width;
  let right = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (!solid(x, y)) continue;
      if (top < 0) top = y;
      bottom = y;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  const mask = { w: src.width, h: src.height, solid, top, bottom, left, right };
  textureMasks.set(key, mask);
  return mask;
}

// The walk footprint for one placed instance, in world units, read straight
// from the texture's alpha channel so every footprint edge is a real pixel
// edge of the art. Top-down art: every solid row. 3/4-view art: only the
// rows of the base band at the art's bottom, BASE_DEPTH_PER_SIZE deep. Solid runs are merged into rectangles row by row.
// History: this used to be derived from a hand-audited hitbox table, which could
// be off by a texel or more (prop_dumpster_round_* were 2px narrow), and one
// version added full-height side strips that walled off the top of narrow
// objects. The padding bug itself was on the character side — see
// constants.js#FEET_HALF_W.
// Pixel-space footprint rectangles ({ c0, c1, r0, r1 }, r1 exclusive) per
// texture and base-band top row. Scanning the alpha is the slow part, and
// level generation derives footprints for thousands of candidate spots.
const footprintRuns = new Map();
function footprintPixelRects(m, textureKey, bandTop) {
  const cacheKey = `${textureKey}|${bandTop}`;
  if (footprintRuns.has(cacheKey)) return footprintRuns.get(cacheKey);
  let solid = m.solid;
  if (!TOP_DOWN_TEXTURES.has(textureKey)) {
    // In 3/4 view nothing can stand UNDER an overhang (a van's chassis between
    // its wheels, a bumper): every column that has art in the band is solid
    // down to the ground line, so the front edge is the art's lowest row and
    // matches the depth-sort line.
    const colTop = new Array(m.w).fill(Infinity);
    for (let x = 0; x < m.w; x++) {
      for (let y = bandTop; y <= m.bottom; y++) {
        if (m.solid(x, y)) { colTop[x] = y; break; }
      }
    }
    solid = (x, y) => y >= colTop[x];
  }
  const rects = [];
  let open = new Map(); // "c0,c1" -> rect still growing downward
  for (let y = bandTop; y <= m.bottom + 1; y++) {
    const runs = new Set();
    if (y <= m.bottom) {
      for (let x = 0; x < m.w; x++) {
        if (!solid(x, y)) continue;
        const c0 = x;
        while (x < m.w && solid(x, y)) x++;
        runs.add(`${c0},${x}`);
      }
    }
    const next = new Map();
    for (const run of runs) {
      if (open.has(run)) {
        const r = open.get(run);
        r.r1 = y + 1;
        next.set(run, r);
      } else {
        const [c0, c1] = run.split(',').map(Number);
        next.set(run, { c0, c1, r0: y, r1: y + 1 });
      }
    }
    for (const [run, r] of open) if (!next.has(run)) rects.push(r);
    open = next;
  }
  footprintRuns.set(cacheKey, rects);
  return rects;
}

function deriveWalkFootprint(scene, textureKey, cx, cy, sx, sy) {
  const m = textureMask(scene, textureKey);
  const tw = sx / m.w;
  const th = sy / m.h;
  const left = cx - sx / 2;
  const top = cy - sy / 2;
  let bandTop = m.top;
  if (!TOP_DOWN_TEXTURES.has(textureKey)) {
    const artH = (m.bottom + 1 - m.top) * th;
    const artW = (m.right + 1 - m.left) * tw;
    const depth = BASE_DEPTH_PER_SIZE * Math.min(artW, artH);
    bandTop = Math.max(m.top, m.bottom + 1 - Math.max(1, Math.round(depth / th)));
  }
  const boxes = footprintPixelRects(m, textureKey, bandTop).map((r) => ({
    minX: left + r.c0 * tw,
    maxX: left + r.c1 * tw,
    minY: top + r.r0 * th,
    maxY: top + r.r1 * th,
  }));
  return { boxes, baseY: top + (m.bottom + 1) * th };
}

// Shared builder for every prop. The alpha-derived footprint is the one set
// of obstacle boxes: movement collides with it and vision cones are occluded
// by it. Depth sorts on the art's real bottom edge — the same line the feet
// stop at from the front — not the display rect's bottom, which sits below
// the art for textures with transparent bottom padding and made a player
// standing in front draw behind.
// A sprite STACKED on top of others (a box on a pallet, a crate on a crate)
// passes `stack = { baseY, level }`: it has no floor footprint of its own
// (the sprites under it already block that floor) and draws just above its
// stack's base so it stays on top of the sprites it rests on.
function propBuilder(scene, textureKey, tint) {
  const builderFn = (cx, cy, sx, sy, stack = null) => {
    const footprint = deriveWalkFootprint(scene, textureKey, cx, cy, sx, sy);
    const img = scene.add.image(px(cx), px(cy), textureKey);
    img.setDisplaySize(px(sx), px(sy));
    if (tint != null) img.setTint(tint);
    img.setDepth(stack ? px(stack.baseY) + stack.level : px(footprint.baseY));
    img.setPipeline('Light2D');
    if (stack) img.setData('stacked', true);
    const walkObs = stack
      ? []
      : footprint.boxes.map((b) => registerWalkObstacle((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, b.maxX - b.minX, b.maxY - b.minY));
    return { gameObjects: [img], walkObstacles: walkObs };
  };
  return builderFn;
}

export function buildLevel(scene) {
  const spawn = [PLAYER_SPAWN.x, PLAYER_SPAWN.y];
  const goal = [PUPPY_SPAWN.x, PUPPY_SPAWN.y];
  const floor = buildFloor(scene);

  // --- Outer walls -------------------------------------------------------
  const zc = (FLOOR_Y[0] + FLOOR_Y[1]) / 2;
  const zLen = FLOOR_Y[1] - FLOOR_Y[0];
  const xc = (FLOOR_X[0] + FLOOR_X[1]) / 2;
  const xLen = FLOOR_X[1] - FLOOR_X[0];
  const wallBoxes = new Set();
  const addWallSpan = (cx, cy, sx, sy) => {
    const wall = scene.add.tileSprite(px(cx), px(cy), px(sx), px(sy), 'wall_corrugated');
    wall.setDepth(px(cy) + px(sy) / 2 + 1e6); // walls always read above floor/props behind them
    wall.setPipeline('Light2D');
    wallBoxes.add(registerWalkObstacle(cx, cy, sx, sy));
  };
  addWallSpan(FLOOR_X[0], zc, WALL_THICKNESS, zLen); // west
  addWallSpan(FLOOR_X[1], zc, WALL_THICKNESS, zLen); // east
  addWallSpan(xc, FLOOR_Y[1], xLen, WALL_THICKNESS); // south (near player spawn)
  addWallSpan(xc, FLOOR_Y[0], xLen, WALL_THICKNESS); // north (near puppy)

  // Wall-mounted light fixtures — see buildWallLamps above. scene.lights is
  // already enabled by GameScene#setupLighting, which runs before buildLevel.
  const lampRects = buildWallLamps(scene, (x, y, radius, color, intensity) => scene.lights.addLight(px(x), px(y), radius, color, intensity));

  // --- Storage rows and aisles --------------------------------------------
  // Warehouse structure: STORAGE ROWS of packed clusters run across the
  // floor, and the open floor between them is a set of aisles no prop art may
  // enter (a prop that would is nudged aside, or for row packing rejected):
  //  - a cross aisle past every row, wall to wall;
  //  - 1-2 walk-through gaps per row, staggered from the previous row's gaps
  //    so the way north weaves instead of running straight;
  //  - the perimeter walkway (props keep MIN_OBSTACLE_CLEARANCE from walls),
  //    which also lets every row be walked around at both ends.
  // So there are always several door-to-puppy routes, while the props read
  // as long masses that define lanes. Spacing is tiered: clusters packed into
  // one row segment sit PACK_GAP apart (one mass); separate props keep
  // PROP_GAP (still a walkable side passage); walls keep
  // MIN_OBSTACLE_CLEARANCE. Some short segments are left open, so the grid
  // never reads as a rigid maze.
  const layoutRand = mulberry32(20260913);
  const jitter = (amount) => (layoutRand() - 0.5) * 2 * amount;
  const ROW_PITCH = 8.5;
  const ROW_YS = [24, 15.5, 7, -1.5, -10, -18.5, -27, -35.5];
  const CROSS_AISLE_HALF_WIDTH = 1.9;
  const GAP_HALF_WIDTH_RANGE = [1.6, 2.0];
  const GAP_X_RANGE = [-8.5, 8.5];
  const GAP_MIN_SPACING = 8;
  const ROW_EXTENT = [
    FLOOR_X[0] + WALL_THICKNESS / 2 + MIN_OBSTACLE_CLEARANCE + 0.1,
    FLOOR_X[1] - WALL_THICKNESS / 2 - MIN_OBSTACLE_CLEARANCE - 0.1,
  ];
  const rows = ROW_YS.map((y) => ({ y: y + jitter(0.3), gaps: [], segments: [] }));
  let previousGaps = [];
  for (const row of rows) {
    // Rows get 1 or 2 gaps (plus both open ends). Of a few random spreads,
    // keep the one whose gaps sit farthest from the previous row's.
    let best = null;
    for (const count of layoutRand() < 0.55 ? [2, 1] : [1]) {
      for (let attempt = 0; attempt < 80; attempt++) {
        const xs = Array.from({ length: count }, () => GAP_X_RANGE[0] + layoutRand() * (GAP_X_RANGE[1] - GAP_X_RANGE[0])).sort((a, b) => a - b);
        if (xs.some((x, i) => i > 0 && x - xs[i - 1] < GAP_MIN_SPACING)) continue;
        const stagger = Math.min(Infinity, ...xs.flatMap((x) => previousGaps.map((g) => Math.abs(x - g.x))));
        if (!best || stagger > best.stagger) best = { xs, stagger };
      }
      if (best) break;
    }
    row.gaps = best.xs.map((x) => ({ x, halfWidth: GAP_HALF_WIDTH_RANGE[0] + layoutRand() * (GAP_HALF_WIDTH_RANGE[1] - GAP_HALF_WIDTH_RANGE[0]) }));
    let x0 = ROW_EXTENT[0];
    for (const g of row.gaps) {
      row.segments.push([x0, g.x - g.halfWidth]);
      x0 = g.x + g.halfWidth;
    }
    row.segments.push([x0, ROW_EXTENT[1]]);
    previousGaps = row.gaps;
  }
  // Cross aisle centers: past the first row, between each pair, past the last.
  const aisleYs = [
    rows[0].y + ROW_PITCH / 2,
    ...rows.slice(1).map((row, i) => (rows[i].y + row.y) / 2),
    rows[rows.length - 1].y - ROW_PITCH / 2,
  ];
  const aisles = aisleYs.map((y) => ({ pts: [[FLOOR_X[0], y], [FLOOR_X[1], y]], halfWidth: CROSS_AISLE_HALF_WIDTH }));
  rows.forEach((row, i) => {
    for (const g of row.gaps) aisles.push({ pts: [[g.x, aisleYs[i]], [g.x, aisleYs[i + 1]]], halfWidth: g.halfWidth });
  });
  const lanePoints = aisles.flatMap(({ pts, halfWidth }) => {
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [[ax, ay], [bx, by]] = [pts[i], pts[i + 1]];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.5));
      for (let s = 0; s <= steps; s++) out.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps, halfWidth]);
    }
    return out;
  });
  const rectPointDist = (r, x, y) => Math.hypot(Math.max(r.minX - x, 0, x - r.maxX), Math.max(r.minY - y, 0, y - r.maxY));
  // Nearest aisle point closer than its aisle's half width to the rect, or
  // null. (Runs for every placement attempt, so points outside the rect grown
  // by the half width are skipped with plain comparisons first.)
  const laneIntrusion = (r) => {
    let worst = null;
    for (const [x, y, hw] of lanePoints) {
      if (x <= r.minX - hw || x >= r.maxX + hw || y <= r.minY - hw || y >= r.maxY + hw) continue;
      const d = rectPointDist(r, x, y);
      if (d < hw && (!worst || d - hw < worst.d - worst.hw)) worst = { x, y, d, hw };
    }
    return worst;
  };

  const SPAWN_CLEAR_R = 9; // keep the player's start position clear of clutter
  const GOAL_CLEAR_R = 8; // keep the puppy's corner clear so pickup stays easy
  const clearOfSpawnAndGoal = (x, y) =>
    Math.hypot(x - spawn[0], y - spawn[1]) >= SPAWN_CLEAR_R && Math.hypot(x - goal[0], y - goal[1]) >= GOAL_CLEAR_R;

  // Every successful placement is logged here (position/tier/kind) so
  // buildLevel can audit its own output afterward (zone and near-puppy passes).
  const placedSummary = [];
  // Props never draw on top of each other or the wall lamps: their art
  // bounding boxes keep SPRITE_GAP apart. (Footprint clearance alone let
  // tall sprites overlap their neighbors once the floor got denser.)
  const SPRITE_GAP = 0.25;
  const PROP_GAP = 1.8; // footprint gap between separate props (not walls, not one row run)
  const minGapFor = (o) => (wallBoxes.has(o) ? MIN_OBSTACLE_CLEARANCE : PROP_GAP);
  const placedRects = [...lampRects];
  const MAX_LANE_NUDGES = 3;
  // The art's opaque bounding box for a sprite placed at (cx, cy), not its
  // display rect: many crops have transparent padding (a barrel's top third).
  const artRectAt = (key, cx, cy, sx, sy) => {
    const m = textureMask(scene, key);
    const left = cx - sx / 2;
    const top = cy - sy / 2;
    return {
      minX: left + (m.left / m.w) * sx,
      maxX: left + ((m.right + 1) / m.w) * sx,
      minY: top + (m.top / m.h) * sy,
      maxY: top + ((m.bottom + 1) / m.h) * sy,
    };
  };
  const unionRect = (rects) => ({
    minX: Math.min(...rects.map((r) => r.minX)),
    maxX: Math.max(...rects.map((r) => r.maxX)),
    minY: Math.min(...rects.map((r) => r.minY)),
    maxY: Math.max(...rects.map((r) => r.maxY)),
  });

  // Places one prop: a list of sprite parts ({ key, builder, dx, dy, sx, sy },
  // offsets from the prop's center) that pass every check and register as a
  // single obstacle. Most props are one sprite; a group (parked cars, a barrel
  // cluster, a crate stack) is several sprites packed tightly.
  // Options: `nudge: false` rejects a spot that intrudes on an aisle instead
  // of shifting it (row packing needs exact positions); `packedWith` is a Set
  // of footprint boxes of the same row run, which this prop may sit right
  // against (PROP_GAP applies to everything else) and which it joins.
  const place = (parts, x, y, { nudge = true, packedWith = null } = {}) => {
    let cx = x;
    let cy = y;
    const rectsAt = () => parts.map((p) => artRectAt(p.key, cx + p.dx, cy + p.dy, p.sx, p.sy));
    let rects = rectsAt();
    for (let n = 0; n <= MAX_LANE_NUDGES; n++) {
      const hit = laneIntrusion(unionRect(rects));
      if (!hit) break;
      if (!nudge || n === MAX_LANE_NUDGES) return null;
      const len = Math.hypot(cx - hit.x, cy - hit.y);
      const nx = len > 1e-6 ? (cx - hit.x) / len : 1;
      const ny = len > 1e-6 ? (cy - hit.y) / len : 0;
      const push = hit.hw - hit.d + 0.05;
      cx += nx * push;
      cy += ny * push;
      rects = rectsAt();
    }
    if (!clearOfSpawnAndGoal(cx, cy)) return null;
    const overlaps = rects.some((rect) =>
      placedRects.some(
        (r) => rect.minX < r.maxX + SPRITE_GAP && rect.maxX > r.minX - SPRITE_GAP && rect.minY < r.maxY + SPRITE_GAP && rect.maxY > r.minY - SPRITE_GAP
      )
    );
    if (overlaps) return null;
    const gapFor = packedWith ? (o) => (packedWith.has(o) ? 0 : minGapFor(o)) : minGapFor;
    // Spacing pre-check on the footprints the parts WILL register, before any
    // sprite is created (building and destroying sprites for every rejected
    // spot made level generation slow).
    for (const p of parts) {
      if (p.stackLevel) continue;
      const { boxes } = deriveWalkFootprint(scene, p.key, cx + p.dx, cy + p.dy, p.sx, p.sy);
      if (boxes.some((b) => walkObstacles.some((o) => boxGap(b, o) < gapFor(o)))) return null;
    }
    const floorRects = rects.filter((_, i) => !parts[i].stackLevel);
    const baseY = Math.max(...floorRects.map((r) => r.maxY));
    const composite = () => {
      const gameObjects = [];
      const boxes = [];
      for (const p of parts) {
        const stack = p.stackLevel ? { baseY, level: p.stackLevel } : null;
        const built = p.builder(cx + p.dx, cy + p.dy, p.sx, p.sy, stack);
        gameObjects.push(...built.gameObjects);
        boxes.push(...built.walkObstacles);
      }
      return { gameObjects, walkObstacles: boxes };
    };
    const firstBox = walkObstacles.length;
    if (!placeObstacleSafe(composite, spawn[0], spawn[1], goal[0], goal[1], gapFor)) return null;
    if (packedWith) for (const o of walkObstacles.slice(firstBox)) packedWith.add(o);
    placedRects.push(...rects);
    return { cx, cy, parts };
  };

  // --- Props -------------------------------------------------------------
  // Three REAL size tiers, every texture drawn at its native aspect ratio and
  // scaled uniformly inside its range (display tiles, 1 tile = 16px):
  //  - SMALL  ~1-2.4 tiles: crate pairs, grey box stacks, barrel groups,
  //    tire stacks with loose tires, cone pairs.
  //  - MEDIUM ~2-3.3 tiles: crate pallets and rows, tire heaps, big barrel
  //    clusters, box piles, AC units, tire piles, top-down cars.
  //  - LARGE  ~3-4.5 tiles (3-5x the smallest): crate stacks and blocks,
  //    tire yards, generators, scrap bins, a capped number of vehicles
  //    (VEHICLE_SPRITE_CAP), and at most L_BOX_COUNT L-shaped boxes.
  // All crops come from the purchased RCCv2STREETStileset sheets; see
  // asset-sources/cropped/.
  const scatterRand = mulberry32(20260911); // stable across loads/resets
  const between = ([lo, hi]) => lo + scatterRand() * (hi - lo);
  const pickOne = (arr) => arr[Math.floor(scatterRand() * arr.length)];
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(scatterRand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const builders = new Map();
  const builderFor = (key, tint = null) => {
    const id = `${key}:${tint}`;
    if (!builders.has(id)) builders.set(id, propBuilder(scene, key, tint));
    return builders.get(id);
  };
  const nativeSize = (key) => {
    const src = scene.textures.get(key).getSourceImage();
    return [src.width / TILE_SIZE, src.height / TILE_SIZE];
  };
  const part = (key, scale, tint = null) => {
    const [w, h] = nativeSize(key);
    return { key, builder: builderFor(key, tint), dx: 0, dy: 0, sx: w * scale, sy: h * scale };
  };
  // Side by side with bottoms (ground lines) aligned, centered on the prop.
  const row = (parts, gap, jitter = 0.2) => {
    const width = parts.reduce((sum, p) => sum + p.sx, 0) + gap * (parts.length - 1);
    const height = Math.max(...parts.map((p) => p.sy));
    let x = -width / 2;
    for (const p of parts) {
      p.dx = x + p.sx / 2;
      p.dy = height / 2 - p.sy / 2 + (scatterRand() - 0.5) * jitter;
      x += p.sx + gap;
    }
    return parts;
  };
  const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // A tight grid of top-down crates: a pallet load seen from above.
  const crateGrid = (cols, rows, size) => {
    const parts = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const p = part(scatterRand() < 0.7 ? 'crate_lidded' : 'crate_dark', size);
        p.dx = (c - (cols - 1) / 2) * (p.sx + 0.05);
        p.dy = (r - (rows - 1) / 2) * (p.sy + 0.05);
        parts.push(p);
      }
    }
    return parts;
  };
  // Extra crates stacked on a grid: each sits over a different crate below,
  // nudged up-left so the lower layer shows, and never past the grid's own
  // edge (the grid is what blocks the floor).
  const stackCrates = (parts, count, size, level = 1) => {
    const floor = parts.filter((p) => !p.stackLevel);
    const minX = Math.min(...floor.map((p) => p.dx - p.sx / 2));
    const maxX = Math.max(...floor.map((p) => p.dx + p.sx / 2));
    const minY = Math.min(...floor.map((p) => p.dy - p.sy / 2));
    const maxY = Math.max(...floor.map((p) => p.dy + p.sy / 2));
    for (const under of shuffle(parts.filter((p) => (p.stackLevel || 0) === level - 1)).slice(0, count)) {
      const p = part('crate_lidded', size);
      p.dx = clampTo(under.dx - p.sx * 0.2, minX + p.sx / 2, maxX - p.sx / 2);
      p.dy = clampTo(under.dy - p.sy * 0.2, minY + p.sy / 2, maxY - p.sy / 2);
      p.stackLevel = level;
      parts.push(p);
    }
    return parts;
  };
  // A small front-facing box set on top of a box below it.
  const stackBox = (parts, under, key, scale) => {
    const p = part(key, scale);
    p.dx = under.dx + (scatterRand() - 0.5) * 0.15;
    p.dy = under.dy - under.sy * 0.7;
    p.stackLevel = 1;
    parts.push(p);
    return parts;
  };

  const kind = (key, scale, weight = 1) => ({ key, weight, uses: [key], layout: () => [part(key, between(scale))] });
  const group = (key, weight, uses, layout) => ({ key, weight, uses, layout });
  const CARS = ['car_top_1', 'car_top_2', 'car_top_3', 'car_top_4', 'car_top_teal', 'car_top_red'];
  const VANS = ['vehicle_van_blue', 'vehicle_van_red', 'vehicle_van_blue_b', 'vehicle_van_red_b', 'vehicle_hover_teal', 'vehicle_hover_teal_b', 'vehicle_coupe_dark', 'vehicle_coupe_dark_b'];
  const VEHICLES = new Set([...CARS, ...VANS]);
  const BARRELS = ['prop_barrel', 'prop_barrel2', 'prop_barrel_fire'];
  const CRATES = ['crate_lidded', 'crate_dark'];
  const BOXES = ['box_grey_a', 'box_grey_b', 'box_grey_small'];
  const TIRES = ['scrap_tire_stack', 'scrap_tire_pile', 'prop_tire'];
  const barrel = () => part(pickOne(BARRELS), between([0.74, 0.82]));

  const CRATE_TINTS = [0xa5372e, 0x2e9e8f, 0x35659e, 0x7a4aa8];
  const L_BOX = group('prop_dumpster', 1, ['prop_dumpster'], () => [part('prop_dumpster', between([1.5, 1.9]), pickOne(CRATE_TINTS))]);
  const L_BOX_COUNT = 3;

  // Warehouse props only, and mostly composed clusters: no isolated small
  // props (barrels, tire stacks, boxes come in groups), and no street
  // furniture (lamps, dishes, kiosks, speakers, vending).
  const SMALL = [
    kind('prop_cone_pair', [0.6, 0.72], 0.4),
    group('group_barrels_pair', 2, BARRELS, () => row([barrel(), barrel()], 0.02, 0.1)),
    group('group_barrels', 2.5, BARRELS, () => {
      const parts = [barrel(), barrel(), barrel()];
      parts[0].dx = -0.42; parts[1].dx = 0.42; parts[1].dy = 0.1; parts[2].dx = 0.05; parts[2].dy = -0.55;
      return parts;
    }),
    group('group_crates_pair', 3, CRATES, () => crateGrid(scatterRand() < 0.5 ? 2 : 1, scatterRand() < 0.5 ? 1 : 2, between([1.0, 1.15]))),
    group('group_boxes', 3, BOXES, () => {
      const parts = row(shuffle([part('box_grey_a', 1.3), part('box_grey_b', 1.3), part('box_grey_small', 1.4)]), 0.03, 0.05);
      return stackBox(parts, pickOne(parts), pickOne(BOXES), 1.3);
    }),
    group('group_tires_small', 3, TIRES, () => row(shuffle([part('scrap_tire_stack', between([1.0, 1.1])), part('prop_tire', between([0.95, 1.05]))]), 0.03, 0.1)),
    group('group_utility', 1, ['utility_box', 'prop_locker'], () => row(shuffle([part('utility_box', 1.1), part('prop_locker', 1.25)]), 0.08)),
  ];
  const MEDIUM = [
    kind('scrap_tire_pile', [1.25, 1.5], 0.75),
    kind('machine_ac_unit', [1.2, 1.4], 0.75),
    ...CARS.map((key) => kind(key, [0.95, 1.1], 0.2)),
    group('group_crate_pallet', 4, CRATES, () => stackCrates(crateGrid(2, 2, between([1.0, 1.1])), 1 + Math.floor(scatterRand() * 2), 1.0)),
    group('group_crate_row', 3, CRATES, () => stackCrates(crateGrid(3, 1, between([1.0, 1.1])), 1, 1.0)),
    group('group_barrels_big', 2.5, BARRELS, () => {
      const back = row([barrel(), barrel()], 0.02, 0);
      const front = row([barrel(), barrel(), barrel()], 0.02, 0);
      back.forEach((p) => { p.dy -= 0.5; });
      return [...back, ...front];
    }),
    group('group_tire_heap', 3.5, TIRES, () => {
      const parts = row([part('scrap_tire_pile', between([1.2, 1.35])), part('scrap_tire_stack', between([1.0, 1.1]))], 0, 0.05);
      const loose = part('prop_tire', 1.0);
      loose.dx = parts[0].dx - 0.5;
      loose.dy = parts[0].dy + parts[0].sy / 2 - loose.sy / 2 + 0.45;
      return [...parts, loose];
    }),
    group('group_box_pile', 3.5, [...BOXES, ...CRATES], () => {
      const parts = row([part('crate_lidded', 1.1), part('box_grey_a', 1.35), part('box_grey_b', 1.35)], 0.04, 0.05);
      stackBox(parts, parts[1], 'box_grey_small', 1.35);
      return stackBox(parts, parts[2], pickOne(['box_grey_a', 'box_grey_small']), 1.3);
    }),
  ];
  const LARGE = [
    L_BOX,
    ...VANS.map((key) => kind(key, key.startsWith('vehicle_van') ? [1.0, 1.2] : [1.0, 1.15], key.endsWith('_b') ? 0.3 : 0.45)),
    kind('machine_generator', [1.6, 1.9], 1.25),
    kind('scrap_bin', [1.6, 1.9], 0.75),
    group('group_parked_cars', 0.75, CARS, () => {
      const n = scatterRand() < 0.6 ? 2 : 3;
      return row(shuffle(CARS.slice()).slice(0, n).map((key) => part(key, between([0.95, 1.05]))), 0.3);
    }),
    group('group_scrap', 1.25, ['scrap_bin', 'scrap_tire_stack'], () => row([part('scrap_bin', between([1.5, 1.7])), part('scrap_tire_stack', between([1.0, 1.15]))], 0.1)),
    group('group_crate_stack', 2.5, CRATES, () => {
      const size = between([1.0, 1.1]);
      const parts = stackCrates(crateGrid(3, 2, size), 3, size * 0.95);
      return stackCrates(parts, 1, size * 0.9, 2);
    }),
    group('group_crate_block', 1.5, CRATES, () => {
      const size = between([1.0, 1.08]);
      const parts = stackCrates(crateGrid(3, 3, size), 4, size * 0.95);
      return stackCrates(parts, 2, size * 0.9, 2);
    }),
    group('group_tire_yard', 1.75, TIRES, () => {
      const parts = row([part('scrap_tire_stack', 1.05), part('scrap_tire_pile', between([1.3, 1.45])), part('scrap_tire_stack', 1.1)], 0, 0.05);
      const pile = parts[1];
      const top = part('prop_tire', 0.95);
      top.dx = pile.dx + 0.1;
      top.dy = pile.dy - pile.sy * 0.25;
      top.stackLevel = 1;
      return [...parts, top];
    }),
  ];
  const TIERS = { small: SMALL, medium: MEDIUM, large: LARGE };

  // A kind's weight drops sharply with every copy already placed, and with
  // every sprite of a texture it uses (so a crate stack also counts against
  // single crates), so no one prop can become the dominant repeat (what
  // happened with the L-box). Vehicles are also hard-capped as a category.
  const VEHICLE_SPRITE_CAP = 6;
  // Big one-off machines are distinctive enough that a third copy reads as
  // repetition (and the generator and scrap bin look alike from above).
  const TEXTURE_CAPS = new Map([['machine_generator', 2], ['scrap_bin', 2]]);
  const placedCounts = new Map();
  const textureCounts = new Map();
  function pickKind(tierName) {
    const vehicleSprites = [...VEHICLES].reduce((sum, t) => sum + (textureCounts.get(t) || 0), 0);
    const list = TIERS[tierName].filter(
      (k) =>
        (vehicleSprites < VEHICLE_SPRITE_CAP || !k.uses.some((t) => VEHICLES.has(t))) &&
        (k !== L_BOX || (placedCounts.get(L_BOX.key) || 0) < L_BOX_COUNT) &&
        k.uses.every((t) => !TEXTURE_CAPS.has(t) || (textureCounts.get(t) || 0) < TEXTURE_CAPS.get(t))
    );
    const weightOf = (k) =>
      k.weight / (1 + 3 * (placedCounts.get(k.key) || 0) + 1.5 * Math.max(...k.uses.map((t) => textureCounts.get(t) || 0)));
    const total = list.reduce((sum, k) => sum + weightOf(k), 0);
    let r = scatterRand() * total;
    for (const k of list) {
      r -= weightOf(k);
      if (r <= 0) return k;
    }
    return list[list.length - 1];
  }

  // Spots inside another prop's art are skipped outright: a prop there almost
  // always fails the overlap check anyway (only a lane nudge could move it
  // clear), and level generation tries thousands of spots, most late ones
  // already taken.
  const spotTaken = (x, y) =>
    placedRects.some((r) => x > r.minX - SPRITE_GAP && x < r.maxX + SPRITE_GAP && y > r.minY - SPRITE_GAP && y < r.maxY + SPRITE_GAP);

  function placeParts(k, tierName, parts, x, y, options) {
    const at = place(parts, x, y, options);
    if (!at) return false;
    placedSummary.push({ cx: at.cx, cy: at.cy, tier: tierName, kind: k.key, parts: at.parts.map((q) => ({ key: q.key, sx: q.sx, sy: q.sy })) });
    placedCounts.set(k.key, (placedCounts.get(k.key) || 0) + 1);
    for (const p of at.parts) textureCounts.set(p.key, (textureCounts.get(p.key) || 0) + 1);
    return true;
  }
  function placeKind(k, tierName, x, y) {
    if (spotTaken(x, y)) return false;
    return placeParts(k, tierName, k.layout(), x, y);
  }

  // Six zones (north/middle/south x west/east), used to audit the final size
  // mix per zone.
  const ZONES = [];
  for (const [y0, y1, rowName] of [[FLOOR_Y[0], -14, 'north'], [-14, 10, 'middle'], [10, FLOOR_Y[1], 'south']]) {
    for (const [x0, x1, colName] of [[FLOOR_X[0], 0, 'west'], [0, FLOOR_X[1], 'east']]) {
      const zoneCandidates = [];
      for (let x = x0 + 2.5; x <= x1 - 2.5; x += 1.5) {
        for (let y = y0 + 2.5; y <= y1 - 2.5; y += 1.5) {
          if (clearOfSpawnAndGoal(x, y)) zoneCandidates.push([x, y]);
        }
      }
      ZONES.push({ name: `${rowName}-${colName}`, x0, x1, y0, y1, candidates: zoneCandidates });
    }
  }
  const inZone = (z, p) => p.cx >= z.x0 && p.cx < z.x1 && p.cy >= z.y0 && p.cy < z.y1;

  // --- Pack the rows -------------------------------------------------------
  // Each row segment (between two gaps, or a gap and the perimeter walkway)
  // is packed as a block two props deep: columns side by side, PACK_GAP
  // apart and centered in the segment, where a column is either one tall
  // cluster or two shorter ones one behind the other (taller at the back).
  // Everything is sized to the band between the row's two cross aisles, so
  // a block never spills into a lane.
  const PACK_GAP = 0.35;
  const SEGMENT_MIN = 1.2;
  const OPEN_SEGMENT_CHANCE = 0.15; // short segments only
  const OPEN_SEGMENT_MAX = 7;
  const ROW_TIERS = [['large', 0.55], ['medium', 0.35], ['small', 0.1]];
  const pickRowTier = (room) => {
    if (room < 2.2) return 'small';
    let r = scatterRand();
    for (const [name, weight] of ROW_TIERS) if ((r -= weight) <= 0) return name;
    return 'small';
  };
  const artSpan = (parts) => unionRect(parts.map((p) => artRectAt(p.key, p.dx, p.dy, p.sx, p.sy)));
  const pickItem = (tierName, maxW, maxH) => {
    const k = pickKind(tierName);
    const parts = k.layout();
    const span = artSpan(parts);
    const w = span.maxX - span.minX;
    const h = span.maxY - span.minY;
    return w <= maxW && h <= maxH ? { k, tierName, parts, span, w, h } : null;
  };
  const planBlock = (width, bandHeight) => {
    const columns = [];
    let used = 0;
    for (let tries = 0; tries < 24; tries++) {
      const room = width - used - (columns.length ? PACK_GAP : 0);
      if (room < 1.0) break;
      const tierName = pickRowTier(room);
      const first = pickItem(tierName, room, bandHeight);
      if (!first || (tries < 12 && columns.some((c) => c.items.some((q) => q.k === first.k)))) continue;
      const column = { w: first.w, items: [first] };
      const spare = bandHeight - first.h - PACK_GAP;
      for (let t = 0; t < 4 && spare >= 1.0; t++) {
        const second = pickItem(spare >= 1.8 && scatterRand() < 0.6 ? 'medium' : 'small', room, spare);
        if (!second) continue;
        column.items.push(second);
        column.w = Math.max(column.w, second.w);
        break;
      }
      column.items.sort((u, v) => v.h - u.h);
      used += column.w + (columns.length ? PACK_GAP : 0);
      columns.push(column);
    }
    return { columns, used };
  };
  let rowBlocks = 0;
  rows.forEach((row, i) => {
    // Room between the two cross aisles, minus a little for jitter.
    const bandHeight = 2 * (Math.min(aisleYs[i] - row.y, row.y - aisleYs[i + 1]) - CROSS_AISLE_HALF_WIDTH) - 0.4;
    for (const [x0, x1] of row.segments) {
      const width = x1 - x0 - 0.1; // a hair inside the gap aisles
      if (width < SEGMENT_MIN) continue;
      if (width <= OPEN_SEGMENT_MAX && layoutRand() < OPEN_SEGMENT_CHANCE) continue;
      const { columns, used } = planBlock(width, bandHeight);
      const packedWith = new Set();
      let cursor = x0 + 0.05 + (width - used) / 2;
      for (const column of columns) {
        const depth = column.items.reduce((sum, it) => sum + it.h, 0) + PACK_GAP * (column.items.length - 1);
        let top = row.y - depth / 2 + jitter(0.1);
        for (const it of column.items) {
          const cx = cursor + (column.w - it.w) * layoutRand() - it.span.minX;
          const cy = top - it.span.minY;
          placeParts(it.k, it.tierName, it.parts, cx, cy, { nudge: false, packedWith });
          top += it.h + PACK_GAP;
        }
        cursor += column.w + PACK_GAP;
      }
      if (columns.length) rowBlocks++;
    }
  });

  // --- Guaranteed size spread ---------------------------------------------
  // The rows can still leave a zone without a large or medium prop, or the
  // puppy's approach without a large landmark; these audits top those up as
  // islands (aisles stay protected: a prop that would intrude is nudged
  // aside). Small props aren't audited: rows always use them as filler, and
  // a lone small prop is exactly the scattered look the rows replace.
  const onRowLine = ([, y]) => rows.some((row) => Math.abs(y - row.y) <= 0.8);
  // Spots on a row's center line are tried first, so a top-up joins a row.
  const rowLineFirst = (spots) => shuffle(spots.slice()).sort((a, b) => Number(onRowLine(b)) - Number(onRowLine(a)));

  // Earlier feedback: the corridor just below the puppy's spotlight kept
  // ending up with only small props even when the north zones had large
  // ones farther out. Each side needs a large object within NEAR_PUPPY_R.
  const NEAR_PUPPY_R = 20;
  for (const side of [-1, 1]) {
    const nearLarge = (p) =>
      p.tier === 'large' && Math.hypot(p.cx - goal[0], p.cy - goal[1]) < NEAR_PUPPY_R && (side < 0 ? p.cx < 0 : p.cx >= 0);
    if (placedSummary.some(nearLarge)) continue;
    const nearCandidates = [];
    for (const x of [2, 3.5, 5, 6.5, 8, 9.5, 11]) {
      for (let y = -17; y >= -37; y -= 2) {
        const d = Math.hypot(x * side - goal[0], y - goal[1]);
        if (d >= GOAL_CLEAR_R && d < NEAR_PUPPY_R) nearCandidates.push([x * side, y]);
      }
    }
    if (!rowLineFirst(nearCandidates).some(([x, y]) => placeKind(pickKind('large'), 'large', x, y))) {
      console.warn(`[level] no clear spot for a large object near the puppy (${side < 0 ? 'west' : 'east'} side).`);
    }
  }

  // Zone top-ups only go ON a row line: the rows already mix all three tiers,
  // so a zone missing one is a best-effort fix, not worth a lone island.
  for (const z of ZONES) {
    for (const tierName of ['large', 'medium']) {
      if (placedSummary.some((p) => p.tier === tierName && inZone(z, p))) continue;
      shuffle(z.candidates.filter(onRowLine)).some(([x, y]) => placeKind(pickKind(tierName), tierName, x, y));
    }
  }

  return {
    floor,
    placements: placedSummary,
    lanes: aisles.map((a) => a.pts),
    rows: rows.map((row) => ({ y: row.y, gaps: row.gaps.map((g) => ({ x: g.x, width: g.halfWidth * 2 })) })),
    rowBlocks,
  };
}
