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
// 2. The obstacle course is a seeded-random SCATTER across the entire floor
//    (all 5 columns west-to-east, including dead center — not just the two
//    side walls), in three real size tiers from barrels and utility boxes up
//    to vans, generators and scrap bins several times their size, plus real
//    gaps and occasional 2-object clumps so it
//    reads as organic rather than a solid grid or a mirrored pattern. Every
//    placement still goes through the same placeObstacleSafe net —
//    MIN_OBSTACLE_CLEARANCE is unchanged and applies regardless of an
//    object's size, and any placement that would seal the only spawn->puppy
//    route is rejected automatically. See buildLevel()'s scatter loop.
// ---------------------------------------------------------------------------
import { TILE_SIZE, FLOOR_X, FLOOR_Y, WALL_THICKNESS, PLAYER_SPAWN, PUPPY_SPAWN } from './constants.js';
import { registerObstacle, registerSightObstacle, registerWalkObstacle, placeObstacleSafe } from './obstacles.js';

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
  const addLamp = (cx, cy) => {
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
}

// Per-texture SIGHT silhouettes (vision-cone occlusion only), as { dx, dy,
// w, h } fractions of the display size: dx/dy is the box center's offset
// from the prop's center, w/h the box size. Only needed for textures whose
// crop has transparent padding or a notched shape; every alpha-trimmed crop
// not listed here (all vehicles, scrap, machinery, kiosks, the re-cropped
// car_top_*) uses the full display rect, which IS its tight bounding box.
// Walk collision does not use this table — see deriveWalkFootprint.
const HITBOXES = {
  prop_barrel: [{ dx: 0, dy: 0.156, w: 0.875, h: 0.625 }],
  prop_dumpster: [
    { dx: 0, dy: 0.25, w: 1.0, h: 0.5 }, // low, full-width base
    { dx: -0.25, dy: -0.25, w: 0.5, h: 0.5 }, // taller unit over the left half
  ],
  prop_barrel2: [{ dx: 0, dy: 0.156, w: 0.875, h: 0.625 }], // identical silhouette to prop_barrel, recolored
  prop_barrel_fire: [{ dx: 0, dy: 0.156, w: 0.875, h: 0.625 }], // same barrel body; the flame above it isn't solid
  // A shelf-backing band (top) with a separate cluster of stacked stock
  // sitting in front of its lower-right — genuinely two disconnected
  // regions (confirmed via alpha dump), not a solid rectangle.
  prop_shelf_stocked: [
    { dx: 0, dy: -0.297, w: 0.8125, h: 0.4063 },
    { dx: 0.3438, dy: 0.1406, w: 0.1875, h: 0.2188 },
    { dx: 0.1563, dy: 0.375, w: 0.1875, h: 0.1875 },
  ],
  // Two leaning cones — a real triangular silhouette, not a rectangle.
  prop_cone_pair: [
    { dx: -0.0469, dy: 0.0313, w: 0.3438, h: 0.5 },
    { dx: 0.2188, dy: -0.0938, w: 0.1875, h: 0.3125 },
    { dx: -0.2969, dy: -0.1563, w: 0.1563, h: 0.3125 },
    { dx: -0.2188, dy: -0.375, w: 0.125, h: 0.125 },
  ],
  // Lamp head + a base, joined by a pole far thinner than either — a single
  // bbox would cover the wide-open air on both sides of that thin pole.
  prop_streetlight: [
    { dx: 0, dy: 0.0652, w: 0.25, h: 0.8696 }, // the pole itself (full height)
    { dx: -0.2188, dy: -0.3043, w: 0.1875, h: 0.13 }, // lamp head, left half
    { dx: 0.2188, dy: -0.3043, w: 0.1875, h: 0.13 }, // lamp head, right half
    { dx: -0.1875, dy: 0.3913, w: 0.125, h: 0.1739 }, // base
  ],
  prop_vending: [{ dx: 0.125, dy: 0, w: 0.75, h: 1.0 }], // solid cabinet, near-full bbox
  // Rim + body with a real gap between them (the narrower "neck" reads as
  // empty on the alpha channel, not just a shading line).
  prop_dumpster_round_red: [
    { dx: 0, dy: 0.3438, w: 0.75, h: 0.3125 },
    { dx: 0, dy: -0.3906, w: 0.625, h: 0.2188 },
    { dx: 0, dy: 0.1563, w: 0.375, h: 0.0625 },
    { dx: -0.375, dy: -0.4375, w: 0.125, h: 0.125 },
  ],
  prop_dumpster_round_blue: [
    { dx: 0, dy: 0.3438, w: 0.75, h: 0.3125 },
    { dx: 0, dy: -0.3906, w: 0.625, h: 0.2188 },
    { dx: 0, dy: 0.1563, w: 0.375, h: 0.0625 },
    { dx: -0.375, dy: -0.4375, w: 0.125, h: 0.125 },
  ],
};
const FULL_RECT_HITBOX = [{ dx: 0, dy: 0, w: 1, h: 1 }];

