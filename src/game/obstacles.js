// ---------------------------------------------------------------------------
// Obstacles, collision, and vision-cone occlusion — ported (math only, no
// rendering) from the original Three.js game's main.js, XZ renamed to XY.
//
// ONE box list, `walkObstacles`: each wall, plus each prop's floor footprint
// derived from its texture alpha (level.js#deriveWalkFootprint). Everything
// reads it — movement collision, the spawn->goal connectivity check, the
// placement-spacing check, AND vision-cone/line-of-sight occlusion — so a
// guard's cone is cut off at exactly the edge the player's feet stop at.
// (Occlusion used to read a separate, looser silhouette list, which left a
// visible gap between cones and objects.)
// ---------------------------------------------------------------------------
import { PLAYER_RADIUS, FEET_HALF_W, FEET_DEPTH, WALK_GRID_CELL, WALK_GRID_BOUNDS, MIN_OBSTACLE_CLEARANCE } from './constants.js';

export const walkObstacles = []; // { minX, maxX, minY, maxY }

function makeBox(cx, cy, sx, sy) {
  return { minX: cx - sx / 2, maxX: cx + sx / 2, minY: cy - sy / 2, maxY: cy + sy / 2 };
}

export function registerWalkObstacle(cx, cy, sx, sy) {
  const o = makeBox(cx, cy, sx, sy);
  walkObstacles.push(o);
  return o;
}

export function unregisterObstacle(o) {
  const idx = walkObstacles.indexOf(o);
  if (idx !== -1) walkObstacles.splice(idx, 1);
}

export function pathExists(fromX, fromY, toX, toY, extraObstacles) {
  const { minX, maxX, minY, maxY } = WALK_GRID_BOUNDS;
  const cols = Math.ceil((maxX - minX) / WALK_GRID_CELL);
  const rows = Math.ceil((maxY - minY) / WALK_GRID_CELL);
  const cellOf = (x, y) => ({
    c: Math.floor((x - minX) / WALK_GRID_CELL),
    r: Math.floor((y - minY) / WALK_GRID_CELL),
  });
  const inBounds = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;
  // A cell is blocked when its center is strictly inside some box grown by
  // PLAYER_RADIUS. Mark blocked cells once per box instead of testing
  // every box for every visited cell — level generation runs this for each
  // candidate placement, and the per-cell version took seconds at load.
  const blocked = new Uint8Array(cols * rows);
  const r0 = PLAYER_RADIUS;
  const markBox = (o) => {
    const cMin = Math.max(0, Math.floor((o.minX - r0 - minX) / WALK_GRID_CELL - 0.5));
    const cMax = Math.min(cols - 1, Math.ceil((o.maxX + r0 - minX) / WALK_GRID_CELL - 0.5));
    const rMin = Math.max(0, Math.floor((o.minY - r0 - minY) / WALK_GRID_CELL - 0.5));
    const rMax = Math.min(rows - 1, Math.ceil((o.maxY + r0 - minY) / WALK_GRID_CELL - 0.5));
    for (let r = rMin; r <= rMax; r++) {
      const y = minY + (r + 0.5) * WALK_GRID_CELL;
      if (!(y > o.minY - r0 && y < o.maxY + r0)) continue;
      for (let c = cMin; c <= cMax; c++) {
        const x = minX + (c + 0.5) * WALK_GRID_CELL;
        if (x > o.minX - r0 && x < o.maxX + r0) blocked[r * cols + c] = 1;
      }
    }
  };
  for (const o of walkObstacles) markBox(o);
  if (extraObstacles) for (const o of extraObstacles) markBox(o);
  const walkable = (c, r) => inBounds(c, r) && !blocked[r * cols + c];

  const start = cellOf(fromX, fromY);
  const goal = cellOf(toX, toY);
  if (!walkable(start.c, start.r) || !walkable(goal.c, goal.r)) return false;

  const visited = new Uint8Array(cols * rows);
  const key = (c, r) => r * cols + c;
  const queue = [start];
  visited[key(start.c, start.r)] = 1;
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    if (cur.c === goal.c && cur.r === goal.r) return true;
    const neighbors = [
      [cur.c + 1, cur.r],
      [cur.c - 1, cur.r],
      [cur.c, cur.r + 1],
      [cur.c, cur.r - 1],
    ];
    for (const [nc, nr] of neighbors) {
      const k = key(nc, nr);
      if (inBounds(nc, nr) && !visited[k] && walkable(nc, nr)) {
        visited[k] = 1;
        queue.push({ c: nc, r: nr });
      }
    }
  }
  return false;
}

// Shortest distance between two axis-aligned boxes (0 if they touch/overlap).
export function boxGap(a, b) {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.sqrt(dx * dx + dy * dy); // (Math.hypot is much slower, and this runs a lot during level generation)
}

