// ---------------------------------------------------------------------------
// Obstacles, collision, and vision-cone occlusion — ported verbatim (math
// only, no rendering) from the original Three.js game's main.js. Every
// obstacle is still an axis-aligned box { minX, maxX, minY, maxY } in the
// same flat list, used for movement collision, vision-cone occlusion, AND
// the connectivity check — exactly as before, just XZ renamed to XY.
// ---------------------------------------------------------------------------
import { PLAYER_RADIUS, WALK_GRID_CELL, WALK_GRID_BOUNDS, MIN_OBSTACLE_CLEARANCE } from './constants.js';

export const obstacles = []; // { minX, maxX, minY, maxY }

export function registerObstacle(cx, cy, sx, sy) {
  const o = { minX: cx - sx / 2, maxX: cx + sx / 2, minY: cy - sy / 2, maxY: cy + sy / 2 };
  obstacles.push(o);
  return o;
}

export function unregisterObstacle(o) {
  const idx = obstacles.indexOf(o);
  if (idx !== -1) obstacles.splice(idx, 1);
}

export function isWalkableCell(x, y, extraObstacles) {
  const r = PLAYER_RADIUS;
  for (const o of obstacles) {
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

export function hasClearance(obstacle) {
  for (const o of obstacles) {
    if (o === obstacle) continue;
    if (boxGap(obstacle, o) < MIN_OBSTACLE_CLEARANCE) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Collision — movers are circles of radius `r`. Push-out always happens
// along whichever axis needs the SMALLER correction, done once after the X
// move and again after the Y move, giving wall-sliding.
// ---------------------------------------------------------------------------
export function resolveObstacle(pos, r, o) {
  const minX = o.minX - r;
  const maxX = o.maxX + r;
  const minY = o.minY - r;
  const maxY = o.maxY + r;
  if (pos.x <= minX || pos.x >= maxX || pos.y <= minY || pos.y >= maxY) return; // no overlap
  const pushLeft = pos.x - minX;
  const pushRight = maxX - pos.x;
  const pushUp = pos.y - minY;
  const pushDown = maxY - pos.y;
  const xPush = Math.min(pushLeft, pushRight);
  const yPush = Math.min(pushUp, pushDown);
  if (xPush < yPush) {
    pos.x = pushLeft < pushRight ? minX : maxX;
  } else {
    pos.y = pushUp < pushDown ? minY : maxY;
  }
}

export function resolveCollisions(pos, r) {
  for (const o of obstacles) resolveObstacle(pos, r, o);
}

export function moveWithCollision(pos, dx, dy, r) {
  pos.x += dx;
  resolveCollisions(pos, r);
  pos.y += dy;
  resolveCollisions(pos, r);
}

// ---------------------------------------------------------------------------
// Ray/segment occlusion — cuts the drawn vision cone off at obstacles and
// decides whether an NPC can actually SEE a point through one.
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
  for (const o of obstacles) {
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

// Places any obstacle (builder returns {gameObjects, obstacle}), then checks
// that it has real clearance from every wall/obstacle already placed and
// that the spawn->puppy route still exists. If either fails, the placement
// is undone (game objects destroyed, obstacle entry removed) and a warning
// is logged — same belt-and-suspenders safety net as the original game.
export function placeObstacleSafe(builder, spawnX, spawnY, goalX, goalY, cx, cy, ...args) {
  const { gameObjects, obstacle } = builder(cx, cy, ...args);
  const clearanceOk = hasClearance(obstacle);
  const routeOk = pathExists(spawnX, spawnY, goalX, goalY);
  if (!clearanceOk || !routeOk) {
    for (const go of gameObjects) go.destroy();
    unregisterObstacle(obstacle);
    console.warn(
      `[level] obstacle at (${cx}, ${cy}) skipped — ${!clearanceOk ? 'too close to a wall/obstacle' : 'would seal the only route'}.`
    );
    return false;
  }
  return true;
}
