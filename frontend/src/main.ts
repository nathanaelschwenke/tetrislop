import './style.css';
import { SynthEngine } from './audio/SynthEngine';
import { GameEngine } from './core/GameEngine';
import type { GameAction, InputDevice } from './core/types';
import { GAME_CONFIG } from './config/gameConfig';
import { GamepadManager, type UiCommand } from './input/GamepadManager';
import { GestureControls } from './input/GestureControls';
import { InputManager, type MetaAction } from './input/InputManager';
import { AssetLoader } from './render/AssetLoader';
import { Renderer, type RenderView } from './render/Renderer';
import { DataLogger } from './telemetry/DataLogger';
import { pingDatabase } from './telemetry/dbPing';
import { focusedButton, moveFocus, trackFocusClass } from './ui/focusNav';
import { GamePanel } from './ui/GamePanel';
import { MainMenu } from './ui/MainMenu';

type Device = Exclude<InputDevice, 'mixed'>;
type Screen = 'menu' | 'game';

const MUTE_KEY = 'tetrislop.muted';
const CLEAR_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'];
const DB_POLL_MS = 30_000;
const DEVICE_CYCLE: Device[] = ['keyboard', 'touch', 'gamepad'];

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const touchRoot = document.getElementById('touch-controls') as HTMLElement;
const touchHud = document.getElementById('touch-hud') as HTMLElement;
const startBtn = touchHud.querySelector('.start-btn') as HTMLButtonElement;
const hudMuteBtn = touchHud.querySelector('.mute-btn') as HTMLButtonElement;

const engine = new GameEngine();
const logger = new DataLogger();
const synth = new SynthEngine();
const assets = new AssetLoader('./');
const renderer = new Renderer(canvas, assets);

try {
  synth.setMuted(localStorage.getItem(MUTE_KEY) === '1');
} catch { /* storage blocked */ }

let touchMode = false;
const setTouchMode = (on: boolean) => {
  touchMode = on;
  document.body.classList.toggle('touch', on);
  renderer.setHudReserved(on);
};

// ---------------------------------------------------------------------------
// Screens & input method.
// The input method can only change on the title screen; once a game starts
// it is locked (gameDevice) and input from any other device is ignored.
// ---------------------------------------------------------------------------
let screen: Screen = 'menu';
let menuDevice: Device = window.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'keyboard';
let deviceChosenManually = false;
let gameDevice: Device = menuDevice;

trackFocusClass();

const menu = new MainMenu({
  play: () => startGame(),
  toggleMute: () => toggleMute(),
  toggleDevice: () => setMenuDevice(DEVICE_CYCLE[(DEVICE_CYCLE.indexOf(menuDevice) + 1) % DEVICE_CYCLE.length], true),
  recheckDb: () => void checkDb(true),
});
const panel = new GamePanel({
  resume: () => togglePause(),
  retry: () => restartGame(),
  toMenu: () => showMenu(),
});

void assets.loadAll().then(() => {
  const logo = assets.get('logo');
  if (logo) menu.setLogoImage(logo.cloneNode() as HTMLImageElement);
});

function setMenuDevice(device: Device, manual = false): void {
  if (screen !== 'menu') return;
  if (manual) deviceChosenManually = true;
  else if (device !== menuDevice) deviceChosenManually = false;
  const changed = device !== menuDevice;
  menuDevice = device;
  setTouchMode(device === 'touch');
  menu.setDevice(device, deviceChosenManually);
  // With a controller, start on the play button so A starts right away.
  if (device === 'gamepad' && (changed || !focusedButton(menu.element))) {
    document.body.classList.add('gp-nav');
    menu.focusPlay();
  }
}

// Auto-detection on the title screen: a key press means keyboard, a finger
// (or pen) means touch, a controller button means gamepad. Mouse clicks are
// neutral, so the icon decides then.
window.addEventListener('keydown', (e) => {
  document.body.classList.remove('gp-nav');
  if (screen === 'menu' && !e.repeat) setMenuDevice('keyboard');
}, true);
window.addEventListener('pointerdown', (e) => {
  synth.unlock();
  document.body.classList.remove('gp-nav');
  if (screen !== 'menu' || e.pointerType === 'mouse') return;
  if (e.target instanceof Element && e.target.closest('#input-btn')) return; // manual switch
  setMenuDevice('touch');
}, true);

