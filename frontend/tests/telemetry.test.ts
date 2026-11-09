/**
 * Headless telemetry tests (payload shape, AFK rule, Supabase request, single send).
 * Run with:  npm test
 */
import assert from 'node:assert/strict';
import type { DropType, MoveSnapshot } from '../src/core/types';
import { DataLogger } from '../src/telemetry/DataLogger';
import { buildGameLog, computeIsAfk, isWorthSending } from '../src/telemetry/payload';

// ---- minimal browser shims for node ------------------------------------------------
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
interface Call { url: string; init: RequestInit }
let calls: Call[] = [];
let nextStatus = 201;
(globalThis as any).fetch = async (url: string, init: RequestInit) => {
  calls.push({ url, init });
  if (nextStatus === 0) throw new TypeError('network down');
  return new Response(null, { status: nextStatus });
};
const quiet = { info: console.info, log: console.log, warn: console.warn };
const silence = () => { console.info = console.log = console.warn = () => {}; };
const restore = () => Object.assign(console, quiet);

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  calls = [];
  nextStatus = 201;
  store.clear();
  silence();
  try {
    await fn();
    restore();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    restore();
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function move(n: number, inputs = 2, drop: DropType = 'hard_drop'): MoveSnapshot {
  return {
    move_number: n, placed_piece: 'T', current_piece: 'I', next_queue: ['L', 'O', 'S'],
    time_delta_ms: 900, inputs_count: inputs, rotations_count: 0, drop_type: drop,
    score: n * 10, level: 1, lines_cleared_total: n, lines_cleared_this_move: 1,
    combo_counter: 0, b2b_streak: 0, perfect_clear: false, board: Array(20).fill('..........'),
  };
}
const moves = (n: number, afkTail = 0) =>
  Array.from({ length: n }, (_, i) => (i >= n - afkTail ? move(i + 1, 0, 'gravity_lock') : move(i + 1)));

const CFG = { url: 'https://demo.supabase.co', anonKey: 'anon-key' };
const COLUMNS = [
  'game_id', 'player_id', 'timestamp_utc', 'game_version', 'input_device', 'termination_reason',
  'is_afk', 'total_moves', 'final_score', 'final_lines', 'moves',
];

function playMoves(logger: DataLogger, n: number, afkTail = 0) {
  logger.startGame();
  logger.noteInputDevice('keyboard');
  moves(n, afkTail).forEach((m) => logger.recordMove(m));
}

console.log('TetriSlop telemetry tests');

await test('is_afk: needs >= 5 moves, last 5 without input and gravity-locked', () => {
  assert.equal(computeIsAfk(moves(4, 4)), false);
  assert.equal(computeIsAfk(moves(5, 5)), true);
  assert.equal(computeIsAfk(moves(20, 5)), true);
  assert.equal(computeIsAfk(moves(20, 4)), false);
  const m = moves(10, 5);
  m[8].drop_type = 'soft_drop';
  assert.equal(computeIsAfk(m), false);
});

await test('games with < 3 moves are not worth sending', () => {
  assert.equal(isWorthSending(moves(2)), false);
  assert.equal(isWorthSending(moves(3)), true);
});

await test('payload has exactly the table columns', () => {
  const log = buildGameLog(
    { gameId: 'g', playerId: 'p', startedAtIso: '2026-11-09T17:00:00Z', gameVersion: '1.0.0', inputDevice: 'touch' },
    moves(7),
    'top_out',
  );
  assert.deepEqual(Object.keys(log), COLUMNS);
  assert.equal(log.total_moves, 7);
  assert.equal(log.final_score, 70);
  assert.equal(log.final_lines, 7);
  assert.equal(log.is_afk, false);
  assert.ok(Array.isArray(log.moves));
});

await test('top_out is inserted once via Supabase REST with the required headers', async () => {
  const logger = new DataLogger(CFG);
  playMoves(logger, 12);
  await logger.finalize('top_out');
  await logger.finalize('top_out'); // ignored: game already finalized
  logger.flushOnUnload(); // ignored: game no longer active
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://demo.supabase.co/rest/v1/games');
  assert.equal(init.method, 'POST');
  assert.equal(init.keepalive, true);
  const h = init.headers as Record<string, string>;
  assert.equal(h['Content-Type'], 'application/json');
  assert.equal(h.apikey, 'anon-key');
  assert.equal(h.Authorization, 'Bearer anon-key');
  assert.equal(h.Prefer, 'return=minimal');
  const body = JSON.parse(init.body as string);
  assert.deepEqual(Object.keys(body), COLUMNS);
  assert.equal(body.termination_reason, 'top_out');
  assert.equal(body.total_moves, 12);
  assert.equal(logger.status, 'saved');
});

await test('window_closed on unload is sent once with keepalive', async () => {
  const logger = new DataLogger(CFG);
  playMoves(logger, 6, 5);
  logger.flushOnUnload(); // pagehide
  logger.flushOnUnload(); // beforeunload
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body as string);
  assert.equal(body.termination_reason, 'window_closed');
  assert.equal(body.is_afk, true);
  assert.equal(calls[0].init.keepalive, true);
});

await test('short games (< 3 moves) are skipped', async () => {
  const logger = new DataLogger(CFG);
  playMoves(logger, 2);
  await logger.finalize('manual_restart');
  assert.equal(calls.length, 0);
  assert.equal(logger.status, 'skipped');
});

await test('payloads > 60 KB are sent without keepalive (browser limit)', async () => {
  const logger = new DataLogger(CFG);
  playMoves(logger, 200);
  await logger.finalize('top_out');
  assert.equal(calls.length, 1);
  assert.ok((calls[0].init.body as string).length > 60_000);
  assert.equal(calls[0].init.keepalive, false);
});

await test('409 duplicate counts as saved, 4xx is not retried, network errors are queued', async () => {
  let logger = new DataLogger(CFG);
  nextStatus = 409;
  playMoves(logger, 5);
  await logger.finalize('top_out');
  assert.equal(logger.status, 'saved');

  calls = [];
  nextStatus = 401;
  logger = new DataLogger(CFG);
  playMoves(logger, 5);
  await logger.finalize('top_out');
  assert.equal(calls.length, 1);
  assert.equal(logger.status, 'failed');
  assert.equal(store.get('tetrislop.pending_games'), undefined);

  calls = [];
  nextStatus = 0; // network down
  logger = new DataLogger(CFG);
  playMoves(logger, 5);
  await logger.finalize('top_out');
  assert.equal(calls.length, 3);
  assert.equal(JSON.parse(store.get('tetrislop.pending_games')!).length, 1);

  // next page load: pending game is retried and removed
  calls = [];
  nextStatus = 201;
  new DataLogger(CFG);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls.length, 1);
  assert.equal(store.get('tetrislop.pending_games'), undefined);
});

await test('without Supabase config the log goes to the console and nothing crashes', async () => {
  const printed: unknown[] = [];
  console.log = (...a: unknown[]) => printed.push(a);
  const logger = new DataLogger(null);
  playMoves(logger, 4);
  await logger.finalize('top_out');
  assert.equal(calls.length, 0);
  assert.equal(logger.status, 'local');
  assert.equal(printed.length, 1);
});

console.log(`\n${passed} tests passed`);
