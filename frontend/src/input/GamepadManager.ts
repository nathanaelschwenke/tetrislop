import type { GameAction } from '../core/types';

/** Navigation commands while a menu, panel or dialog is shown. */
export type UiCommand = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

export interface GamepadHandlers {
  press(action: GameAction): void;
  release(action: GameAction): void;
  /** Start button: start / pause / resume / retry (main decides). */
  start(): void;
  ui(cmd: UiCommand): void;
  /** Any new button press or stick deflection (input-method detection, audio unlock). */
  activity(): void;
}

/**
 * Button indices of the W3C "standard" gamepad mapping
 * (Xbox: A B X Y, PlayStation: Cross Circle Square Triangle).
 */
export const GAMEPAD_BUTTONS = {
  south: 0, // A / Cross
  east: 1, // B / Circle
  west: 2, // X / Square
  north: 3, // Y / Triangle
  lb: 4,
  rb: 5,
  select: 8,
  start: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

/** In-game bindings: button index -> action. */
export const GAMEPAD_BINDINGS: Record<number, GameAction> = {
  [GAMEPAD_BUTTONS.left]: 'left',
  [GAMEPAD_BUTTONS.right]: 'right',
  [GAMEPAD_BUTTONS.down]: 'softDrop',
  [GAMEPAD_BUTTONS.up]: 'hardDrop',
  [GAMEPAD_BUTTONS.south]: 'rotateCCW',
  [GAMEPAD_BUTTONS.north]: 'rotateCCW',
  [GAMEPAD_BUTTONS.rb]: 'rotateCW',
  [GAMEPAD_BUTTONS.east]: 'rotateCW',
  [GAMEPAD_BUTTONS.west]: 'rotateCW',
  [GAMEPAD_BUTTONS.lb]: 'rotateCCW',
};

/** Left stick: deflection that turns a direction on / back off (hysteresis). */
const STICK_ON = 0.5;
const STICK_OFF = 0.35;
/** Holding a direction in menus repeats it after this delay / interval. */
const UI_REPEAT_DELAY_MS = 400;
const UI_REPEAT_MS = 160;

type VirtualInput = number | 'stickLeft' | 'stickRight' | 'stickUp' | 'stickDown';

const UI_BINDINGS: Array<[VirtualInput[], UiCommand]> = [
  [[GAMEPAD_BUTTONS.up, 'stickUp'], 'up'],
  [[GAMEPAD_BUTTONS.down, 'stickDown'], 'down'],
  [[GAMEPAD_BUTTONS.left, 'stickLeft'], 'left'],
  [[GAMEPAD_BUTTONS.right, 'stickRight'], 'right'],
  [[GAMEPAD_BUTTONS.south], 'confirm'],
  [[GAMEPAD_BUTTONS.east], 'back'],
];

const GAME_STICK: Partial<Record<VirtualInput, GameAction>> = {
  stickLeft: 'left',
  stickRight: 'right',
  stickDown: 'softDrop', // stick up is deliberately unbound (no accidental hard drops)
};

/**
 * Polls the Gamepad API once per frame (it has no input events) and turns
 * button edges into the same abstract actions as keyboard and touch.
 * All connected pads are merged. Like the keyboard, auto-shift is left to the
 * engine (DAS/ARR), so inputs_count counts real presses only.
 */
export class GamepadManager {
  /** Set by main every frame: true while a menu/panel/dialog takes the input. */
  uiMode = true;

  private prev = new Set<VirtualInput>();
  private held = new Set<GameAction>();
  private uiRepeat: { cmd: UiCommand; next: number } | null = null;
  private stick = { x: 0, y: 0 };

  constructor(private readonly handlers: GamepadHandlers) {}

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  }

  get connected(): boolean {
    return GamepadManager.supported && [...navigator.getGamepads()].some((p) => p?.connected);
  }

  poll(now: number): void {
    if (!GamepadManager.supported) return;
    const down = this.readInputs();
    const pressed = [...down].filter((v) => !this.prev.has(v));
    this.prev = down;
    if (pressed.length) this.handlers.activity();

    if (pressed.includes(GAMEPAD_BUTTONS.start)) this.handlers.start();

    if (this.uiMode) {
      this.releaseAll();
      this.pollUi(down, pressed, now);
      return;
    }
    this.uiRepeat = null;

    // Game actions: press on the first source going down, release when no source holds it.
    const want = new Set<GameAction>();
    for (const v of down) {
      const a = typeof v === 'number' ? GAMEPAD_BINDINGS[v] : GAME_STICK[v];
      // Only inputs pressed during gameplay count (a held A from "Play" must not rotate).
      if (a && (this.held.has(a) || pressed.includes(v))) want.add(a);
    }
    for (const a of want) if (!this.held.has(a)) this.handlers.press(a);
    for (const a of this.held) if (!want.has(a)) this.handlers.release(a);
    this.held = want;
  }

  /** Forget held game actions (pause, menu, window blur). */
  releaseAll(): void {
    this.held.forEach((a) => this.handlers.release(a));
    this.held.clear();
  }

  private pollUi(down: Set<VirtualInput>, pressed: VirtualInput[], now: number): void {
    for (const [inputs, cmd] of UI_BINDINGS) {
      if (inputs.some((v) => pressed.includes(v))) {
        this.handlers.ui(cmd);
        this.uiRepeat = cmd === 'confirm' || cmd === 'back' ? null : { cmd, next: now + UI_REPEAT_DELAY_MS };
        return;
      }
    }
    const r = this.uiRepeat;
    if (!r) return;
    const binding = UI_BINDINGS.find(([, c]) => c === r.cmd);
    if (!binding || !binding[0].some((v) => down.has(v))) {
      this.uiRepeat = null;
    } else if (now >= r.next) {
      this.handlers.ui(r.cmd);
      r.next = now + UI_REPEAT_MS;
    }
  }

  private readInputs(): Set<VirtualInput> {
    const down = new Set<VirtualInput>();
    let x = 0;
    let y = 0;
    for (const pad of navigator.getGamepads()) {
      if (!pad?.connected) continue;
      pad.buttons.forEach((b, i) => {
        if (b.pressed || b.value > 0.5) down.add(i);
      });
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > Math.abs(x)) x = ax;
      if (Math.abs(ay) > Math.abs(y)) y = ay;
    }
    this.stick = { x: this.axis(this.stick.x, x), y: this.axis(this.stick.y, y) };
    if (this.stick.x < 0) down.add('stickLeft');
    if (this.stick.x > 0) down.add('stickRight');
    if (this.stick.y < 0) down.add('stickUp');
    if (this.stick.y > 0) down.add('stickDown');
    return down;
  }

  /** Digitises one axis with hysteresis: returns -1, 0 or 1. */
  private axis(prev: number, v: number): number {
    if (Math.abs(v) >= STICK_ON) return Math.sign(v);
    if (prev !== 0 && Math.sign(v) === prev && Math.abs(v) > STICK_OFF) return prev;
    return 0;
  }
}
