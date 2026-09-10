import Phaser from 'phaser';
import './style.css';
import { createClient } from '@supabase/supabase-js';
import GameScene from './game/scenes/GameScene.js';
import { gameState } from './game/state.js';
import { npcs } from './game/npc.js';
import { bus } from './game/events.js';

// ---------------------------------------------------------------------------
// Supabase — backs the guest leaderboard (submit + fetch against the
// "scores" table). The publishable (anon) key is meant to be public/
// client-side — safe to embed here — with the table's Row Level Security
// policies as the only real gate on what it can do (public insert + public
// select, no update/delete; see the SQL used to create the table).
// ---------------------------------------------------------------------------
const SUPABASE_URL = 'https://djyurantsagpdshiwjkc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_oSl_PQFajJKXv3M_ISygTg_g5EPDB0s';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ---------------------------------------------------------------------------
// Phaser game + scene. Everything gameplay-related (map, player, NPCs,
// vision cones, collision, puppy, door) lives in src/game/ — see GameScene.
// Everything below here is the DOM overlay layer (landing/timer/caught/
// rescued/leaderboard), ported unchanged from the original Three.js version:
// none of it ever touched Three.js directly, so none of it needed to change
// for this rewrite beyond wiring its a few trigger points to the new scene.
// ---------------------------------------------------------------------------
const gameScene = new GameScene();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#040405',
  pixelArt: true,
  // The original Three.js game's requestAnimationFrame loop never paused on
  // tab-blur/visibility-loss (dt was just clamped, see GameScene.update) —
  // match that here rather than Phaser's default of pausing the whole
  // update loop when the tab loses OS focus. Also needed for this project's
  // established automated-testing workflow (driving the game via the
  // console without ever clicking into the page), which a visibility pause
  // would otherwise silently freeze.
  disableVisibilityChange: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  scene: gameScene,
});

// ---------------------------------------------------------------------------
// Timer — starts the instant Play is clicked, runs live on-screen during
// gameplay, and freezes the instant the player wins (reaches the door while
// carrying the puppy). Wall-clock based (performance.now()), deliberately NOT
// tied to Phaser's per-frame delta — a leaderboard time should reflect real
// elapsed time even across a tab-switch stall.
// ---------------------------------------------------------------------------
let timerStartTs = 0;
let finalTime = 0;
let timerRunning = false;

function formatTime(totalSeconds) {
  const clamped = Math.max(0, totalSeconds);
  const m = Math.floor(clamped / 60);
  const s = clamped - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

function currentElapsed() {
  return timerRunning ? (performance.now() - timerStartTs) / 1000 : finalTime;
}

function startTimer() {
  timerStartTs = performance.now();
  timerRunning = true;
}

function stopTimer() {
  finalTime = (performance.now() - timerStartTs) / 1000;
  timerRunning = false;
}

const timerEl = document.createElement('div');
timerEl.style.cssText = [
  'position:fixed',
  'top:18px',
  'left:50%',
  'transform:translateX(-50%)',
  'font:600 1.6vw/1 system-ui,sans-serif',
  'letter-spacing:0.08em',
  'color:#eaeaea',
  'background:rgba(0,0,0,0.45)',
  'padding:0.45em 0.9em',
  'border-radius:6px',
  'z-index:5',
  'display:none',
  'pointer-events:none',
].join(';');
timerEl.textContent = '00:00.00';
document.body.appendChild(timerEl);

// Independent of Phaser's render loop (the timer is wall-clock based, see
// above) — just refreshes the HUD text/visibility every frame.
function tickTimerDisplay() {
  requestAnimationFrame(tickTimerDisplay);
  const timerActive = gameState.started && !gameState.over && !gameState.won;
  timerEl.style.display = timerActive ? 'block' : 'none';
  if (timerActive) timerEl.textContent = formatTime(currentElapsed());
}
tickTimerDisplay();

// ---------------------------------------------------------------------------
// Leaderboard — backed by the "scores" table in Supabase (name, time_seconds,
// created_at). Two tabs, This Week / This Month, each sorted fastest-first.
// Fetched at most once per real day via a timestamped localStorage cache; a
// successful submit busts the cache immediately.
// ---------------------------------------------------------------------------
const DAY_MS = 24 * 60 * 60 * 1000;
const LEADERBOARD_REFRESH_MS = DAY_MS;
const LEADERBOARD_WINDOW_MS = { week: 7 * DAY_MS, month: 30 * DAY_MS };
const LEADERBOARD_TOP_N = 10;
const LEADERBOARD_CACHE_KEY = 'puppy-game:leaderboard-cache-v1';

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function readLeaderboardCache() {
  try {
    const raw = localStorage.getItem(LEADERBOARD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.scores)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLeaderboardCache(scores) {
  try {
    localStorage.setItem(LEADERBOARD_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), scores }));
  } catch {
    // best-effort only
  }
}

