import sys
import os
import json

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from puzzles.api.routes import (
    start_puzzle,
    puzzle_action,
    submit_puzzle,
    puzzle_status,
    puzzle_leaderboard,
    StartPuzzleRequest,
    ActionRequest,
    SubmitRequest
)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing command"}))
        sys.exit(1)

    cmd = sys.argv[1].lower()

    try:
        if cmd == "start":
            payload = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
            req = StartPuzzleRequest(**payload)
            res = start_puzzle(req)
            print(json.dumps(res))

        elif cmd == "action":
            puzzle_id = sys.argv[2]
            payload = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
            req = ActionRequest(**payload)
            res = puzzle_action(puzzle_id, req)
            print(json.dumps(res))

        elif cmd == "submit":
            puzzle_id = sys.argv[2]
            payload = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
            req = SubmitRequest(**payload)
            res = submit_puzzle(puzzle_id, req)
            print(json.dumps(res))

        elif cmd == "status":
            puzzle_id = sys.argv[2]
            res = puzzle_status(puzzle_id)
            print(json.dumps(res))

        elif cmd == "leaderboard":
            tier = sys.argv[2] if len(sys.argv) > 2 else None
            res = puzzle_leaderboard(tier=tier)
            print(json.dumps(res))

        else:
            print(json.dumps({"error": f"Unknown command: {cmd}"}))
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"error": str(e), "success": False}))
        sys.exit(1)


if __name__ == "__main__":
    main()
