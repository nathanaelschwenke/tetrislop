/**
 * Pure helpers for building the game log payload (no DOM, no env access),
 * so they can be unit-tested headlessly.
 */
import { TELEMETRY_CONFIG } from '../config/gameConfig';
import type { GameLog, InputDevice, MoveSnapshot, TerminationReason } from '../core/types';

/** true if there are at least N moves and the last N had no input and were gravity-locked. */
export function computeIsAfk(moves: readonly MoveSnapshot[], window: number = TELEMETRY_CONFIG.afkWindow): boolean {
  if (moves.length < window) return false;
  return moves.slice(-window).every((m) => m.inputs_count === 0 && m.drop_type === 'gravity_lock');
}

/** Games shorter than this are never sent. */
export function isWorthSending(moves: readonly MoveSnapshot[]): boolean {
  return moves.length >= TELEMETRY_CONFIG.minMoves;
}

export interface PayloadMeta {
  gameId: string;
  playerId: string;
  startedAtIso: string;
  gameVersion: string;
  inputDevice: InputDevice;
}

/** Builds the row exactly as stored in Supabase (top-level keys = table columns). */
export function buildGameLog(meta: PayloadMeta, moves: MoveSnapshot[], reason: TerminationReason): GameLog {
  const last = moves[moves.length - 1];
  return {
    game_id: meta.gameId,
    player_id: meta.playerId,
    timestamp_utc: meta.startedAtIso,
    game_version: meta.gameVersion,
    input_device: meta.inputDevice,
    termination_reason: reason,
    is_afk: computeIsAfk(moves),
    total_moves: moves.length,
    final_score: last?.score ?? 0,
    final_lines: last?.lines_cleared_total ?? 0,
    moves,
  };
}
