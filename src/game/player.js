// ---------------------------------------------------------------------------
// Player — WASD movement, ported from the original game's updatePlayer().
// Same delta-time-based movement and collision call. Facing is DELIBERATELY
// different from the ported original, though: the old game eased the
// player's facing toward its target via the same TURN_SPEED cap as the
// guards (carried over from when the player was a rotating 3D model). For a
// 4-direction 2D sprite that reads as sluggish/wrong — genre convention
// (Zelda/Stardew/RPG-Maker) is an instant facing snap on input, so
// `player.heading` is just set directly here, no easing. NPCs still ease via
// approachAngle (see npc.js) — TURN_SPEED remains their fairness cap,
// unchanged; only the player's own turn got the sprite-appropriate snap.
// `heading` is otherwise still just a visual pick of the nearest of 4
// sprite directions — the player has no vision cone, so nothing
// gameplay-critical reads player.heading.
// ---------------------------------------------------------------------------
import { TILE_SIZE, PLAYER_SPEED, PLAYER_SPAWN, PLAYER_SPAWN_HEADING } from './constants.js';
import { moveWithCollision } from './obstacles.js';
import { spriteExtents, clampToWorld } from './bounds.js';
import { headingToDir4, playAnimForDir } from './anim.js';

export function createPlayer(scene) {
  const player = scene.add.sprite(PLAYER_SPAWN.x * TILE_SIZE, PLAYER_SPAWN.y * TILE_SIZE, 'player', 1);
  // Feet-based anchor (standard top-down convention) — confirmed by direct
  // alpha-channel inspection that every frame in this spritesheet (all 4
  // directions, all 3 walk-cycle frames) has its feet touching the exact
  // same bottom pixel row of its 32x32 cell, so a single fixed origin works
  // for every frame with no per-frame offset. player.x/y now IS the feet's
  // world position, used directly for both collision (obstacles.js anchors
  // the measured FEET box here — see constants.js#FEET_HALF_W) and depth (setDepth(player.y)
  // below, unchanged code, now sorts on feet-Y — matching how every prop
  // already sorts on ITS OWN base position, see level.js's propBuilder).
  player.setOrigin(0.5, 1);
  player.worldExtents = spriteExtents(scene, 'player');
  player.setDepth(player.y);
  player.heading = PLAYER_SPAWN_HEADING;
  player.desiredHeading = PLAYER_SPAWN_HEADING;
  player.lastMoveDir = { x: 0, y: -1 };
  player.moving = false;
  playAnimForDir(player, 'player', headingToDir4(player.heading), false);
  return player;
}

const moveDir = { x: 0, y: 0 };

export function updatePlayer(scene, player, keys, dt) {
  moveDir.x = 0;
  moveDir.y = 0;
  if (keys.up.isDown) moveDir.y -= 1;
  if (keys.down.isDown) moveDir.y += 1;
  if (keys.left.isDown) moveDir.x -= 1;
  if (keys.right.isDown) moveDir.x += 1;

  const lenSq = moveDir.x * moveDir.x + moveDir.y * moveDir.y;
  player.moving = lenSq > 0;
  if (player.moving) {
    const len = Math.sqrt(lenSq);
    moveDir.x /= len;
    moveDir.y /= len;
    player.lastMoveDir.x = moveDir.x;
    player.lastMoveDir.y = moveDir.y;
    player.desiredHeading = Math.atan2(moveDir.y, moveDir.x);
    player.heading = player.desiredHeading; // instant snap — see file header
    const posInTiles = { x: player.x / TILE_SIZE, y: player.y / TILE_SIZE };
    moveWithCollision(posInTiles, moveDir.x * PLAYER_SPEED * dt, moveDir.y * PLAYER_SPEED * dt);
    clampToWorld(posInTiles, player.worldExtents);
    player.x = posInTiles.x * TILE_SIZE;
    player.y = posInTiles.y * TILE_SIZE;
  }

  player.setDepth(player.y);
  playAnimForDir(player, 'player', headingToDir4(player.heading), player.moving);
}
