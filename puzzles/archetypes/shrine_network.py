from typing import Any, Dict, List, Optional
from ..engine.seed import create_prng
from ..engine.difficulty import DifficultyMetrics


class ShrineNetworkArchetype:
    """
    Celestial Tier Archetype: Interconnected Shrine Network.
    Features 7 to 9 interconnected chambers with elemental mechanics,
    polarity shifts, and activation dependencies.
    """

    CHAMBER_NAMES = [
        "Chamber of Morning Dew",
        "The Gilded Corridor",
        "Hall of Ember Whispers",
        "The Verdant Sanctuary",
        "The Quiet Atrium",
        "The Mirror Pavilion",
        "Chamber of Shifting Polarities",
        "The Astral Spire",
        "The Ninth Chamber of Truth"
    ]

    ELEMENTS = ["Water", "Metal", "Wood", "Fire", "Earth"]

    @classmethod
    def generate(cls, seed: str, chamber_count: int = 8) -> Dict[str, Any]:
        rng = create_prng(seed)

        chambers: Dict[str, Any] = {}
        for i in range(chamber_count):
            cid = f"chamber_{i + 1}"
            chambers[cid] = {
                "id": cid,
                "name": cls.CHAMBER_NAMES[i % len(cls.CHAMBER_NAMES)],
                "description": f"A serene, vaulted chamber with ancient stone masonry and inscriptions.",
                "element": cls.ELEMENTS[i % len(cls.ELEMENTS)],
                "has_mechanism": (i < chamber_count - 1),
                "mechanism_id": f"shrine_{cls.ELEMENTS[i % len(cls.ELEMENTS)].lower()}_{i + 1}" if i < chamber_count - 1 else None
            }

        # Build bidirectional chamber connections (graph)
        connections: Dict[str, List[str]] = {}
        for i in range(chamber_count):
            cid = f"chamber_{i + 1}"
            conns: List[str] = []
            if i > 0:
                conns.append(f"chamber_{i}")
            if i < chamber_count - 1:
                conns.append(f"chamber_{i + 2}")
            # Cross-connect
            cross = (i + 3) % chamber_count
            if cross != i and f"chamber_{cross + 1}" not in conns:
                conns.append(f"chamber_{cross + 1}")
            connections[cid] = conns

        # Dynamic hidden rules
        rules = [
            {
                "id": "rule_water_polarity",
                "trigger": "shrine_water_1",
                "effect": "reverse_polarity",
                "description": "Water shrine inverts elemental polarity between positive and negative."
            },
            {
                "id": "rule_metal_resonance",
                "trigger": "shrine_metal_2",
                "effect": "resonate_adjacent",
                "description": "Metal harmonizes with adjacent chambers."
            }
        ]

        entities = {
            "black_pillar": {
                "inspection_detail": "Three concentric markings glow upon the obsidian surface. Polarity: Active."
            },
            "water_basin": {
                "inspection_detail": "Clear mountain water flows counter-clockwise, dampening celestial fire."
            },
            "sealed_archive": {
                "inspection_detail": "Glyphs record: 'The final seal yields only when the Water and Wood shrines resonate together.'"
            },
            "guardian_statue": {
                "inspection_detail": "An immortal stone sage. Inscription: 'Beware: The bell of shadow sounds when an incompatible element is forced.'"
            }
        }

        # Canonical solution sequence
        canonical_path = [
            {"action": "observe"},
            {"action": "inspect", "target": "black_pillar"},
            {"action": "activate", "target": "shrine_water_1"},
            {"action": "move", "target": "chamber_2"},
            {"action": "activate", "target": "shrine_metal_2"},
            {"action": "move", "target": f"chamber_{chamber_count}"}
        ]

        target_chamber = f"chamber_{chamber_count}"

        metrics = DifficultyMetrics(
            inference_depth=60,
            branching_factor=18,
            hidden_variables=25,
            state_dependencies=24,
            required_experiments=10,
            misleading_evidence=8,
            planning_horizon=32
        )

        return {
            "archetype": "shrine_network",
            "tier": "celestial",
            "title": "The Observatory of Nine Moons",
            "objective": f"Reach {cls.CHAMBER_NAMES[chamber_count - 1]} and activate the Celestial Resonance.",
            "actions_remaining": 45,
            "inspections_remaining": 8,
            "resets_remaining": 1,
            "current_chamber": "chamber_1",
            "chambers": chambers,
            "connections": connections,
            "entities": entities,
            "rules": rules,
            "polarity": "positive",
            "active_mechanisms": [],
            "discoveries": [],
            "target_chamber": target_chamber,
            "difficulty": metrics.to_dict(),
            "solution": {
                "canonical_path": canonical_path,
                "target_chamber": target_chamber,
                "required_polarity": "negative"
            }
        }
