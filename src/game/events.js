// A tiny standalone event bus for scene->UI signals ('caught', 'rescued').
// Deliberately NOT Phaser's `scene.events` — that EventEmitter isn't
// installed on a Scene instance until Phaser's boot pipeline runs it through
// the SceneManager, so listeners attached right after `new GameScene()`
// (before the game has booted) would attach to `undefined`. This plain
// emitter exists immediately, with no boot-order dependency either side.
class TinyEmitter {
  constructor() {
    this.listeners = new Map();
  }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
  }
  emit(event, ...args) {
    for (const fn of this.listeners.get(event) || []) fn(...args);
  }
}

export const bus = new TinyEmitter();
