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
export const PLAYER_RADIUS = 0.95;
export const NPC_SIZE = 1.8;
export const NPC_RADIUS = 0.95;

// Start (bottom of the floor) and goal (top) — same coordinates as the
// original game's PLAYER_SPAWN_XZ / PUPPY_XZ.
export const PLAYER_SPAWN = { x: 0, y: 34 };
export const PUPPY_SPAWN = { x: -4, y: -38 };

export const FLOOR_X = [-15, 15]; // 30 units wide
export const FLOOR_Y = [-41, 37]; // 78 units tall
export const WALL_THICKNESS = 0.6;

export const WALK_GRID_CELL = 0.5;
export const WALK_GRID_BOUNDS = { minX: -22, maxX: 22, minY: -48, maxY: 44 };

// Minimum gap required between any obstacle's edge and the nearest other
// obstacle (or wall) — enough for the player (diameter 2*PLAYER_RADIUS) to
// pass through comfortably, with real margin to spare.
export const MIN_OBSTACLE_CLEARANCE = 2.8;

export const PLAYER_SPEED = 9; // world units per second

export const NPC_SPEED_SLOW = 1.8;
export const NPC_SPEED_NORMAL = 3.6;
export const NPC_SPEED_FAST = 6.2;

// Hard cap on how fast ANY character's facing can rotate, in radians/sec —
// shared by guards AND the player. See the original game's note: tuned so an
// attentive player has a real window to notice a guard swinging toward them.
export const TURN_SPEED = 2.4;

export const VISION_RANGE = 9;
export const VISION_HALF_ANGLE = (28 * Math.PI) / 180; // ~56 deg full cone
export const CONE_RAYS = 40;

export const WANDER_MIN_DIST = 4;
export const WANDER_MAX_DIST = 9;
export const WANDER_BOUNDS = { x: 14, y: 40 };
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
export const DOOR_W = 2.6;
export const DOOR_D = 1.3;

export const PLAYER_SPAWN_HEADING = -Math.PI / 2; // facing "up"/north, same as before

export const CAMERA_FOLLOW_RATE = 3.2;
export const CAMERA_ZOOM = 3; // integer zoom on the 16px-tile art, classic RPG-Maker-ish scale
