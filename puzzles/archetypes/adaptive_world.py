from typing import Any, Dict, List
from ..engine.seed import create_prng
from ..engine.difficulty import DifficultyMetrics


class AdaptiveWorldArchetype:
    """
    Celestial Tier Archetype: Dynamic Adaptive Environment.
    Actions dynamically mutate environment topology (e.g. collapsed bridges,
    shifting portals, locked passages), forcing agents to adapt plans dynamically.
    """

    @classmethod
    def generate(cls, seed: str) -> Dict[str, Any]:
        rng = create_prng(seed)

        chambers = {
            "chamber_1": {"name": "Entry Terrace", "description": "High precipice overlooking the cloud sea."},
            "chamber_2": {"name": "Bridge of Jade", "description": "A fragile green stone span crossing the chasm."},
            "chamber_3": {"name": "Sunken Cistern", "description": "Deep stone basin filled with crystalline moisture."},
            "chamber_4": {"name": "The Upper Spire", "description": "High vantage point connected to the Celestial Gate."},
            "chamber_5": {"name": "The Forgotten Tunnel", "description": "A dark, subterranean bypass route beneath the chasm."},
            "chamber_6": {"name": "The Inner Sanctum", "description": "The destination chamber holding the Celestial Core."}
        }

        # Initial graph: direct route via Jade Bridge (1 -> 2 -> 4 -> 6)
        connections = {
            "chamber_1": ["chamber_2", "chamber_3"],
            "chamber_2": ["chamber_1", "chamber_4"],
            "chamber_3": ["chamber_1", "chamber_5"],
            "chamber_4": ["chamber_2", "chamber_6"],
            "chamber_5": ["chamber_3", "chamber_6"],
            "chamber_6": ["chamber_4", "chamber_5"]
        }

        # Dynamic rules causing bridge collapse upon touching unstable mechanism
        rules = [
            {
                "id": "rule_fragile_bridge",
                "trigger": "mechanism_heavy_stone",
                "effect": "collapse_bridge",
                "blocked_connection": ("chamber_1", "chamber_2"),
                "description": "Triggering the heavy mechanism causes the Bridge of Jade to buckle and collapse. The sunken bypass tunnel (3 -> 5) must be used instead."
            }
        ]

        metrics = DifficultyMetrics(
            inference_depth=65,
            branching_factor=20,
            hidden_variables=22,
            state_dependencies=28,
            required_experiments=12,
            misleading_evidence=8,
            planning_horizon=32
        )

        return {
            "archetype": "adaptive_world",
            "tier": "celestial",
            "title": "The Collapsing Sanctum of Cloud & Jade",
            "objective": "Traverse the shifting chambers and stabilize the Celestial Core in the Inner Sanctum.",
            "actions_remaining": 45,
            "inspections_remaining": 8,
            "resets_remaining": 1,
            "current_chamber": "chamber_1",
            "chambers": chambers,
            "connections": connections,
            "rules": rules,
            "difficulty": metrics.to_dict(),
            "solution": {
                "safe_route": ["chamber_1", "chamber_3", "chamber_5", "chamber_6"],
                "adapted_route_if_collapsed": ["chamber_3", "chamber_5", "chamber_6"]
            }
        }
