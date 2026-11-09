/**
 * Tetromino shapes, rotation states and the custom "SRS-lite" kick tables.
 *
 * Coordinate system: x grows to the right, y grows DOWNWARDS (row index).
 * Kick tables below are written as (dx, dy) with +y = UP (as in the spec)
 * and are converted when applied.
 */

export const PIECE_TYPES = ['I', 'J', 'L', 'O', 'S', 'Z', 'T'] as const;
export type PieceType = (typeof PIECE_TYPES)[number];

/** Rotation states 0, R, 2, L encoded as 0..3. */
export type RotationState = 0 | 1 | 2 | 3;
export const ROTATION_NAMES = ['0', 'R', '2', 'L'] as const;

export interface Cell {
  x: number;
  y: number;
}

interface ShapeDef {
  size: number; // bounding box size used for rotation
  cells: Cell[]; // spawn orientation (state 0)
  spawnX: number; // column of the bounding box's left edge at spawn
}

const SHAPES: Record<PieceType, ShapeDef> = {
  I: { size: 4, spawnX: 3, cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }] },
  J: { size: 3, spawnX: 3, cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }] },
  L: { size: 3, spawnX: 3, cells: [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }] },
  O: { size: 2, spawnX: 4, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
  S: { size: 3, spawnX: 3, cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
  Z: { size: 3, spawnX: 3, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }] },
  T: { size: 3, spawnX: 3, cells: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }] },
};

/** Clockwise rotation inside an n x n bounding box. */
function rotateCW(cells: Cell[], size: number): Cell[] {
  return cells.map(({ x, y }) => ({ x: size - 1 - y, y: x }));
}

/** Pre-computed local cells for every piece and rotation state. */
const ROTATIONS: Record<PieceType, Cell[][]> = (() => {
  const out = {} as Record<PieceType, Cell[][]>;
  for (const type of PIECE_TYPES) {
    const def = SHAPES[type];
    const states: Cell[][] = [def.cells];
    for (let i = 1; i < 4; i++) {
      states.push(type === 'O' ? def.cells : rotateCW(states[i - 1], def.size));
    }
    out[type] = states;
  }
  return out;
})();

/** Kick offsets tested AFTER (0, 0). (dx, dy) with +y = up. Never contains dy < 0. */
const KICKS_STANDARD: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [+1, 0],
  [0, +1], // floor kick
  [-1, +1],
  [+1, +1],
];

const KICKS_I: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [+1, 0],
  [-2, 0],
  [+2, 0],
  [0, +1], // floor kick
  [0, +2], // double floor kick
];

/** Offsets in board coordinates (y down), including the initial (0, 0) test. */
export function kickTests(type: PieceType): Cell[] {
  const table = type === 'I' ? KICKS_I : KICKS_STANDARD;
  return [{ x: 0, y: 0 }, ...table.map(([dx, dyUp]) => ({ x: dx, y: -dyUp }))];
}

export function localCells(type: PieceType, rotation: RotationState): Cell[] {
  return ROTATIONS[type][rotation];
}

export function spawnX(type: PieceType): number {
  return SHAPES[type].spawnX;
}

export function canRotate(type: PieceType): boolean {
  return type !== 'O';
}

/** An active (falling) piece. Immutable-ish value object. */
export class Tetromino {
  constructor(
    public readonly type: PieceType,
    public x: number,
    public y: number,
    public rotation: RotationState = 0,
  ) {}

  static spawn(type: PieceType): Tetromino {
    return new Tetromino(type, spawnX(type), 0, 0);
  }

  /** Absolute board cells for the current (or a hypothetical) placement. */
  cells(x = this.x, y = this.y, rotation: RotationState = this.rotation): Cell[] {
    return localCells(this.type, rotation).map((c) => ({ x: c.x + x, y: c.y + y }));
  }

  static rotated(rotation: RotationState, dir: 1 | -1): RotationState {
    return (((rotation + dir) % 4) + 4) % 4 as RotationState;
  }
}
