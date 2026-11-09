"""TetriSlop backend.

Phase 1: receives finished (or provisional) game logs and stores them as JSON.
Phase 2: will load the trained PyTorch model and answer /api/predict.

Run (from the backend/ folder):
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from schemas import GameLog, PredictionRequest, PredictionResponse
from storage import GameStore

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("TETRISLOP_DATA_DIR", BASE_DIR / "data"))
FRONTEND_DIST = Path(os.environ.get("TETRISLOP_FRONTEND_DIST", BASE_DIR.parent / "frontend" / "dist"))
CORS_ORIGINS = [o for o in os.environ.get("TETRISLOP_CORS_ORIGINS", "http://localhost:5173").split(",") if o]

log = logging.getLogger("tetrislop")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="TetriSlop", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

store = GameStore(DATA_DIR)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "model_loaded": predictor.loaded}


@app.get("/api/stats")
def stats() -> dict:
    return store.stats()


@app.post("/api/games")
def receive_game(game: GameLog) -> dict:
    result = store.save(game)
    log.info(
        "game %s reason=%s moves=%d score=%d -> %s/%s%s",
        game.game_id,
        game.termination_reason,
        game.total_moves,
        game.final_score,
        result.category,
        result.status,
        " (AFK)" if result.afk_flagged else "",
    )
    return {
        "status": result.status,
        "category": result.category,
        "afk_flagged": result.afk_flagged,
        "game_id": str(game.game_id),
    }


# ---------------------------------------------------------------------------
# Phase 2: live inference (placeholder until a model is trained)
# ---------------------------------------------------------------------------
class Predictor:
    """Wraps the PyTorch model. Phase 2: load weights in __init__ and implement predict()."""

    def __init__(self) -> None:
        self.loaded = False
        self.model_version: str | None = None

    def predict(self, req: PredictionRequest) -> PredictionResponse:
        # Phase 2: board tensor (1x20x10 or 7x20x10) + metadata MLP -> (mu, sigma^2)
        return PredictionResponse(available=False)


predictor = Predictor()


@app.post("/api/predict", response_model=PredictionResponse)
def predict(req: PredictionRequest) -> PredictionResponse:
    if not predictor.loaded:
        raise HTTPException(status_code=503, detail="No model loaded yet (Phase 2)")
    return predictor.predict(req)


# ---------------------------------------------------------------------------
# Serve the built frontend (npm run build) so testers only need one link.
# ---------------------------------------------------------------------------
if FRONTEND_DIST.is_dir():
    # Mounted last, so the /api routes above take precedence.
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
else:
    log.warning("frontend build not found at %s – run `npm run build` in frontend/ (dev: use Vite)", FRONTEND_DIST)
