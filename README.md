# TetriSlop – Phase 1: Game & Data Collection

Web Tetris clone that records every placed piece as a telemetry snapshot for the
survival-prediction model (Phase 2). Spec: `../claude.md`, project outline: `../outline.md`.

```
backend/   FastAPI – validates and stores game logs (data/top_out, data/aborted)
frontend/  Vite + TypeScript + Canvas + Web Audio – the game
```

## Run locally (development)

```bash
# 1) backend  (Python ≥ 3.10)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 2) frontend (Node ≥ 18), second terminal
cd frontend
npm install
npm run dev          # http://localhost:5173  (proxies /api -> :8000)
```

Phones in the same Wi-Fi can open `http://<your-LAN-IP>:5173` (touch controls appear automatically).

## Deploy for testers (single link)

```bash
cd frontend && npm run build            # -> frontend/dist
cd ../backend && uvicorn main:app --host 0.0.0.0 --port 8000
```

FastAPI then serves the game **and** the API on one origin (needed for `sendBeacon`).
For testers outside your network put a tunnel/reverse proxy in front (e.g. `cloudflared tunnel --url http://localhost:8000`).

Env vars: `TETRISLOP_DATA_DIR`, `TETRISLOP_FRONTEND_DIST`, `TETRISLOP_CORS_ORIGINS`.

## Tests

```bash
cd frontend && npm test                  # headless engine tests (scoring, kicks, DAS, lock delay, top-out, snapshots)
cd backend  && python tests/test_storage.py   # schema validation + storage rules
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

## Data collection – how the log is produced

Snapshot cycle per move: *lock → clear lines → score/level/combo/b2b/perfect clear → next piece spawns → snapshot*.

Implementation decisions on top of `claude.md`:

- **Final move on top out is logged.** For a lock out, the board after locking is stored and `current_piece`
  is the piece that would have spawned; for a block out, `current_piece` is the piece that could not spawn.
  So `total_moves − move_number = 0` on the last row.
- **`time_delta_ms`** = time from the piece's spawn to its lock, game time only (pauses are excluded).
- **`inputs_count`** = real presses of game keys/buttons during the piece (auto-repeat from DAS and OS key repeat are not counted).
  **`rotations_count`** = successful rotations.
- **`combo_counter`** is logged as `max(0, combo)` (internal −1 → 0), as in the spec. Use `lines_cleared_this_move`
  to tell "no clear" from "first clear".
- **`input_device`** = `keyboard`, `touch`, or `mixed` if both were used in one game.
- **Tab hidden / window blur** → game pauses; on hidden a provisional log with `termination_reason: "window_closed"`
  is sent. Additionally a checkpoint is sent every 10 moves, and a `sendBeacon` on page unload.
  The backend keeps one file per `game_id`: a final log (`top_out`/`manual_restart`) replaces checkpoints,
  checkpoints never replace a final log. So a closed tab leaves at most ≤ 10 moves missing even if the beacon is dropped.
- **AFK**: if the last 5 moves have `inputs_count == 0` and `gravity_lock`, the game is stored in `aborted/`
  with `server_meta.afk_flagged = true`.
- Every stored file gets an extra `server_meta` block (`received_utc`, `category`, `afk_flagged`); everything else is the exact client schema.
- Games with 0 moves (e.g. immediate restart) are not sent.

## Phase 2 hooks already in place

- `SynthEngine.setTensionState(t)` and `Renderer.setTensionVisuals(t)` / `setVisualModulation({...})`.
  In Phase 1 tension comes from a mild stack-height heuristic in `main.ts`; swap it via
  `window.__tetrislop.setTensionProvider(() => prediction)`.
- `POST /api/predict` + `Predictor` class in `backend/main.py` (returns 503 until a model is loaded).
- Debug console: `__tetrislop.renderer.setVisualModulation({ hueShiftDeg: 40 })`, `__tetrislop.synth.setPresetParams('hardDrop', { baseFrequencyHz: 120 })`.