function invalidateLeaderboardCache() {
  try {
    localStorage.removeItem(LEADERBOARD_CACHE_KEY);
  } catch {
    // best-effort only
  }
}

async function fetchLeaderboardScores() {
  const since = new Date(Date.now() - LEADERBOARD_WINDOW_MS.month).toISOString();
  const { data, error } = await supabase
    .from('scores')
    .select('name, time_seconds, created_at')
    .gte('created_at', since)
    .order('time_seconds', { ascending: true })
    .limit(200);
  if (error) throw error;
  return data;
}

function makeOverlayButton(label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = [
    'font:bold 2.2vw/1 system-ui,sans-serif',
    'padding:0.6em 1.8em',
    'background:#3fb6d3',
    'color:#04191f',
    'border:none',
    'border-radius:8px',
    'cursor:pointer',
  ].join(';');
  btn.addEventListener('click', onClick);
  return btn;
}

const leaderboardEl = document.createElement('div');
leaderboardEl.style.cssText = [
  'position:fixed',
  'inset:0',
  'display:none',
  'flex-direction:column',
  'align-items:center',
  'justify-content:center',
  'gap:18px',
  'font:bold 3vw/1 system-ui,sans-serif',
  'letter-spacing:0.12em',
  'color:#eaeaea',
  'background:rgba(0,0,0,0.85)',
  'z-index:30',
].join(';');
const leaderboardTitle = document.createElement('div');
leaderboardTitle.textContent = 'LEADERBOARD';

function makeTabButton(label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = [
    'font:600 1.1vw/1 system-ui,sans-serif',
    'padding:0.5em 1.2em',
    'border:2px solid #3fb6d3',
    'border-radius:20px',
    'cursor:pointer',
  ].join(';');
  btn.addEventListener('click', onClick);
  return btn;
}
const tabRow = document.createElement('div');
tabRow.style.cssText = 'display:flex;gap:10px;';
const weekTabBtn = makeTabButton('This Week', () => setLeaderboardTab('week'));
const monthTabBtn = makeTabButton('This Month', () => setLeaderboardTab('month'));
tabRow.append(weekTabBtn, monthTabBtn);

const leaderboardList = document.createElement('div');
leaderboardList.style.cssText = [
  'font:1.3vw/2 system-ui,sans-serif',
  'letter-spacing:0.02em',
  'min-width:16em',
  'min-height:2em',
].join(';');

let leaderboardScores = [];
let leaderboardTab = 'week';
let leaderboardLoadToken = 0;

function renderLeaderboardList() {
  const cutoff = Date.now() - LEADERBOARD_WINDOW_MS[leaderboardTab];
  const rows = leaderboardScores
    .filter((s) => new Date(s.created_at).getTime() >= cutoff)
    .slice(0, LEADERBOARD_TOP_N);
  leaderboardList.innerHTML = rows.length
    ? rows
        .map(
          (entry, i) =>
            `<div style="display:flex;justify-content:space-between;gap:2em;"><span>${i + 1}. ${escapeHtml(entry.name)}</span><span>${formatTime(entry.time_seconds)}</span></div>`
        )
        .join('')
    : '<div style="opacity:0.6;text-align:center;">No times yet — be the first!</div>';
}

function setLeaderboardTab(tab) {
  leaderboardTab = tab;
  weekTabBtn.style.background = tab === 'week' ? '#3fb6d3' : 'transparent';
  weekTabBtn.style.color = tab === 'week' ? '#04191f' : '#eaeaea';
  monthTabBtn.style.background = tab === 'month' ? '#3fb6d3' : 'transparent';
  monthTabBtn.style.color = tab === 'month' ? '#04191f' : '#eaeaea';
  renderLeaderboardList();
}

