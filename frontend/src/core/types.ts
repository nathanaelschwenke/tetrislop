import type { PieceType } from './Tetromino';

export type GameAction = 'left' | 'right' | 'softDrop' | 'hardDrop' | 'rotateCW' | 'rotateCCW';

export type DropType = 'hard_drop' | 'soft_drop' | 'gravity_lock';

export type TerminationReason = 'top_out' | 'manual_restart' | 'window_closed';

export type InputDevice = 'keyboard' | 'touch' | 'gamepad' | 'mixed';

export type EngineState = 'ready' | 'playing' | 'paused' | 'over';

/** One row of the `moves` array in the JSON log (exact schema, snake_case). */
export interface MoveSnapshot {
  move_number: number;
  placed_piece: PieceType;
  current_piece: PieceType;
  next_queue: PieceType[];
  time_delta_ms: number;
  inputs_count: number;
  rotations_count: number;
  drop_type: DropType;
  score: number;
  level: number;
  lines_cleared_total: number;
  lines_cleared_this_move: number;
  combo_counter: number;
  b2b_streak: number;
  perfect_clear: boolean;
  board: string[];
}

/** Complete game log = one row in the Supabase `games` table (top-level keys = columns). */
export interface GameLog {
  game_id: string;
  player_id: string;
  timestamp_utc: string;
  game_version: string;
  input_device: InputDevice;
  termination_reason: TerminationReason;
  is_afk: boolean;
  total_moves: number;
  final_score: number;
  final_lines: number;
  moves: MoveSnapshot[];
}
