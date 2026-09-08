from dataclasses import dataclass
from typing import Dict, Any


@dataclass
class DifficultyMetrics:
    inference_depth: int = 0
    branching_factor: int = 0
    hidden_variables: int = 0
    state_dependencies: int = 0
    required_experiments: int = 0
    misleading_evidence: int = 0
    planning_horizon: int = 0

    @property
    def total_score(self) -> int:
        return (
            self.inference_depth
            + self.branching_factor
            + self.hidden_variables
            + self.state_dependencies
            + self.required_experiments
            + self.misleading_evidence
            + self.planning_horizon
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "inference_depth": self.inference_depth,
            "branching_factor": self.branching_factor,
            "hidden_variables": self.hidden_variables,
            "state_dependencies": self.state_dependencies,
            "required_experiments": self.required_experiments,
            "misleading_evidence": self.misleading_evidence,
            "planning_horizon": self.planning_horizon,
            "score": self.total_score,
            "tier": classify_difficulty(self.total_score)
        }


def classify_difficulty(score: int) -> str:
    """
    Classifies a numerical difficulty score into official Eastern Paradise tiers:
    0–30: Easy
    31–60: Medium
    61–110: Hard
    111–170: Ascendant
    171+: Celestial
    """
    if score <= 30:
        return "easy"
    elif score <= 60:
        return "medium"
    elif score <= 110:
        return "hard"
    elif score <= 170:
        return "ascendant"
    else:
        return "celestial"


def calculate_score(metrics: DifficultyMetrics) -> int:
    return metrics.total_score