function setScreen(next: Screen): void {
  screen = next;
  document.body.dataset.screen = next;
}

function toggleMute(): void {
  const muted = synth.toggleMute();
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
  updateMuteUi();
}

function updateMuteUi(): void {
  menu.setMuted(synth.isMuted);
  hudMuteBtn.setAttribute('aria-pressed', String(synth.isMuted));
}

// After a top out every input is ignored for a moment (accidental restarts).
let gameOverAt = -Infinity;
function inGameOverCooldown(): boolean {
  return engine.state === 'over' && performance.now() - gameOverAt < GAME_CONFIG.gameOverInputLockMs;
}

// ---------------------------------------------------------------------------
// Database indicator (title screen only)
// ---------------------------------------------------------------------------
let dbTimer: ReturnType<typeof setInterval> | undefined;
let dbSeq = 0;

async function checkDb(showChecking = false): Promise<void> {
  const seq = ++dbSeq;
  if (showChecking) menu.setDbStatus('checking');
  const status = await pingDatabase();
  if (seq === dbSeq) menu.setDbStatus(status);
}

function startDbPolling(): void {
  stopDbPolling();
  void checkDb();
  dbTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void checkDb();
  }, DB_POLL_MS);
}

function stopDbPolling(): void {
  clearInterval(dbTimer);
  dbTimer = undefined;
  dbSeq++; // drop answers of pings still in flight
}

window.addEventListener('online', () => { if (screen === 'menu') void checkDb(true); });
window.addEventListener('offline', () => { if (screen === 'menu') menu.setDbStatus('offline'); });

// ---------------------------------------------------------------------------
// Tension source. Phase 1: simple stack-height heuristic.
// Phase 2: replace with the model's survival prediction (mu, sigma^2).
// ---------------------------------------------------------------------------
export type TensionProvider = () => number;
let tensionProvider: TensionProvider = () => {
  const h = engine.board.stackHeight();
  return Math.min(1, Math.max(0, (h - 9) / 9));
};
let tensionSmoothed = 0;

// ---------------------------------------------------------------------------
// Game lifecycle
// ---------------------------------------------------------------------------
function releaseInputs(): void {
  input.releaseAll();
  gamepad.releaseAll();
}

function startGame(): void {
  if (menu.infoOpen) menu.closeInfo();
  gameDevice = menuDevice; // locked until the player returns to the menu
  setTouchMode(gameDevice === 'touch');
  setScreen('game');
  stopDbPolling();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  panel.hide();
  releaseInputs();
  logger.startGame(gameDevice);
  engine.start();
  tensionSmoothed = 0;
}

function abortRunningGame(): void {
  if (engine.state === 'playing' || engine.state === 'paused') {
    void logger.finalize('manual_restart');
  }
}

function restartGame(): void {
  abortRunningGame();
  startGame();
}

function showMenu(): void {
  abortRunningGame();
  releaseInputs();
  panel.hide();
  engine.reset();
  setScreen('menu');
  setMenuDevice(menuDevice);
  updateMuteUi();
  startDbPolling();
}

