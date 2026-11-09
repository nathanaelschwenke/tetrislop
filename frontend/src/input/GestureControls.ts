import type { GameAction } from '../core/types';

export interface GestureHandlers {
  /** One discrete action (press + release), e.g. one column of movement. */
  tap(action: GameAction): void;
  /** Whether gestures are accepted right now (touch game running). */
  enabled(): boolean;
  /** Board cell size in CSS px: a horizontal drag moves one column per cell. */
  cellSize(): number;
}

/** Tuning (in board cells / ms). */
const GESTURE = {
  /** Horizontal finger travel per column moved (in cells). */
  dragCellsPerColumn: 0.9,
  /** A tap: little movement and short. */
  tapMaxMovePx: 12,
  tapMaxMs: 280,
  /** Swipe down: downward speed over the last ~100 ms (px/ms) and distance (cells). */
  swipeMinSpeed: 0.55,
  swipeMinCells: 1.5,
  velocityWindowMs: 100,
} as const;

interface Sample { x: number; y: number; t: number }

/**
 * Touch gestures on the board, alongside the on-screen buttons:
 *  - drag left/right: the piece follows the finger (one column per cell width)
 *  - tap: rotate clockwise
 *  - fast swipe down: hard drop
 * Each recognised step is sent as a normal press, so it counts in inputs_count.
 */
export class GestureControls {
  private pointerId: number | null = null;
  private start: Sample = { x: 0, y: 0, t: 0 };
  private anchorX = 0;
  private movedColumns = false;
  private samples: Sample[] = [];

  constructor(private readonly target: HTMLElement, private readonly handlers: GestureHandlers) {
    target.addEventListener('pointerdown', this.onDown);
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerup', this.onUp);
    target.addEventListener('pointercancel', this.onCancel);
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || this.pointerId !== null || !this.handlers.enabled()) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try { this.target.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    this.start = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    this.anchorX = e.clientX;
    this.movedColumns = false;
    this.samples = [this.start];
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    const cutoff = e.timeStamp - GESTURE.velocityWindowMs * 2;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
    if (!this.handlers.enabled()) return;

    // Horizontal drag: one column per step; vertical-dominant swipes don't move sideways.
    const step = this.handlers.cellSize() * GESTURE.dragCellsPerColumn;
    const dyTotal = e.clientY - this.start.y;
    const dxTotal = e.clientX - this.start.x;
    if (!this.movedColumns && Math.abs(dyTotal) > Math.abs(dxTotal) * 1.5) return;
    while (e.clientX - this.anchorX >= step) {
      this.handlers.tap('right');
      this.anchorX += step;
      this.movedColumns = true;
    }
    while (this.anchorX - e.clientX >= step) {
      this.handlers.tap('left');
      this.anchorX -= step;
      this.movedColumns = true;
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    if (!this.handlers.enabled()) return;
    const dx = e.clientX - this.start.x;
    const dy = e.clientY - this.start.y;
    const dt = e.timeStamp - this.start.t;

    if (!this.movedColumns && Math.hypot(dx, dy) <= GESTURE.tapMaxMovePx && dt <= GESTURE.tapMaxMs) {
      this.handlers.tap('rotateCW');
      return;
    }

    // Swipe down: judged on the final part of the gesture, so drag-then-flick works too.
    const recent = this.samples.filter((s) => s.t >= e.timeStamp - GESTURE.velocityWindowMs);
    const from = recent[0] ?? this.samples[0];
    const vdy = e.clientY - from.y;
    const vdx = e.clientX - from.x;
    const span = Math.max(16, e.timeStamp - from.t);
    const fast = vdy / span >= GESTURE.swipeMinSpeed && vdy > Math.abs(vdx);
    const far = dy >= this.handlers.cellSize() * GESTURE.swipeMinCells;
    if (fast && far) this.handlers.tap('hardDrop');
  };

  private onCancel = (e: PointerEvent) => {
    if (e.pointerId === this.pointerId) this.pointerId = null;
  };
}
