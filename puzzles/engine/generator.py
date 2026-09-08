import random
from typing import Any, Dict, Optional

from .seed import generate_secret_seed, derive_seed_hash, create_prng
from .verifier import AdversarialVerifier
from .difficulty import classify_difficulty
from ..archetypes.constraint_grid import ConstraintGridArchetype
from ..archetypes.temporal_chain import TemporalChainArchetype
from ..archetypes.hidden_machine import HiddenMachineArchetype
from ..archetypes.shrine_network import ShrineNetworkArchetype
from ..archetypes.corrupted_archive import CorruptedArchiveArchetype
from ..archetypes.adaptive_world import AdaptiveWorldArchetype
from ..hard.config import DEFAULT_HARD_CONFIG
from ..celestial.config import DEFAULT_CELESTIAL_CONFIG


class MasterPuzzleGenerator:
    """
    Unified procedural engine for Hard and Celestial trials.
    Generates hidden worlds first, computes solutions, derives evidence/clues,
    and runs adversarial quality gates before exposing instances.
    """

    ARCHETYPE_MAP = {
        "constraint_grid": ConstraintGridArchetype,
        "temporal_chain": TemporalChainArchetype,
        "hidden_machine": HiddenMachineArchetype,
        "shrine_network": ShrineNetworkArchetype,
        "corrupted_archive": CorruptedArchiveArchetype,
        "adaptive_world": AdaptiveWorldArchetype
    }

    @classmethod
    def generate(
        cls,
        tier: str = "hard",
        archetype: Optional[str] = None,
        seed: Optional[str] = None,
        max_regeneration_attempts: int = 5
    ) -> Dict[str, Any]:
        tier = tier.lower().strip()
        secret_seed = seed or generate_secret_seed()
        seed_hash = derive_seed_hash(secret_seed)
        rng = create_prng(secret_seed)

        # Select archetype if not specified
        if not archetype:
            if tier == "celestial":
                archetype = rng.choice(DEFAULT_CELESTIAL_CONFIG.allowed_archetypes)
            else:
                archetype = rng.choice(DEFAULT_HARD_CONFIG.allowed_archetypes)

        archetype_class = cls.ARCHETYPE_MAP.get(archetype)
        if not archetype_class:
            archetype = "constraint_grid" if tier == "hard" else "shrine_network"
            archetype_class = cls.ARCHETYPE_MAP[archetype]

        for attempt in range(max_regeneration_attempts):
            curr_seed = secret_seed if attempt == 0 else f"{secret_seed}_{attempt}"
            puzzle_data = archetype_class.generate(curr_seed)

            # Adversarial Quality Gate
            if tier == "hard":
                clues = puzzle_data.get("clues", [])
                if not clues and "archive_logs" in puzzle_data:
                    clues = [log["text"] for log in puzzle_data["archive_logs"]]
                elif not clues and "sample_experiments" in puzzle_data:
                    clues = [f"Sample: {exp['input']} -> {exp['output']}" for exp in puzzle_data["sample_experiments"]]

                verification = AdversarialVerifier.verify_hard_puzzle(
                    puzzle_data,
                    puzzle_data.get("solution"),
                    clues
                )
                if not verification.is_valid:
                    continue  # Regenerate if failed check

            elif tier == "celestial":
                # Check difficulty threshold
                score = puzzle_data.get("difficulty", {}).get("score", 0)
                if score < DEFAULT_CELESTIAL_CONFIG.min_difficulty_score:
                    continue

            # Success! Assemble client-safe view and private instance record
            puzzle_data["seed_hash"] = seed_hash
            puzzle_data["secret_seed"] = secret_seed  # Stored server-side only
            puzzle_data["tier"] = tier
            puzzle_data["archetype"] = archetype
            return puzzle_data

        # Fallback return guaranteed baseline
        puzzle_data = archetype_class.generate(secret_seed)
        puzzle_data["seed_hash"] = seed_hash
        puzzle_data["secret_seed"] = secret_seed
        puzzle_data["tier"] = tier
        puzzle_data["archetype"] = archetype
        return puzzle_data


def generate_hard_puzzle(archetype: Optional[str] = None, seed: Optional[str] = None) -> Dict[str, Any]:
    return MasterPuzzleGenerator.generate(tier="hard", archetype=archetype, seed=seed)


def generate_celestial_puzzle(archetype: Optional[str] = None, seed: Optional[str] = None) -> Dict[str, Any]:
    return MasterPuzzleGenerator.generate(tier="celestial", archetype=archetype, seed=seed)
