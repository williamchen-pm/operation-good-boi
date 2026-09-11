// ---------------------------------------------------------------------------
// NPCs — wandering guards with a vision cone. Ported from the original
// game's makeNpc/updateNpc/updateVisionCone/pickWanderTarget/spookApart/
// wall-hugging logic, math unchanged (XZ -> XY). The vision cone used to be
// a rebuilt-every-frame THREE.BufferGeometry triangle fan; here it's a
// rebuilt-every-frame Phaser Graphics triangle fan — same ray-cast shape.
// ---------------------------------------------------------------------------
import {
  TILE_SIZE, TURN_SPEED, VISION_RANGE, VISION_HALF_ANGLE, CONE_RAYS,
  WANDER_MIN_DIST, WANDER_MAX_DIST, WANDER_BOUNDS, PAUSE_MIN, PAUSE_MAX,
  OVERLAP_COOLDOWN, STUCK_GIVEUP, WALL_HUG_CHECK_DIST, WALL_HUG_FRACTION,
  WALL_HUG_SAMPLES, WALL_HUG_COOLDOWN, MIN_SPOOK_TURN,
  PLAYER_SPAWN, NPC_SPAWN_SAFE_RADIUS,
  START_GRACE_SECONDS, START_GRACE_EXCLUSION, START_GRACE_TARGET_BUFFER,
  NPC_SEPARATION_RADIUS, NPC_SEPARATION_WEIGHT, NPC_MIN_SPACING, NPC_RESPACE_COOLDOWN,
  WANDER_TARGET_CANDIDATES, FEET_HALF_W,
} from './constants.js';
import { moveWithCollision, rayObstacleDistance, segmentBlocked, walkObstacles } from './obstacles.js';
import { spriteExtents, clampToWorld } from './bounds.js';
import { approachAngle, headingToDir4, playAnimForDir } from './anim.js';

export const npcs = [];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function inWanderBounds(x, y) {
  return x >= WANDER_BOUNDS.minX && x <= WANDER_BOUNDS.maxX && y >= WANDER_BOUNDS.minY && y <= WANDER_BOUNDS.maxY;
}

// Hard rule (see constants.js#NPC_SPAWN_SAFE_RADIUS): if a requested spawn
// point is too close to the player's start, push it straight out along the
// player->point direction until it clears the safe radius, then keep it on
// the floor. This runs once per NPC at creation time and its result is
// stored as spawnX/spawnY, so every later resetNpc() reuses the same
// already-safe point automatically — the check can't be skipped by editing
// NPC_DEFS or by a level reset.
function enforceSpawnSafeZone(x, y) {
  const dx = x - PLAYER_SPAWN.x;
  const dy = y - PLAYER_SPAWN.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= NPC_SPAWN_SAFE_RADIUS) return { x, y };
  const angle = dist < 1e-6 ? -Math.PI / 2 : Math.atan2(dy, dx);
  const safeX = PLAYER_SPAWN.x + Math.cos(angle) * NPC_SPAWN_SAFE_RADIUS;
  const safeY = PLAYER_SPAWN.y + Math.sin(angle) * NPC_SPAWN_SAFE_RADIUS;
  return {
    x: clamp(safeX, WANDER_BOUNDS.minX, WANDER_BOUNDS.maxX),
    y: clamp(safeY, WANDER_BOUNDS.minY, WANDER_BOUNDS.maxY),
  };
}

// NPC_DEFS points are hand-spread over the map, but the level's storage rows
// can cover one. A guard spawns at the nearest point (searching outward in
// rings) that is open floor: no prop footprint within SPAWN_OPEN_CLEARANCE,
// inside the wander bounds, and still outside NPC_SPAWN_SAFE_RADIUS.
const SPAWN_OPEN_CLEARANCE = 1.2;
function spotIsOpen(x, y) {
  if (!inWanderBounds(x, y) || distToStart(x, y) < NPC_SPAWN_SAFE_RADIUS) return false;
  return walkObstacles.every(
    (o) => Math.hypot(Math.max(o.minX - x, 0, x - o.maxX), Math.max(o.minY - y, 0, y - o.maxY)) >= SPAWN_OPEN_CLEARANCE
  );
}
function nearestOpenSpot(x, y) {
  if (spotIsOpen(x, y)) return { x, y };
  for (let r = 0.5; r <= 10; r += 0.5) {
    const steps = Math.ceil((2 * Math.PI * r) / 0.5);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (spotIsOpen(px, py)) return { x: px, y: py };
    }
  }
  return { x, y };
}

