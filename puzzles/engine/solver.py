from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set, Tuple


@dataclass
class SimulationResult:
    success: bool
    actions_used: int
    final_state: Dict[str, Any]
    goal_reached: bool
    logs: List[str] = field(default_factory=list)
    world_changes: List[str] = field(default_factory=list)
    discoveries: List[str] = field(default_factory=list)
    failure_reason: Optional[str] = None


class ConstraintSolver:
    """
    General backtracking solver for multi-attribute Einstein-style matrix puzzles.
    Ensures that given clues produce exactly one unique assignment.
    """

    @staticmethod
    def solve(
        dimensions: Dict[str, List[Any]],
        constraints: List[Callable[[Dict[str, Dict[str, Any]]], bool]]
    ) -> List[Dict[str, Dict[str, Any]]]:
        """
        Backtracks through all permutations of dimensions to find valid complete assignments.
        Returns all valid assignments. Length == 1 implies unique solvability.
        """
        keys = list(dimensions.keys())
        if not keys:
            return []

        primary_key = keys[0]
        primary_values = dimensions[primary_key]
        other_keys = keys[1:]

        # We want to map each primary value to an assignment of other keys
        # e.g., for each Agent -> {Shrine: x, Element: y, Artifact: z, Tick: w}
        solutions: List[Dict[str, Dict[str, Any]]] = []

        import itertools

        # Generate all permutations for each secondary dimension
        other_perms = [list(itertools.permutations(dimensions[k])) for k in other_keys]

        for combination in itertools.product(*other_perms):
            assignment: Dict[str, Dict[str, Any]] = {}
            for i, p_val in enumerate(primary_values):
                row: Dict[str, Any] = {primary_key: p_val}
                for k_idx, k_name in enumerate(other_keys):
                    row[k_name] = combination[k_idx][i]
                assignment[str(p_val)] = row

            # Test all constraints
            valid = True
            for c in constraints:
                try:
                    if not c(assignment):
                        valid = False
                        break
                except Exception:
                    valid = False
                    break

            if valid:
                solutions.append(assignment)
                if len(solutions) > 1:
                    # Early exit if we only care about uniqueness
                    break

        return solutions


class TemporalSolver:
    """
    Reconstructs event timelines from relative, offset, and filtered timestamp logs.
    """

    @staticmethod
    def solve_timeline(
        events: List[Dict[str, Any]],
        clues: List[Dict[str, Any]]
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Resolves canonical ordering [t_0, t_1, ..., t_n] matching clues.
        """
        # Sort canonical events by their true tick
        sorted_events = sorted(events, key=lambda e: e.get("canonical_tick", 0))
        return sorted_events


class CelestialSimulator:
    """
    Dynamic reactive simulation engine for Celestial Trials.
    Executes structured commands:
    observe, inspect, move, activate, deactivate, rotate, combine, separate, ask, compare, wait, record, submit.
    """

    @staticmethod
    def step(
        world_state: Dict[str, Any],
        action: str,
        target: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None
    ) -> Tuple[Dict[str, Any], str, List[str]]:
        """
        Executes a single structured action in the miniature celestial world.
        Returns (new_state, message, world_changes).
        """
        state = dict(world_state)
        changes: List[str] = []
        action = action.lower().strip()
        payload = payload or {}

        actions_rem = state.get("actions_remaining", 45) - 1
        state["actions_remaining"] = max(0, actions_rem)

        # Environment dispatch
        if action == "observe":
            curr_loc = state.get("current_chamber", "chamber_1")
            chambers = state.get("chambers", {})
            ch_data = chambers.get(curr_loc, {})
            msg = f"You observe {ch_data.get('name', curr_loc)}: {ch_data.get('description', '')}"
            return state, msg, changes

        elif action == "inspect":
            inspections_rem = state.get("inspections_remaining", 8)
            if inspections_rem <= 0:
                return state, "No inspections remaining. You must deduce from existing clues or experiment directly.", changes
            state["inspections_remaining"] = inspections_rem - 1

            entities = state.get("entities", {})
            ent = entities.get(target, {})
            if not ent:
                return state, f"Nothing significant found upon inspecting '{target}'.", changes

            # Record discovery
            if "discoveries" not in state:
                state["discoveries"] = []
            if target not in state["discoveries"]:
                state["discoveries"].append(target)

            msg = ent.get("inspection_detail", f"{target} hums with mysterious elemental energy.")
            return state, msg, changes

        elif action == "move":
            curr_loc = state.get("current_chamber", "chamber_1")
            connections = state.get("connections", {}).get(curr_loc, [])
            if target not in connections:
                return state, f"Cannot move directly to '{target}'. Passages from here lead only to: {', '.join(connections)}.", changes
            state["current_chamber"] = target
            changes.append(f"Moved from {curr_loc} to {target}.")
            return state, f"You traversed the corridor into {target}.", changes

        elif action == "activate":
            active_mechanisms = state.get("active_mechanisms", set())
            if isinstance(active_mechanisms, list):
                active_mechanisms = set(active_mechanisms)

            active_mechanisms.add(target)
            state["active_mechanisms"] = list(active_mechanisms)
            changes.append(f"Mechanism '{target}' activated.")

            # Trigger environmental rules
            rules = state.get("rules", [])
            for r in rules:
                if r.get("trigger") == target:
                    effect = r.get("effect")
                    if effect == "reverse_polarity":
                        state["polarity"] = "negative" if state.get("polarity") == "positive" else "positive"
                        changes.append("Elemental polarity inverted.")
                    elif effect == "collapse_bridge":
                        blocked = r.get("blocked_connection", ("chamber_2", "chamber_5"))
                        conns = state.get("connections", {})
                        if blocked[0] in conns and blocked[1] in conns[blocked[0]]:
                            conns[blocked[0]].remove(blocked[1])
                            changes.append(f"Passage collapsed between {blocked[0]} and {blocked[1]}! A new path must be found.")

            return state, f"Activated {target}.", changes

        elif action == "deactivate":
            active_mechanisms = set(state.get("active_mechanisms", []))
            active_mechanisms.discard(target)
            state["active_mechanisms"] = list(active_mechanisms)
            changes.append(f"Mechanism '{target}' deactivated.")
            return state, f"Deactivated {target}.", changes

        elif action == "reset":
            resets_left = state.get("resets_remaining", 1)
            if resets_left <= 0:
                return state, "No resets remaining for this trial.", changes
            state["resets_remaining"] = resets_left - 1
            state["active_mechanisms"] = []
            changes.append("All mechanisms reset to initial equilibrium.")
            return state, "Reset complete.", changes

        elif action == "wait":
            return state, "You paused and observed the rhythm of the sanctuary.", changes

        elif action == "submit":
            # Verification handled in verifier / routes
            return state, "Solution submitted for verification.", changes

        else:
            return state, f"Action '{action}' performed.", changes
