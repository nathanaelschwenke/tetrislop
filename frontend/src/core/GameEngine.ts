import { GAME_CONFIG, dropIntervalMs, levelForLines } from '../config/gameConfig';
import { BagRandomizer, type RandomFn } from './BagRandomizer';
import { Board } from './Board';
import { EventEmitter } from './EventEmitter';
import { Tetromino, canRotate, kickTests, type Cell, type PieceType } from './Tetromino';
import type { DropType, EngineState, GameAction, MoveSnapshot } from './types';

export interface LineClearEvent {
  rows: number[]; // board row indices (0..21) before the shift
  count: number;
  isTetris: boolean;
  b2bApplied: boolean;
  combo: number; // raw combo counter after this clear (0 = first clear)
  b2bStreak: number;
  perfectClear: boolean;
  points: number;
}

export type TopOutKind = 'lock_out' | 'block_out';

export interface EngineEvents extends Record<string, unknown> {
  start: void;
  move: void;
  rotate: { kicked: boolean };
  softDropStep: void;
  hardDrop: { cells: Cell[]; distance: number; type: PieceType };
  lock: { type: PieceType; cells: Cell[]; dropType: DropType };
  lineClear: LineClearEvent;
  levelUp: { level: number };
  spawn: { type: PieceType };
  snapshot: MoveSnapshot;
  gameOver: { kind: TopOutKind; snapshot: MoveSnapshot };
  stateChange: { state: EngineState };
}

/**
 * Pure game logic: gravity, input timing (DAS/ARR), lock delay, line clears,
 * scoring and per-move state snapshots. No DOM, no rendering, no audio.
 * Time only advances through update(dtMs), so paused time never leaks into
 * telemetry and the engine can be driven deterministically in tests.
 */
export class GameEngine {
  readonly events = new EventEmitter<EngineEvents>();
  readonly board = new Board();
  private bag: BagRandomizer;

  private _state: EngineState = 'ready';
  private _active: Tetromino | null = null;

  // ---- progress ------------------------------------------------------------
  private _score = 0;
  private _level: number = GAME_CONFIG.startLevel;
  private _lines = 0;
  private _combo = -1; // -1 = no active combo
  private _b2b = 0;
  private lastClearWasTetris = false;
  private _moveCount = 0;
  private _gameTimeMs = 0;

  // ---- per piece -----------------------------------------------------------
  private pieceElapsedMs = 0;
  private inputsCount = 0;
  private rotationsCount = 0;
  private gravityAccMs = 0;
  private lockTimerMs = 0;
  private lockResets = 0;
  private lastSoftDropActiveAt = -Infinity;

  // ---- held input ----------------------------------------------------------
  private leftHeld = false;
  private rightHeld = false;
  private softHeld = false;
  private dasDir: -1 | 0 | 1 = 0;
  private dasHeldMs = 0;
  private arrAccMs = 0;

  constructor(random: RandomFn = Math.random) {
    this.bag = new BagRandomizer(GAME_CONFIG.previewCount, random);
  }

  // ===========================================================================
  // Public read API (renderer / main)
  // ===========================================================================
  get state(): EngineState { return this._state; }
  get active(): Tetromino | null { return this._active; }
  get score(): number { return this._score; }
  get level(): number { return this._level; }
  get lines(): number { return this._lines; }
  get comboCounter(): number { return Math.max(0, this._combo); }
  get b2bStreak(): number { return this._b2b; }
  get moveCount(): number { return this._moveCount; }
  get gameTimeMs(): number { return this._gameTimeMs; }
  get nextQueue(): PieceType[] { return this.bag.peek(GAME_CONFIG.previewCount); }

  /** 0..1 progress of the lock delay (for visual feedback). */
  get lockProgress(): number {
    return this._active && this.isGrounded() ? Math.min(1, this.lockTimerMs / GAME_CONFIG.lockDelayMs) : 0;
  }

