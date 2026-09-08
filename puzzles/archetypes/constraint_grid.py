import random
from typing import Any, Dict, List, Tuple
from ..engine.seed import create_prng
from ..engine.difficulty import DifficultyMetrics


class ConstraintGridArchetype:
    """
    Einstein-style multi-dimensional constraint puzzle.
    Generates hidden truth table first, then derives clues until a unique solution is reached.
    """

    AGENTS = ["Aira", "Ix", "Nova", "Iris", "Kaito", "Ren", "Yuki", "Sol"]
    SHRINES = ["Lotus", "Moon", "Jade", "Sun", "Mist", "Shadow", "Thunder"]
    ELEMENTS = ["Water", "Metal", "Fire", "Wood", "Earth"]
    ARTIFACTS = ["Orb", "Mirror", "Scroll", "Bell", "Compass", "Prism"]

    @classmethod
    def generate(cls, seed: str, size: int = 4) -> Dict[str, Any]:
        rng = create_prng(seed)

        # 1. Sample dimension sets
        agents = rng.sample(cls.AGENTS, size)
        shrines = rng.sample(cls.SHRINES, size)
        elements = rng.sample(cls.ELEMENTS, size)
        artifacts = rng.sample(cls.ARTIFACTS, size)
        base_ticks = sorted(rng.sample(range(120, 260), size))

        # 2. Build canonical hidden world table
        rng.shuffle(shrines)
        rng.shuffle(elements)
        rng.shuffle(artifacts)
        rng.shuffle(base_ticks)

        table: List[Dict[str, Any]] = []
        for i in range(size):
            table.append({
                "agent": agents[i],
                "shrine": shrines[i],
                "element": elements[i],
                "artifact": artifacts[i],
                "tick": base_ticks[i]
            })

        # Canonical solution mapping: agent -> {shrine, element, artifact, tick}
        solution = {row["agent"]: {k: v for k, v in row.items() if k != "agent"} for row in table}

        # 3. Derive clues from canonical table
        clues: List[str] = []

        # Relative time clues (Tick order)
        sorted_by_tick = sorted(table, key=lambda r: r["tick"])
        for i in range(len(sorted_by_tick) - 1):
            earlier = sorted_by_tick[i]
            later = sorted_by_tick[i + 1]
            diff = later["tick"] - earlier["tick"]
            clues.append(f"The bearer of the {later['artifact']} arrived exactly {diff} ticks after {earlier['agent']}.")

        # Positive correlation clues
        for i in range(size):
            row = table[i]
            if i % 2 == 0:
                clues.append(f"{row['agent']} entered the {row['shrine']} Shrine carrying the {row['artifact']}.")
            else:
                clues.append(f"The {row['element']} Shrine contained the {row['artifact']}.")

        # Negative correlation clues
        for i in range(size):
            curr_row = table[i]
            other_row = table[(i + 1) % size]
            clues.append(f"{curr_row['agent']} never approached the {other_row['shrine']} Shrine.")
            clues.append(f"The {other_row['element']} relic was not carried by {curr_row['agent']}.")

        # Shuffle clues deterministically
        rng.shuffle(clues)

        metrics = DifficultyMetrics(
            inference_depth=16 + size * 3,
            branching_factor=size + 2,
            hidden_variables=size * 4,
            state_dependencies=size,
            required_experiments=0,
            misleading_evidence=2,
            planning_horizon=size * 2
        )

        return {
            "archetype": "constraint_grid",
            "tier": "hard",
            "title": f"The Trial of the {size} Guardians",
            "objective": "Determine the complete canonical assignment of Shrine, Element, and Artifact for each Agent.",
            "prompt": (
                "Four guardians stood at the elemental gateways before the celestial eclipse. "
                "Study the inscriptions left upon the sanctuary archives and reconstruct the exact assignment."
            ),
            "clues": clues,
            "dimensions": {
                "agents": agents,
                "shrines": shrines,
                "elements": elements,
                "artifacts": artifacts
            },
            "difficulty": metrics.to_dict(),
            "solution": solution
        }
