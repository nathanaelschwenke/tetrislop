"""Backend tests without FastAPI: schema validation + storage rules.
Run from backend/:  python -m pytest tests  (or: python tests/test_storage.py)
"""
import json
import sys
import tempfile
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError  # noqa: E402

from schemas import GameLog  # noqa: E402
from storage import GameStore, is_afk  # noqa: E402

EMPTY = ".........."


def make_move(n, inputs=3, drop="hard_drop", score=None):
    board = [EMPTY] * 18 + ["....T.....", "...TTT...."]
    return {
        "move_number": n, "placed_piece": "T", "current_piece": "I", "next_queue": ["L", "O", "S"],
        "time_delta_ms": 1000, "inputs_count": inputs, "rotations_count": 1, "drop_type": drop,
        "score": score if score is not None else n * 10, "level": 1, "lines_cleared_total": 0,
        "lines_cleared_this_move": 0, "combo_counter": 0, "b2b_streak": 0, "perfect_clear": False,
        "board": board,
    }


def make_game(n_moves, reason="top_out", gid=None, afk_tail=0):
    moves = [make_move(i) for i in range(1, n_moves + 1)]
    for m in moves[len(moves) - afk_tail:] if afk_tail else []:
        m["inputs_count"] = 0
        m["drop_type"] = "gravity_lock"
    return {
        "game_id": gid or str(uuid.uuid4()), "player_id": str(uuid.uuid4()),
        "timestamp_utc": "2026-11-07T17:00:00Z", "game_version": "1.0.0", "input_device": "keyboard",
        "termination_reason": reason, "total_moves": n_moves,
        "final_score": moves[-1]["score"] if moves else 0, "final_lines": 0, "moves": moves,
    }


def test_valid_game_parses():
    g = GameLog.model_validate(make_game(12))
    assert g.total_moves == 12


def test_rejects_bad_board_and_counts():
    bad = make_game(3)
    bad["moves"][0]["board"][0] = "....X....."
    for doc in (bad,):
        try:
            GameLog.model_validate(doc)
            raise AssertionError("should fail")
        except ValidationError:
            pass
    bad = make_game(3)
    bad["total_moves"] = 4
    try:
        GameLog.model_validate(bad)
        raise AssertionError("should fail")
    except ValidationError:
        pass
    bad = make_game(3)
    bad["game_id"] = "../../etc/passwd"
    try:
        GameLog.model_validate(bad)
        raise AssertionError("should fail")
    except ValidationError:
        pass


def test_afk_detection():
    assert is_afk(GameLog.model_validate(make_game(20, afk_tail=5)))
    assert not is_afk(GameLog.model_validate(make_game(20, afk_tail=4)))


def test_storage_rules():
    with tempfile.TemporaryDirectory() as d:
        store = GameStore(Path(d))
        gid = str(uuid.uuid4())
        # checkpoint stored in aborted
        r = store.save(GameLog.model_validate(make_game(10, "window_closed", gid)))
        assert (r.status, r.category) == ("stored", "aborted")
        # newer checkpoint replaces, older one is ignored
        assert store.save(GameLog.model_validate(make_game(20, "window_closed", gid))).status == "replaced"
        assert store.save(GameLog.model_validate(make_game(15, "window_closed", gid))).status == "ignored"
        # final top_out moves the game to top_out/ and removes the checkpoint
        r = store.save(GameLog.model_validate(make_game(25, "top_out", gid)))
        assert (r.status, r.category) == ("replaced", "top_out")
        assert (Path(d) / "top_out" / f"{gid}.json").exists()
        assert not (Path(d) / "aborted" / f"{gid}.json").exists()
        # late checkpoint never overwrites the final log
        assert store.save(GameLog.model_validate(make_game(30, "window_closed", gid))).status == "ignored"
        doc = json.loads((Path(d) / "top_out" / f"{gid}.json").read_text())
        assert doc["total_moves"] == 25 and doc["server_meta"]["category"] == "top_out"
        # AFK top-out goes to aborted with a flag
        r = store.save(GameLog.model_validate(make_game(30, "top_out", afk_tail=5)))
        assert r.category == "aborted" and r.afk_flagged
        assert store.stats() == {"top_out": 1, "aborted": 1, "total": 2}


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("  ✓", name)
    print("all backend tests passed")
