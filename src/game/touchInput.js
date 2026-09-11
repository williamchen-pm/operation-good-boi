// ---------------------------------------------------------------------------
// Shared touch input state, written by the on-screen joystick
// (src/touchControls.js) and read by the scene (player movement, camera zoom).
// ---------------------------------------------------------------------------

// Joystick deflection: x/y in [-1, 1], magnitude <= 1, zero when released.
export const touchStick = { x: 0, y: 0 };

// True once the device is detected as touch (or a touch happens), for the
// rest of the session. Desktop players never flip it.
export const touchState = { enabled: false };
