import json
import os
import sqlite3
import time
import uuid
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..engine.generator import MasterPuzzleGenerator
from ..engine.solver import CelestialSimulator
from ..engine.scoring import score_hard_attempt, score_celestial_attempt
from ..archetypes.hidden_machine import HiddenMachineArchetype

# Initialize Database for Puzzle Instances & Attempts
DB_PATH = os.environ.get("PUZZLE_DB_PATH", os.path.join(os.path.dirname(__file__), "../../data/puzzles.db"))
os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS puzzle_instances (
        id TEXT PRIMARY KEY,
        tier TEXT NOT NULL,
        archetype TEXT NOT NULL,
        seed_hash TEXT NOT NULL,
        world_state_encrypted TEXT NOT NULL,
        solution_encrypted TEXT NOT NULL,
        difficulty_score INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    )
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS puzzle_attempts (
        id TEXT PRIMARY KEY,
        puzzle_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        actions_used INTEGER DEFAULT 0,
        inspection_count INTEGER DEFAULT 0,
        answer TEXT,
        success INTEGER DEFAULT 0,
        score INTEGER DEFAULT 0,
        merit_awarded INTEGER DEFAULT 0,
        FOREIGN KEY (puzzle_id) REFERENCES puzzle_instances(id)
    )
    """)
    conn.commit()
    conn.close()


init_db()

app = FastAPI(title="Eastern Paradise Procedural Puzzle Engine", version="1.0.0")


class StartPuzzleRequest(BaseModel):
    tier: str = Field(default="hard", description="Tier: 'hard' or 'celestial'")
    archetype: Optional[str] = Field(default=None, description="Optional archetype name")
    seed: Optional[str] = Field(default=None, description="Optional secret seed")
    agent_id: Optional[str] = Field(default="guest_pilgrim", description="Agent/Player ID")


class ActionRequest(BaseModel):
    action: str = Field(..., description="Structured command: observe, inspect, move, activate, deactivate, test, reset, wait")
    target: Optional[str] = Field(default=None, description="Target entity, mechanism, or chamber")
    payload: Optional[Dict[str, Any]] = Field(default=None, description="Optional action payload (e.g. test inputs)")
    inputs: Optional[List[Any]] = Field(default=None, description="Convenience inputs for experiment/test")


class SubmitRequest(BaseModel):
    answer: Optional[Any] = Field(default=None, description="Submitted solution mapping, sequence, or target value")
    solution: Optional[Any] = Field(default=None, description="Alias for answer")


@app.post("/api/puzzles/start")
def start_puzzle(req: StartPuzzleRequest):
    tier = req.tier.lower().strip()
    if tier not in ["hard", "celestial"]:
        tier = "hard"

    puzzle_data = MasterPuzzleGenerator.generate(tier=tier, archetype=req.archetype, seed=req.seed)
    instance_id = f"{tier[:3]}_{uuid.uuid4().hex[:8]}"

    # Save full state server-side
    conn = get_db()
    cursor = conn.cursor()

    world_json = json.dumps(puzzle_data)
    sol_json = json.dumps(puzzle_data.get("solution", {}))
    diff_score = puzzle_data.get("difficulty", {}).get("score", 75)
    now = int(time.time())
    expires = now + (4 * 3600)  # 4 hours TTL

    cursor.execute("""
    INSERT INTO puzzle_instances (id, tier, archetype, seed_hash, world_state_encrypted, solution_encrypted, difficulty_score, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (instance_id, tier, puzzle_data["archetype"], puzzle_data["seed_hash"], world_json, sol_json, diff_score, now, expires))

    # Initialize attempt
    attempt_id = f"att_{uuid.uuid4().hex[:8]}"
    cursor.execute("""
    INSERT INTO puzzle_attempts (id, puzzle_id, agent_id, started_at, actions_used, inspection_count)
    VALUES (?, ?, ?, ?, 0, 0)
    """, (attempt_id, instance_id, req.agent_id, now))

    conn.commit()
    conn.close()

    # Build client-safe view (seed and solution stripped)
    client_view = {
        "instance_id": instance_id,
        "attempt_id": attempt_id,
        "tier": tier,
        "archetype": puzzle_data["archetype"],
        "title": puzzle_data.get("title", "Sanctuary Trial"),
        "objective": puzzle_data.get("objective", "Resolve the celestial challenge."),
        "actions_remaining": puzzle_data.get("actions_remaining", 45 if tier == "celestial" else 25),
        "difficulty": puzzle_data.get("difficulty", {}),
        "seed_hash": puzzle_data["seed_hash"]
    }

    # Include tier-specific client properties
    if tier == "hard":
        if "clues" in puzzle_data:
            client_view["clues"] = puzzle_data["clues"]
        if "dimensions" in puzzle_data:
            client_view["dimensions"] = puzzle_data["dimensions"]
        if "archive_logs" in puzzle_data:
            client_view["archive_logs"] = puzzle_data["archive_logs"]
        if "events" in puzzle_data:
            client_view["events"] = puzzle_data["events"]
        if "sample_experiments" in puzzle_data:
            client_view["sample_experiments"] = puzzle_data["sample_experiments"]
            client_view["target_input"] = puzzle_data.get("target_input")
            client_view["max_experiments"] = puzzle_data.get("max_experiments", 8)
    else:
        # Celestial client initial view
        client_view["current_chamber"] = puzzle_data.get("current_chamber", "chamber_1")
        client_view["chambers_visible"] = list(puzzle_data.get("chambers", {}).keys())
        client_view["inspections_remaining"] = puzzle_data.get("inspections_remaining", 8)
        client_view["initial_observation"] = {
            "current_location": puzzle_data.get("current_chamber"),
            "connected_passages": puzzle_data.get("connections", {}).get("chamber_1", [])
        }

    return client_view


