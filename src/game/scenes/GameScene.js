import Phaser from 'phaser';
import {
  TILE_SIZE, FLOOR_X, FLOOR_Y, CAMERA_FOLLOW_RATE, CAMERA_ZOOM,
  NPC_SPEED_SLOW, NPC_SPEED_NORMAL, NPC_SPEED_FAST,
} from '../constants.js';
import { buildLevel } from '../level.js';
import { createPlayer, updatePlayer } from '../player.js';
import { makeNpc, updateNpc, resolveConeOverlaps, resolveWallHugging, resetNpc, npcs } from '../npc.js';
import { createPuppy, checkPuppyPickup, updatePuppyCarry, resetPuppy } from '../puppy.js';
import { createDoor, checkDoor } from '../door.js';
import { detectingNpc, touchingNpc } from '../detection.js';
import { createDirectionalAnims } from '../anim.js';
import { PLAYER_SPAWN, PLAYER_SPAWN_HEADING, PUPPY_SPAWN, DOOR_XZ } from '../constants.js';
import { gameState } from '../state.js';
import { bus } from '../events.js';

// Centers a camera on a world point, with its own simple bounds clamp.
// Deliberately NOT Phaser's Camera.setBounds()/centerOn() — both were found
// (empirically, right after they shipped) to produce scroll values that
// don't respect the stated bounds, so this small manual version replaced
// them. THIS is the actual fix for the solid-black-canvas bug: the formula
// below divided (width/zoom) when computing scrollX/scrollY, which is wrong
// for Phaser's own scroll convention and NOT just a rounding difference —
// traced directly in Phaser's source (cameras/2d/Camera.js#preRender):
//   worldView.x (true world-space left edge) = scrollX + width/2 - displayWidth/2
//   where displayWidth = width/zoom
// i.e. Phaser's `scrollX` is offset by the RAW pixel half-width (width/2),
// not the zoom-adjusted one — my old formula's `width/2/zoom` was off by a
// full viewport-width at zoom=3, silently pushing every single game object
// off-canvas every frame (nothing drawn = solid black) while every object's
// own position/visibility/pipeline stayed completely correct, which is why
// nothing about the objects themselves ever looked wrong under inspection.
// Verified algebraically against that exact source formula before fixing.
function centerCameraOn(cam, x, y, bounds) {
  const displayWidth = cam.width / cam.zoom;
  const displayHeight = cam.height / cam.zoom;
  let worldLeft = x - displayWidth / 2;
  let worldTop = y - displayHeight / 2;
  if (bounds) {
    const minLeft = Math.min(bounds.minX, bounds.maxX - displayWidth);
    const maxLeft = Math.max(bounds.minX, bounds.maxX - displayWidth);
    const minTop = Math.min(bounds.minY, bounds.maxY - displayHeight);
    const maxTop = Math.max(bounds.minY, bounds.maxY - displayHeight);
    worldLeft = Phaser.Math.Clamp(worldLeft, minLeft, maxLeft);
    worldTop = Phaser.Math.Clamp(worldTop, minTop, maxTop);
  }
  // Convert the (intuitive, true-world-space) clamped left/top edge back
  // into the scrollX/scrollY Phaser's own preRender() expects.
  cam.scrollX = worldLeft + displayWidth / 2 - cam.width / 2;
  cam.scrollY = worldTop + displayHeight / 2 - cam.height / 2;
}