// `ignore` (a Set) lets a multi-box object exclude its OWN sibling footprint
// boxes from this check. Clearance is about guaranteed walkable space, so
// tall props may still visually overlap neighbors above their footprint.
// `minGapFor(o)` is the required gap to existing box `o` (defaults to
// MIN_OBSTACLE_CLEARANCE for everything).
export function hasClearance(obstacle, ignore, minGapFor = () => MIN_OBSTACLE_CLEARANCE) {
  for (const o of walkObstacles) {
    if (o === obstacle) continue;
    if (ignore && ignore.has(o)) continue;
    if (boxGap(obstacle, o) < minGapFor(o)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Collision — the mover is a character's FEET box (see constants.js#FEET_*):
// pos is the feet anchor, the box spans x +/- FEET_HALF_W and y from
// pos.y - FEET_DEPTH to pos.y. So an obstacle blocks when the feet pixels
// themselves would overlap its footprint, with no extra padding. Each axis is
// resolved against the direction just moved on that axis (wall-sliding on the
// other), and movement is sub-stepped so thin footprints can't be tunneled
// through on a long frame.
// ---------------------------------------------------------------------------
const MAX_SUBSTEP = 0.1;

function feetBounds(o) {
  return {
    minX: o.minX - FEET_HALF_W,
    maxX: o.maxX + FEET_HALF_W,
    minY: o.minY,
    maxY: o.maxY + FEET_DEPTH,
  };
}

export function resolveObstacle(pos, o, axis, step) {
  const b = feetBounds(o);
  if (pos.x <= b.minX || pos.x >= b.maxX || pos.y <= b.minY || pos.y >= b.maxY) return;
  const slack = Math.abs(step) + 1e-6;
  if (axis === 'x' && step > 0 && pos.x - b.minX <= slack) { pos.x = b.minX; return; }
  if (axis === 'x' && step < 0 && b.maxX - pos.x <= slack) { pos.x = b.maxX; return; }
  if (axis === 'y' && step > 0 && pos.y - b.minY <= slack) { pos.y = b.minY; return; }
  if (axis === 'y' && step < 0 && b.maxY - pos.y <= slack) { pos.y = b.maxY; return; }
  // Already overlapping deeper than this step (spawned/teleported inside):
  // fall back to the nearest edge.
  const pushes = [
    [pos.x - b.minX, () => { pos.x = b.minX; }],
    [b.maxX - pos.x, () => { pos.x = b.maxX; }],
    [pos.y - b.minY, () => { pos.y = b.minY; }],
    [b.maxY - pos.y, () => { pos.y = b.maxY; }],
  ];
  pushes.sort((a, c) => a[0] - c[0]);
  pushes[0][1]();
}

export function moveWithCollision(pos, dx, dy) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_SUBSTEP));
  const sdx = dx / steps;
  const sdy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (sdx !== 0) {
      pos.x += sdx;
      for (const o of walkObstacles) resolveObstacle(pos, o, 'x', sdx);
    }
    if (sdy !== 0) {
      pos.y += sdy;
      for (const o of walkObstacles) resolveObstacle(pos, o, 'y', sdy);
    }
  }
}

// ---------------------------------------------------------------------------
// Ray/segment occlusion — cuts the drawn vision cone off at obstacles and
// decides whether an NPC can actually SEE a point through one. Reads the
// same walkObstacles boxes movement collides with (the cone is drawn on the
// floor, so it stops where the object meets the floor).
// ---------------------------------------------------------------------------
export function rayAABBEntry(ox, oy, dx, dy, o) {
  let tmin = -Infinity;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < o.minX || ox > o.maxX) return Infinity;
  } else {
    let t1 = (o.minX - ox) / dx;
    let t2 = (o.maxX - ox) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < o.minY || oy > o.maxY) return Infinity;
  } else {
    let t1 = (o.minY - oy) / dy;
    let t2 = (o.maxY - oy) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (tmin > tmax || tmax < 0) return Infinity;
  return Math.max(tmin, 0);
}

export function rayObstacleDistance(ox, oy, dirAngle, maxDist) {
  const dx = Math.cos(dirAngle);
  const dy = Math.sin(dirAngle);
  let best = maxDist;
  for (const o of walkObstacles) {
    const t = rayAABBEntry(ox, oy, dx, dy, o);
    if (t < best) best = t;
  }
  return best;
}

export function segmentBlocked(ox, oy, tx, ty) {
  const dx = tx - ox;
  const dy = ty - oy;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return false;
  const hit = rayObstacleDistance(ox, oy, Math.atan2(dy, dx), dist);
  return hit < dist - 0.02;
}

// Places any obstacle (builder returns {gameObjects, walkObstacles}), then
// checks that EVERY footprint box keeps its required gap (`minGapFor(o)`, see
// hasClearance) from every other box already placed (ignoring its own sibling
// boxes) and that the spawn->puppy route still exists. If either fails, the placement is undone (game objects
// destroyed, boxes removed) — same belt-and-suspenders safety net as the
// original game. Level generation tries many spots on purpose, so ordinary
// rejections are silent; the route check only runs once clearance passes.
export function placeObstacleSafe(builder, spawnX, spawnY, goalX, goalY, minGapFor) {
  const { gameObjects, walkObstacles: walkObs } = builder();
  const selfSet = new Set(walkObs);
  const ok = walkObs.every((o) => hasClearance(o, selfSet, minGapFor)) && pathExists(spawnX, spawnY, goalX, goalY);
  if (!ok) {
    for (const go of gameObjects) go.destroy();
    for (const o of walkObs) unregisterObstacle(o);
    return false;
  }
  return true;
}