// True when a guard could walk straight from (ox, oy) to (tx, ty): the path's
// center line and both feet edges miss every obstacle. Guards steer in
// straight lines, so a target behind a storage row just walks them into it.
function walkPathClear(ox, oy, tx, ty) {
  const len = Math.hypot(tx - ox, ty - oy);
  if (len < 1e-6) return true;
  const nx = (-(ty - oy) / len) * FEET_HALF_W;
  const ny = ((tx - ox) / len) * FEET_HALF_W;
  return [0, 1, -1].every((k) => !segmentBlocked(ox + nx * k, oy + ny * k, tx + nx * k, ty + ny * k));
}

// --- Start-area grace period (see constants.js#START_GRACE_*) -------------
// Counts active play time: GameScene starts it when the level is built or
// reset and advances it once per simulated frame, after guards have moved.
let startGraceRemaining = 0;
export function beginStartGrace() {
  startGraceRemaining = START_GRACE_SECONDS;
}
export function advanceStartGrace(dt) {
  startGraceRemaining = Math.max(0, startGraceRemaining - dt);
}
export function startGraceActive() {
  return startGraceRemaining > 0;
}
function distToStart(x, y) {
  return Math.hypot(x - PLAYER_SPAWN.x, y - PLAYER_SPAWN.y);
}
function targetAllowed(x, y) {
  return !startGraceActive() || distToStart(x, y) >= START_GRACE_EXCLUSION + START_GRACE_TARGET_BUFFER;
}
// Last resort for target pickers that found no allowed candidate: push the
// target straight out from the spawn point to the allowed distance.
function keepTargetOutOfStartArea(npc) {
  if (targetAllowed(npc.targetX, npc.targetY)) return;
  const r = START_GRACE_EXCLUSION + START_GRACE_TARGET_BUFFER;
  let ang = Math.atan2(npc.targetY - PLAYER_SPAWN.y, npc.targetX - PLAYER_SPAWN.x);
  if (!Number.isFinite(ang)) ang = -Math.PI / 2;
  npc.targetX = clamp(PLAYER_SPAWN.x + Math.cos(ang) * r, WANDER_BOUNDS.minX, WANDER_BOUNDS.maxX);
  npc.targetY = clamp(PLAYER_SPAWN.y + Math.sin(ang) * r, WANDER_BOUNDS.minY, WANDER_BOUNDS.maxY);
  if (!targetAllowed(npc.targetX, npc.targetY)) {
    // clamped back inside by the side walls: head north instead
    npc.targetX = clamp(npc.targetX, WANDER_BOUNDS.minX, WANDER_BOUNDS.maxX);
    npc.targetY = PLAYER_SPAWN.y - r;
  }
}

// Picks the wander destination (within the usual wander ring) that is
// farthest from every other guard and every other guard's destination, so
// guards keep spreading across the map instead of drifting together.
// Destinations the guard can walk to in a straight line win over ones behind
// an obstacle (it would only push into it and give up); if none is clear, the
// spread rule alone decides, as before.
export function pickWanderTarget(npc) {
  const ox = npc.sprite.x / TILE_SIZE;
  const oy = npc.sprite.y / TILE_SIZE;
  let best = null;
  for (let i = 0; i < WANDER_TARGET_CANDIDATES; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = WANDER_MIN_DIST + Math.random() * (WANDER_MAX_DIST - WANDER_MIN_DIST);
    const tx = clamp(ox + Math.cos(ang) * dist, WANDER_BOUNDS.minX, WANDER_BOUNDS.maxX);
    const ty = clamp(oy + Math.sin(ang) * dist, WANDER_BOUNDS.minY, WANDER_BOUNDS.maxY);
    if (!targetAllowed(tx, ty)) continue;
    let clearance = Infinity;
    for (const other of npcs) {
      if (other === npc) continue;
      clearance = Math.min(
        clearance,
        Math.hypot(tx - other.sprite.x / TILE_SIZE, ty - other.sprite.y / TILE_SIZE),
        Math.hypot(tx - other.targetX, ty - other.targetY)
      );
    }
    const clearPath = walkPathClear(ox, oy, tx, ty);
    if (!best || (clearPath && !best.clearPath) || (clearPath === best.clearPath && clearance > best.clearance)) {
      best = { tx, ty, clearance, clearPath };
    }
  }
  if (best) {
    npc.targetX = best.tx;
    npc.targetY = best.ty;
  } else {
    npc.targetX = ox;
    npc.targetY = oy - WANDER_MIN_DIST;
    keepTargetOutOfStartArea(npc);
  }
}

