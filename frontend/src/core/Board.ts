import { GAME_CONFIG } from '../config/gameConfig';
import type { Cell, PieceType } from './Tetromino';

export type CellValue = PieceType | null;

/**
 * 10 x 22 grid: rows 0..1 are the hidden spawn/buffer rows,
 * rows 2..21 are the 20 visible rows (top to bottom).
 */
export class Board {
  readonly cols = GAME_CONFIG.cols;
  readonly hiddenRows = GAME_CONFIG.hiddenRows;
  readonly rows = GAME_CONFIG.visibleRows + GAME_CONFIG.hiddenRows;
  private grid: CellValue[][];

  constructor() {
    this.grid = Board.emptyGrid(this.rows, this.cols);
  }

  private static emptyGrid(rows: number, cols: number): CellValue[][] {
    return Array.from({ length: rows }, () => Array<CellValue>(cols).fill(null));
  }

  reset(): void {
    this.grid = Board.emptyGrid(this.rows, this.cols);
  }

  get(x: number, y: number): CellValue {
    return this.grid[y]?.[x] ?? null;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
  }

  /** True if every cell is inside the grid and unoccupied. */
  isValid(cells: Cell[]): boolean {
    for (const { x, y } of cells) {
      if (!this.inBounds(x, y) || this.grid[y][x] !== null) return false;
    }
    return true;
  }

  place(cells: Cell[], type: PieceType): void {
    for (const { x, y } of cells) this.grid[y][x] = type;
  }

  /** Removes full rows, shifts everything above down. Returns the cleared row indices. */
  clearFullLines(): number[] {
    const cleared: number[] = [];
    for (let y = 0; y < this.rows; y++) {
      if (this.grid[y].every((c) => c !== null)) cleared.push(y);
    }
    if (cleared.length === 0) return cleared;
    const remaining = this.grid.filter((_, y) => !cleared.includes(y));
    const fresh = Board.emptyGrid(cleared.length, this.cols);
    this.grid = [...fresh, ...remaining];
    return cleared;
  }

  isEmpty(): boolean {
    return this.grid.every((row) => row.every((c) => c === null));
  }

  /** True if all given cells lie in the hidden rows (lock out). */
  allAboveVisible(cells: Cell[]): boolean {
    return cells.every(({ y }) => y < this.hiddenRows);
  }

  /** Height of the stack in visible rows (0 = empty, 20 = touching the top). */
  stackHeight(): number {
    for (let y = 0; y < this.rows; y++) {
      if (this.grid[y].some((c) => c !== null)) return this.rows - y;
    }
    return 0;
  }

  /** Logged representation: the 20 visible rows, top to bottom, '.' = empty. */
  toLoggedRows(): string[] {
    const out: string[] = [];
    for (let y = this.hiddenRows; y < this.rows; y++) {
      out.push(this.grid[y].map((c) => c ?? '.').join(''));
    }
    return out;
  }

  /** Read-only view for the renderer. */
  rowsView(): ReadonlyArray<ReadonlyArray<CellValue>> {
    return this.grid;
  }
}