function togglePause(): void {
  if (engine.state === 'playing') {
    releaseInputs();
    engine.pause();
  } else if (engine.state === 'paused') {
    engine.resume();
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
/** Game actions are accepted only from the device the game was started with. */
function pressAction(action: GameAction, device: Device): void {
  if (screen !== 'game' || device !== gameDevice || engine.state !== 'playing') return;
  engine.press(action);
}

const input = new InputManager({
  press: pressAction,
  release(action: GameAction) {
    engine.release(action);
  },
  meta(action: MetaAction, device: Device) {
    if (screen === 'menu') {
      if (menu.infoOpen) return;
      if (action === 'start') startGame();
      else if (action === 'mute') toggleMute();
      return;
    }
    // Esc / P on a keyboard always pauses, whatever device the game is locked to.
    // Resuming stays with the locked device (or the panel buttons).
    if (action === 'pause' && device === 'keyboard' && engine.state === 'playing') {
      togglePause();
      return;
    }
    if (device !== gameDevice || inGameOverCooldown()) return;
    switch (action) {
      case 'start':
        if (engine.state === 'over') restartGame();
        else if (engine.state === 'paused' || device !== 'keyboard') togglePause(); // touch START / pad Start double as pause
        break;
      case 'restart':
        // On touch a restart mid-game first pauses (guards against mis-taps).
        if (device === 'touch' && engine.state === 'playing') togglePause();
        else restartGame();
        break;
      case 'pause':
        if (engine.state === 'over') showMenu();
        else togglePause();
        break;
      case 'mute':
        toggleMute();
        break;
    }
  },
  gesture() {
    synth.unlock();
  },
});
input.attachKeyboard();
input.attachTouchControls(touchRoot);
input.attachTouchControls(touchHud);

// Swipe / tap gestures on the board (in addition to the buttons).
new GestureControls(canvas, {
  tap(action) {
    pressAction(action, 'touch');
    engine.release(action);
  },
  enabled: () => screen === 'game' && gameDevice === 'touch' && engine.state === 'playing',
  cellSize: () => renderer.getCellSize(),
});

// ---------------------------------------------------------------------------
// Controller (Gamepad API, polled every frame)
// ---------------------------------------------------------------------------
const gamepad = new GamepadManager({
  press: (action) => pressAction(action, 'gamepad'),
  release: (action) => engine.release(action),
  start() {
    if (screen === 'menu') {
      if (!menu.infoOpen) startGame();
      return;
    }
    if (gameDevice !== 'gamepad' || inGameOverCooldown()) return;
    if (engine.state === 'over') restartGame();
    else togglePause();
  },
  ui: gamepadUi,
  activity() {
    synth.unlock(); // browsers may not count pad buttons as a user gesture; a click/tap still unlocks audio
    if (screen === 'menu') setMenuDevice('gamepad');
  },
});

function gamepadUi(cmd: UiCommand): void {
  if (screen === 'game' && (gameDevice !== 'gamepad' || inGameOverCooldown())) return; // input lock / cooldown
  document.body.classList.add('gp-nav');
  if (menu.infoOpen) {
    if (cmd === 'confirm' || cmd === 'back') menu.closeInfo();
    else if (cmd === 'up' || cmd === 'down') menu.scrollInfo(cmd === 'up' ? -1 : 1);
    return;
  }
  const root = screen === 'menu' ? menu.element : panel.current ? panel.element : null;
  if (!root) return;
  switch (cmd) {
    case 'up':
    case 'left':
      moveFocus(root, -1);
      break;
    case 'down':
    case 'right':
      moveFocus(root, 1);
      break;
    case 'confirm': {
      const btn = focusedButton(root);
      if (btn) btn.click();
      else if (screen === 'menu') startGame();
      else panel.focusPrimary();
      break;
    }
    case 'back':
      if (panel.current === 'paused') togglePause();
      else if (panel.current === 'over') showMenu();
      break;
  }
}

// ---------------------------------------------------------------------------
// Engine events -> audio, visuals, telemetry
// ---------------------------------------------------------------------------
engine.events.on('snapshot', (s) => logger.recordMove(s));

engine.events.on('stateChange', ({ state }) => {
  if (screen !== 'game') return;
  if (state === 'paused' || state === 'over') {
    panel.show(state, { score: engine.score, lines: engine.lines, level: engine.level }, gameDevice);
    panel.setUpload(logger.status);
    const focusForPad = () => { if (gameDevice === 'gamepad') panel.focusPrimary(); };
    if (state === 'over') {
      gameOverAt = performance.now();
      panel.lock(GAME_CONFIG.gameOverInputLockMs, focusForPad);
    } else {
      focusForPad();
    }
  } else {
    panel.hide();
  }
});
logger.onStatusChange = (status) => panel.setUpload(status);

engine.events.on('move', () => synth.play('move'));
engine.events.on('rotate', () => synth.play('rotate'));
let lastSoftSound = 0;
engine.events.on('softDropStep', () => {
  const now = performance.now();
  if (now - lastSoftSound > 45) {
    synth.play('softDrop');
    lastSoftSound = now;
  }
});
engine.events.on('hardDrop', ({ cells, distance, type }) => {
  synth.play('hardDrop');
  const now = performance.now();
  renderer.dropTrail(cells, distance, type, now);
  if (distance > 2) renderer.shake(now);
});
engine.events.on('lock', ({ dropType }) => {
  if (dropType !== 'hard_drop') synth.play('lock');
});
engine.events.on('lineClear', (e) => {
  const now = performance.now();
  renderer.flashRows(e.rows, now);
  if (e.isTetris) synth.playTetris(e.b2bApplied);
  else synth.playLineClear(e.count);
  if (e.combo > 0) synth.playCombo(e.combo);

  renderer.popText(e.b2bApplied ? `B2B ${CLEAR_NAMES[4]}` : CLEAR_NAMES[e.count], e.isTetris ? 190 : 50, now, e.isTetris);
  if (e.combo > 0) renderer.popText(`COMBO x${e.combo}`, 30, now);
  if (e.perfectClear) {
    renderer.popText('PERFECT CLEAR', 290, now, true);
    synth.playPerfectClear();
  }
});
engine.events.on('levelUp', ({ level }) => renderer.popText(`LEVEL ${level}`, 140, performance.now()));
engine.events.on('gameOver', () => {
  releaseInputs();
  synth.play('gameOver');
  renderer.shake(performance.now(), 320);
  void logger.finalize('top_out');
});

// ---------------------------------------------------------------------------
// Window lifecycle: hiding the tab only pauses; closing the page sends the
// running game once as "window_closed" (fetch with keepalive).
// ---------------------------------------------------------------------------
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (engine.state === 'playing') {
      releaseInputs();
      engine.pause();
    }
    synth.suspend();
  } else {
    synth.resume();
  }
});
window.addEventListener('blur', () => {
  releaseInputs();
  if (engine.state === 'playing') engine.pause();
});
window.addEventListener('pagehide', () => logger.flushOnUnload());
window.addEventListener('beforeunload', () => logger.flushOnUnload());

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
new ResizeObserver(() => renderer.resize()).observe(canvas);