// Unit-ish vector pointing away from nearby guards (stronger the closer
// they are), plus the distance to the nearest one.
function separationFrom(npc, x, y) {
  let sx = 0;
  let sy = 0;
  let nearest = Infinity;
  for (const other of npcs) {
    if (other === npc) continue;
    const ex = x - other.sprite.x / TILE_SIZE;
    const ey = y - other.sprite.y / TILE_SIZE;
    const d = Math.hypot(ex, ey);
    nearest = Math.min(nearest, d);
    if (d < 1e-6 || d >= NPC_SEPARATION_RADIUS) continue;
    const w = (NPC_SEPARATION_RADIUS - d) / NPC_SEPARATION_RADIUS;
    sx += (ex / d) * w;
    sy += (ey / d) * w;
  }
  return { sx, sy, nearest };
}

// ---------------------------------------------------------------------------
// Darkness-aware guard/cone visibility — same principle already applied to
// the player (who simply never uses the Light2D pipeline, so ambient
// darkness can never touch them), extended to guards and their cones: both
// stay on the default pipeline too (so THIS logic, not the shader, is the
// one and only thing dimming them), but here we deliberately want them to
// read differently in lit vs. unlit spots, clamped to a floor that keeps
// them "harder to spot at a glance", never "invisible until it's too late".
// sampleLightLevel() re-derives, in plain JS, roughly what the Light2D
// shader would compute at a point (ambient + each in-range light's
// falloff*intensity) — it doesn't need to match the shader's exact curve,
// only to correlate well enough to tell "well inside a lit pool" apart from
// "out in the ambient-only dark", which is all this needs.
// ---------------------------------------------------------------------------
const DARK_LEVEL = 0.08; // ~= the ambient-only brightness floor (see GameScene#setupLighting)
const LIT_LEVEL = 0.5; // brightness at/beyond which something reads as "fully lit" — reached well before a light's exact center
const MIN_NPC_ALPHA = 0.5; // guard sprite's floor opacity in full dark — dim, never gone
const MIN_CONE_ALPHA = 0.13; // cone's floor opacity in full dark (lit-area alpha is 0.34)
const CONE_ALPHA_LIT = 0.34;

function sampleLightLevel(scene, x, y) {
  const lm = scene.lights;
  const amb = lm.ambientColor._rgb;
  let level = (amb[0] + amb[1] + amb[2]) / 3;
  for (const light of lm.lights) {
    const dx = x - light.x;
    const dy = y - light.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= light.radius) continue;
    const falloff = 1 - dist / light.radius;
    const c = light.color._rgb;
    const luma = (c[0] + c[1] + c[2]) / 3;
    level += falloff * light.intensity * luma;
  }
  return level;
}

function litVisibility(level) {
  return clamp((level - DARK_LEVEL) / (LIT_LEVEL - DARK_LEVEL), 0, 1);
}

