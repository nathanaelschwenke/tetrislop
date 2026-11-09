/**
 * Headless engine tests. Run with:  npm test   (uses tsx, no browser needed)
 */
import assert from 'node:assert/strict';
import { dropIntervalMs, GAME_CONFIG } from '../src/config/gameConfig';
import { BagRandomizer, mulberry32 } from '../src/core/BagRandomizer';
import { GameEngine } from '../src/core/GameEngine';
import { PIECE_TYPES, type PieceType } from '../src/core/Tetromino';
import type { MoveSnapshot } from '../src/core/types';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

function newGame(seed = 1) {
  const engine = new GameEngine(mulberry32(seed));
  const snaps: MoveSnapshot[] = [];
  let over: string | null = null;
  engine.events.on('snapshot', (s) => snaps.push(s));
  engine.events.on('gameOver', (e) => (over = e.kind));
  engine.start();
  return { engine, snaps, isOver: () => over };
}

/** Fill visible bottom rows (board row indices) except the given columns. */
function fillRows(engine: GameEngine, rows: number[], holes: number[], type: PieceType = 'L') {
  for (const y of rows) {
    const cells = [];
    for (let x = 0; x < 10; x++) if (!holes.includes(x)) cells.push({ x, y });
    engine.board.place(cells, type);
  }
}

function tap(engine: GameEngine, action: Parameters<GameEngine['press']>[0], times = 1) {
  for (let i = 0; i < times; i++) {
    engine.press(action);
    engine.release(action);
  }
}

console.log('TetriSlop engine tests');

test('gravity curve matches spec', () => {
  assert.equal(dropIntervalMs(1), 800);
  assert.equal(dropIntervalMs(5), 398);
  assert.equal(dropIntervalMs(10), 167);
  assert.equal(dropIntervalMs(15), 70);
  assert.equal(dropIntervalMs(20), 35);
  assert.equal(dropIntervalMs(40), 35);
});

test('7-bag deals every piece exactly once per bag', () => {
  const bag = new BagRandomizer(3, mulberry32(42));
  for (let b = 0; b < 50; b++) {
    const seen = new Set<PieceType>();
    for (let i = 0; i < 7; i++) seen.add(bag.next());
    assert.equal(seen.size, 7);
    assert.equal(bag.peek().length, 3);
  }
});

test('snapshot after hard-dropped T matches the spec example', () => {
  const { engine, snaps } = newGame();
  engine.debugSpawn('T');
  const expectedNext = engine.nextQueue[0];
  for (let i = 0; i < 5; i++) engine.update(100); // frames are clamped to 100 ms
  tap(engine, 'hardDrop');
  assert.equal(snaps.length, 1);
  const s = snaps[0];
  assert.equal(s.move_number, 1);
  assert.equal(s.placed_piece, 'T');
  assert.equal(s.current_piece, expectedNext);
  assert.equal(s.current_piece, engine.active!.type);
  assert.deepEqual(s.next_queue, engine.nextQueue);
  assert.equal(s.next_queue.length, 3);
  assert.equal(s.drop_type, 'hard_drop');
  assert.equal(s.inputs_count, 1);
  assert.equal(s.time_delta_ms, 500);
  assert.equal(engine.active!.y, 1); // gravity at level 1 (800 ms/row) never ticked
  assert.equal(s.board.length, 20);
  assert.equal(s.board[18], '....T.....');
  assert.equal(s.board[19], '...TTT....');
  assert.ok(s.board.slice(0, 18).every((r) => r === '..........'));
  // T spawns on rows 1-2 (after the initial 1-row drop) and falls to rows 20-21: 19 cells * 2 pts
  assert.equal(s.score, 19 * 2);
});

