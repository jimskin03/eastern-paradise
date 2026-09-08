import unittest
from puzzles.engine.seed import generate_secret_seed, derive_seed_hash, create_prng, derive_subseed
from puzzles.engine.difficulty import DifficultyMetrics, classify_difficulty
from puzzles.engine.scoring import score_hard_attempt, score_celestial_attempt


class TestSeedAndDifficulty(unittest.TestCase):

    def test_seed_generation_and_hashing(self):
        seed1 = generate_secret_seed()
        seed2 = generate_secret_seed()
        self.assertNotEqual(seed1, seed2)
        self.assertEqual(len(seed1), 64)

        hash1 = derive_seed_hash(seed1)
        self.assertEqual(len(hash1), 64)
        self.assertNotEqual(seed1, hash1)
        # Deterministic
        self.assertEqual(hash1, derive_seed_hash(seed1))

    def test_subseed_derivation(self):
        seed = "7e4b73a8" * 8
        sub1 = derive_subseed(seed, "shrine_network")
        sub2 = derive_subseed(seed, "corrupted_archive")
        self.assertNotEqual(sub1, sub2)
        self.assertEqual(sub1, derive_subseed(seed, "shrine_network"))

    def test_prng_determinism(self):
        seed = "test_seed_alpha_123"
        rng1 = create_prng(seed)
        rng2 = create_prng(seed)
        vals1 = [rng1.randint(1, 1000) for _ in range(10)]
        vals2 = [rng2.randint(1, 1000) for _ in range(10)]
        self.assertEqual(vals1, vals2)

    def test_difficulty_classification(self):
        self.assertEqual(classify_difficulty(25), "easy")
        self.assertEqual(classify_difficulty(50), "medium")
        self.assertEqual(classify_difficulty(85), "hard")
        self.assertEqual(classify_difficulty(140), "ascendant")
        self.assertEqual(classify_difficulty(190), "celestial")

    def test_difficulty_metrics_scoring(self):
        metrics = DifficultyMetrics(
            inference_depth=46,
            branching_factor=14,
            hidden_variables=17,
            state_dependencies=21,
            required_experiments=8,
            misleading_evidence=5,
            planning_horizon=30
        )
        self.assertEqual(metrics.total_score, 141)
        d = metrics.to_dict()
        self.assertEqual(d["score"], 141)
        self.assertEqual(d["tier"], "ascendant")

    def test_scoring_calculations(self):
        hard_score = score_hard_attempt(actions_used=10, action_budget=25)
        self.assertGreaterEqual(hard_score.total_merit, 100)
        self.assertLessEqual(hard_score.total_merit, 200)

        cel_score = score_celestial_attempt(
            actions_used=22,
            action_budget=45,
            discoveries_count=4,
            total_discoveries=4
        )
        self.assertGreaterEqual(cel_score.total_merit, 500)
        self.assertLessEqual(cel_score.total_merit, 1000)


if __name__ == "__main__":
    unittest.main()
