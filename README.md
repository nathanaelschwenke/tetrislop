# TetriSlop – Phase 1: Game & Data Collection

Web Tetris clone that records every placed piece as a telemetry snapshot for the
survival-prediction model (Phase 2).

Fully serverless:

```
frontend/   Vite + TypeScript + Canvas + Web Audio – static site on GitHub Pages
            └─ inserts one row per finished game directly into Supabase (REST, anon key, INSERT-only RLS)
supabase/   schema.sql – table + Row Level Security policy
backend/    export_dataset.py – local script: Supabase -> data/top_out/<game_id>.json for PyTorch
.github/    workflows/deploy.yml – build + deploy to GitHub Pages on every push to main
```

## 1. Supabase setup (once)

1. Create a project on supabase.com.
2. SQL editor → run [`supabase/schema.sql`](supabase/schema.sql) (table `games`, checks, RLS: anon may only INSERT).
3. Project Settings → API: copy the **Project URL**, the **anon public key** and the **service_role key**.

## 2. Run the game locally

```bash
cd frontend
cp .env.example .env.local     # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev                    # http://localhost:5173 (also reachable from phones in the LAN)
```

Without `.env.local` the game runs normally and prints each finished game as JSON to the browser console.

## 3. Deploy to GitHub Pages

1. Push the repo to GitHub.
2. Repo → Settings → Secrets and variables → Actions → add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Repo → Settings → Pages → Source: **GitHub Actions**.
4. Every push to `main` runs tests, builds `frontend/` and publishes it at `https://<user>.github.io/<repo>/`
   (`base: './'` keeps all paths relative).

The anon key ends up in the public JS bundle – that is intended. RLS allows anonymous users only to insert;
reading, updating and deleting rows is impossible with it. Never put the service role key into the frontend.

## 4. Export the dataset for PyTorch

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env           # SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
python export_dataset.py       # top_out & not AFK -> data/top_out/<game_id>.json
```

- Incremental: games already on disk are skipped (`--overwrite` re-downloads).
- `--all` exports every game (restarts, closed windows, AFK) to `data/all/`.
- `--out DIR` changes the target folder.
- Each row is sanity-checked (move numbering, `total_moves`, 20×10 boards); broken rows are reported and skipped.

## Tests

```bash
cd frontend && npm test        # engine (scoring, kicks, DAS, lock delay, top-out, snapshots) + telemetry
```

## Controls

| Keyboard              | Touch | Action        |
|-----------------------|-------|---------------|
| ← →                   | ◀ ▶   | move (DAS 133 ms / ARR 33 ms) |
| ↑ / X                 | ⟳     | rotate right  |
| Z / Y / Ctrl          | ⟲     | rotate left   |
| ↓                     | ▼     | soft drop     |
| Space                 | ⤓     | hard drop     |
| P / Esc               | ❚❚    | pause         |
| R                     | ↻     | restart (touch: first tap pauses, second restarts) |
| M                     | ♪     | mute          |

## Data collection – how a game log is produced

Snapshot cycle per move: *lock → clear lines → score/level/combo/b2b/perfect clear → next piece spawns → snapshot*.

One row per game in `games`, columns = top-level JSON keys:
`game_id, player_id, timestamp_utc, game_version, input_device, termination_reason, is_afk, total_moves, final_score, final_lines, moves`.

Sending rules (`frontend/src/telemetry/DataLogger.ts`):

- **Once per game.** RLS allows INSERT only (no UPDATE/SELECT), so every game is sent exactly once
  (`hasSent`), with `Prefer: return=minimal`. A duplicate `game_id` (HTTP 409) counts as already saved.
- **When:** `top_out` and `manual_restart` when the game ends; `window_closed` on `pagehide`/`beforeunload`
  via `fetch(..., { keepalive: true })`. Hiding the tab only **pauses** – nothing is sent.
- **Short games** (`total_moves < 3`) are never sent.
- **`is_afk`** is computed in the browser: ≥ 5 moves and the last 5 all have `inputs_count == 0` and `drop_type == "gravity_lock"`.
- **keepalive limit:** browsers reject keepalive bodies above 64 KiB (≈ 100+ moves). Larger games are sent
  without keepalive – fine for `top_out`/`manual_restart` (page stays open), best effort for very long games closed mid-run.
- **Offline:** if a final upload fails (network / 5xx, after 3 attempts) it is stored in `localStorage`
  and retried on the next visit.

Field semantics:

- **Final move on top out is logged** (`total_moves − move_number = 0` on the last row). For a lock out,
  `current_piece` is the piece that would have spawned; for a block out, the piece that could not spawn.
- **`time_delta_ms`** = time from the piece's spawn to its lock, game time only (pauses excluded).
- **`inputs_count`** = real presses of game keys/buttons (no DAS / OS auto-repeat); **`rotations_count`** = successful rotations.
- **`combo_counter`** is `max(0, combo)` (internal −1 → 0). Use `lines_cleared_this_move` to tell "no clear" from "first clear".
- **`input_device`** = `keyboard`, `touch`, or `mixed` if both were used.

## Phase 2/3 hooks

- `SynthEngine.setTensionState(t)`, `Renderer.setTensionVisuals(t)` / `setVisualModulation({...})`.
  Phase 1 uses a mild stack-height heuristic in `main.ts`; swap it via
  `window.__tetrislop.setTensionProvider(() => prediction)`.
- With no server, live inference in Phase 3 has to run in the browser (e.g. export the PyTorch model to ONNX and use `onnxruntime-web`).
- Debug console: `__tetrislop.renderer.setVisualModulation({ hueShiftDeg: 40 })`, `__tetrislop.synth.setPresetParams('hardDrop', { baseFrequencyHz: 120 })`.
