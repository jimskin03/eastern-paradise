from dataclasses import dataclass
from typing import Dict, Any, Optional


@dataclass
class ScoreBreakdown:
    tier: str
    base_reward: int
    bonuses: Dict[str, int]
    total_merit: int
    maximum_possible: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tier": self.tier,
            "base_reward": self.base_reward,
            "bonuses": self.bonuses,
            "total_merit": self.total_merit,
            "maximum_possible": self.maximum_possible
        }


def score_hard_attempt(
    actions_used: int,
    action_budget: int,
    hints_used: int = 0,
    attempt_number: int = 1
) -> ScoreBreakdown:
    """
    Computes score for Hard tier trial:
    Base: 100
    Efficiency: +40 (scaled if actions_used <= 50% of budget)
    No-hint: +30 (if hints_used == 0)
    First-attempt: +30 (if attempt_number == 1)
    Max: 200 $MERIT
    """
    base = 100
    bonuses: Dict[str, int] = {}

    # Efficiency bonus
    if action_budget > 0:
        ratio = actions_used / action_budget
        if ratio <= 0.5:
            bonuses["efficiency"] = 40
        elif ratio <= 0.75:
            bonuses["efficiency"] = 20
        else:
            bonuses["efficiency"] = 0
    else:
        bonuses["efficiency"] = 0

    # No-hint bonus
    if hints_used == 0:
        bonuses["no_hint"] = 30
    else:
        bonuses["no_hint"] = 0

    # First-attempt bonus
    if attempt_number == 1:
        bonuses["first_attempt"] = 30
    else:
        bonuses["first_attempt"] = 0

    total = min(200, base + sum(bonuses.values()))
    return ScoreBreakdown(
        tier="hard",
        base_reward=base,
        bonuses=bonuses,
        total_merit=total,
        maximum_possible=200
    )


def score_celestial_attempt(
    actions_used: int,
    action_budget: int,
    discoveries_count: int,
    total_discoveries: int,
    resets_used: int = 0,
    is_rare_seed: bool = False
) -> ScoreBreakdown:
    """
    Computes score for Celestial tier trial:
    Base reward: 500
    Discovery bonus: +150 (scaled by discoveries_count / total_discoveries)
    Efficiency bonus: +200 (if actions_used <= 60% of budget)
    No-reset bonus: +100 (if resets_used == 0)
    Rare-seed bonus: +50 (if is_rare_seed)
    Max: 1000 $MERIT
    """
    base = 500
    bonuses: Dict[str, int] = {}

    # Discovery bonus (max 150)
    if total_discoveries > 0:
        disc_ratio = min(1.0, discoveries_count / total_discoveries)
        bonuses["discovery"] = int(150 * disc_ratio)
    else:
        bonuses["discovery"] = 150

    # Efficiency bonus (max 200)
    if action_budget > 0:
        eff_ratio = actions_used / action_budget
        if eff_ratio <= 0.5:
            bonuses["efficiency"] = 200
        elif eff_ratio <= 0.75:
            bonuses["efficiency"] = 100
        elif eff_ratio <= 0.9:
            bonuses["efficiency"] = 50
        else:
            bonuses["efficiency"] = 0
    else:
        bonuses["efficiency"] = 0

    # No-reset bonus (100)
    if resets_used == 0:
        bonuses["no_reset"] = 100
    else:
        bonuses["no_reset"] = 0

    # Rare seed bonus (50)
    if is_rare_seed:
        bonuses["rare_seed"] = 50
    else:
        bonuses["rare_seed"] = 0

    total = min(1000, base + sum(bonuses.values()))
    return ScoreBreakdown(
        tier="celestial",
        base_reward=base,
        bonuses=bonuses,
        total_merit=total,
        maximum_possible=1000
    )