export function updateVisionCone(npc) {
  const g = npc.cone;
  g.clear();
  const ox = npc.sprite.x / TILE_SIZE;
  const oy = npc.sprite.y / TILE_SIZE;
  const points = [];
  for (let i = 0; i <= CONE_RAYS; i++) {
    const theta = -VISION_HALF_ANGLE + (i / CONE_RAYS) * (2 * VISION_HALF_ANGLE);
    const dist = rayObstacleDistance(ox, oy, npc.heading + theta, VISION_RANGE);
    points.push({
      x: (ox + Math.cos(npc.heading + theta) * dist) * TILE_SIZE,
      y: (oy + Math.sin(npc.heading + theta) * dist) * TILE_SIZE,
    });
  }

  const t = litVisibility(sampleLightLevel(npc.sprite.scene, npc.sprite.x, npc.sprite.y));
  npc.sprite.setAlpha(MIN_NPC_ALPHA + (1 - MIN_NPC_ALPHA) * t);
  const coneAlpha = MIN_CONE_ALPHA + (CONE_ALPHA_LIT - MIN_CONE_ALPHA) * t;

  g.fillStyle(0xff5a4a, coneAlpha);
  g.beginPath();
  g.moveTo(npc.sprite.x, npc.sprite.y);
  for (const p of points) g.lineTo(p.x, p.y);
  g.closePath();
  g.fillPath();
}

export function makeNpc(scene, textureKey, x, y, speed) {
  const pushed = enforceSpawnSafeZone(x, y);
  const safe = nearestOpenSpot(pushed.x, pushed.y);
  const sprite = scene.add.sprite(safe.x * TILE_SIZE, safe.y * TILE_SIZE, textureKey, 1);
  // Feet-based anchor, same convention/rationale as player.js#createPlayer —
  // confirmed every guard texture's feet touch the same bottom pixel row on
  // every frame, so one fixed origin covers all of them. This is what
  // makes the guard's obstacle collision (the shared measured FEET box) sit at
  // their feet instead of their torso, and its depth sort (setDepth(sprite.y)
  // below) key off feet-Y like every prop's own base-Y.
  sprite.setOrigin(0.5, 1);
  sprite.setTint(0xffb0a8); // faint red-ish tint so guards read as distinct from the player at a glance
  const cone = scene.add.graphics();
  cone.setDepth(-500); // always beneath every character sprite, above the floor

  const startHeading = Math.random() * Math.PI * 2;
  const npc = {
    sprite,
    cone,
    textureKey,
    worldExtents: spriteExtents(scene, textureKey),
    speed,
    spawnX: safe.x,
    spawnY: safe.y,
    heading: startHeading,
    desiredHeading: startHeading,
    state: 'walk',
    timer: 0,
    stuckTime: 0,
    overlapCooldown: 0,
    wallHugCooldown: 0,
    respaceCooldown: 0,
    targetX: safe.x,
    targetY: safe.y,
  };
  playAnimForDir(sprite, textureKey, headingToDir4(startHeading), false);
  pickWanderTarget(npc);
  updateVisionCone(npc);
  npcs.push(npc);
  return npc;
}

