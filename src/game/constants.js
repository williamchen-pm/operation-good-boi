// ---------------------------------------------------------------------------
// Shared gameplay constants — ported from the original Three.js version's
// main.js almost entirely unchanged. That game used a top-down orthographic
// camera over an XZ ground plane (X = east/west, Z = north/south, +Z = "down
// on screen"/south). This one uses Phaser's native 2D XY plane where +Y is
// also "down on screen" — so every old `z` becomes `y` here with NO sign
// flip and NO rescaling of any distance/speed constant. 1 world unit here =
// 1 tile = TILE_SIZE pixels (chosen so the numbers that used to describe a
// "1.8-unit-wide person in a 30-unit-wide room" now describe an equally
// proportioned tile-grid room), so every speed/range/size constant below is
// copied verbatim from the old game rather than re-tuned.
// ---------------------------------------------------------------------------

export const TILE_SIZE = 16; // native pixel size of one world unit (one tileset tile)

export const PLAYER_SIZE = 1.8;
// Body-scale radii, sized for the original center-anchored 2-tile sprite.
// Still used for character-to-character touch (catch/pickup distance) and the
// conservative route/clearance checks — NOT for colliding with obstacles.
export const PLAYER_RADIUS = 0.95;
export const NPC_SIZE = 1.8;
export const NPC_RADIUS = 0.95;

// Obstacle collision uses the character's actual FEET, measured from the
// sprite alpha: in the standing frame of every facing, for the player and
// every guard, the bottom 3 solid rows (shoes + shadow) span 6px either side
// of the cell center (1 cell px = 1/16 tile); walk-stride frames reach 7px.
// The box sits on the feet anchor (sprite origin 0.5,1): x +/- FEET_HALF_W,
// y from -FEET_DEPTH to 0. Using the 0.95 body radius here instead put ~15px
// of invisible padding around every object once sprites were re-anchored at
// the feet.
export const FEET_HALF_W = 6 / 16;
export const FEET_DEPTH = 3 / 16;

// Start (bottom of the floor) and goal (top) — same coordinates as the
// original game's PLAYER_SPAWN_XZ / PUPPY_XZ.
export const PLAYER_SPAWN = { x: 0, y: 34 };
// Centered on the map's horizontal axis (FLOOR_X spans -15..15) and at the
// top (near the north wall, FLOOR_Y[0] = -41) — both the puppy sprite and
// its dedicated light pool derive their position from this single constant
// (see puppy.js and GameScene.js#setupLighting), so centering it here
// centers both together.
export const PUPPY_SPAWN = { x: 0, y: -38 };

export const FLOOR_X = [-15, 15]; // 30 units wide
export const FLOOR_Y = [-41, 37]; // 78 units tall
export const WALL_THICKNESS = 0.6;

export const WALK_GRID_CELL = 0.5;
export const WALK_GRID_BOUNDS = { minX: -22, maxX: 22, minY: -48, maxY: 44 };

// Default minimum gap between an obstacle's edge and the nearest other one —
// enough for the player (diameter 2*PLAYER_RADIUS) to pass through
// comfortably, with real margin to spare. The level keeps it between props and
// walls (the perimeter walkway); between props it uses tighter, tiered gaps
// (see level.js, "Storage rows and aisles").
export const MIN_OBSTACLE_CLEARANCE = 2.8;

export const PLAYER_SPEED = 9; // world units per second

// Touch joystick (src/touchControls.js): below the dead zone the player
// stands still; past it, speed ramps up linearly to full PLAYER_SPEED at
// TOUCH_STICK_FULL_SPEED deflection, so a light push sneaks slowly.
// Keyboard movement is always full speed.
export const TOUCH_STICK_DEADZONE = 0.18;
export const TOUCH_STICK_FULL_SPEED = 0.75;

export const NPC_SPEED_SLOW = 1.8;
export const NPC_SPEED_NORMAL = 3.6;
export const NPC_SPEED_FAST = 6.2;

// Hard cap on how fast a guard's facing (and so its vision cone) can rotate,
// in radians/sec — every turn goes through it (wander, respacing, cone-overlap
// spooking, wall-avoidance). The player snaps instead (see player.js). Tuned
// so an attentive player has a real window to notice a cone swinging toward
// them; lowered from 2.4 (180° in ~1.3s) to 2.0 (~1.6s) for a slightly larger
// reaction window.
export const TURN_SPEED = 2.0;