  /** Y position the active piece would land on (ghost piece). */
  ghostY(): number {
    const p = this._active;
    if (!p) return 0;
    let y = p.y;
    while (this.board.isValid(p.cells(p.x, y + 1))) y++;
    return y;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================
  start(): void {
    this.board.reset();
    this.bag.reset();
    this._score = 0;
    this._level = GAME_CONFIG.startLevel;
    this._lines = 0;
    this._combo = -1;
    this._b2b = 0;
    this.lastClearWasTetris = false;
    this._moveCount = 0;
    this._gameTimeMs = 0;
    this.softHeld = this.leftHeld = this.rightHeld = false;
    this.dasDir = 0;
    this.setState('playing');
    this.events.emit('start', undefined);
    this.spawn(this.bag.next());
  }

  pause(): void {
    if (this._state === 'playing') this.setState('paused');
  }

  resume(): void {
    if (this._state === 'paused') this.setState('playing');
  }

  private setState(state: EngineState): void {
    this._state = state;
    this.events.emit('stateChange', { state });
  }

  // ===========================================================================
  // Input
  // ===========================================================================
  press(action: GameAction): void {
    if (this._state !== 'playing' || !this._active) {
      // Still track held keys so releasing them later stays consistent.
      this.trackHeld(action, true);
      return;
    }
    this.inputsCount++;
    switch (action) {
      case 'left':
      case 'right': {
        const dir = action === 'left' ? -1 : 1;
        this.trackHeld(action, true);
        this.dasDir = dir;
        this.dasHeldMs = 0;
        this.arrAccMs = 0;
        this.tryShift(dir);
        break;
      }
      case 'softDrop':
        this.softHeld = true;
        this.lastSoftDropActiveAt = this._gameTimeMs;
        // first row drops on the next update
        this.gravityAccMs = Math.max(this.gravityAccMs, this.currentDropInterval());
        break;
      case 'hardDrop':
        this.hardDrop();
        break;
      case 'rotateCW':
        this.tryRotate(1);
        break;
      case 'rotateCCW':
        this.tryRotate(-1);
        break;
    }
  }

  release(action: GameAction): void {
    this.trackHeld(action, false);
    if (action === 'left' || action === 'right') {
      const dir = action === 'left' ? -1 : 1;
      if (this.dasDir === dir) {
        const other = dir === -1 ? this.rightHeld : this.leftHeld;
        this.dasDir = other ? (-dir as -1 | 1) : 0;
        this.dasHeldMs = 0;
        this.arrAccMs = 0;
      }
    } else if (action === 'softDrop') {
      if (this.softHeld) this.lastSoftDropActiveAt = this._gameTimeMs;
      this.softHeld = false;
    }
  }

  /** Release everything (used on blur / pause so keys don't get stuck). */
  releaseAll(): void {
    this.leftHeld = this.rightHeld = this.softHeld = false;
    this.dasDir = 0;
  }

  private trackHeld(action: GameAction, down: boolean): void {
    if (action === 'left') this.leftHeld = down;
    else if (action === 'right') this.rightHeld = down;
    else if (action === 'softDrop') this.softHeld = down && this._state === 'playing';
  }

  // ===========================================================================
  // Simulation
  // ===========================================================================
  update(dtRaw: number): void {
    if (this._state !== 'playing' || !this._active) return;
    const dt = Math.min(Math.max(dtRaw, 0), GAME_CONFIG.maxFrameDtMs);
    this._gameTimeMs += dt;
    this.pieceElapsedMs += dt;

    this.updateAutoShift(dt);
    if (!this._active) return;

    if (this.softHeld) this.lastSoftDropActiveAt = this._gameTimeMs;

    // ---- gravity -------------------------------------------------------------
    if (!this.isGrounded()) {
      this.gravityAccMs += dt;
      const interval = this.currentDropInterval();
      while (this.gravityAccMs >= interval && !this.isGrounded()) {
        this.gravityAccMs -= interval;
        this._active.y++;
        this.lockTimerMs = 0;
        if (this.softHeld) {
          this._score += GAME_CONFIG.scoring.softDropPerCell;
          this.events.emit('softDropStep', undefined);
        }
      }
    }

    // ---- lock delay -------------------------------------------------------------
    if (this.isGrounded()) {
      this.gravityAccMs = 0;
      this.lockTimerMs += dt;
      if (this.lockTimerMs >= GAME_CONFIG.lockDelayMs) {
        const recentSoft = this.softHeld || this._gameTimeMs - this.lastSoftDropActiveAt <= GAME_CONFIG.softDropRecentMs;
        this.lockPiece(recentSoft ? 'soft_drop' : 'gravity_lock');
      }
    }
  }

  private currentDropInterval(): number {
    const g = dropIntervalMs(this._level);
    return this.softHeld ? Math.min(g, GAME_CONFIG.softDropIntervalMs) : g;
  }

  private updateAutoShift(dt: number): void {
    if (this.dasDir === 0) return;
    const das = GAME_CONFIG.dasMs;
    const arr = GAME_CONFIG.arrMs;
    const prev = this.dasHeldMs;
    this.dasHeldMs += dt;
    if (this.dasHeldMs < das) return;

    if (prev < das) {
      this.tryShift(this.dasDir);
      this.arrAccMs = this.dasHeldMs - das;
    } else {
      this.arrAccMs += dt;
    }
    if (arr <= 0) {
      while (this.tryShift(this.dasDir));
      this.arrAccMs = 0;
    } else {
      while (this.arrAccMs >= arr) {
        this.arrAccMs -= arr;
        if (!this.tryShift(this.dasDir)) {
          this.arrAccMs = 0;
          break;
        }
      }
    }
  }

  private isGrounded(): boolean {
    const p = this._active;
    return !!p && !this.board.isValid(p.cells(p.x, p.y + 1));
  }

  /** Successful move/rotation while on the ground resets the lock timer (max N times). */
  private onPieceManipulated(wasGrounded: boolean): void {
    if ((wasGrounded || this.isGrounded()) && this.lockResets < GAME_CONFIG.maxLockResets) {
      this.lockTimerMs = 0;
      this.lockResets++;
    }
  }

  private tryShift(dir: number): boolean {
    const p = this._active;
    if (!p) return false;
    if (!this.board.isValid(p.cells(p.x + dir, p.y))) return false;
    const wasGrounded = this.isGrounded();
    p.x += dir;
    this.onPieceManipulated(wasGrounded);
    this.events.emit('move', undefined);
    return true;
  }

  private tryRotate(dir: 1 | -1): boolean {
    const p = this._active;
    if (!p || !canRotate(p.type)) return false;
    const target = Tetromino.rotated(p.rotation, dir);
    const tests = kickTests(p.type);
    for (let i = 0; i < tests.length; i++) {
      const { x: dx, y: dy } = tests[i];
      if (this.board.isValid(p.cells(p.x + dx, p.y + dy, target))) {
        const wasGrounded = this.isGrounded();
        p.x += dx;
        p.y += dy;
        p.rotation = target;
        this.rotationsCount++;
        this.onPieceManipulated(wasGrounded);
        this.events.emit('rotate', { kicked: i > 0 });
        return true;
      }
    }
    return false;
  }

  private hardDrop(): void {
    const p = this._active;
    if (!p) return;
    const targetY = this.ghostY();
    const distance = targetY - p.y;
    p.y = targetY;
    this._score += distance * GAME_CONFIG.scoring.hardDropPerCell;
    this.events.emit('hardDrop', { cells: p.cells(), distance, type: p.type });
    this.lockPiece('hard_drop');
  }

  // ===========================================================================
  // Turn cycle: lock -> clear -> score/level -> spawn -> snapshot
  // ===========================================================================
  private lockPiece(dropType: DropType): void {
    const p = this._active;
    if (!p) return;
    const cells = p.cells();
    this.board.place(cells, p.type);
    this.events.emit('lock', { type: p.type, cells, dropType });

    // 2. line clears + scoring
    const lockedAboveVisible = this.board.allAboveVisible(cells);
    const clearedRows = this.board.clearFullLines();
    const n = clearedRows.length;
    let perfectClear = false;

    if (n > 0) {
      const levelAtClear = this._level;
      const s = GAME_CONFIG.scoring;
      this._combo += 1;
      let points = s.lineClear[n] * levelAtClear;
      let b2bApplied = false;
      if (n === 4) {
        if (this.lastClearWasTetris) {
          this._b2b += 1;
          points *= s.b2bMultiplier;
          b2bApplied = true;
        }
        this.lastClearWasTetris = true;
      } else {
        this._b2b = 0;
        this.lastClearWasTetris = false;
      }
      if (this._combo > 0) points += s.comboBonusPerStep * this._combo * levelAtClear;
      perfectClear = this.board.isEmpty();
      if (perfectClear) points += s.perfectClearBonus * levelAtClear;
      points = Math.floor(points);
      this._score += points;

      this._lines += n;
      const newLevel = levelForLines(this._lines);
      this.events.emit('lineClear', {
        rows: clearedRows,
        count: n,
        isTetris: n === 4,
        b2bApplied,
        combo: this._combo,
        b2bStreak: this._b2b,
        perfectClear,
        points,
      });
      if (newLevel !== this._level) {
        this._level = newLevel;
        this.events.emit('levelUp', { level: newLevel });
      }
    } else {
      this._combo = -1;
    }

    const placedPiece = p.type;
    const lockOut = lockedAboveVisible && n === 0;
    // capture per-piece counters before spawn() resets them
    const timeDelta = Math.round(this.pieceElapsedMs);
    const inputs = this.inputsCount;
    const rotations = this.rotationsCount;

    // 3. spawn next piece (always dealt, so current_piece/next_queue are consistent)
    const nextType = this.bag.next();
    const blockOut = !lockOut && !this.spawn(nextType);

    // 4. snapshot
    this._moveCount++;
    const snapshot: MoveSnapshot = {
      move_number: this._moveCount,
      placed_piece: placedPiece,
      current_piece: nextType,
      next_queue: this.bag.peek(GAME_CONFIG.previewCount),
      time_delta_ms: timeDelta,
      inputs_count: inputs,
      rotations_count: rotations,
      drop_type: dropType,
      score: this._score,
      level: this._level,
      lines_cleared_total: this._lines,
      lines_cleared_this_move: n,
      combo_counter: Math.max(0, this._combo),
      b2b_streak: this._b2b,
      perfect_clear: perfectClear,
      board: this.board.toLoggedRows(),
    };
    if (lockOut) this.resetPieceCounters();
    this.events.emit('snapshot', snapshot);

    if (lockOut || blockOut) {
      this._active = null;
      this.softHeld = false;
      this.setState('over');
      this.events.emit('gameOver', { kind: lockOut ? 'lock_out' : 'block_out', snapshot });
    }
  }

  private resetPieceCounters(): void {
    this.pieceElapsedMs = 0;
    this.inputsCount = 0;
    this.rotationsCount = 0;
    this.lockTimerMs = 0;
    this.lockResets = 0;
    this.gravityAccMs = 0;
  }

  /** Debug / test helper: replace the active piece with a freshly spawned one of the given type. */
  debugSpawn(type: PieceType): boolean {
    if (this._state !== 'playing') return false;
    return this.spawn(type);
  }

  /** Places a new piece at the top. Returns false on block out. */
  private spawn(type: PieceType): boolean {
    const piece = Tetromino.spawn(type);
    if (!this.board.isValid(piece.cells())) {
      this._active = null;
      return false;
    }
    // Guideline behaviour: drop one row immediately if possible so the piece
    // peeks into the visible field.
    if (this.board.isValid(piece.cells(piece.x, piece.y + 1))) piece.y++;
    this._active = piece;
    this.resetPieceCounters();
    this.events.emit('spawn', { type });
    return true;
  }
}
