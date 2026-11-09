import { GAME_VERSION, TELEMETRY_CONFIG } from '../config/gameConfig';
import type { GameLog, InputDevice, MoveSnapshot, TerminationReason } from '../core/types';

export type UploadStatus = 'idle' | 'sending' | 'saved' | 'failed';

function uuidv4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for insecure contexts (e.g. testing over LAN http://)
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function loadPlayerId(): string {
  const key = TELEMETRY_CONFIG.playerIdStorageKey;
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = uuidv4();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return uuidv4(); // storage blocked: anonymous per-session id
  }
}

/**
 * Records per-move snapshots of one game and ships the complete log to the
 * backend. Delivery strategy:
 *  - final result (top_out / manual_restart): regular fetch POST with retries
 *  - tab hidden / every N moves: provisional "window_closed" checkpoint, which
 *    the backend overwrites (same game_id) once the final result arrives
 *  - page unload: navigator.sendBeacon (size-limited, best effort)
 */
export class DataLogger {
  readonly playerId = loadPlayerId();
  private gameId = '';
  private startedAt = '';
  private moves: MoveSnapshot[] = [];
  private device: InputDevice | null = null;
  private finalized = false;
  private lastCheckpointMoves = -1;
  private _status: UploadStatus = 'idle';
  onStatusChange: (status: UploadStatus) => void = () => {};

  get status(): UploadStatus { return this._status; }
  get active(): boolean { return !!this.gameId && !this.finalized; }
  get moveCount(): number { return this.moves.length; }
  get currentGameId(): string { return this.gameId; }

  startGame(): void {
    this.gameId = uuidv4();
    this.startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    this.moves = [];
    this.device = null;
    this.finalized = false;
    this.lastCheckpointMoves = -1;
    this.setStatus('idle');
  }

  noteInputDevice(device: Exclude<InputDevice, 'mixed'>): void {
    if (!this.active) return;
    if (this.device === null) this.device = device;
    else if (this.device !== device) this.device = 'mixed';
  }

  recordMove(snapshot: MoveSnapshot): void {
    if (!this.active) return;
    this.moves.push(snapshot);
    const every = TELEMETRY_CONFIG.checkpointEveryMoves;
    if (every > 0 && this.moves.length % every === 0) this.checkpoint();
  }

  buildPayload(reason: TerminationReason): GameLog {
    const last = this.moves[this.moves.length - 1];
    return {
      game_id: this.gameId,
      player_id: this.playerId,
      timestamp_utc: this.startedAt,
      game_version: GAME_VERSION,
      input_device: this.device ?? 'keyboard',
      termination_reason: reason,
      total_moves: this.moves.length,
      final_score: last?.score ?? 0,
      final_lines: last?.lines_cleared_total ?? 0,
      moves: this.moves,
    };
  }

  /** Ends the game and uploads the final log. Games without moves are dropped. */
  async finalize(reason: 'top_out' | 'manual_restart'): Promise<void> {
    if (!this.active) return;
    this.finalized = true;
    if (this.moves.length === 0) return;
    const payload = this.buildPayload(reason);
    this.setStatus('sending');
    const ok = await this.post(payload, 3);
    this.setStatus(ok ? 'saved' : 'failed');
  }

  /** Provisional save while the game is still running (tab hidden, every N moves). */
  checkpoint(): void {
    if (!this.active || this.moves.length === 0 || this.moves.length === this.lastCheckpointMoves) return;
    this.lastCheckpointMoves = this.moves.length;
    void this.post(this.buildPayload('window_closed'), 1);
  }

  /** Last-chance delivery on page unload. */
  flushOnUnload(): void {
    if (!this.active || this.moves.length === 0) return;
    if (this.moves.length === this.lastCheckpointMoves) return; // already stored
    const body = JSON.stringify(this.buildPayload('window_closed'));
    const blob = new Blob([body], { type: 'application/json' });
    let sent = false;
    if (blob.size <= TELEMETRY_CONFIG.beaconMaxBytes && navigator.sendBeacon) {
      sent = navigator.sendBeacon(TELEMETRY_CONFIG.endpoint, blob);
    }
    if (!sent) {
      // Too large for a beacon: keepalive fetch may still succeed in some browsers.
      try {
        void fetch(TELEMETRY_CONFIG.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: blob.size <= TELEMETRY_CONFIG.beaconMaxBytes,
        });
      } catch { /* page is going away */ }
    }
    this.lastCheckpointMoves = this.moves.length;
  }

  private async post(payload: GameLog, attempts: number): Promise<boolean> {
    const body = JSON.stringify(payload);
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(TELEMETRY_CONFIG.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (res.ok) return true;
        if (res.status >= 400 && res.status < 500) {
          console.warn('[TetriSlop] game log rejected', res.status, await res.text().catch(() => ''));
          return false; // validation error: retrying will not help
        }
      } catch (err) {
        if (i === attempts - 1) console.warn('[TetriSlop] could not reach backend', err);
      }
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
    return false;
  }

  private setStatus(status: UploadStatus): void {
    this._status = status;
    this.onStatusChange(status);
  }
}
