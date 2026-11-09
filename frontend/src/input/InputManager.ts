import type { GameAction, InputDevice } from '../core/types';

export type MetaAction = 'restart' | 'pause' | 'mute' | 'start';

export interface InputHandlers {
  press(action: GameAction, device: Exclude<InputDevice, 'mixed'>): void;
  release(action: GameAction): void;
  meta(action: MetaAction, device: Exclude<InputDevice, 'mixed'>): void;
  /** Any user gesture (needed to unlock the AudioContext). */
  gesture(): void;
}

export const KEY_BINDINGS: Record<string, GameAction | MetaAction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'softDrop',
  Space: 'hardDrop',
  ArrowUp: 'rotateCW',
  KeyX: 'rotateCW',
  KeyZ: 'rotateCCW',
  KeyY: 'rotateCCW', // German keyboard layout (QWERTZ)
  ControlLeft: 'rotateCCW',
  ControlRight: 'rotateCCW',
  KeyR: 'restart',
  KeyP: 'pause',
  Escape: 'pause',
  KeyM: 'mute',
  Enter: 'start',
};

const GAME_ACTIONS = new Set<string>(['left', 'right', 'softDrop', 'hardDrop', 'rotateCW', 'rotateCCW']);

function isGameAction(a: string): a is GameAction {
  return GAME_ACTIONS.has(a);
}

/**
 * Maps keyboard and touch controls to abstract game actions.
 * Browser key-repeat events are ignored: auto-shift is handled by the engine
 * (DAS/ARR), so inputs_count counts real presses only.
 */
export class InputManager {
  private heldKeys = new Map<string, GameAction>();
  private heldPointers = new Map<number, GameAction>();
  private disposers: Array<() => void> = [];

  constructor(private readonly handlers: InputHandlers) {}

  attachKeyboard(target: Window = window): void {
    const onDown = (e: KeyboardEvent) => {
      const action = KEY_BINDINGS[e.code];
      this.handlers.gesture();
      if (!action) return;
      e.preventDefault();
      if (e.repeat) return;
      if (isGameAction(action)) {
        if (this.heldKeys.has(e.code)) return;
        this.heldKeys.set(e.code, action);
        this.handlers.press(action, 'keyboard');
      } else {
        this.handlers.meta(action, 'keyboard');
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const action = this.heldKeys.get(e.code);
      if (!action) return;
      e.preventDefault();
      this.heldKeys.delete(e.code);
      // Only release if no other key/pointer still holds the same action.
      if (![...this.heldKeys.values(), ...this.heldPointers.values()].includes(action)) {
        this.handlers.release(action);
      }
    };
    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    this.disposers.push(() => {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
    });
  }

  /**
   * Binds on-screen buttons. Each element needs data-action="left|right|..."
   * (game action) or data-meta="restart|pause|mute|start".
   */
  attachTouchControls(root: HTMLElement): void {
    const buttons = root.querySelectorAll<HTMLElement>('[data-action], [data-meta]');
    buttons.forEach((btn) => {
      const action = btn.dataset.action;
      const meta = btn.dataset.meta as MetaAction | undefined;

      const onDown = (e: PointerEvent) => {
        e.preventDefault();
        this.handlers.gesture();
        btn.classList.add('pressed');
        if (meta) {
          this.handlers.meta(meta, 'touch');
          return;
        }
        if (!action || !isGameAction(action)) return;
        try { btn.setPointerCapture(e.pointerId); } catch { /* not supported */ }
        this.heldPointers.set(e.pointerId, action);
        this.handlers.press(action, 'touch');
      };
      const onUp = (e: PointerEvent) => {
        btn.classList.remove('pressed');
        const held = this.heldPointers.get(e.pointerId);
        if (!held) return;
        this.heldPointers.delete(e.pointerId);
        if (![...this.heldKeys.values(), ...this.heldPointers.values()].includes(held)) {
          this.handlers.release(held);
        }
      };
      btn.addEventListener('pointerdown', onDown);
      btn.addEventListener('pointerup', onUp);
      btn.addEventListener('pointercancel', onUp);
      btn.addEventListener('lostpointercapture', onUp);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
      this.disposers.push(() => {
        btn.removeEventListener('pointerdown', onDown);
        btn.removeEventListener('pointerup', onUp);
        btn.removeEventListener('pointercancel', onUp);
        btn.removeEventListener('lostpointercapture', onUp);
      });
    });
  }

  /** Forget all held inputs (window blur, pause, restart). */
  releaseAll(): void {
    const actions = new Set([...this.heldKeys.values(), ...this.heldPointers.values()]);
    this.heldKeys.clear();
    this.heldPointers.clear();
    actions.forEach((a) => this.handlers.release(a));
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }
}