const NPC_DEFS = [
  { x: -9, y: 27, speed: NPC_SPEED_SLOW, texture: 'npc_samurai' },
  { x: -3, y: 10, speed: NPC_SPEED_NORMAL, texture: 'npc_ninja' },
  { x: 10, y: -9, speed: NPC_SPEED_FAST, texture: 'npc_mechanic' },
  { x: -1, y: -14, speed: NPC_SPEED_NORMAL, texture: 'npc_android' },
  { x: -9, y: -31, speed: NPC_SPEED_SLOW, texture: 'npc_big' },
];

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  preload() {
    // Loud, explicit logging for any asset that fails to load — a 404/path
    // typo here otherwise fails "silently" in the sense that Phaser just
    // substitutes its pink/black missing-texture placeholder and carries on,
    // which is easy to miss in a screenshot but obvious in the console.
    this.load.on('loaderror', (file) => {
      console.error(`[preload] FAILED to load "${file.key}" from ${file.src}`);
    });

    this.load.image('floor_a', 'assets/tiles/floor_a.png');
    this.load.image('floor_b', 'assets/tiles/floor_b.png');
    this.load.image('floor_c', 'assets/tiles/floor_c.png');
    this.load.image('floor_d', 'assets/tiles/floor_d.png');
    this.load.image('floor_e', 'assets/tiles/floor_e.png');
    this.load.image('wall_corrugated', 'assets/tiles/wall_corrugated.png');
    this.load.image('prop_container_red', 'assets/tiles/prop_container_red.png');
    this.load.image('prop_container_teal', 'assets/tiles/prop_container_teal.png');
    this.load.image('prop_container_blue', 'assets/tiles/prop_container_blue.png');
    this.load.image('prop_dumpster', 'assets/tiles/prop_dumpster.png');
    this.load.image('prop_tire', 'assets/tiles/prop_tire.png');

    this.load.spritesheet('player', 'assets/characters/player.png', { frameWidth: 32, frameHeight: 32 });
    for (const def of NPC_DEFS) {
      this.load.spritesheet(def.texture, `assets/characters/${def.texture}.png`, { frameWidth: 32, frameHeight: 32 });
    }
    this.load.spritesheet('dog-idle', 'assets/dog/idle.png', { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('dog-walk', 'assets/dog/walk.png', { frameWidth: 64, frameHeight: 64 });
  }

  create() {
    try {
      createDirectionalAnims(this, 'player');
      for (const def of NPC_DEFS) createDirectionalAnims(this, def.texture);

      // Lighting MUST be set up before anything calls .setPipeline('Light2D')
      // — buildLevel() does that immediately for the floor/walls/every prop.
      // This used to run in the opposite order (buildLevel() first), which
      // assigns the Light2D pipeline before this.lights.enable() has ever
      // run in this scene; found as the likely cause of a real "everything
      // renders solid black" bug a real (non-automated) browser hit, since
      // create() throwing partway through would leave every later game
      // object (player/NPCs/puppy/door/camera) never created at all — while
      // the on-screen timer kept counting, because it runs on its own DOM
      // rAF loop in main.js, completely decoupled from this scene.
      this.setupLighting();
      buildLevel(this);

      this.player = createPlayer(this);
      for (const def of NPC_DEFS) makeNpc(this, def.texture, def.x, def.y, def.speed);
      this.puppy = createPuppy(this);
      this.door = createDoor(this);

      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys({ up: 'W', down: 'S', left: 'A', right: 'D' });
      this.keys = {
        up: { isDown: false }, down: { isDown: false }, left: { isDown: false }, right: { isDown: false },
      };

      const cam = this.cameras.main;
      cam.setZoom(CAMERA_ZOOM);
      cam.roundPixels = true;
      // Deliberately NOT using Phaser's own cam.setBounds()/centerOn() bounds
      // clamping here — found (empirically, via direct scrollX inspection) to
      // produce wildly wrong scroll values in this Phaser version any time the
      // unclamped position falls outside the bounds (e.g. bounds.x - width/zoom
      // instead of a simple clamp to bounds.x), not just a zoom-timing quirk.
      // this.worldBounds + the manual clamp in centerCameraOn() replace it
      // entirely with a small, predictable clamp of my own.
      const margin = 4 * TILE_SIZE;
      this.worldBounds = {
        minX: FLOOR_X[0] * TILE_SIZE - margin,
        maxX: FLOOR_X[1] * TILE_SIZE + margin,
        minY: FLOOR_Y[0] * TILE_SIZE - margin,
        maxY: FLOOR_Y[1] * TILE_SIZE + margin,
      };
      this.cameraFocus = { x: this.player.x, y: this.player.y };
      centerCameraOn(cam, this.cameraFocus.x, this.cameraFocus.y, this.worldBounds);

      this.events.emit('ready');
    } catch (err) {
      // If this fires, create() aborted partway through and NOTHING past
      // the failure point exists — exactly the "solid black, only the DOM
      // timer moving" symptom. Logged loudly (not swallowed) so the real
      // cause is never mistaken for "no console errors".
      console.error('[GameScene.create] threw — scene setup did not finish:', err);
      throw err;
    }
  }

  // Moody lighting, matching the original Three.js version's "near-black
  // with warm-lit pools" mood — via Phaser's built-in Light2D pipeline
  // rather than a hand-rolled darkness-overlay+mask. Only the ENVIRONMENT
  // (floor/walls/props, all set to the 'Light2D' pipeline in level.js) is
  // affected by ambient darkness and these point lights; the player, every
  // NPC sprite, and every vision-cone Graphics object are deliberately left
  // on Phaser's default pipeline, so they always render at full native
  // brightness regardless of how dark a given spot on the floor is — the
  // atmosphere never gets to hide gameplay-critical information.
  setupLighting() {
    this.lights.enable();
    this.lights.setAmbientColor(0x24222c); // dim, not pitch black — floor variety stays legible everywhere
    const TS = TILE_SIZE;
    const warm = 0xffd9a0; // matches the old game's lamp color family (0xffe0b8)
    const cool = 0xbfe0ff;
    const pool = (x, y, radius, color, intensity) => this.lights.addLight(x * TS, y * TS, radius, color, intensity);
    pool(DOOR_XZ.x, DOOR_XZ.y - 4, 170, warm, 1.8); // entrance/exit
    pool(-10.5, 22, 130, warm, 1.4); // west row, near the forklift
    pool(10.5, -8, 130, warm, 1.4); // east row, mid-floor
    pool(0, 12, 150, warm, 1.3); // center aisle
    pool(0, -14, 150, warm, 1.3); // center aisle, further in
    pool(-10.8, -28, 120, warm, 1.2); // west row, near the pallet rack
    pool(PUPPY_SPAWN.x, PUPPY_SPAWN.y, 190, cool, 2.0); // the goal — brightest, distinct color
  }

  updateCamera(dt) {
    const t = 1 - Math.exp(-CAMERA_FOLLOW_RATE * dt);
    this.cameraFocus.x += (this.player.x - this.cameraFocus.x) * t;
    this.cameraFocus.y += (this.player.y - this.cameraFocus.y) * t;
    centerCameraOn(this.cameras.main, this.cameraFocus.x, this.cameraFocus.y, this.worldBounds);
  }

  resetLevel() {
    this.player.x = PLAYER_SPAWN.x * TILE_SIZE;
    this.player.y = PLAYER_SPAWN.y * TILE_SIZE;
    this.player.heading = this.player.desiredHeading = PLAYER_SPAWN_HEADING;
    this.player.lastMoveDir = { x: 0, y: -1 };
    this.cameraFocus = { x: this.player.x, y: this.player.y };
    centerCameraOn(this.cameras.main, this.cameraFocus.x, this.cameraFocus.y, this.worldBounds);
    gameState.puppyCarried = false;
    resetPuppy(this.puppy);
    this.door.setLocked(true);
    for (const n of npcs) resetNpc(n);
  }

  update(time, deltaMs) {
    const dt = Math.min(deltaMs / 1000, 0.1);
    this.keys.up.isDown = this.cursors.up.isDown || this.wasd.up.isDown;
    this.keys.down.isDown = this.cursors.down.isDown || this.wasd.down.isDown;
    this.keys.left.isDown = this.cursors.left.isDown || this.wasd.left.isDown;
    this.keys.right.isDown = this.cursors.right.isDown || this.wasd.right.isDown;

    if (gameState.started && !gameState.over && !gameState.won) {
      updatePlayer(this, this.player, this.keys, dt);
      for (const npc of npcs) updateNpc(npc, dt);
      resolveConeOverlaps();
      resolveWallHugging();
      this.updateCamera(dt);

      gameState.puppyCarried = checkPuppyPickup(this.player, this.puppy, gameState.puppyCarried, () => {
        this.door.setLocked(false);
      });
      updatePuppyCarry(this.player, this.puppy, gameState.puppyCarried, dt);
      checkDoor(this.player, this.door, gameState.puppyCarried, () => bus.emit('rescued'));

      if (!gameState.won && (detectingNpc(this.player, this.puppy, gameState.puppyCarried) || touchingNpc(this.player, this.puppy, gameState.puppyCarried))) {
        bus.emit('caught');
      }
    }
  }
}
