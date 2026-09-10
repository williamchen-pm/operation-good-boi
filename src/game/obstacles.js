// ---------------------------------------------------------------------------
// Obstacles, collision, and vision-cone occlusion — ported (math only, no
// rendering) from the original Three.js game's main.js, XZ renamed to XY.
//
// TWO separate box lists, not one:
//  - `sightObstacles` — each prop's full visual silhouette (the carefully
//    alpha-audited multi-box HITBOXES from level.js). Used ONLY for vision-
//    cone occlusion and the guards' line-of-sight check: a guard's cone
//    should be blocked by an object's whole visible body, exactly as before.
//  - `walkObstacles` — a small FOOTPRINT near each object's own visual base
//    (its front-facing bottom edge, where it actually "sits" on the floor).
//    Used for movement collision, the spawn->goal connectivity check, and
//    the placement-spacing check. This is what makes collision feet-based
//    on the OBJECT's side of the interaction (see player.js/npc.js for the
//    CHARACTER's side — feet-anchored sprite origin): a tall object's
//    footprint no longer spans its full height, so a character approaching
//    from ANY direction (front, behind, either side) can get their own feet
//    close to the object's real base, instead of stopping far short when
//    approaching from behind a tall silhouette.
// Splitting these was necessary, not optional: before this, both concerns
// shared one list, so shrinking it for collision would have also shrunk
// what a guard's cone could see past — walls are the one exception (a wall
// has no "tall visual overhang" distinct from its own thickness, so its box
// goes in both lists unchanged; see registerObstacle()).
// ---------------------------------------------------------------------------
import { PLAYER_RADIUS, FEET_HALF_W, FEET_DEPTH, WALK_GRID_CELL, WALK_GRID_BOUNDS, MIN_OBSTACLE_CLEARANCE } from './constants.js';

export const sightObstacles = []; // { minX, maxX, minY, maxY } — full silhouettes
export const walkObstacles = []; // { minX, maxX, minY, maxY } — base footprints only

function makeBox(cx, cy, sx, sy) {
  return { minX: cx - sx / 2, maxX: cx + sx / 2, minY: cy - sy / 2, maxY: cy + sy / 2 };
}

export function registerSightObstacle(cx, cy, sx, sy) {
  const o = makeBox(cx, cy, sx, sy);
  sightObstacles.push(o);
  return o;
}

export function registerWalkObstacle(cx, cy, sx, sy) {
  const o = makeBox(cx, cy, sx, sy);
  walkObstacles.push(o);
  return o;
}

// Walls (and anything else whose footprint IS its full silhouette) block
// sight and movement identically — one box, registered into both lists.
export function registerObstacle(cx, cy, sx, sy) {
  const o = makeBox(cx, cy, sx, sy);
  sightObstacles.push(o);
  walkObstacles.push(o);
  return o;
}

export function unregisterObstacle(o) {
  let idx = sightObstacles.indexOf(o);
  if (idx !== -1) sightObstacles.splice(idx, 1);
  idx = walkObstacles.indexOf(o);
  if (idx !== -1) walkObstacles.splice(idx, 1);
}

export function isWalkableCell(x, y, extraObstacles) {
  const r = PLAYER_RADIUS;
  for (const o of walkObstacles) {
    if (x > o.minX - r && x < o.maxX + r && y > o.minY - r && y < o.maxY + r) return false;
  }
  if (extraObstacles) {
    for (const o of extraObstacles) {
      if (x > o.minX - r && x < o.maxX + r && y > o.minY - r && y < o.maxY + r) return false;
    }
  }
  return true;
}

export function pathExists(fromX, fromY, toX, toY, extraObstacles) {
  const { minX, maxX, minY, maxY } = WALK_GRID_BOUNDS;
  const cols = Math.ceil((maxX - minX) / WALK_GRID_CELL);
  const rows = Math.ceil((maxY - minY) / WALK_GRID_CELL);
  const cellOf = (x, y) => ({
    c: Math.floor((x - minX) / WALK_GRID_CELL),
    r: Math.floor((y - minY) / WALK_GRID_CELL),
  });
  const cellCenter = (c, r) => ({ x: minX + (c + 0.5) * WALK_GRID_CELL, y: minY + (r + 0.5) * WALK_GRID_CELL });
  const inBounds = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;
  const walkable = (c, r) => {
    if (!inBounds(c, r)) return false;
    const { x, y } = cellCenter(c, r);
    return isWalkableCell(x, y, extraObstacles);
  };

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
  return Math.hypot(dx, dy);
}

// `ignore` (a Set) lets a multi-box object exclude its OWN sibling boxes
// (e.g. its sight silhouette boxes) from this check — only ever called on
// WALK (footprint) boxes now, checked against other objects' walk footprints,
// since clearance is fundamentally about guaranteed walkable space, not
// visual silhouette overlap (tall props are allowed to visually overlap
// neighbors above their footprint, same as they're allowed to overlap a
// character's head/shoulders).
export function hasClearance(obstacle, ignore) {
  for (const o of walkObstacles) {
    if (o === obstacle) continue;
    if (ignore && ignore.has(o)) continue;
    if (boxGap(obstacle, o) < MIN_OBSTACLE_CLEARANCE) return false;
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
// through on a long frame. Reads walkObstacles, not sightObstacles.
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
// decides whether an NPC can actually SEE a point through one. Reads
// sightObstacles (full silhouettes) — a guard's view is blocked by an
// object's whole visible body, not just its small floor footprint.
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
  for (const o of sightObstacles) {
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

// Places any obstacle (builder returns {gameObjects, walkObstacles,
// sightObstacles}), then checks that EVERY walk (footprint) box has real
// clearance from every other walk box already placed (ignoring its own
// sibling boxes) and that the spawn->puppy route still exists. If either
// fails, the placement is undone (game objects destroyed, every obstacle
// entry — walk AND sight — removed) and a warning is logged — same
// belt-and-suspenders safety net as the original game.
export function placeObstacleSafe(builder, spawnX, spawnY, goalX, goalY, cx, cy, ...args) {
  const { gameObjects, walkObstacles: walkObs, sightObstacles: sightObs } = builder(cx, cy, ...args);
  const selfSet = new Set([...walkObs, ...sightObs]);
  const clearanceOk = walkObs.every((o) => hasClearance(o, selfSet));
  const routeOk = pathExists(spawnX, spawnY, goalX, goalY);
  if (!clearanceOk || !routeOk) {
    for (const go of gameObjects) go.destroy();
    for (const o of walkObs) unregisterObstacle(o);
    for (const o of sightObs) unregisterObstacle(o);
    console.warn(
      `[level] obstacle at (${cx}, ${cy}) skipped — ${!clearanceOk ? 'too close to a wall/obstacle' : 'would seal the only route'}.`
    );
    return false;
  }
  return true;
}
