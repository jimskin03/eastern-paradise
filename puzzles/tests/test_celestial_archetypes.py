import unittest
from puzzles.archetypes.shrine_network import ShrineNetworkArchetype
from puzzles.archetypes.corrupted_archive import CorruptedArchiveArchetype
from puzzles.archetypes.adaptive_world import AdaptiveWorldArchetype
from puzzles.engine.solver import CelestialSimulator
from puzzles.engine.generator import generate_celestial_puzzle


class TestCelestialArchetypes(unittest.TestCase):

    def test_shrine_network_generation(self):
        seed = "celestial_shrine_seed_101"
        puzzle = ShrineNetworkArchetype.generate(seed, chamber_count=8)
        self.assertEqual(puzzle["archetype"], "shrine_network")
        self.assertEqual(puzzle["tier"], "celestial")
        self.assertEqual(len(puzzle["chambers"]), 8)
        self.assertIn("chamber_8", puzzle["chambers"])
        self.assertEqual(puzzle["actions_remaining"], 45)
        self.assertEqual(puzzle["inspections_remaining"], 8)

    def test_celestial_simulator_actions(self):
        seed = "celestial_sim_seed_202"
        world = ShrineNetworkArchetype.generate(seed, chamber_count=8)

        # 1. Observe
        s1, msg1, ch1 = CelestialSimulator.step(world, "observe")
        self.assertIn("You observe", msg1)
        self.assertEqual(s1["actions_remaining"], 44)

        # 2. Inspect
        s2, msg2, ch2 = CelestialSimulator.step(s1, "inspect", target="black_pillar")
        self.assertIn("black_pillar", s2.get("discoveries", []))
        self.assertEqual(s2["inspections_remaining"], 7)

        # 3. Activate mechanism with rule trigger (reversing polarity)
        s3, msg3, ch3 = CelestialSimulator.step(s2, "activate", target="shrine_water_1")
        self.assertEqual(s3["polarity"], "negative")

    def test_corrupted_archive_generation(self):
        seed = "corrupted_archive_seed_303"
        puzzle = CorruptedArchiveArchetype.generate(seed)
        self.assertEqual(puzzle["archetype"], "corrupted_archive")
        self.assertEqual(len(puzzle["guardians"]), 4)
        self.assertEqual(len(puzzle["archives"]), 4)
        # Check one corrupted archive exists
        corrupted_count = sum(1 for a in puzzle["archives"].values() if a["corrupted"])
        self.assertEqual(corrupted_count, 1)

    def test_adaptive_world_generation_and_bridge_collapse(self):
        seed = "adaptive_world_seed_404"
        world = AdaptiveWorldArchetype.generate(seed)
        self.assertEqual(world["archetype"], "adaptive_world")
        self.assertIn("chamber_2", world["connections"]["chamber_1"])

        # Trigger heavy stone mechanism -> causes bridge collapse
        w2, msg, changes = CelestialSimulator.step(world, "activate", target="mechanism_heavy_stone")
        self.assertNotIn("chamber_2", w2["connections"]["chamber_1"])
        self.assertTrue(any("collapsed" in c.lower() for c in changes))

    def test_master_celestial_generator(self):
        puzzle = generate_celestial_puzzle()
        self.assertEqual(puzzle["tier"], "celestial")
        self.assertIn(puzzle["archetype"], ["shrine_network", "corrupted_archive", "adaptive_world"])
        self.assertIn("seed_hash", puzzle)
        self.assertGreaterEqual(puzzle["difficulty"]["score"], 171)
        self.assertEqual(puzzle["difficulty"]["tier"], "celestial")


if __name__ == "__main__":
    unittest.main()