// Textures drawn straight top-down: the whole silhouette IS the floor
// footprint. Everything else in this tileset is 3/4 view (front face + top),
// where only the bottom of the silhouette touches the floor.
const TOP_DOWN_TEXTURES = new Set(['car_top_1', 'car_top_2', 'car_top_3', 'car_top_4', 'car_top_teal', 'car_top_red']);

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
  const ctx = canvas.getContext('2d');
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
// History: this used to be derived from the hand-audited HITBOXES, which can
// be off by a texel or more (prop_dumpster_round_* were 2px narrow), and one
// version added full-height side strips that walled off the top of narrow
// objects. The padding bug itself was on the character side — see
// constants.js#FEET_HALF_W.
function deriveWalkFootprint(scene, textureKey, cx, cy, sx, sy) {
  const m = textureMask(scene, textureKey);
  const tw = sx / m.w;
  const th = sy / m.h;
  const left = cx - sx / 2;
  const top = cy - sy / 2;
  let bandTop = m.top;
  let solid = m.solid;
  if (!TOP_DOWN_TEXTURES.has(textureKey)) {
    const artH = (m.bottom + 1 - m.top) * th;
    const artW = (m.right + 1 - m.left) * tw;
    const depth = BASE_DEPTH_PER_SIZE * Math.min(artW, artH);
    bandTop = Math.max(m.top, m.bottom + 1 - Math.max(1, Math.round(depth / th)));
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
  const boxes = [];
  let open = new Map(); // "c0,c1" -> box still growing downward
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
        const b = open.get(run);
        b.maxY = top + (y + 1) * th;
        next.set(run, b);
      } else {
        const [c0, c1] = run.split(',').map(Number);
        next.set(run, { minX: left + c0 * tw, maxX: left + c1 * tw, minY: top + y * th, maxY: top + (y + 1) * th });
      }
    }
    for (const [run, b] of open) if (!next.has(run)) boxes.push(b);
    open = next;
  }
  return { boxes, baseY: top + (m.bottom + 1) * th };
}

