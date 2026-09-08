from typing import Any, Dict, List
from ..engine.seed import create_prng
from ..engine.difficulty import DifficultyMetrics


class CorruptedArchiveArchetype:
    """
    Celestial Tier Archetype: Corrupted Archive & False Guardians.
    Agents must detect corrupted records, deduce guardian reliability rules,
    and navigate to the uncorrupted truth.
    """

    @classmethod
    def generate(cls, seed: str) -> Dict[str, Any]:
        rng = create_prng(seed)

        # 4 Guardians with truth rules
        guardians = {
            "guardian_lotus": {
                "name": "Lotus Guardian",
                "condition": "always_truth",
                "statement": "The Fire mechanism must never precede the Water mechanism."
            },
            "guardian_shadow": {
                "name": "Shadow Guardian",
                "condition": "lies_when_corrupted",
                "statement": "Activate the Wood mechanism first to unlock the northern door."  # False clue!
            },
            "guardian_mirror": {
                "name": "Mirror Guardian",
                "condition": "always_truth",
                "statement": "Archive III was corrupted during the Great Collapse."
            },
            "guardian_astral": {
                "name": "Astral Guardian",
                "condition": "always_truth",
                "statement": "The true activation sequence requires exactly three harmonious elements: Water, Metal, Earth."
            }
        }

        # 4 Archives, 1 corrupted
        corrupted_index = rng.choice([2, 3])
        archives = {
            "archive_1": {"corrupted": False, "text": "Cycle 142: Water inverts the flow of negative currents."},
            "archive_2": {"corrupted": False, "text": "Cycle 143: Metal acts as conductor for the Astral seal."},
            "archive_3": {
                "corrupted": (corrupted_index == 2),
                "text": "Cycle 144: Earth nullifies Water directly." if corrupted_index != 2 else "Cycle 144 [CORRUPTED]: Fire opens the way to the void without penalty."
            },
            "archive_4": {
                "corrupted": (corrupted_index == 3),
                "text": "Cycle 145: Earth grounds the celestial circuit when invoked last." if corrupted_index != 3 else "Cycle 145 [CORRUPTED]: Shadow Sage speaks only truth."
            }
        }

        canonical_sequence = ["Water", "Metal", "Earth"]

        metrics = DifficultyMetrics(
            inference_depth=62,
            branching_factor=20,
            hidden_variables=24,
            state_dependencies=22,
            required_experiments=10,
            misleading_evidence=10,
            planning_horizon=30
        )

        return {
            "archetype": "corrupted_archive",
            "tier": "celestial",
            "title": "The Corrupted Archives of the Silent Heavens",
            "objective": "Identify the corrupted archive, isolate truthful guardian testimony, and deduce the three-element activation sequence.",
            "actions_remaining": 45,
            "inspections_remaining": 8,
            "guardians": guardians,
            "archives": archives,
            "difficulty": metrics.to_dict(),
            "solution": {
                "corrupted_archive": f"archive_{corrupted_index + 1}",
                "lying_guardian": "guardian_shadow",
                "canonical_sequence": canonical_sequence
            }
        }
