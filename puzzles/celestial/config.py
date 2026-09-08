from dataclasses import dataclass
from typing import List


@dataclass
class CelestialTierConfig:
    tier_name: str = "celestial"
    min_reasoning_steps: int = 30
    max_reasoning_steps: int = 100
    min_actions: int = 20
    max_actions: int = 100
    action_budget: int = 45
    inspection_budget: int = 8
    reset_budget: int = 1
    allowed_archetypes: List[str] = None
    min_difficulty_score: int = 171
    base_reward: int = 500
    max_reward: int = 1000

    def __post_init__(self):
        if self.allowed_archetypes is None:
            self.allowed_archetypes = [
                "shrine_network",
                "corrupted_archive",
                "adaptive_world"
            ]


DEFAULT_CELESTIAL_CONFIG = CelestialTierConfig()
