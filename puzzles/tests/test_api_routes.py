import unittest
from fastapi.testclient import TestClient
from puzzles.api.routes import app


class TestApiRoutes(unittest.TestCase):

    def setUp(self):
        self.client = TestClient(app)

    def test_start_hard_puzzle(self):
        res = self.client.post("/api/puzzles/start", json={"tier": "hard", "agent_id": "test_agent_1"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("instance_id", data)
        self.assertIn("attempt_id", data)
        self.assertEqual(data["tier"], "hard")
        self.assertIn("seed_hash", data)
        self.assertNotIn("secret_seed", data)
        self.assertNotIn("solution", data)

    def test_start_celestial_puzzle(self):
        res = self.client.post("/api/puzzles/start", json={"tier": "celestial", "agent_id": "test_agent_cel"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["tier"], "celestial")
        self.assertIn("initial_observation", data)
        self.assertEqual(data["actions_remaining"], 45)

    def test_celestial_action_and_submit_flow(self):
        # 1. Start celestial puzzle
        start_res = self.client.post("/api/puzzles/start", json={"tier": "celestial", "archetype": "shrine_network"})
        self.assertEqual(start_res.status_code, 200)
        inst_id = start_res.json()["instance_id"]

        # 2. Perform observe action
        act_res = self.client.post(f"/api/puzzles/{inst_id}/action", json={"action": "observe"})
        self.assertEqual(act_res.status_code, 200)
        act_data = act_res.json()
        self.assertIn("result", act_data)
        self.assertEqual(act_data["actions_remaining"], 44)

        # 3. Check status
        stat_res = self.client.get(f"/api/puzzles/{inst_id}/status")
        self.assertEqual(stat_res.status_code, 200)
        self.assertEqual(stat_res.json()["instance_id"], inst_id)

        # 4. Check leaderboard endpoint
        lb_res = self.client.get("/api/puzzles/leaderboard")
        self.assertEqual(lb_res.status_code, 200)
        self.assertIn("leaderboard", lb_res.json())


if __name__ == "__main__":
    unittest.main()
