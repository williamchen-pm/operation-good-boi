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

// Base positions are themselves kept well clear of PLAYER_SPAWN (0, 34) —
// npc_samurai used to start at (-9, 27) (only ~11.4 units away, inside
// VISION_RANGE + a real reaction-time margin) and relied entirely on
// npc.js#enforceSpawnSafeZone to push it out at runtime. That runtime check
// still exists as a defense-in-depth backstop (e.g. against a future def
// placed too close), but the actual level layout should never depend on it:
// every entry below is >=16.9 units from the start on its own — the start
// exclusion applies regardless of where in x a guard sits.
//
// x is deliberately spread across the FULL floor width (FLOOR_X is -15..15)
// rather than clustered on one side — an earlier layout put 6 of 7 guards
// at x <= -1, leaving the whole east side of the map an easy unguarded
// lane. Split into thirds (left x<-5, center -5..5, right x>5), this list
// is LEFT: npc_ninja(-8,10), npc_big(-9,-31), npc_mechanic#2(-6,-22) —
// CENTER: npc_android(-2,-14), npc_ninja#2(4,-3) — RIGHT: npc_samurai(8,18),
// npc_mechanic(10,-9): 3/2/2, no zone left empty. y positions are otherwise
// unchanged from before (still one guard near each depth of the spawn->
// puppy route; only x was reassigned for width coverage). Two texture keys
// repeat (ninja, mechanic) — this asset pack has only 5 distinct guard
// spritesheets for 7 guards.
const NPC_DEFS = [
  { x: 8, y: 18, speed: NPC_SPEED_SLOW, texture: 'npc_samurai' }, // right
  { x: -8, y: 10, speed: NPC_SPEED_NORMAL, texture: 'npc_ninja' }, // left
  { x: 10, y: -9, speed: NPC_SPEED_FAST, texture: 'npc_mechanic' }, // right
  { x: -2, y: -14, speed: NPC_SPEED_NORMAL, texture: 'npc_android' }, // center
  { x: -9, y: -31, speed: NPC_SPEED_SLOW, texture: 'npc_big' }, // left
  { x: 4, y: -3, speed: NPC_SPEED_NORMAL, texture: 'npc_ninja' }, // center
  { x: -6, y: -22, speed: NPC_SPEED_NORMAL, texture: 'npc_mechanic' }, // left
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

    // No floor tile images loaded anymore — the floor is a flat procedural
    // fill now (see level.js#buildFloor), not tile art. Every variant in
    // this pack draws its own border, which tiled into a maze/grid pattern
    // at full-floor scale regardless of which variant was used.
    this.load.image('wall_corrugated', 'assets/tiles/wall_corrugated.png');
    // Every prop texture below is a crop from the purchased
    // RCCv2STREETStileset sheets (source rects: asset-sources/cropped/).
    const props = [
      'prop_dumpster', 'prop_barrel', 'prop_barrel2', 'prop_barrel_fire',
      'prop_shelf_stocked', 'prop_cone_pair', 'prop_streetlight', 'prop_vending',
      'prop_dumpster_round_red', 'prop_dumpster_round_blue',
      'car_top_1', 'car_top_2', 'car_top_3', 'car_top_4', 'car_top_teal', 'car_top_red',
      'vehicle_van_blue', 'vehicle_van_red', 'vehicle_hover_teal', 'vehicle_coupe_dark',
      'scrap_tire_pile', 'scrap_tire_stack', 'scrap_bin',
      'machine_generator', 'machine_ac_unit', 'utility_box', 'pa_speaker',
      'satellite_dish', 'arcade_kiosk_purple', 'arcade_kiosk_blue',
    ];
    for (const key of props) this.load.image(key, `assets/tiles/${key}.png`);
    // Real door art (see door.js) — a front-elevation double door, replacing
    // the flat graphics-drawn placeholder rectangle.
    this.load.image('prop_door', 'assets/tiles/prop_door.png');
    // Small wall-mounted light fixture (see level.js#buildWallLamps) — drawn
    // procedurally at runtime (createWallLampTexture), not loaded from a file;
    // no matching sconce/fixture prop exists anywhere in the purchased sheet.

    this.load.spritesheet('player', 'assets/characters/player.png', { frameWidth: 32, frameHeight: 32 });
    // A texture key can appear on more than one NPC_DEFS entry (two guards
    // sharing a look) — load each unique texture only once.
    for (const texture of new Set(NPC_DEFS.map((def) => def.texture))) {
      this.load.spritesheet(texture, `assets/characters/${texture}.png`, { frameWidth: 32, frameHeight: 32 });
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
  // affected by ambient darkness and these point lights; the player is
  // deliberately left on Phaser's default pipeline, so they always render
  // at full native brightness regardless of how dark a given spot on the
  // floor is — the atmosphere never gets to hide the player from
  // themselves. Guards and their vision cones are ALSO left off the
  // Light2D pipeline, but unlike the player they DO dim in unlit areas —
  // npc.js#updateVisionCone samples this same light setup in plain JS and
  // fades both the guard sprite's and its cone's alpha down toward a
  // floor (never fully invisible) as a deliberate, moderate difficulty
  // increase: harder to spot at a glance in the dark, never impossible to
  // make out if the player is actually looking.
  setupLighting() {
    this.lights.enable();
    // Darkened from the original 0x24222c (moderate difficulty increase —
    // unlit floor is meaningfully harder to read at a glance now) but
    // deliberately NOT anywhere near pitch black: the player sprite, every
    // NPC sprite, and every vision-cone Graphics object are on Phaser's
    // default pipeline (see the comment above), so none of them are
    // affected by this value at all — they stay at full native brightness
    // in every unlit corner of the map regardless of how dark this gets.
    // Only the environment (floor/walls/props, all Light2D) reads darker.
    this.lights.setAmbientColor(0x121118);
    const TS = TILE_SIZE;
    const warm = 0xffd9a0; // matches the old game's lamp color family (0xffe0b8)
    const cool = 0xbfe0ff;
    const pool = (x, y, radius, color, intensity) => this.lights.addLight(x * TS, y * TS, radius, color, intensity);
    pool(DOOR_XZ.x, DOOR_XZ.y - 4, 150, warm, 1.6); // entrance/exit
    pool(-10.5, 22, 110, warm, 1.2); // west side, upper floor
    pool(10.5, -8, 110, warm, 1.2); // east side, mid-floor
    pool(0, 12, 130, warm, 1.15); // center, upper-mid
    pool(0, -14, 130, warm, 1.15); // center, lower-mid
    pool(-10.8, -28, 105, warm, 1.1); // west side, lower floor
    pool(PUPPY_SPAWN.x, PUPPY_SPAWN.y, 170, cool, 1.8); // the goal — brightest, distinct color
    // Wall-mounted light fixtures (sprite + their own light pools) are built
    // in level.js#buildLevel alongside the rest of the environment — see
    // buildWallLamps there for why they replace the old uniform edge glow.
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