let lastHudRect = '';
function positionHud(): void {
  const r = touchMode && screen === 'game' ? renderer.getHudRect() : null;
  if (!r) return;
  const key = `${r.x},${r.y},${r.w},${r.h}`;
  if (key === lastHudRect) return;
  lastHudRect = key;
  Object.assign(touchHud.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  touchHud.classList.toggle('row', r.w > r.h);
}

let last = performance.now();
function frame(now: number): void {
  const dt = now - last;
  last = now;
  gamepad.uiMode = screen === 'menu' || engine.state !== 'playing' || menu.infoOpen;
  gamepad.poll(now);
  engine.update(dt);

  if (engine.state === 'playing') {
    const target = tensionProvider();
    tensionSmoothed += (target - tensionSmoothed) * Math.min(1, dt / 400);
  } else if (engine.state === 'ready') {
    tensionSmoothed *= 0.95;
  }
  synth.setTensionState(tensionSmoothed);
  renderer.setTensionVisuals(tensionSmoothed);

  const p = engine.active;
  const view: RenderView = {
    state: engine.state,
    grid: engine.board.rowsView(),
    active: p ? { type: p.type, cells: p.cells() } : null,
    ghost: p ? p.cells(p.x, engine.ghostY()) : null,
    lockProgress: engine.lockProgress,
    nextQueue: engine.nextQueue,
    score: engine.score,
    level: engine.level,
    lines: engine.lines,
    uploadStatus: logger.status,
    muted: synth.isMuted,
    touchMode,
  };
  renderer.render(view, now);
  if (panel.current) panel.position(renderer.getWellRect());
  positionHud();
  if (document.body.dataset.state !== engine.state) {
    document.body.dataset.state = engine.state;
    startBtn.textContent = engine.state === 'playing' ? '❚❚' : engine.state === 'over' ? '↻' : '▶';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
showMenu();

// Debug / Phase 2 hooks, e.g. __tetrislop.renderer.setVisualModulation({ hueShiftDeg: 40 })
declare global {
  interface Window {
    __tetrislop: {
      engine: GameEngine;
      logger: DataLogger;
      synth: SynthEngine;
      renderer: Renderer;
      setTensionProvider(fn: TensionProvider): void;
    };
  }
}
window.__tetrislop = {
  engine,
  logger,
  synth,
  renderer,
  setTensionProvider(fn) { tensionProvider = fn; },
};
