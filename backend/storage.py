"""File-based storage for game logs.

Layout:
    data/top_out/<game_id>.json   valid training games (ended by top out, not AFK)
    data/aborted/<game_id>.json   manual restarts, closed windows, AFK games

A game can arrive several times under the same game_id: the client sends
provisional "window_closed" checkpoints while playing and the final log at
the end. Rules:
  * a final log (top_out / manual_restart) always replaces a checkpoint
  * a checkpoint never replaces a final log
  * a checkpoint only replaces an older checkpoint with fewer moves
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from schemas import GameLog

AFK_WINDOW = 5  # last N moves without input + gravity lock => AFK
FINAL_REASONS = {"top_out", "manual_restart"}


def is_afk(game: GameLog, window: int = AFK_WINDOW) -> bool:
    """AFK if the last `window` moves had no input and were locked by gravity."""
    if len(game.moves) < window:
        return False
    tail = game.moves[-window:]
    return all(m.inputs_count == 0 and m.drop_type == "gravity_lock" for m in tail)


@dataclass
class SaveResult:
    status: str  # "stored" | "replaced" | "ignored"
    category: str  # "top_out" | "aborted"
    afk_flagged: bool
    path: Path | None


class GameStore:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = Path(data_dir)
        self.top_out_dir = self.data_dir / "top_out"
        self.aborted_dir = self.data_dir / "aborted"
        self.top_out_dir.mkdir(parents=True, exist_ok=True)
        self.aborted_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    # ---- helpers -------------------------------------------------------------
    def _paths(self, game_id: str) -> list[Path]:
        return [self.top_out_dir / f"{game_id}.json", self.aborted_dir / f"{game_id}.json"]

    @staticmethod
    def _read_meta(path: Path) -> dict[str, Any] | None:
        try:
            with path.open("r", encoding="utf-8") as f:
                doc = json.load(f)
            return {"termination_reason": doc.get("termination_reason"), "total_moves": doc.get("total_moves", 0)}
        except (OSError, json.JSONDecodeError):
            return None

    @staticmethod
    def _atomic_write(path: Path, doc: dict[str, Any]) -> None:
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    # ---- API -----------------------------------------------------------------
    def save(self, game: GameLog) -> SaveResult:
        game_id = str(game.game_id)  # UUID-validated -> safe as a filename
        afk = is_afk(game)
        category = "top_out" if game.termination_reason == "top_out" and not afk else "aborted"
        incoming_final = game.termination_reason in FINAL_REASONS

        with self._lock:
            existing = [(p, self._read_meta(p)) for p in self._paths(game_id) if p.exists()]
            for _, meta in existing:
                if meta is None:
                    continue
                existing_final = meta["termination_reason"] in FINAL_REASONS
                if existing_final and not incoming_final:
                    return SaveResult("ignored", category, afk, None)
                if not existing_final and not incoming_final and meta["total_moves"] >= game.total_moves:
                    return SaveResult("ignored", category, afk, None)

            doc = game.model_dump(mode="json")
            doc["server_meta"] = {
                "received_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "category": category,
                "afk_flagged": afk,
            }
            target = (self.top_out_dir if category == "top_out" else self.aborted_dir) / f"{game_id}.json"
            self._atomic_write(target, doc)
            for p, _ in existing:
                if p != target:
                    p.unlink(missing_ok=True)
            return SaveResult("replaced" if existing else "stored", category, afk, target)

    def stats(self) -> dict[str, int]:
        top = sum(1 for _ in self.top_out_dir.glob("*.json"))
        aborted = sum(1 for _ in self.aborted_dir.glob("*.json"))
        return {"top_out": top, "aborted": aborted, "total": top + aborted}