test('tetris + perfect clear + b2b + combo scoring', () => {
  const { engine, snaps } = newGame();
  // 4 rows full except column 0 -> vertical I clears all and empties board
  fillRows(engine, [18, 19, 20, 21], [0]);
  engine.debugSpawn('I');
  tap(engine, 'rotateCW'); // vertical, column 5
  tap(engine, 'left', 5);
  assert.deepEqual(engine.active!.cells().map((c) => c.x), [0, 0, 0, 0]);
  tap(engine, 'hardDrop');
  let s = snaps.at(-1)!;
  assert.equal(s.lines_cleared_this_move, 4);
  assert.equal(s.perfect_clear, true);
  assert.equal(s.combo_counter, 0);
  assert.equal(s.b2b_streak, 0);
  assert.equal(s.rotations_count, 1);
  assert.equal(s.inputs_count, 7);
  const scoreAfterFirst = s.score;
  const hardDropPts1 = scoreAfterFirst - 800 - 2000;
  assert.ok(hardDropPts1 > 0 && hardDropPts1 % 2 === 0, `hard drop pts ${hardDropPts1}`);

  // second consecutive tetris: b2b x1.5, combo 1 (+50), perfect clear again (+2000)
  fillRows(engine, [18, 19, 20, 21], [0]);
  engine.debugSpawn('I');
  tap(engine, 'rotateCW');
  tap(engine, 'left', 5);
  tap(engine, 'hardDrop');
  s = snaps.at(-1)!;
  assert.equal(s.b2b_streak, 1);
  assert.equal(s.combo_counter, 1);
  assert.equal(s.lines_cleared_total, 8);
  assert.equal(s.level, 2); // floor(8 / 5) + 1
  const gained = s.score - scoreAfterFirst - hardDropPts1;
  assert.equal(gained, 800 * 1.5 + 50 * 1 * 1 + 2000); // scored at level 1 (level before clear)

  // non-clearing move: combo resets (logged 0), b2b persists
  engine.debugSpawn('O');
  tap(engine, 'hardDrop');
  s = snaps.at(-1)!;
  assert.equal(s.combo_counter, 0);
  assert.equal(s.b2b_streak, 1);
  assert.equal(s.perfect_clear, false);
});

test('single line clear resets b2b and scores 100 x level', () => {
  const { engine, snaps } = newGame();
  fillRows(engine, [21], [3, 4, 5, 6]);
  engine.debugSpawn('I'); // horizontal at x 3..6
  const before = engine.score;
  tap(engine, 'hardDrop');
  const s = snaps.at(-1)!;
  assert.equal(s.lines_cleared_this_move, 1);
  assert.equal(s.score - before, 100 + 2 * 19 + 2000); // single + hard drop + perfect clear
  assert.equal(s.b2b_streak, 0);
  assert.equal(s.perfect_clear, true);
});

test('wall kick: vertical I at right wall rotates back by kicking left', () => {
  const { engine } = newGame();
  engine.debugSpawn('I');
  tap(engine, 'rotateCW'); // vertical at column 5
  tap(engine, 'right', 6); // column 9 (wall)
  assert.ok(engine.active!.cells().every((c) => c.x === 9));
  tap(engine, 'rotateCW'); // state 2 needs columns 7..10 -> kick (-1, 0)
  const xs = engine.active!.cells().map((c) => c.x).sort();
  assert.deepEqual(xs, [6, 7, 8, 9]);
});

test('floor kick lifts a piece, never pushes it down', () => {
  // T flat on the floor (state 0), pointing up. Block the cells needed by
  // (0,0), (-1,0) and (+1,0) so only the floor kick (0,+1) works.
  const { engine: e } = newGame(3);
  e.debugSpawn('T');
  for (let i = 0; i < 400 && e.active!.y !== e.ghostY(); i++) e.update(100);
  const t = e.active!; // cells rows 20 (tip) / 21 (base), x = 3..5
  assert.deepEqual(t.cells().map((c) => c.y).sort(), [20, 21, 21, 21]);
  // state R = local (1,0),(1,1),(2,1),(1,2) needs row 22 (outside the board) for (0,0) and side kicks
  const yBefore = t.y;
  tap(e, 'rotateCW');
  assert.equal(e.active!.rotation, 1);
  assert.ok(e.active!.y <= yBefore, 'kick must never move the piece down');
  assert.ok(Math.max(...e.active!.cells().map((c) => c.y)) <= 21);
  assert.equal(e.active!.y, yBefore - 1, 'floor kick lifted the piece by one row');
});

test('lock delay: 500 ms on ground, then gravity_lock', () => {
  const { engine, snaps } = newGame();
  engine.debugSpawn('O');
  // let it fall to the floor at level 1 speed
  let guard = 0;
  while (engine.ghostY() !== engine.active!.y && guard++ < 1000) engine.update(16);
  assert.equal(snaps.length, 0);
  for (let i = 0; i < 4; i++) engine.update(100);
  assert.equal(snaps.length, 0);
  engine.update(100);
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].drop_type, 'gravity_lock');
  assert.equal(snaps[0].inputs_count, 0);
});

