from typing import Any, Dict, List
from ..engine.seed import create_prng
from ..engine.difficulty import DifficultyMetrics


class HiddenMachineArchetype:
    """
    Black-box arithmetic/combinatorial state machine.
    Requires active experimentation through /action (test queries)
    to infer hidden mathematical transformations and evaluate target inputs.
    """

    ELEMENT_VALUES = {
        "WOOD": 3,
        "FIRE": 7,
        "EARTH": 5,
        "METAL": 9,
        "WATER": 2
    }

    @classmethod
    def generate(cls, seed: str) -> Dict[str, Any]:
        rng = create_prng(seed)

        # Coefficients for hidden transformation rule
        coeff_a = rng.choice([2, 3, 4])
        coeff_b = rng.choice([1, 2, 5])
        mod_c = rng.choice([3, 4, 6])
        offset = rng.randint(5, 25)

        elements = list(cls.ELEMENT_VALUES.keys())
        target_triplet = rng.sample(elements, 3)

        def evaluate_rule(e1: str, e2: str, e3: str) -> int:
            v1 = cls.ELEMENT_VALUES.get(e1.upper(), 1)
            v2 = cls.ELEMENT_VALUES.get(e2.upper(), 1)
            v3 = cls.ELEMENT_VALUES.get(e3.upper(), 1)
            return (v1 * coeff_a) + (v2 * coeff_b) - (v3 % mod_c) + offset

        target_output = evaluate_rule(target_triplet[0], target_triplet[1], target_triplet[2])

        # Pre-seed 2 sample experiments
        sample_1 = rng.sample(elements, 3)
        sample_2 = rng.sample(elements, 3)
        sample_runs = [
            {"input": sample_1, "output": evaluate_rule(*sample_1)},
            {"input": sample_2, "output": evaluate_rule(*sample_2)}
        ]

        metrics = DifficultyMetrics(
            inference_depth=26,
            branching_factor=8,
            hidden_variables=8,
            state_dependencies=6,
            required_experiments=6,
            misleading_evidence=3,
            planning_horizon=10
        )

        return {
            "archetype": "hidden_machine",
            "tier": "hard",
            "title": "The Cipher Engine of the High Monks",
            "objective": f"Perform experiments with input triplets of elements [WOOD, FIRE, EARTH, METAL, WATER] and deduce the output for the target: {' '.join(target_triplet)}",
            "max_experiments": 8,
            "target_input": target_triplet,
            "sample_experiments": sample_runs,
            "rule_coefficients": {
                "coeff_a": coeff_a,
                "coeff_b": coeff_b,
                "mod_c": mod_c,
                "offset": offset
            },
            "difficulty": metrics.to_dict(),
            "solution": {
                "target_output": target_output,
                "target_input": target_triplet
            }
        }

    @classmethod
    def run_experiment(cls, puzzle_state: Dict[str, Any], inputs: List[str]) -> int:
        coeffs = puzzle_state.get("rule_coefficients", {"coeff_a": 3, "coeff_b": 2, "mod_c": 4, "offset": 10})
        clean = [str(x).upper() for x in inputs]
        v1 = cls.ELEMENT_VALUES.get(clean[0] if len(clean) > 0 else "WOOD", 1)
        v2 = cls.ELEMENT_VALUES.get(clean[1] if len(clean) > 1 else "WATER", 1)
        v3 = cls.ELEMENT_VALUES.get(clean[2] if len(clean) > 2 else "FIRE", 1)
        return (v1 * coeffs["coeff_a"]) + (v2 * coeffs["coeff_b"]) - (v3 % coeffs["mod_c"]) + coeffs["offset"]