// Shared builder for every prop. The HITBOXES silhouette becomes SIGHT
// obstacles (vision-cone occlusion); the alpha-derived base footprint
// becomes WALK obstacles. Depth sorts on the silhouette's real bottom edge — the same
// line the feet stop at from the front — not the display rect's bottom,
// which sits below the art for textures with transparent bottom padding and
// made a player standing in front draw behind.
function propBuilder(scene, textureKey, tint) {
  const hitboxes = HITBOXES[textureKey] || FULL_RECT_HITBOX;
  const builderFn = (cx, cy, sx, sy) => {
    const footprint = deriveWalkFootprint(scene, textureKey, cx, cy, sx, sy);
    const img = scene.add.image(px(cx), px(cy), textureKey);
    img.setDisplaySize(px(sx), px(sy));
    if (tint != null) img.setTint(tint);
    img.setDepth(px(footprint.baseY));
    img.setPipeline('Light2D');
    const sightObs = hitboxes.map(({ dx, dy, w, h }) =>
      registerSightObstacle(cx + dx * sx, cy + dy * sy, w * sx, h * sy)
    );
    const walkObs = footprint.boxes.map((b) =>
      registerWalkObstacle((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, b.maxX - b.minX, b.maxY - b.minY)
    );
    return { gameObjects: [img], walkObstacles: walkObs, sightObstacles: sightObs };
  };
  builderFn.textureKey = textureKey; // read back by buildLevel's placedSummary tracking below
  return builderFn;
}

export function buildLevel(scene) {
  const spawn = [PLAYER_SPAWN.x, PLAYER_SPAWN.y];
  const goal = [PUPPY_SPAWN.x, PUPPY_SPAWN.y];
  // Every successful placement is logged here (position/size/texture) so
  // buildLevel can audit its OWN output afterward (see the guaranteed
  // near-puppy coverage pass) instead of just hoping the random scatter
  // came out reasonably distributed.
  const placedSummary = [];
  const place = (builder, cx, cy, ...args) => {
    const ok = placeObstacleSafe(builder, spawn[0], spawn[1], goal[0], goal[1], cx, cy, ...args);
    if (ok) placedSummary.push({ cx, cy, sx: args[0], sy: args[1], tex: builder.textureKey });
    return ok;
  };

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

  // Wall-mounted light fixtures — see buildWallLamps above. scene.lights is
  // already enabled by GameScene#setupLighting, which runs before buildLevel.
  buildWallLamps(scene, (x, y, radius, color, intensity) => scene.lights.addLight(px(x), px(y), radius, color, intensity));

  // --- Obstacle course — scattered across the whole floor ----------------
  // Three REAL size tiers, every texture drawn at its native aspect ratio and
  // scaled uniformly inside its range (display tiles, 1 tile = 16px):
  //  - SMALL  ~0.8-1.5 tiles: barrels, tire stacks, utility boxes, arcade
  //    kiosks, cone pairs, PA speakers.
  //  - MEDIUM ~1.7-3 tiles: scrap tire piles, AC units, satellite dishes,
  //    top-down cars, vending machines, streetlights.
  //  - LARGE  ~3-4.5 tiles (3-5x the smallest): side-on vans and hover cars,
  //    generators, scrap bins, and exactly L_BOX_COUNT L-shaped boxes.
  // All crops come from the purchased RCCv2STREETStileset sheets; see
  // asset-sources/cropped/. The L-shaped box used to fill every crate,
  // shelf, rack and machinery slot (16 of ~50 props) — it is now one large
  // option among several, hard-capped.
  const CRATE_TINTS = [0xa5372e, 0x2e9e8f, 0x35659e, 0x7a4aa8];
  const lBoxBuilders = CRATE_TINTS.map((t) => propBuilder(scene, 'prop_dumpster', t));
  const L_BOX = { key: 'prop_dumpster', scale: [1.5, 1.9], lBox: true };
  const L_BOX_COUNT = 3;

  const kind = (key, scale, weight = 1) => ({ key, scale, weight, build: propBuilder(scene, key, null) });
  const SMALL = [
    kind('prop_barrel', [0.75, 0.9]),
    kind('prop_barrel2', [0.75, 0.9]),
    kind('prop_barrel_fire', [0.75, 0.9]),
    kind('scrap_tire_stack', [1.0, 1.2], 1.5),
    kind('utility_box', [1.0, 1.3], 1.5),
    kind('arcade_kiosk_purple', [1.0, 1.15]),
    kind('arcade_kiosk_blue', [1.0, 1.15]),
    kind('prop_cone_pair', [0.6, 0.72]),
    kind('pa_speaker', [0.85, 1.0]),
  ];
  const MEDIUM = [
    kind('scrap_tire_pile', [1.25, 1.5], 2),
    kind('machine_ac_unit', [1.2, 1.4], 1.5),
    kind('satellite_dish', [1.2, 1.4], 1.5),
    kind('car_top_1', [0.95, 1.1]),
    kind('car_top_2', [0.95, 1.1]),
    kind('car_top_3', [0.95, 1.1]),
    kind('car_top_4', [0.95, 1.1]),
    kind('car_top_teal', [0.95, 1.1]),
    kind('car_top_red', [0.95, 1.1]),
    kind('prop_vending', [0.9, 1.1]),
    kind('prop_streetlight', [0.9, 1.0], 0.5),
    kind('prop_shelf_stocked', [0.9, 1.1], 0.5),
    kind('prop_dumpster_round_red', [1.0, 1.2], 0.5),
    kind('prop_dumpster_round_blue', [1.0, 1.2], 0.5),
  ];
  const LARGE = [
    kind('vehicle_van_blue', [1.0, 1.2], 1.5),
    kind('vehicle_van_red', [1.0, 1.2], 1.5),
    kind('vehicle_hover_teal', [1.0, 1.15]),
    kind('vehicle_coupe_dark', [1.0, 1.15]),
    kind('machine_generator', [1.6, 1.9], 1.5),
    kind('scrap_bin', [1.6, 1.9], 1.5),
  ];
  const TIERS = { small: SMALL, medium: MEDIUM, large: LARGE };

  const SPAWN_CLEAR_R = 9; // keep the player's start position clear of clutter
  const GOAL_CLEAR_R = 8; // keep the puppy's corner clear so pickup stays easy
  const clearOfSpawnAndGoal = (x, y) =>
    Math.hypot(x - spawn[0], y - spawn[1]) >= SPAWN_CLEAR_R && Math.hypot(x - goal[0], y - goal[1]) >= GOAL_CLEAR_R;

  // Deterministic PRNG (stable across loads/resets) drives the scatter.
  const scatterRand = mulberry32(20260911);
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(scatterRand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // A type's weight drops sharply with every copy already placed, so no one
  // texture can become the dominant repeat (what happened with the L-box).
  const placedCounts = new Map();
  function pickKind(tierName) {
    const list = TIERS[tierName];
    const weightOf = (k) => k.weight / (1 + 2 * (placedCounts.get(k.key) || 0));
    const total = list.reduce((sum, k) => sum + weightOf(k), 0);
    let r = scatterRand() * total;
    for (const k of list) {
      r -= weightOf(k);
      if (r <= 0) return k;
    }
    return list[list.length - 1];
  }

  function placeKind(k, tierName, cx, cy) {
    const src = scene.textures.get(k.key).getSourceImage();
    const s = k.scale[0] + scatterRand() * (k.scale[1] - k.scale[0]);
    const builder = k.lBox ? lBoxBuilders[Math.floor(scatterRand() * lBoxBuilders.length)] : k.build;
    const ok = place(builder, cx, cy, (src.width / TILE_SIZE) * s, (src.height / TILE_SIZE) * s);
    if (ok) {
      placedSummary[placedSummary.length - 1].tier = tierName;
      placedCounts.set(k.key, (placedCounts.get(k.key) || 0) + 1);
    }
    return ok;
  }

  // Big footprints fail the clearance check far more often (especially near
  // a wall), so a rolled tier gets a few nearby spots — nudged toward the
  // map's center first — before the cell falls back to the next smaller tier.
  // Without this the large tier was mostly rejected and density dropped.
  const FALLBACK = { large: 'medium', medium: 'small', small: null };
  function scatterCell(cx, cy) {
    const roll = scatterRand();
    let tierName = roll < 0.38 ? 'small' : roll < 0.72 ? 'medium' : 'large';
    const inward = cx < 0 ? 1 : -1;
    const spots = [[0, 0], [inward * 1.5, 0], [0, 1.5], [0, -1.5], [inward * 3, 0]];
    while (tierName) {
      for (const [dx, dy] of spots) {
        if (!clearOfSpawnAndGoal(cx + dx, cy + dy)) continue;
        if (placeKind(pickKind(tierName), tierName, cx + dx, cy + dy)) return;
      }
      tierName = FALLBACK[tierName];
    }
  }

  // Columns pulled in from the wall face and jitter tightened — big
  // footprints need real clearance from the wall behind them.
  const SCATTER_COLS = [-9.5, -4.75, 0, 4.75, 9.5];
  const SCATTER_ROWS = [29, 22, 15, 8, 1, -6, -13, -20, -27, -34];
  const CELL_JITTER_X = 1.6;
  const CELL_JITTER_Y = 1.8;
  // Per-column phase offset on every row baseline (brick-laying stagger) so
  // no two columns share a row height and nothing reads as an even line.
  const ROW_STAGGER = 2.2;
  const SKIP_CHANCE = 0.28; // real gaps, not a solid grid of objects
  const CLUSTER_CHANCE = 0.3; // occasional 2nd object near the first — organic clumping

  SCATTER_ROWS.forEach((cy0) => {
    SCATTER_COLS.forEach((cx0, colIdx) => {
      if (scatterRand() < SKIP_CHANCE) return;
      const staggeredCy0 = cy0 + (colIdx - (SCATTER_COLS.length - 1) / 2) * ROW_STAGGER;
      const cx = cx0 + (scatterRand() - 0.5) * 2 * CELL_JITTER_X;
      const cy = staggeredCy0 + (scatterRand() - 0.5) * 2 * CELL_JITTER_Y;
      if (!clearOfSpawnAndGoal(cx, cy)) return;
      scatterCell(cx, cy);
      if (scatterRand() < CLUSTER_CHANCE) {
        const ang = scatterRand() * Math.PI * 2;
        const dist = 2.6 + scatterRand() * 1.6;
        const ncx = cx + Math.cos(ang) * dist;
        const ncy = cy + Math.sin(ang) * dist;
        if (clearOfSpawnAndGoal(ncx, ncy)) scatterCell(ncx, ncy);
      }
    });
  });

  // --- Guaranteed size spread ---------------------------------------------
  // A random tier roll per cell can still cluster all the big pieces in one
  // part of the map. Audit what actually got placed in each of 6 zones
  // (north/middle/south x west/east) and top up any zone missing a small,
  // medium or large object from a shuffled candidate grid inside that zone.
  const ZONES = [];
  for (const [y0, y1, rowName] of [[FLOOR_Y[0], -14, 'north'], [-14, 10, 'middle'], [10, FLOOR_Y[1], 'south']]) {
    for (const [x0, x1, colName] of [[FLOOR_X[0], 0, 'west'], [0, FLOOR_X[1], 'east']]) {
      const candidates = [];
      for (let x = x0 + 2.5; x <= x1 - 2.5; x += 1.5) {
        for (let y = y0 + 2.5; y <= y1 - 2.5; y += 1.5) {
          if (clearOfSpawnAndGoal(x, y)) candidates.push([x, y]);
        }
      }
      ZONES.push({ name: `${rowName}-${colName}`, x0, x1, y0, y1, candidates });
    }
  }
  const inZone = (z, p) => p.cx >= z.x0 && p.cx < z.x1 && p.cy >= z.y0 && p.cy < z.y1;

  // Exactly L_BOX_COUNT L-shaped boxes, each in a different zone.
  let lBoxes = 0;
  for (const z of shuffle(ZONES.slice())) {
    if (lBoxes === L_BOX_COUNT) break;
    if (shuffle(z.candidates.slice()).some(([x, y]) => placeKind(L_BOX, 'large', x, y))) lBoxes++;
  }
  if (lBoxes < L_BOX_COUNT) console.warn(`[level] only ${lBoxes}/${L_BOX_COUNT} L-shaped boxes found a clear spot.`);

  // Earlier feedback: the corridor just below the puppy's spotlight kept
  // ending up with only small props even when the north zones had large
  // ones farther out. Each side needs a large object within NEAR_PUPPY_R.
  const NEAR_PUPPY_R = 20;
  for (const side of [-1, 1]) {
    const nearLarge = (p) =>
      p.tier === 'large' && Math.hypot(p.cx - goal[0], p.cy - goal[1]) < NEAR_PUPPY_R && (side < 0 ? p.cx < 0 : p.cx >= 0);
    if (placedSummary.some(nearLarge)) continue;
    const candidates = [];
    for (const x of [2, 3.5, 5, 6.5, 8, 9.5, 11]) {
      for (let y = -17; y >= -37; y -= 2) {
        const d = Math.hypot(x * side - goal[0], y - goal[1]);
        if (d >= GOAL_CLEAR_R && d < NEAR_PUPPY_R) candidates.push([x * side, y]);
      }
    }
    if (!shuffle(candidates).some(([x, y]) => placeKind(pickKind('large'), 'large', x, y))) {
      console.warn(`[level] no clear spot for a large object near the puppy (${side < 0 ? 'west' : 'east'} side).`);
    }
  }

  for (const z of ZONES) {
    for (const tierName of ['large', 'medium', 'small']) {
      if (placedSummary.some((p) => p.tier === tierName && inZone(z, p))) continue;
      if (!shuffle(z.candidates.slice()).some(([x, y]) => placeKind(pickKind(tierName), tierName, x, y))) {
        console.warn(`[level] no clear spot for a ${tierName} object in the ${z.name} zone.`);
      }
    }
  }

  return { floor };
}
