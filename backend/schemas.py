"""Pydantic models for TetriSlop game logs (validated on POST /api/games)."""

from __future__ import annotations

import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PieceType = Literal["I", "J", "L", "O", "S", "Z", "T"]
DropType = Literal["hard_drop", "soft_drop", "gravity_lock"]
TerminationReason = Literal["top_out", "manual_restart", "window_closed"]
InputDevice = Literal["keyboard", "touch", "mixed"]

BOARD_ROWS = 20
BOARD_COLS = 10
PREVIEW_COUNT = 3
_ROW_RE = re.compile(rf"^[.IJLOSZT]{{{BOARD_COLS}}}$")

# Hard upper bound to protect the server from absurd payloads (~a few MB).
MAX_MOVES = 10_000


class Move(BaseModel):
    model_config = ConfigDict(extra="forbid")

    move_number: int = Field(ge=1)
    placed_piece: PieceType
    current_piece: PieceType
    next_queue: list[PieceType] = Field(min_length=PREVIEW_COUNT, max_length=PREVIEW_COUNT)
    time_delta_ms: int = Field(ge=0)
    inputs_count: int = Field(ge=0)
    rotations_count: int = Field(ge=0)
    drop_type: DropType
    score: int = Field(ge=0)
    level: int = Field(ge=1)
    lines_cleared_total: int = Field(ge=0)
    lines_cleared_this_move: int = Field(ge=0, le=4)
    combo_counter: int = Field(ge=0)
    b2b_streak: int = Field(ge=0)
    perfect_clear: bool
    board: list[str] = Field(min_length=BOARD_ROWS, max_length=BOARD_ROWS)

    @field_validator("board")
    @classmethod
    def _check_rows(cls, rows: list[str]) -> list[str]:
        for i, row in enumerate(rows):
            if not _ROW_RE.match(row):
                raise ValueError(f"board row {i} must be {BOARD_COLS} chars of '.IJLOSZT', got {row!r}")
        return rows


class GameLog(BaseModel):
    model_config = ConfigDict(extra="forbid")

    game_id: UUID
    player_id: UUID
    timestamp_utc: str = Field(max_length=40)
    game_version: str = Field(max_length=20)
    input_device: InputDevice
    termination_reason: TerminationReason
    total_moves: int = Field(ge=0)
    final_score: int = Field(ge=0)
    final_lines: int = Field(ge=0)
    moves: list[Move] = Field(max_length=MAX_MOVES)

    @model_validator(mode="after")
    def _consistency(self) -> "GameLog":
        if self.total_moves != len(self.moves):
            raise ValueError(f"total_moves={self.total_moves} but {len(self.moves)} moves sent")
        for i, m in enumerate(self.moves, start=1):
            if m.move_number != i:
                raise ValueError(f"moves must be numbered 1..n consecutively (index {i} has {m.move_number})")
        if self.moves:
            last = self.moves[-1]
            if self.final_score != last.score or self.final_lines != last.lines_cleared_total:
                raise ValueError("final_score / final_lines do not match the last move")
        return self


# ---- Phase 2 (prediction) ------------------------------------------------------
class PredictionRequest(BaseModel):
    """One live move from a running game; history is kept client-side (e.g. last 5 moves)."""

    model_config = ConfigDict(extra="forbid")

    game_id: UUID
    moves: list[Move] = Field(min_length=1, max_length=16)


class PredictionResponse(BaseModel):
    available: bool
    mu: float | None = None  # predicted remaining moves (clipped horizon)
    sigma2: float | None = None  # predicted variance (GaussianNLL head)
    model_version: str | None = None