let leaderboardReturnEl = null;
async function openLeaderboard(returnEl) {
  leaderboardReturnEl = returnEl;
  returnEl.style.display = 'none';
  leaderboardEl.style.display = 'flex';
  setLeaderboardTab(leaderboardTab);

  const cache = readLeaderboardCache();
  if (cache) {
    leaderboardScores = cache.scores;
    renderLeaderboardList();
  }
  const stale = !cache || Date.now() - cache.fetchedAt > LEADERBOARD_REFRESH_MS;
  if (!stale) return;

  const token = ++leaderboardLoadToken;
  if (!cache) leaderboardList.innerHTML = '<div style="opacity:0.6;text-align:center;">Loading…</div>';
  try {
    const scores = await fetchLeaderboardScores();
    if (token !== leaderboardLoadToken) return;
    writeLeaderboardCache(scores);
    leaderboardScores = scores;
    renderLeaderboardList();
  } catch (err) {
    console.error('[leaderboard] fetch failed', err);
    if (token !== leaderboardLoadToken) return;
    if (!cache) leaderboardList.innerHTML = '<div style="opacity:0.6;text-align:center;">Couldn’t load the leaderboard.</div>';
  }
}
const closeLeaderboardBtn = makeOverlayButton('Close', () => {
  leaderboardEl.style.display = 'none';
  if (leaderboardReturnEl) leaderboardReturnEl.style.display = 'flex';
});
leaderboardEl.append(leaderboardTitle, tabRow, leaderboardList, closeLeaderboardBtn);
document.body.appendChild(leaderboardEl);

const leaderboardBtn = makeOverlayButton('Leaderboard', () => openLeaderboard(landingEl));

// ---------------------------------------------------------------------------
// Landing screen — the one screen shown before gameplay starts.
// ---------------------------------------------------------------------------
const landingEl = document.createElement('div');
landingEl.style.cssText = [
  'position:fixed',
  'inset:0',
  'display:flex',
  'flex-direction:column',
  'align-items:center',
  'justify-content:center',
  'gap:22px',
  'font:bold 6vw/1 system-ui,sans-serif',
  'letter-spacing:0.13em',
  'color:#eaeaea',
  'background:rgba(0,0,0,0.78)',
  'z-index:20',
  'text-align:center',
  'padding:0 5vw',
].join(';');
const landingTitle = document.createElement('div');
landingTitle.textContent = 'OPERATION GOOD BOI';
const landingPitch = document.createElement('div');
landingPitch.textContent = "Sneak in. Grab the good boi. Get out. Don't get caught.";
landingPitch.style.cssText = [
  'font:600 1.7vw/1.4 system-ui,sans-serif',
  'letter-spacing:0.03em',
  'color:#e8c088',
].join(';');
const landingPlayBtn = makeOverlayButton('Play', () => {
  gameState.started = true;
  landingEl.style.display = 'none';
  startTimer();
});
landingEl.append(landingTitle, landingPitch, landingPlayBtn, leaderboardBtn);
document.body.appendChild(landingEl);

const caughtEl = document.createElement('div');
caughtEl.style.cssText = [
  'position:fixed',
  'inset:0',
  'display:none',
  'flex-direction:column',
  'align-items:center',
  'justify-content:center',
  'gap:28px',
  'font:bold 10vw/1 system-ui,sans-serif',
  'letter-spacing:0.12em',
  'color:#ff3b30',
  'background:rgba(0,0,0,0.6)',
  'z-index:10',
].join(';');
const caughtText = document.createElement('div');
caughtText.textContent = 'CAUGHT';
const retryBtn = makeOverlayButton('Retry', () => resetGame());
const caughtLeaderboardBtn = makeOverlayButton('Leaderboard', () => openLeaderboard(caughtEl));
caughtEl.append(caughtText, retryBtn, caughtLeaderboardBtn);
document.body.appendChild(caughtEl);

function triggerCaught() {
  if (gameState.over || gameState.won) return;
  gameState.over = true;
  stopTimer();
  caughtEl.style.display = 'flex';
}