export function updateNpc(npc, dt) {
  const textureKey = npc.textureKey;
  if (npc.overlapCooldown > 0) npc.overlapCooldown -= dt;
  if (npc.wallHugCooldown > 0) npc.wallHugCooldown -= dt;
  if (npc.respaceCooldown > 0) npc.respaceCooldown -= dt;

  const curX = npc.sprite.x / TILE_SIZE;
  const curY = npc.sprite.y / TILE_SIZE;
  const sep = separationFrom(npc, curX, curY);
  if (sep.nearest < NPC_MIN_SPACING && npc.respaceCooldown <= 0) {
    pickWanderTarget(npc);
    npc.state = 'walk';
    npc.respaceCooldown = NPC_RESPACE_COOLDOWN;
  }

  let moving = false;
  if (npc.state === 'pause') {
    npc.timer -= dt;
    if (npc.timer <= 0) {
      pickWanderTarget(npc);
      npc.state = 'walk';
    }
  } else {
    const dx = npc.targetX - curX;
    const dy = npc.targetY - curY;
    const d = Math.hypot(dx, dy);
    if (d < 0.25) {
      npc.state = 'pause';
      npc.timer = PAUSE_MIN + Math.random() * (PAUSE_MAX - PAUSE_MIN);
      npc.stuckTime = 0;
    } else {
      npc.desiredHeading = Math.atan2(dy / d + NPC_SEPARATION_WEIGHT * sep.sy, dx / d + NPC_SEPARATION_WEIGHT * sep.sx);
      const align = Math.cos(npc.heading - npc.desiredHeading);
      let mx = Math.cos(npc.heading);
      let my = Math.sin(npc.heading);
      if (d < 1.5) {
        mx = dx / d;
        my = dy / d;
      }
      const speedFactor = clamp(0.3 + 0.7 * align, 0.15, 1);
      const stepDist = npc.speed * speedFactor * dt;
      const pos = { x: curX, y: curY };
      moveWithCollision(pos, mx * stepDist, my * stepDist);
      clampToWorld(pos, npc.worldExtents);
      // Grace period hard rule: whatever chose this step (wander, spreading
      // out, cone-overlap spooking, wall-hug turns), a guard may not move
      // closer to the start area while it's inside the exclusion distance.
      if (
        startGraceActive() &&
        distToStart(pos.x, pos.y) < START_GRACE_EXCLUSION &&
        distToStart(pos.x, pos.y) < distToStart(curX, curY)
      ) {
        pos.x = curX;
        pos.y = curY;
        pickWanderTarget(npc);
      }
      npc.sprite.x = pos.x * TILE_SIZE;
      npc.sprite.y = pos.y * TILE_SIZE;
      const moved = Math.hypot(pos.x - curX, pos.y - curY);
      moving = moved > 1e-5;
      if (stepDist > 1e-6 && moved < stepDist * 0.2) {
        npc.stuckTime += dt;
        if (npc.stuckTime > STUCK_GIVEUP) {
          pickWanderTarget(npc);
          npc.stuckTime = 0;
        }
      } else {
        npc.stuckTime = 0;
      }
    }
  }

  npc.heading = approachAngle(npc.heading, npc.desiredHeading, TURN_SPEED * dt);
  npc.sprite.setDepth(npc.sprite.y);
  playAnimForDir(npc.sprite, textureKey, headingToDir4(npc.heading), moving);
  updateVisionCone(npc);
}

// ---------------------------------------------------------------------------
// Cone-vs-cone reaction + wall-hugging correction — ported verbatim.
// ---------------------------------------------------------------------------
const cosVisionHalf = Math.cos(VISION_HALF_ANGLE);

function pointInCone(x, y, npc) {
  const ox = npc.sprite.x / TILE_SIZE;
  const oy = npc.sprite.y / TILE_SIZE;
  const dx = x - ox;
  const dy = y - oy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return true;
  if (d > VISION_RANGE) return false;
  const dot = (dx / d) * Math.cos(npc.heading) + (dy / d) * Math.sin(npc.heading);
  return dot >= cosVisionHalf;
}

function sectorSamplesInCone(from, other) {
  const RS = 4;
  const AS = 4;
  const ox = from.sprite.x / TILE_SIZE;
  const oy = from.sprite.y / TILE_SIZE;
  for (let ri = 1; ri <= RS; ri++) {
    const r = (ri / RS) * VISION_RANGE;
    for (let ai = 0; ai <= AS; ai++) {
      const ang = from.heading - VISION_HALF_ANGLE + (ai / AS) * (2 * VISION_HALF_ANGLE);
      const x = ox + Math.cos(ang) * r;
      const y = oy + Math.sin(ang) * r;
      if (pointInCone(x, y, other)) return true;
    }
  }
  return false;
}

function conesOverlap(a, b) {
  const apexDist = Math.hypot(a.sprite.x - b.sprite.x, a.sprite.y - b.sprite.y) / TILE_SIZE;
  if (apexDist > VISION_RANGE * 2) return false;
  return sectorSamplesInCone(a, b) || sectorSamplesInCone(b, a);
}

