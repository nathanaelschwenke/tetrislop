import { GAME_VERSION, TELEMETRY_CONFIG } from '../config/gameConfig';
import type { GameLog, InputDevice, MoveSnapshot, TerminationReason } from '../core/types';
import { buildGameLog, isWorthSending } from './payload';
import { readSupabaseConfig, type SupabaseConfig } from './supabaseConfig';

/**
 * idle     game running, nothing sent yet
 * sending  upload in progress
 * saved    row inserted into Supabase
 * failed   upload failed (kept locally, retried on next page load)
 * local    Supabase not configured: log printed to the console
 * skipped  game too short (< minMoves), nothing sent
 */
export type UploadStatus = 'idle' | 'sending' | 'saved' | 'failed' | 'local' | 'skipped';

const PENDING_KEY = 'tetrislop.pending_games';
const MAX_PENDING = 20;

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

type SendResult = 'saved' | 'retry' | 'rejected';

/**
 * Records per-move snapshots of one game and inserts the finished log as one
 * row into Supabase (`POST /rest/v1/games`). Each game is sent at most once
 * (`hasSent`), because RLS only allows INSERT (no UPDATE / SELECT) for anon.
 *
 *  - top_out / manual_restart: sent when the game ends (with retries)
 *  - window_closed: sent on pagehide / beforeunload with `keepalive`
 *  - hiding the tab only pauses the game, nothing is sent
 */
export class DataLogger {
  readonly playerId = loadPlayerId();
  private gameId = '';
  private startedAt = '';
  private moves: MoveSnapshot[] = [];
  private device: InputDevice | null = null;
  private finalized = false;
  private hasSent = false;
  private _status: UploadStatus = 'idle';
  onStatusChange: (status: UploadStatus) => void = () => {};

  /** @param supabase connection settings (defaults to the Vite env; injectable for tests) */
  constructor(private readonly supabase: SupabaseConfig | null = readSupabaseConfig()) {
    if (!this.supabase) {
      console.info('[TetriSlop] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set – game logs are printed to the console.');
    } else {
      void this.retryPending();
    }
  }

  get status(): UploadStatus { return this._status; }
  get active(): boolean { return !!this.gameId && !this.finalized; }
  get moveCount(): number { return this.moves.length; }
  get currentGameId(): string { return this.gameId; }
  get remoteEnabled(): boolean { return this.supabase !== null; }

  startGame(): void {
    this.gameId = uuidv4();
    this.startedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    this.moves = [];
    this.device = null;
    this.finalized = false;
    this.hasSent = false;
    this.setStatus('idle');
  }

  noteInputDevice(device: Exclude<InputDevice, 'mixed'>): void {
    if (!this.active) return;
    if (this.device === null) this.device = device;
    else if (this.device !== device) this.device = 'mixed';
  }

  recordMove(snapshot: MoveSnapshot): void {
    if (this.active) this.moves.push(snapshot);
  }

  buildPayload(reason: TerminationReason): GameLog {
    return buildGameLog(
      {
        gameId: this.gameId,
        playerId: this.playerId,
        startedAtIso: this.startedAt,
        gameVersion: GAME_VERSION,
        inputDevice: this.device ?? 'keyboard',
      },
      this.moves,
      reason,
    );
  }

  /** Ends the game (top out or restart) and uploads it once. */
  async finalize(reason: 'top_out' | 'manual_restart'): Promise<void> {
    if (!this.active) return;
    this.finalized = true;
    await this.send(reason, false);
  }

  /** Last-chance delivery when the page is closed / navigated away. */
  flushOnUnload(): void {
    if (!this.active) return;
    this.finalized = true;
    void this.send('window_closed', true);
  }

  // ---------------------------------------------------------------------------
  private async send(reason: TerminationReason, unloading: boolean): Promise<void> {
    if (this.hasSent) return;
    if (!isWorthSending(this.moves)) {
      this.setStatus('skipped');
      return;
    }
    this.hasSent = true; // set before any await: prevents double inserts of the same game_id
    const gameId = this.gameId;
    // a restart starts the next game before this upload finishes: only report for the current one
    const report = (s: UploadStatus) => { if (this.gameId === gameId) this.setStatus(s); };

    const payload = this.buildPayload(reason);
    if (!this.supabase) {
      console.info(`[TetriSlop] game ${payload.game_id} (${reason}, ${payload.total_moves} moves) – not uploaded:`);
      console.log(JSON.stringify(payload));
      report('local');
      return;
    }

    const body = JSON.stringify(payload);
    report('sending');
    const attempts = unloading ? 1 : TELEMETRY_CONFIG.maxAttempts;
    let result: SendResult = 'retry';
    for (let i = 0; i < attempts && result === 'retry'; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 700 * i));
      result = await this.insert(this.supabase, body);
    }
    if (result === 'retry' && !unloading) this.storePending(body);
    report(result === 'saved' ? 'saved' : 'failed');
  }

  /** One INSERT via the Supabase REST API (PostgREST). */
  private async insert(cfg: SupabaseConfig, body: string): Promise<SendResult> {
    const bytes = new TextEncoder().encode(body).length;
    try {
      const res = await fetch(`${cfg.url}/rest/v1/${TELEMETRY_CONFIG.table}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: cfg.anonKey,
          Authorization: `Bearer ${cfg.anonKey}`,
          Prefer: 'return=minimal', // anon has no SELECT permission -> must not ask for the row back
        },
        body,
        // keepalive lets the request outlive the page, but browsers cap it at 64 KiB
        keepalive: bytes <= TELEMETRY_CONFIG.keepaliveMaxBytes,
      });
      if (res.ok) return 'saved';
      if (res.status === 409) return 'saved'; // duplicate game_id: this game is already stored
      const detail = await res.text().catch(() => '');
      console.warn(`[TetriSlop] Supabase rejected the game log (${res.status})`, detail);
      return res.status >= 500 || res.status === 429 ? 'retry' : 'rejected';
    } catch (err) {
      console.warn('[TetriSlop] could not reach Supabase', err);
      return 'retry';
    }
  }

  // ---- offline queue: failed final uploads are retried on the next page load ----
  private storePending(body: string): void {
    try {
      const list: string[] = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]');
      list.push(body);
      localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
    } catch { /* storage full or blocked: give up on this game */ }
  }

  private async retryPending(): Promise<void> {
    if (!this.supabase) return;
    let list: string[];
    try {
      list = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]');
    } catch {
      return;
    }
    if (!Array.isArray(list) || list.length === 0) return;
    const remaining: string[] = [];
    for (const body of list) {
      if ((await this.insert(this.supabase, body)) === 'retry') remaining.push(body);
    }
    try {
      if (remaining.length) localStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
      else localStorage.removeItem(PENDING_KEY);
    } catch { /* ignore */ }
  }

  private setStatus(status: UploadStatus): void {
    this._status = status;
    this.onStatusChange(status);
  }
}
