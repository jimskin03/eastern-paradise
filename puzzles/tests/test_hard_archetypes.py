import unittest
from puzzles.archetypes.constraint_grid import ConstraintGridArchetype
from puzzles.archetypes.temporal_chain import TemporalChainArchetype
from puzzles.archetypes.hidden_machine import HiddenMachineArchetype
from puzzles.engine.generator import generate_hard_puzzle


class TestHardArchetypes(unittest.TestCase):

    def test_constraint_grid_generation(self):
        seed = "test_hard_grid_seed_999"
        puzzle = ConstraintGridArchetype.generate(seed, size=4)
        self.assertEqual(puzzle["archetype"], "constraint_grid")
        self.assertEqual(puzzle["tier"], "hard")
        self.assertIn("clues", puzzle)
        self.assertGreaterEqual(len(puzzle["clues"]), 4)
        self.assertIn("solution", puzzle)
        self.assertEqual(len(puzzle["solution"]), 4)

    def test_temporal_chain_generation(self):
        seed = "test_temporal_seed_888"
        puzzle = TemporalChainArchetype.generate(seed, event_count=5)
        self.assertEqual(puzzle["archetype"], "temporal_chain")
        self.assertEqual(len(puzzle["events"]), 5)
        self.assertIn("archive_logs", puzzle)
        self.assertIn("solution", puzzle)
        self.assertEqual(len(puzzle["solution"]["order"]), 5)

    def test_hidden_machine_generation_and_experimentation(self):
        seed = "test_machine_seed_777"
        puzzle = HiddenMachineArchetype.generate(seed)
        self.assertEqual(puzzle["archetype"], "hidden_machine")
        self.assertIn("target_input", puzzle)
        self.assertIn("solution", puzzle)

        # Run test experiment
        output = HiddenMachineArchetype.run_experiment(puzzle, ["WOOD", "FIRE", "WATER"])
        self.assertIsInstance(output, int)

        # Verify target input evaluates to expected solution
        expected = puzzle["solution"]["target_output"]
        target_res = HiddenMachineArchetype.run_experiment(puzzle, puzzle["target_input"])
        self.assertEqual(target_res, expected)

    def test_master_hard_generator(self):
        puzzle = generate_hard_puzzle()
        self.assertEqual(puzzle["tier"], "hard")
        self.assertIn(puzzle["archetype"], ["constraint_grid", "temporal_chain", "hidden_machine"])
        self.assertIn("seed_hash", puzzle)
        self.assertIn("difficulty", puzzle)


if __name__ == "__main__":
    unittest.main()
