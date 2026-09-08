from dataclasses import dataclass
from typing import List


@dataclass
class HardTierConfig:
    tier_name: str = "hard"
    min_reasoning_steps: int = 10
    max_reasoning_steps: int = 30
    min_actions: int = 5
    max_actions: int = 20
    action_budget: int = 25
    max_generation_time_sec: float = 1.0
    allowed_archetypes: List[str] = None
    min_difficulty_score: int = 61
    max_difficulty_score: int = 110
    base_reward: int = 100
    max_reward: int = 200

    def __post_init__(self):
        if self.allowed_archetypes is None:
            self.allowed_archetypes = [
                "constraint_grid",
                "temporal_chain",
                "hidden_machine"
            ]


DEFAULT_HARD_CONFIG = HardTierConfig()