function spookApart(npc, other) {
  const ox = npc.sprite.x / TILE_SIZE;
  const oy = npc.sprite.y / TILE_SIZE;
  const away = Math.atan2(oy - other.sprite.y / TILE_SIZE, ox - other.sprite.x / TILE_SIZE);
  let best = null;
  for (let attempt = 0; attempt < 16; attempt++) {
    const biased = attempt < 8;
    const base = biased ? away : Math.random() * Math.PI * 2;
    const spread = biased ? Math.PI * 0.9 : Math.PI * 2;
    const ang = base + (Math.random() - 0.5) * spread;
    const dist = 2.5 + Math.random() * (WANDER_MAX_DIST - 2.5);
    const tx = ox + Math.cos(ang) * dist;
    const ty = oy + Math.sin(ang) * dist;
    const inBounds = inWanderBounds(tx, ty);
    const newHeading = Math.atan2(ty - oy, tx - ox);
    const turn = Math.abs(((newHeading - npc.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const score = (inBounds ? 10 : 0) + turn;
    if (!best || score > best.score) best = { tx, ty, score, turn };
    if (inBounds && turn >= MIN_SPOOK_TURN) break;
  }
  npc.targetX = clamp(best.tx, WANDER_BOUNDS.minX, WANDER_BOUNDS.maxX);
  npc.targetY = clamp(best.ty, WANDER_BOUNDS.minY, WANDER_BOUNDS.maxY);
  keepTargetOutOfStartArea(npc);
  npc.state = 'walk';
  npc.timer = 0;
  npc.overlapCooldown = OVERLAP_COOLDOWN;
}

export let overlapReactions = 0;
export function resolveConeOverlaps() {
  for (let i = 0; i < npcs.length; i++) {
    for (let j = i + 1; j < npcs.length; j++) {
      const a = npcs[i];
      const b = npcs[j];
      if (a.overlapCooldown > 0 || b.overlapCooldown > 0) continue;
      if (conesOverlap(a, b)) {
        spookApart(a, b);
        spookApart(b, a);
        overlapReactions++;
      }
    }
  }
}

function coneMostlyBlockedByWall(npc) {
  let blocked = 0;
  const ox = npc.sprite.x / TILE_SIZE;
  const oy = npc.sprite.y / TILE_SIZE;
  for (let i = 0; i < WALL_HUG_SAMPLES; i++) {
    const theta = -VISION_HALF_ANGLE + (i / (WALL_HUG_SAMPLES - 1)) * (2 * VISION_HALF_ANGLE);
    const dist = rayObstacleDistance(ox, oy, npc.heading + theta, VISION_RANGE);
    if (dist < WALL_HUG_CHECK_DIST) blocked++;
  }
  return blocked / WALL_HUG_SAMPLES >= WALL_HUG_FRACTION;
}

function turnTowardOpenDirection(npc) {
  const ox = npc.sprite.x / TILE_SIZE;
  const oy = npc.sprite.y / TILE_SIZE;
  let best = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = WANDER_MIN_DIST + Math.random() * (WANDER_MAX_DIST - WANDER_MIN_DIST);
    const tx = ox + Math.cos(ang) * dist;
    const ty = oy + Math.sin(ang) * dist;
    const inBounds = inWanderBounds(tx, ty);
    const openness = rayObstacleDistance(ox, oy, ang, VISION_RANGE);
    const score = (inBounds ? 10 : 0) + openness;
    if (!best || score > best.score) best = { tx, ty, score };
    if (inBounds && openness > VISION_RANGE * 0.7) break;
  }
  npc.targetX = clamp(best.tx, WANDER_BOUNDS.minX, WANDER_BOUNDS.maxX);
  npc.targetY = clamp(best.ty, WANDER_BOUNDS.minY, WANDER_BOUNDS.maxY);
  keepTargetOutOfStartArea(npc);
  npc.state = 'walk';
  npc.timer = 0;
  npc.wallHugCooldown = WALL_HUG_COOLDOWN;
}

export let wallHugReactions = 0;
export function resolveWallHugging() {
  for (const npc of npcs) {
    if (npc.wallHugCooldown > 0) continue;
    if (coneMostlyBlockedByWall(npc)) {
      turnTowardOpenDirection(npc);
      wallHugReactions++;
    }
  }
}

export function resetNpc(npc) {
  npc.sprite.x = npc.spawnX * TILE_SIZE;
  npc.sprite.y = npc.spawnY * TILE_SIZE;
  npc.heading = npc.desiredHeading = Math.random() * Math.PI * 2;
  npc.state = 'walk';
  npc.timer = 0;
  npc.stuckTime = 0;
  npc.overlapCooldown = 0;
  npc.wallHugCooldown = 0;
  npc.respaceCooldown = 0;
  pickWanderTarget(npc);
  updateVisionCone(npc);
}