test('lock delay resets on movement at most 15 times', () => {
  const { engine, snaps } = newGame();
  engine.debugSpawn('O');
  let guard = 0;
  while (engine.ghostY() !== engine.active!.y && guard++ < 1000) engine.update(16);
  for (let i = 0; i < 20; i++) {
    for (let k = 0; k < 4; k++) engine.update(100);
    if (snaps.length) break;
    tap(engine, i % 2 ? 'left' : 'right');
  }
  // 15 resets x 400 ms survive, the 16th movement no longer resets the timer
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].inputs_count, 16);
});

test('soft drop scores 1 per cell and marks drop_type soft_drop', () => {
  const { engine, snaps } = newGame();
  engine.debugSpawn('O');
  engine.press('softDrop');
  let guard = 0;
  while (!snaps.length && guard++ < 500) engine.update(16);
  engine.release('softDrop');
  assert.equal(snaps[0].drop_type, 'soft_drop');
  assert.equal(snaps[0].score, 19); // O spawns rows 1-2 -> rows 20-21: 19 cells
});

test('DAS: one move on press, auto-repeat after 133 ms every 33 ms', () => {
  const { engine } = newGame();
  engine.debugSpawn('O');
  const x0 = engine.active!.x;
  engine.press('left');
  assert.equal(engine.active!.x, x0 - 1);
  engine.update(65);
  engine.update(65);
  assert.equal(engine.active!.x, x0 - 1);
  engine.update(5); // 135 ms -> first auto shift
  assert.equal(engine.active!.x, x0 - 2);
  engine.update(33);
  assert.equal(engine.active!.x, x0 - 3);
  engine.release('left');
  engine.update(100);
  assert.equal(engine.active!.x, x0 - 3);
});

test('lock out: piece locks completely above the visible rows -> top_out', () => {
  const { engine: e, snaps: sn, isOver: over } = newGame(7);
  // visible field full except column 0 (no line can complete with an O at columns 4-5)
  fillRows(e, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], [0]);
  e.debugSpawn('O');
  tap(e, 'hardDrop'); // O stays in rows 0-1 (hidden): lock out
  assert.equal(over(), 'lock_out');
  assert.equal(e.state, 'over');
  assert.equal(sn.length, 1);
  assert.equal(sn[0].move_number, 1);
  assert.equal(sn[0].board[0], '.LLLLLLLLL'); // hidden rows are not logged
});

test('block out: next piece cannot spawn', () => {
  const { engine: e, snaps, isOver } = newGame(9);
  // stack up to visible row 2 except where a vertical piece fits, then fill spawn row partially
  fillRows(e, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], [0]);
  fillRows(e, [2], [0, 1, 2, 3, 4, 5]);
  e.debugSpawn('O'); // O at columns 4-5, rows 0-1 -> drop: row 2 cols 4,5 free? yes -> lands rows 1-2
  tap(e, 'hardDrop');
  assert.equal(isOver(), 'block_out');
  assert.equal(snaps.length, 1);
  assert.ok(snaps[0].board[0].includes('O'));
});

test('engine ignores input and time while paused', () => {
  const { engine } = newGame();
  engine.debugSpawn('T');
  const y = engine.active!.y;
  engine.pause();
  engine.update(5000);
  engine.press('hardDrop');
  assert.equal(engine.active!.y, y);
  assert.equal(engine.moveCount, 0);
  engine.resume();
  for (let i = 0; i < 8; i++) engine.update(100);
  assert.equal(engine.active!.y, y + 1);
});

test('random long game (bot) stays consistent', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { engine, snaps, isOver } = newGame(seed);
    const rnd = mulberry32(seed * 99);
    const actions = ['left', 'right', 'rotateCW', 'rotateCCW'] as const;
    let guard = 0;
    while (!isOver() && guard++ < 5000) {
      const n = Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) tap(engine, actions[Math.floor(rnd() * 4)]);
      engine.update(16 + rnd() * 50);
      if (rnd() < 0.6) tap(engine, 'hardDrop');
    }
    assert.ok(isOver(), 'game should end');
    snaps.forEach((s, i) => {
      assert.equal(s.move_number, i + 1);
      assert.equal(s.board.length, 20);
      assert.ok(s.board.every((r) => /^[.IJLOSZT]{10}$/.test(r)));
      assert.equal(s.next_queue.length, GAME_CONFIG.previewCount);
      assert.ok(PIECE_TYPES.includes(s.current_piece));
      if (i > 0) {
        assert.ok(s.score >= snaps[i - 1].score);
        assert.equal(s.placed_piece, snaps[i - 1].current_piece);
        assert.deepEqual(s.next_queue.slice(0, 2), snaps[i - 1].next_queue.slice(1));
      }
    });
  }
});

console.log(`\n${passed} tests passed`);
