import './style.css';
import { SynthEngine } from './audio/SynthEngine';
import { GameEngine } from './core/GameEngine';
import type { GameAction, InputDevice } from './core/types';
import { InputManager, type MetaAction } from './input/InputManager';
import { AssetLoader } from './render/AssetLoader';
import { Renderer, type RenderView } from './render/Renderer';
import { DataLogger } from './telemetry/DataLogger';

type Device = Exclude<InputDevice, 'mixed'>;

const MUTE_KEY = 'tetrislop.muted';
const CLEAR_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'];

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game') as HTMLCanvasElement;
const touchRoot = document.getElementById('touch-controls') as HTMLElement;
const startBtn = touchRoot.querySelector('.start-btn') as HTMLButtonElement;

const engine = new GameEngine();
const logger = new DataLogger();
const synth = new SynthEngine();
const assets = new AssetLoader('./');
const renderer = new Renderer(canvas, assets);
void assets.loadAll();

try {
  synth.setMuted(localStorage.getItem(MUTE_KEY) === '1');
} catch { /* storage blocked */ }

let touchMode = window.matchMedia?.('(pointer: coarse)').matches ?? false;
const setTouchMode = (on: boolean) => {
  touchMode = on;
  document.body.classList.toggle('touch', on);
};
setTouchMode(touchMode);

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
function startGame(): void {
  input.releaseAll();
  logger.startGame();
  engine.start();
  tensionSmoothed = 0;
}

function restartGame(): void {
  if (engine.state === 'playing' || engine.state === 'paused') {
    void logger.finalize('manual_restart');
  }
  startGame();
}

function togglePause(): void {
  if (engine.state === 'playing') {
    input.releaseAll();
    engine.pause();
  } else if (engine.state === 'paused') {
    engine.resume();
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const input = new InputManager({
  press(action: GameAction, device: Device) {
    if (device === 'touch') setTouchMode(true);
    if (engine.state === 'ready') {
      startGame();
      return;
    }
    if (engine.state !== 'playing') return;
    logger.noteInputDevice(device);
    engine.press(action);
  },
  release(action: GameAction) {
    engine.release(action);
  },
  meta(action: MetaAction, device: Device) {
    if (device === 'touch') setTouchMode(true);
    switch (action) {
      case 'start':
        if (engine.state === 'ready' || engine.state === 'over') startGame();
        else if (device === 'touch') togglePause(); // the touch START button doubles as pause
        break;
      case 'restart':
        // On touch a restart mid-game first pauses (guards against mis-taps).
        if (device === 'touch' && engine.state === 'playing') togglePause();
        else restartGame();
        break;
      case 'pause':
        togglePause();
        break;
      case 'mute': {
        const muted = synth.toggleMute();
        try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
        break;
      }
    }
  },
  gesture() {
    synth.unlock();
  },
});
input.attachKeyboard();
input.attachTouchControls(touchRoot);

// Any key starts the game from the title screen.
window.addEventListener('keydown', (e) => {
  if (engine.state === 'ready' && !e.repeat && !['KeyM', 'KeyP', 'Escape'].includes(e.code)) {
    synth.unlock();
    startGame();
  }
});
canvas.addEventListener('pointerdown', (e) => {
  synth.unlock();
  if (e.pointerType === 'touch') setTouchMode(true);
  if (engine.state === 'ready' || (engine.state === 'over' && e.pointerType === 'touch')) startGame();
});

// ---------------------------------------------------------------------------
// Engine events -> audio, visuals, telemetry
// ---------------------------------------------------------------------------
engine.events.on('snapshot', (s) => logger.recordMove(s));

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
  input.releaseAll();
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
      input.releaseAll();
      engine.pause();
    }
    synth.suspend();
  } else {
    synth.resume();
  }
});
window.addEventListener('blur', () => {
  input.releaseAll();
  if (engine.state === 'playing') engine.pause();
});
window.addEventListener('pagehide', () => logger.flushOnUnload());
window.addEventListener('beforeunload', () => logger.flushOnUnload());

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
new ResizeObserver(() => renderer.resize()).observe(canvas);

let last = performance.now();
function frame(now: number): void {
  const dt = now - last;
  last = now;
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
    moves: engine.moveCount,
    combo: engine.comboCounter,
    b2b: engine.b2bStreak,
    uploadStatus: logger.status,
    muted: synth.isMuted,
    touchMode,
  };
  renderer.render(view, now);
  if (document.body.dataset.state !== engine.state) {
    document.body.dataset.state = engine.state;
    startBtn.textContent = engine.state === 'playing' ? '❚❚' : engine.state === 'paused' ? '▶' : 'START';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

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
