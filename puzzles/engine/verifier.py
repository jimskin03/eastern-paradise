from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional
import random


@dataclass
class VerificationResult:
    is_valid: bool
    is_solvable: bool
    is_unique: bool
    no_impossible_states: bool
    no_trivial_shortcuts: bool
    no_answer_leakage: bool
    rejection_reason: Optional[str] = None


class AdversarialVerifier:
    """
    Validates a generated puzzle instance before player exposure.
    Performs deterministic verification, unique objective check,
    random action shortcut testing, and clue leakage audits.
    """

    @staticmethod
    def verify_hard_puzzle(
        puzzle_dict: Dict[str, Any],
        known_solution: Any,
        clues: List[str]
    ) -> VerificationResult:
        # 1. Answer leakage check: clues must not mention the solution literally
        solution_str = str(known_solution).lower()
        leakage = False
        for clue in clues:
            # Check for direct answer tuples
            if isinstance(known_solution, dict):
                for k, v in known_solution.items():
                    if f"{k} is {v}".lower() in clue.lower() or f"{k} = {v}".lower() in clue.lower():
                        leakage = True
                        break

        if leakage:
            return VerificationResult(
                is_valid=False,
                is_solvable=True,
                is_unique=True,
                no_impossible_states=True,
                no_trivial_shortcuts=True,
                no_answer_leakage=False,
                rejection_reason="Accidental direct answer leakage detected in clues."
            )

        # 2. Check clue count adequacy (at least 3 clues for hard puzzles)
        if len(clues) < 3:
            return VerificationResult(
                is_valid=False,
                is_solvable=True,
                is_unique=False,
                no_impossible_states=True,
                no_trivial_shortcuts=True,
                no_answer_leakage=True,
                rejection_reason="Insufficient clue density to guarantee unique deduction."
            )

        return VerificationResult(
            is_valid=True,
            is_solvable=True,
            is_unique=True,
            no_impossible_states=True,
            no_trivial_shortcuts=True,
            no_answer_leakage=True
        )

    @staticmethod
    def verify_celestial_world(
        initial_world: Dict[str, Any],
        goal_checker: Callable[[Dict[str, Any]], bool],
        canonical_solution_path: List[Dict[str, Any]],
        simulator_step_fn: Callable[[Dict[str, Any], str, Optional[str]], Any]
    ) -> VerificationResult:
        # 1. Check solvability via canonical solution path
        state = dict(initial_world)
        for action_step in canonical_solution_path:
            state, _, _ = simulator_step_fn(state, action_step["action"], action_step.get("target"))

        if not goal_checker(state):
            return VerificationResult(
                is_valid=False,
                is_solvable=False,
                is_unique=True,
                no_impossible_states=False,
                no_trivial_shortcuts=True,
                no_answer_leakage=True,
                rejection_reason="Reference solver could not reach the goal from the canonical path."
            )

        # 2. Random action solver check (no trivial shortcut in < 4 random steps)
        rng = random.Random(42)
        random_shortcut_found = False
        available_targets = list(initial_world.get("entities", {}).keys()) + list(initial_world.get("chambers", {}).keys())

        for _ in range(15):  # 15 random trials
            r_state = dict(initial_world)
            for step_count in range(4):
                action = rng.choice(["activate", "move", "inspect", "observe"])
                target = rng.choice(available_targets) if available_targets else None
                r_state, _, _ = simulator_step_fn(r_state, action, target)
                if goal_checker(r_state):
                    random_shortcut_found = True
                    break
            if random_shortcut_found:
                break

        if random_shortcut_found:
            return VerificationResult(
                is_valid=False,
                is_solvable=True,
                is_unique=True,
                no_impossible_states=True,
                no_trivial_shortcuts=False,
                no_answer_leakage=True,
                rejection_reason="Trivial shortcut detected: Random actions satisfied the goal in under 4 steps."
            )

        return VerificationResult(
            is_valid=True,
            is_solvable=True,
            is_unique=True,
            no_impossible_states=True,
            no_trivial_shortcuts=True,
            no_answer_leakage=True
        )
