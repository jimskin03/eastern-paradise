from typing import Any, Dict, List
from ..engine.seed import create_prng
from ..engine.difficulty import DifficultyMetrics


class TemporalChainArchetype:
    """
    Timeline reconstruction archetype.
    Generates chronological sequence of events, then emits transformed, offset,
    and relative archive records for the agent to resolve.
    """

    EVENT_TEMPLATES = [
        "Agent {agent} crossed the threshold into the inner sanctuary",
        "The {element} Rune resonated with harmonic chime",
        "The Celestial Gate mechanism shifted into alignment",
        "The Water Basin drained into the lower stream",
        "The Bronze Bell was struck by an unknown force",
        "The Lotus Bridge locked in the open position",
        "A pulse of pure synthetic consciousness surged through the obelisk"
    ]
    AGENTS = ["Kaito", "Iris", "Nova", "Ix", "Aira"]
    ELEMENTS = ["Water", "Fire", "Metal", "Wood", "Earth"]

    @classmethod
    def generate(cls, seed: str, event_count: int = 5) -> Dict[str, Any]:
        rng = create_prng(seed)

        # 1. Generate canonical timeline
        base_tick = rng.randint(100, 300)
        canonical_events: List[Dict[str, Any]] = []

        curr_tick = base_tick
        for i in range(event_count):
            curr_tick += rng.randint(4, 18)
            template = rng.choice(cls.EVENT_TEMPLATES)
            desc = template.format(
                agent=rng.choice(cls.AGENTS),
                element=rng.choice(cls.ELEMENTS)
            )
            canonical_events.append({
                "id": f"event_{i + 1}",
                "tick": curr_tick,
                "description": desc
            })

        # 2. Generate transformed archive logs
        archive_logs: List[Dict[str, Any]] = []

        # Relative difference clues
        for i in range(len(canonical_events) - 1):
            e1 = canonical_events[i]
            e2 = canonical_events[i + 1]
            diff = e2["tick"] - e1["tick"]
            archive_logs.append({
                "source": f"Archive {chr(65 + i)}",
                "text": f"'{e2['description']}' occurred exactly {diff} ticks after '{e1['description']}'."
            })

        # Offset timestamp clue
        offset = rng.randint(11, 29)
        first_event = canonical_events[0]
        skewed_tick = first_event["tick"] + offset
        archive_logs.append({
            "source": "Chronos Stele",
            "text": f"Ancient stele log records an anomalous event at local tick {skewed_tick} ('{first_event['description']}'). Calibration note: stele chronometer was running +{offset} ticks ahead of true sanctuary time."
        })

        # Ordering constraints
        mid_idx = event_count // 2
        archive_logs.append({
            "source": "Monastery Register",
            "text": f"Confirmed: '{canonical_events[mid_idx]['description']}' transpired before the final event of this cycle."
        })

        solution_order = [e["id"] for e in canonical_events]
        solution_ticks = {e["id"]: e["tick"] for e in canonical_events}

        metrics = DifficultyMetrics(
            inference_depth=26,
            branching_factor=8,
            hidden_variables=event_count * 3,
            state_dependencies=event_count * 2,
            required_experiments=0,
            misleading_evidence=3,
            planning_horizon=event_count * 2
        )

        return {
            "archetype": "temporal_chain",
            "tier": "hard",
            "title": "The Broken Chronology of the Lotus Sanctuary",
            "objective": "Reconstruct the exact canonical timeline (tick order and timestamp for each event).",
            "events": [{"id": e["id"], "description": e["description"]} for e in canonical_events],
            "archive_logs": archive_logs,
            "difficulty": metrics.to_dict(),
            "solution": {
                "order": solution_order,
                "ticks": solution_ticks
            }
        }
