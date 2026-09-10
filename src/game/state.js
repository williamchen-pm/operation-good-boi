// Shared run-state flags, mirroring the original game's module-level
// `gameStarted`/`gameOver`/`gameWon`/`puppyCarried` variables — a plain
// mutable object so both the Phaser scene and the DOM UI layer (main.js)
// can read/write the same flags without a circular import between them.
export const gameState = {
  started: false,
  over: false,
  won: false,
  puppyCarried: false,
};