export const VISION_RANGE = 9;
export const VISION_HALF_ANGLE = (28 * Math.PI) / 180; // ~56 deg full cone
export const CONE_RAYS = 40;

// Start-area grace period: for the first START_GRACE_SECONDS of play after
// the level loads or resets, no guard may stand in, or aim its cone into, the
// START_ZONE_RADIUS disc around PLAYER_SPAWN (the entrance door area). A cone
// reaches at most VISION_RANGE, so keeping every guard at least
// START_GRACE_EXCLUSION from the spawn point guarantees both, whatever its
// heading. Enforced every movement step in npc.js (not just at spawn).
export const START_ZONE_RADIUS = 6;
export const START_GRACE_SECONDS = 5;
export const START_GRACE_EXCLUSION = START_ZONE_RADIUS + VISION_RANGE;
// Wander targets during the grace period keep this much extra distance, so
// guards don't queue up on the exclusion edge waiting for it to lift.
export const START_GRACE_TARGET_BUFFER = 3;

// No NPC's spawn/reset point may be closer than this to PLAYER_SPAWN, so the
// grace invariant already holds the instant the level loads/resets. Enforced
// in npc.js#enforceSpawnSafeZone (its result becomes spawnX/spawnY, so every
// reset reuses the same already-safe point).
export const NPC_SPAWN_SAFE_RADIUS = START_GRACE_EXCLUSION + 1;

// Guard spacing during patrol: wander targets are picked to be far from other
// guards and their destinations, guards steer away from any guard within
// NPC_SEPARATION_RADIUS, and one closer than NPC_MIN_SPACING makes them pick
// a fresh (spread-out) destination.
export const NPC_SEPARATION_RADIUS = 10;
export const NPC_SEPARATION_WEIGHT = 1.5;
export const NPC_MIN_SPACING = 7;
export const NPC_RESPACE_COOLDOWN = 1.5;
export const WANDER_TARGET_CANDIDATES = 12;

export const WANDER_MIN_DIST = 4;
export const WANDER_MAX_DIST = 9;
// Guard wander targets stay where a guard's whole sprite fits inside the walls
// (see bounds.js): up to ~0.6 tiles of sprite past the feet sideways and 2
// tiles above them, inside walls whose inner faces are at x=+/-14.7,
// y=-40.7 (north) and y=36.7 (south).
export const WANDER_BOUNDS = { minX: -13.5, maxX: 13.5, minY: -38.5, maxY: 36 };
export const PAUSE_MIN = 0.6;
export const PAUSE_MAX = 2.2;
export const OVERLAP_COOLDOWN = 2.5;
export const STUCK_GIVEUP = 0.4;
export const WALL_HUG_CHECK_DIST = 3;
export const WALL_HUG_FRACTION = 0.6;
export const WALL_HUG_SAMPLES = 7;
export const WALL_HUG_COOLDOWN = 3.5;
export const MIN_SPOOK_TURN = (40 * Math.PI) / 180;

export const PUPPY_HEIGHT = 0.8; // gameplay radius only, not visual size
export const PUPPY_PICKUP_DIST = PLAYER_RADIUS + PUPPY_HEIGHT;
export const PUPPY_TRAIL_DIST = 1.6;
export const PUPPY_FOLLOW_RATE = 7;

export const DOOR_XZ = { x: PLAYER_SPAWN.x, y: 35.6 };
export const DOOR_TRIGGER_DIST = 2.2;
// Display size of the real door sprite (prop_door, a front-elevation double
// door from the tileset) — taller than wide, matching an actual doorway cut
// into the wall, rather than the old flat top-down placeholder rectangle.
export const DOOR_W = 2.2;
export const DOOR_D = 2.6;

export const PLAYER_SPAWN_HEADING = -Math.PI / 2; // facing "up"/north, same as before

export const CAMERA_FOLLOW_RATE = 3.2;
export const CAMERA_ZOOM = 3; // integer zoom on the 16px-tile art, classic RPG-Maker-ish scale
// On touch devices the zoom shrinks so the screen's SHORT side still shows at
// least this many tiles: a guard's cone reaches VISION_RANGE tiles, so with
// the player centered, any guard close enough to see them is on screen. (At
// zoom 3 a phone in portrait showed only ~8 tiles across.) Desktop keeps
// CAMERA_ZOOM.
export const TOUCH_MIN_VIEW_TILES = 20;
export const TOUCH_CAMERA_BOTTOM_PADDING = 8; // tiles; see GameScene#cameraBounds
