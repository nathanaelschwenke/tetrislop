/**
 * Central gameplay configuration for TetriSlop.
 * Everything that influences game feel or scoring lives here so that the
 * telemetry produced in Phase 1 can be reproduced exactly in later phases.
 */

export const GAME_VERSION = '1.0.0';

export const GAME_CONFIG = {
  // ---- Board ---------------------------------------------------------------
  cols: 10,
  visibleRows: 20,
  hiddenRows: 2, // invisible spawn/buffer rows above the visible field
  previewCount: 3, // size of the visible next queue

  // ---- Input ---------------------------------------------------------------
  dasMs: 133, // Delayed Auto Shift
  arrMs: 33, // Auto Repeat Rate (0 = instant to wall)
  softDropIntervalMs: 33, // row interval while soft drop is held (capped by gravity)
  softDropRecentMs: 100, // soft drop within this window before lock => drop_type "soft_drop"

  // ---- Lock delay ----------------------------------------------------------
  lockDelayMs: 500,
  maxLockResets: 15, // per piece

  // ---- Levels --------------------------------------------------------------
  startLevel: 1,
  linesPerLevel: 5,

  // ---- Scoring -------------------------------------------------------------
  scoring: {
    lineClear: [0, 100, 300, 500, 800] as readonly number[], // index = lines cleared, x level
    comboBonusPerStep: 50, // 50 * combo_counter * level
    b2bMultiplier: 1.5, // applied to the 4-line clear base score
    perfectClearBonus: 2000, // x level
    softDropPerCell: 1,
    hardDropPerCell: 2,
  },

  // ---- Loop safety -----------------------------------------------------------
  maxFrameDtMs: 100, // clamp huge frame gaps (e.g. debugger, tab throttling)
} as const;

/** Gravity speed: milliseconds per row drop for a given level. */
export function dropIntervalMs(level: number): number {
  return Math.max(35, Math.round(800 * Math.pow(0.84, level - 1)));
}

/** Level derived from total cleared lines (fixed start at level 1). */
export function levelForLines(linesClearedTotal: number): number {
  return Math.floor(linesClearedTotal / GAME_CONFIG.linesPerLevel) + GAME_CONFIG.startLevel;
}

export const TELEMETRY_CONFIG = {
  endpoint: '/api/games',
  /** Send a provisional "window_closed" checkpoint every N moves (0 = off). */
  checkpointEveryMoves: 10,
  /** sendBeacon / keepalive payloads above this size are not reliable. */
  beaconMaxBytes: 60_000,
  playerIdStorageKey: 'tetrislop.player_id',
} as const;