@app.post("/api/puzzles/{id}/action")
def puzzle_action(id: str, req: ActionRequest):
    conn = get_db()
    cursor = conn.cursor()
    row = cursor.execute("SELECT * FROM puzzle_instances WHERE id = ?", (id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Puzzle instance '{id}' not found.")

    instance = dict(row)
    world_state = json.loads(instance["world_state_encrypted"])
    tier = instance["tier"]

    # Retrieve active attempt
    attempt_row = cursor.execute(
        "SELECT * FROM puzzle_attempts WHERE puzzle_id = ? ORDER BY started_at DESC LIMIT 1",
        (id,)
    ).fetchone()

    actions_used = (attempt_row["actions_used"] if attempt_row else 0) + 1
    inspections_used = attempt_row["inspection_count"] if attempt_row else 0
    if req.action.lower() == "inspect":
        inspections_used += 1

    action_name = req.action.lower().strip()
    result_text = ""
    world_changes: List[str] = []
    output_val = None

    if action_name in ["test", "experiment"] and world_state.get("archetype") == "hidden_machine":
        # Run black-box experiment
        inputs = req.inputs if req.inputs is not None else (req.payload.get("inputs", []) if req.payload else [])
        output_val = HiddenMachineArchetype.run_experiment(world_state, inputs)
        result_text = f"Device Output for [{' '.join(str(x) for x in inputs)}]: {output_val}"
        world_changes.append("Experiment recorded.")
    else:
        # Celestial simulator step
        world_state, result_text, world_changes = CelestialSimulator.step(
            world_state,
            action=req.action,
            target=req.target,
            payload=req.payload
        )

    # Persist updated state
    cursor.execute(
        "UPDATE puzzle_instances SET world_state_encrypted = ? WHERE id = ?",
        (json.dumps(world_state), id)
    )
    if attempt_row:
        cursor.execute(
            "UPDATE puzzle_attempts SET actions_used = ?, inspection_count = ? WHERE id = ?",
            (actions_used, inspections_used, attempt_row["id"])
        )

    conn.commit()
    conn.close()

    res = {
        "action": req.action,
        "result": result_text,
        "world_changes": world_changes,
        "actions_remaining": world_state.get("actions_remaining", max(0, 45 - actions_used)),
        "current_chamber": world_state.get("current_chamber"),
        "polarity": world_state.get("polarity"),
        "active_mechanisms": world_state.get("active_mechanisms", [])
    }
    if output_val is not None:
        res["output"] = output_val
    return res


@app.post("/api/puzzles/{id}/submit")
def submit_puzzle(id: str, req: SubmitRequest):
    conn = get_db()
    cursor = conn.cursor()
    row = cursor.execute("SELECT * FROM puzzle_instances WHERE id = ?", (id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Puzzle instance not found.")

    instance = dict(row)
    world_state = json.loads(instance["world_state_encrypted"])
    solution = json.loads(instance["solution_encrypted"])
    tier = instance["tier"]

    attempt_row = cursor.execute(
        "SELECT * FROM puzzle_attempts WHERE puzzle_id = ? ORDER BY started_at DESC LIMIT 1",
        (id,)
    ).fetchone()
    actions_used = attempt_row["actions_used"] if attempt_row else 10
    now = int(time.time())

    is_success = False
    details = ""

    # Deterministic verification based on archetype and tier
    archetype = instance["archetype"]
    submitted_ans = req.answer if req.answer is not None else req.solution

    if archetype == "constraint_grid":
        # Check submitted mapping
        submitted = submitted_ans or {}
        if isinstance(submitted, dict) and submitted == solution:
            is_success = True
        else:
            # Partial or canonical check
            correct_keys = sum(1 for k in solution if submitted.get(k) == solution[k])
            is_success = (correct_keys == len(solution))

    elif archetype == "temporal_chain":
        submitted_order = submitted_ans
        if isinstance(submitted_order, list):
            is_success = (submitted_order == solution.get("order"))
        elif isinstance(submitted_order, dict) and "order" in submitted_order:
            is_success = (submitted_order["order"] == solution.get("order"))

    elif archetype == "hidden_machine":
        submitted_val = req.answer
        expected_val = solution.get("target_output")
        is_success = (str(submitted_val).strip() == str(expected_val).strip())

    elif tier == "celestial":
        # Celestial goal checking
        target_ch = world_state.get("target_chamber") or solution.get("target_chamber")
        curr_ch = world_state.get("current_chamber")
        # Check if agent navigated to destination chamber and completed requirements
        if curr_ch == target_ch:
            is_success = True
        elif req.answer and req.answer == solution.get("canonical_sequence"):
            is_success = True
        elif req.answer and req.answer == solution.get("safe_route"):
            is_success = True

    # Compute score and rewards
    if is_success:
        if tier == "hard":
            score_data = score_hard_attempt(actions_used=actions_used, action_budget=25)
        else:
            score_data = score_celestial_attempt(
                actions_used=actions_used,
                action_budget=45,
                discoveries_count=len(world_state.get("discoveries", [])),
                total_discoveries=4
            )
        score_val = score_data.total_merit
        merit_awarded = score_data.total_merit
    else:
        score_val = 0
        merit_awarded = 0
        score_data = None

    if attempt_row:
        cursor.execute("""
        UPDATE puzzle_attempts
        SET completed_at = ?, answer = ?, success = ?, score = ?, merit_awarded = ?
        WHERE id = ?
        """, (now, str(req.answer), 1 if is_success else 0, score_val, merit_awarded, attempt_row["id"]))

    conn.commit()
    conn.close()

    return {
        "success": True,
        "is_correct": is_success,
        "score": score_val,
        "reward": merit_awarded,
        "merit_awarded": merit_awarded,
        "breakdown": score_data.to_dict() if score_data else {},
        "message": "Celestial trial completed and proven!" if is_success else "Solution verification failed. The sanctuary remains in equilibrium."
    }


@app.get("/api/puzzles/{id}/status")
def puzzle_status(id: str):
    conn = get_db()
    cursor = conn.cursor()
    row = cursor.execute("SELECT * FROM puzzle_instances WHERE id = ?", (id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Puzzle not found.")

    attempt = cursor.execute(
        "SELECT * FROM puzzle_attempts WHERE puzzle_id = ? ORDER BY started_at DESC LIMIT 1",
        (id,)
    ).fetchone()
    conn.close()

    inst = dict(row)
    world = json.loads(inst["world_state_encrypted"])
    is_completed = bool(attempt and attempt["completed_at"])

    return {
        "instance_id": id,
        "status": "completed" if is_completed else "active",
        "tier": inst["tier"],
        "archetype": inst["archetype"],
        "difficulty_score": inst["difficulty_score"],
        "actions_remaining": world.get("actions_remaining", 45),
        "attempt": dict(attempt) if attempt else None
    }


@app.get("/api/puzzles/leaderboard")
def puzzle_leaderboard(tier: Optional[str] = None):
    conn = get_db()
    cursor = conn.cursor()
    query = """
    SELECT a.id, a.puzzle_id, a.agent_id, a.score, a.merit_awarded, a.actions_used, a.completed_at, i.tier, i.archetype
    FROM puzzle_attempts a
    JOIN puzzle_instances i ON a.puzzle_id = i.id
    WHERE a.success = 1
    """
    params = []
    if tier:
        query += " AND i.tier = ?"
        params.append(tier.lower())
    query += " ORDER BY a.score DESC, a.actions_used ASC LIMIT 20"

    rows = cursor.execute(query, params).fetchall()
    conn.close()

    return {
        "leaderboard": [dict(r) for r in rows]
    }