const rescuedEl = document.createElement('div');
rescuedEl.style.cssText = [
  'position:fixed',
  'inset:0',
  'display:none',
  'flex-direction:column',
  'align-items:center',
  'justify-content:center',
  'gap:22px',
  'font:bold 10vw/1 system-ui,sans-serif',
  'letter-spacing:0.12em',
  'color:#3fe07a',
  'background:rgba(0,0,0,0.6)',
  'z-index:10',
].join(';');
const rescuedText = document.createElement('div');
rescuedText.textContent = 'RESCUED';

const rescuedTimeEl = document.createElement('div');
rescuedTimeEl.style.cssText = 'font:600 2.4vw/1 system-ui,sans-serif;letter-spacing:0.05em;color:#eaeaea;';

const submitRow = document.createElement('div');
submitRow.style.cssText = 'display:flex;gap:10px;align-items:center;';
const nameInput = document.createElement('input');
nameInput.type = 'text';
nameInput.placeholder = 'Your name';
nameInput.maxLength = 20;
nameInput.style.cssText = [
  'font:1.2vw system-ui,sans-serif',
  'padding:0.5em 0.7em',
  'border-radius:6px',
  'border:none',
  'width:9em',
].join(';');
async function submitScore(name, timeSeconds) {
  submitBtn.textContent = 'Submitting…';
  submitBtn.disabled = true;
  try {
    const { error } = await supabase.from('scores').insert({ name, time_seconds: timeSeconds });
    if (error) throw error;
    console.log(`[leaderboard] submitted: name="${name}" time=${timeSeconds.toFixed(2)}s (${formatTime(timeSeconds)})`);
    submitBtn.textContent = 'Submitted!';
    invalidateLeaderboardCache();
  } catch (err) {
    console.error('[leaderboard] submit failed', err);
    submitBtn.textContent = 'Submit failed — retry?';
    submitBtn.disabled = false;
  }
}
const submitBtn = makeOverlayButton('Submit', () => {
  const name = nameInput.value.trim() || 'Anonymous';
  submitScore(name, finalTime);
});
submitRow.append(nameInput, submitBtn);

const playAgainBtn = makeOverlayButton('Play Again', () => resetGame());
const rescuedLeaderboardBtn = makeOverlayButton('Leaderboard', () => openLeaderboard(rescuedEl));
rescuedEl.append(rescuedText, rescuedTimeEl, submitRow, playAgainBtn, rescuedLeaderboardBtn);
document.body.appendChild(rescuedEl);

function triggerRescued() {
  if (gameState.won || gameState.over) return;
  gameState.won = true;
  stopTimer();
  rescuedTimeEl.textContent = `Time: ${formatTime(finalTime)}`;
  nameInput.value = '';
  submitBtn.textContent = 'Submit';
  submitBtn.disabled = false;
  rescuedEl.style.display = 'flex';
}

function resetGame() {
  gameState.over = false;
  gameState.won = false;
  caughtEl.style.display = 'none';
  rescuedEl.style.display = 'none';
  startTimer();
  gameScene.resetLevel();
}

bus.on('caught', triggerCaught);
bus.on('rescued', triggerRescued);

// ---------------------------------------------------------------------------
// Debug handle — mirrors the original game's window.__D, for console-driven
// testing without ever clicking Play (gameState.started stays false, and
// __D.step runs the update logic unconditionally either way).
// ---------------------------------------------------------------------------
window.__D = {
  game, gameScene, gameState,
  get player() { return gameScene.player; },
  get puppy() { return gameScene.puppy; },
  npcs,
  reset: resetGame,
  startTimer, stopTimer, formatTime, currentElapsed,
  supabase, fetchLeaderboardScores,
  landingEl, caughtEl, rescuedEl, leaderboardEl,
  // Unconditional test step — calls the scene's update() directly, same
  // role as the original Three.js game's __D.step: drives the simulation
  // deterministically from the console without depending on the real
  // requestAnimationFrame loop (which this automated browser tab does not
  // reliably tick on its own between tool calls — see the note in
  // scenes/GameScene.js). Bypasses gameState.started so it works pre-Play too.
  step: (dt = 1 / 60) => {
    const wasStarted = gameState.started;
    gameState.started = true;
    gameScene.update(performance.now(), dt * 1000);
    gameState.started = wasStarted;
  },
};
