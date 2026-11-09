#!/usr/bin/env python3
"""Export TetriSlop games from Supabase into one JSON file per game.

Default: only training-ready games (termination_reason = top_out, is_afk = false)
are written to  backend/data/top_out/<game_id>.json  – the input format of the
PyTorch dataset in Phase 2.

Credentials come from backend/.env (see .env.example):
    SUPABASE_URL=https://<project-ref>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=...   (bypasses RLS – keep it local, never commit)

Usage:
    python export_dataset.py                 # incremental: only games not yet on disk
    python export_dataset.py --overwrite     # re-download everything
    python export_dataset.py --all           # every game (incl. restarts/closed/AFK) -> data/all/
    python export_dataset.py --out ../dataset/top_out
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterator

import requests
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
TABLE = "games"

# Columns written to each file, in this order (= the client payload).
COLUMNS = [
    "game_id",
    "player_id",
    "timestamp_utc",
    "game_version",
    "input_device",
    "termination_reason",
    "is_afk",
    "total_moves",
    "final_score",
    "final_lines",
    "moves",
]

ID_PAGE_SIZE = 1000  # Supabase default max rows per request
ROW_BATCH_SIZE = 25  # full rows are large (moves jsonb), fetch them in small batches
TIMEOUT_S = 60


class ExportError(RuntimeError):
    pass


class SupabaseClient:
    def __init__(self, url: str, service_key: str) -> None:
        self.base = f"{url.rstrip('/')}/rest/v1/{TABLE}"
        self.session = requests.Session()
        self.session.headers.update(
            {
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Accept": "application/json",
            }
        )

    def _get(self, params: dict[str, str]) -> list[dict[str, Any]]:
        try:
            res = self.session.get(self.base, params=params, timeout=TIMEOUT_S)
        except requests.RequestException as exc:
            raise ExportError(f"cannot reach Supabase: {exc}") from exc
        if res.status_code != 200:
            raise ExportError(f"Supabase returned {res.status_code}: {res.text[:500]}")
        return res.json()

    def list_game_ids(self, filters: dict[str, str]) -> list[str]:
        ids: list[str] = []
        offset = 0
        while True:
            page = self._get(
                {
                    "select": "game_id",
                    "order": "timestamp_utc.asc,game_id.asc",
                    "limit": str(ID_PAGE_SIZE),
                    "offset": str(offset),
                    **filters,
                }
            )
            ids.extend(str(row["game_id"]) for row in page)
            if len(page) < ID_PAGE_SIZE:
                return ids
            offset += len(page)

    def fetch_games(self, game_ids: list[str]) -> Iterator[dict[str, Any]]:
        for i in range(0, len(game_ids), ROW_BATCH_SIZE):
            chunk = game_ids[i : i + ROW_BATCH_SIZE]
            yield from self._get({"select": ",".join(COLUMNS), "game_id": f"in.({','.join(chunk)})"})


def normalize(row: dict[str, Any]) -> dict[str, Any]:
    """Bring a DB row into the exact dataset format and sanity-check it."""
    game = {col: row.get(col) for col in COLUMNS}
    if isinstance(game["moves"], str):  # in case the column is text instead of jsonb
        game["moves"] = json.loads(game["moves"])
    moves = game["moves"]
    if not isinstance(moves, list) or not moves:
        raise ValueError("moves is empty or not a list")
    if game["total_moves"] != len(moves):
        raise ValueError(f"total_moves={game['total_moves']} but {len(moves)} moves")
    for i, m in enumerate(moves, start=1):
        if m.get("move_number") != i:
            raise ValueError(f"move {i} has move_number={m.get('move_number')}")
        board = m.get("board")
        if not (isinstance(board, list) and len(board) == 20 and all(isinstance(r, str) and len(r) == 10 for r in board)):
            raise ValueError(f"move {i} has an invalid board")
    return game


def write_json_atomic(path: Path, doc: dict[str, Any]) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--all", action="store_true", help="export every game, not only top_out & non-AFK")
    parser.add_argument("--out", type=Path, help="output folder (default: data/top_out or data/all)")
    parser.add_argument("--overwrite", action="store_true", help="re-download games that already exist on disk")
    parser.add_argument("--env-file", type=Path, default=HERE / ".env", help="path to the .env file")
    args = parser.parse_args(argv)

    load_dotenv(args.env_file)
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        print(f"SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (looked in {args.env_file})", file=sys.stderr)
        return 2

    filters = {} if args.all else {"termination_reason": "eq.top_out", "is_afk": "eq.false"}
    out_dir: Path = args.out or (HERE / "data" / ("all" if args.all else "top_out"))
    out_dir.mkdir(parents=True, exist_ok=True)

    client = SupabaseClient(url, key)
    try:
        ids = client.list_game_ids(filters)
        todo = ids if args.overwrite else [g for g in ids if not (out_dir / f"{g}.json").exists()]
        print(f"{len(ids)} games in Supabase{'' if args.all else ' (top_out, not AFK)'}, {len(todo)} to download -> {out_dir}")

        written = skipped = 0
        for row in client.fetch_games(todo):
            try:
                game = normalize(row)
            except (ValueError, json.JSONDecodeError) as exc:
                skipped += 1
                print(f"  skip {row.get('game_id')}: {exc}", file=sys.stderr)
                continue
            write_json_atomic(out_dir / f"{game['game_id']}.json", game)
            written += 1
    except ExportError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    total_files = sum(1 for _ in out_dir.glob("*.json"))
    print(f"done: {written} written, {skipped} invalid, {total_files} files in {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
