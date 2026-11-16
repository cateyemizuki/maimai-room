"""Ports of upstream garden rule/autonomy scenarios; no SDK/network required."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType

import importlib
import json
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "maimai_garden_test"
package = ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
sys.modules[PACKAGE] = package
G = importlib.import_module(PACKAGE + ".garden")
C = importlib.import_module(PACKAGE + ".garden_care")
R = importlib.import_module(PACKAGE + ".room_core")
T = int(datetime(2026, 11, 16, 12, tzinfo=timezone(timedelta(hours=8))).timestamp())
MS = T * 1000


def act(state, kind, at=MS, **fields):
    result = G.apply_garden_action(state, {"type": kind, **fields}, at)
    if not result["ok"]:
        raise AssertionError(result["message"])
    return result["state"]


def planted(crop="radish"):
    return act(act(G.create_garden(MS), "till", plotId=4), "plant", plotId=4, cropId=crop)


def room():
    state = R.empty_state(T)
    C.ensure_garden(state, T)
    state["garden"]["care"]["autoEnabled"] = False
    return state


def complete(state, now=T, limit=600):
    for i in range(limit):
        current = now + i
        R.tick(state, current)
        C.tick_garden(state, current)
        if not state["garden"]["care"]["task"] and not state["garden"]["care"]["queue"]:
            return current
    raise AssertionError("Physical job did not complete")


class RuleTests(unittest.TestCase):
    def reject(self, state, action, now=MS):
        before = deepcopy(state)
        result = G.apply_garden_action(state, action, now)
        self.assertFalse(result["ok"])
        self.assertEqual(result["state"], G.advance_garden(state, now))
        self.assertEqual(state, before)

    def test_catalog_and_new_save(self):
        self.assertEqual(len(G.CROPS), 12)
        self.assertEqual(len(G.BY_ID), 12)
        view = G.garden_view(G.create_garden(MS), MS)
        self.assertEqual(len(view["plots"]), 8)
        self.assertTrue(view["plots"][0]["mature"])
        self.assertTrue(all(not p["tilled"] for p in view["plots"][4:]))
        self.assertTrue(all(c["yield"] * c["sellPrice"] > c["seedCost"] for c in G.CROPS))
        self.assertTrue(all(p["cropId"] is None for p in G.normalize_garden({}, MS)["plots"]))

    def test_pure_inputs_seed_cost_and_replant(self):
        original = G.create_garden(MS)
        copy = deepcopy(original)
        state = planted("carrot")
        self.assertEqual(original, copy)
        self.assertEqual(state["seeds"]["carrot"], 2)
        self.assertEqual(state["plots"][4]["moisture"], .8)
        copy = deepcopy(state)
        G.advance_garden(state, MS + 5000)
        G.garden_view(state, MS + 5000)
        self.assertEqual(state, copy)

    def test_offline_growth_stops_at_drought(self):
        state = G.advance_garden(planted(), MS + 3_600_000)
        self.assertAlmostEqual(state["plots"][4]["progress"], .6)
        self.assertEqual(state["plots"][4]["moisture"], 0)
        state = act(state, "water", at=MS + 3_700_000, plotId=4)
        state = G.advance_garden(state, MS + 3_750_000)
        self.assertEqual(state["plots"][4]["progress"], 1)

    def test_poll_frequency_and_clock_rollback(self):
        state = act(planted("tomato"), "fertilize", plotId=4)
        whole = G.advance_garden(state, MS + 400_000)
        pieces = state
        for elapsed in range(1000, 400001, 1000):
            pieces = G.advance_garden(pieces, MS + elapsed)
        self.assertAlmostEqual(whole["plots"][4]["progress"], pieces["plots"][4]["progress"])
        self.assertAlmostEqual(whole["plots"][4]["moisture"], pieces["plots"][4]["moisture"])
        self.assertEqual(G.advance_garden(whole, MS + 200_000), whole)

    def test_fertilizer_speed_yield_and_single_use(self):
        state = act(planted(), "fertilize", plotId=4)
        self.assertEqual(state["compost"], 2)
        self.reject(state, {"type": "fertilize", "plotId": 4})
        self.assertAlmostEqual(G.garden_view(state, MS + 30000)["plots"][4]["progress"], .3)
        self.assertEqual(G.garden_view(state, MS)["plots"][4]["expectedYield"], 5)
        state = act(state, "water", at=MS + 70000, plotId=4)
        state = act(state, "harvest", at=MS + 130000, plotId=4)
        self.assertEqual(state["inventory"]["radish"], 5)
        self.assertEqual(state["stats"]["totalYield"], 5)

    def test_harvest_sell_shop_loop_no_duplicate_reward(self):
        state = act(G.create_garden(MS), "harvest", plotId=0)
        self.reject(state, {"type": "harvest", "plotId": 0})
        state = act(state, "sell", cropId="radish", quantity=3)
        self.assertEqual(state["coins"], 42)
        state = act(state, "buySeed", cropId="radish", quantity=2)
        state = act(state, "buyCompost", quantity=2)
        self.assertEqual((state["coins"], state["seeds"]["radish"], state["compost"]), (22, 5, 5))
        self.assertTrue(state["plots"][0]["tilled"])
        state = act(state, "plant", cropId="pumpkin", plotId=0)
        self.assertFalse(state["plots"][0]["fertilized"])

    def test_invalid_inputs_and_overspend_are_atomic(self):
        state = G.create_garden(MS)
        for value in [-1, 0, .5, 100, float("inf"), float("nan"), "2", None, True]:
            for kind in ["buySeed", "buyCompost", "sell"]:
                self.reject(state, {"type": kind, "cropId": "radish", "quantity": value})
        for index in [-1, 8, "0", .5, None, True]:
            self.reject(state, {"type": "water", "plotId": index})
        for action in [None, {}, {"type": "erase"}, {"type": "buySeed", "cropId": "__proto__"}]:
            self.reject(state, action)
        state.update(coins=0, compost=0)
        state["seeds"]["carrot"] = 0
        for action in [{"type": "buySeed", "cropId": "carrot"}, {"type": "buyCompost"},
                       {"type": "sell", "cropId": "carrot"}, {"type": "fertilize", "plotId": 1}]:
            self.reject(state, action)

    def test_all_twelve_crops_complete_real_cycle(self):
        for crop in G.CROPS:
            with self.subTest(crop=crop["id"]):
                state = planted(crop["id"])
                state = act(state, "water", at=MS + crop["growMs"] * .55, plotId=4)
                state = act(state, "harvest", at=MS + crop["growMs"] + 1, plotId=4)
                self.assertEqual(state["inventory"][crop["id"]], crop["yield"])
                state = act(state, "sell", at=MS + crop["growMs"] + 1, cropId=crop["id"], quantity=crop["yield"])
                self.assertEqual(state["inventory"][crop["id"]], 0)

    def test_bad_save_bounds_mature_preservation_and_stock_caps(self):
        state = G.normalize_garden({"coins": -9, "compost": float("inf"), "seeds": {"radish": 3.9},
                                    "plots": [{"id": 0, "cropId": "tomato", "progress": 9, "moisture": -4}],
                                    "secret": "discarded"}, MS)
        self.assertEqual((state["coins"], state["compost"], state["seeds"]["radish"]), (0, 0, 3))
        self.assertNotIn("secret", state)
        state = G.create_garden(MS)
        mature = G.garden_view(state, MS + 365 * 86400000)["plots"][0]
        self.assertEqual((mature["stage"], mature["remainingMs"]), (3, 0))
        state["inventory"]["radish"] = G.MAX_STOCK
        self.reject(state, {"type": "harvest", "plotId": 0})
        state["coins"] = G.MAX_STOCK
        self.reject(state, {"type": "sell", "cropId": "radish"})


class CareTests(unittest.TestCase):
    def test_walk_then_full_work_precede_reward(self):
        state = room()
        result = C.control_garden(state, "harvest", plot=0, request_id="harvest1", now_seconds=T)
        self.assertTrue(result["accepted"])
        self.assertEqual(state["garden"]["inventory"]["radish"], 0)
        C.tick_garden(state, T)
        target = state["character"]["target"]
        self.assertEqual(target["id"], "garden.plot0")
        while state["character"]["walking"]:
            now = state["lastTick"] + 1
            R.tick(state, now)
            C.tick_garden(state, now)
            self.assertEqual(state["garden"]["inventory"]["radish"], 0)
        task = state["garden"]["care"]["task"]
        self.assertEqual(task["phase"], "working")
        until = task["workUntil"] / 1000
        C.tick_garden(state, until - .001)
        self.assertEqual(state["garden"]["inventory"]["radish"], 0)
        C.tick_garden(state, until + .001)
        self.assertEqual(state["garden"]["inventory"]["radish"], 3)
        self.assertEqual(state["garden"]["care"]["receipts"][0]["status"], "completed")

    def test_retry_restart_and_conflicting_id(self):
        state = room()
        C.control_garden(state, "harvest", plot=0, request_id="same", now_seconds=T)
        self.assertFalse(C.control_garden(state, "harvest", plot=0, request_id="same", now_seconds=T + 1)["changed"])
        state = json.loads(json.dumps(state))
        now = complete(state)
        self.assertEqual(C.control_garden(state, "harvest", plot=0, request_id="same", now_seconds=now)["status"], "completed")
        before = deepcopy(state)
        with self.assertRaises(ValueError):
            C.control_garden(state, "buySeed", crop="carrot", request_id="same", now_seconds=now)
        self.assertEqual(state, before)
        for n in range(10):
            C.tick_garden(state, now + n)
        self.assertEqual(state["garden"]["stats"]["harvests"], 1)

    def test_all_eight_actions_physically_settle(self):
        state, now = room(), T
        actions = [("harvest", {"plot": 0}), ("sell", {"crop": "radish", "quantity": 2}),
                   ("till", {"plot": 4}), ("plant", {"plot": 4, "crop": "pumpkin"}), ("water", {"plot": 4}),
                   ("fertilize", {"plot": 4}), ("buySeed", {"crop": "strawberry"}), ("buyCompost", {})]
        for i, (action, fields) in enumerate(actions):
            C.control_garden(state, action, request_id="cycle" + str(i), now_seconds=now, **fields)
            now = complete(state, now) + 3
            self.assertTrue(state["garden"]["care"]["recent"][-1]["ok"])
        self.assertEqual(state["garden"]["inventory"]["radish"], 1)
        self.assertEqual(state["garden"]["plots"][4]["cropId"], "pumpkin")
        self.assertTrue(state["garden"]["plots"][4]["fertilized"])

    def test_stale_crop_cancelled_and_offline_work_not_skipped(self):
        state = room()
        C.control_garden(state, "harvest", plot=0, now_seconds=T)
        C.tick_garden(state, T)
        state["garden"]["plots"][0].update(cropId="carrot", plantedAt=MS + 1, progress=1)
        complete(state)
        self.assertEqual(state["garden"]["inventory"]["carrot"], 0)
        self.assertFalse(state["garden"]["care"]["recent"][-1]["ok"])
        state = room()
        C.control_garden(state, "harvest", plot=0, now_seconds=T)
        C.tick_garden(state, T)
        C.tick_garden(state, T + 1800)
        self.assertEqual(state["garden"]["inventory"]["radish"], 0)

    def test_sleep_manual_and_true_life_take_priority(self):
        for life in [{"available": True, "activity": {"name": "睡觉"}}, {"available": True, "activity": {"name": "认真工作"}}]:
            state = room()
            C.control_garden(state, "harvest", plot=0, now_seconds=T)
            result = C.tick_garden(state, T, life)
            self.assertFalse(result["busy"])
            self.assertIsNone(state["garden"]["care"]["task"])
        state = room()
        C.control_garden(state, "harvest", plot=0, now_seconds=T)
        C.tick_garden(state, T)
        R.apply_action(state, "sleep", now=T + 1)
        self.assertFalse(C.tick_garden(state, T + 1)["busy"])
        self.assertIsNone(state["garden"]["care"]["task"])
        self.assertEqual(state["character"]["source"], "webui")

    def test_conflict_defer_and_read_snapshot_purity(self):
        state = room()
        R.apply_action(state, "sit", now=T)
        result = C.control_garden(state, "careNow", now_seconds=T)
        self.assertTrue(result["conflict"])
        before = deepcopy(state)
        view = C.garden_snapshot(state, T + 20)
        self.assertEqual(state, before)
        self.assertEqual(len(view["catalog"]), 12)
        C.tick_garden(state, T + 31)
        self.assertIsNone(state["garden"]["care"]["pendingConflict"])

    def test_single_save_contains_receipt_route_and_rewards(self):
        state = room()
        C.control_garden(state, "harvest", plot=0, request_id="save", now_seconds=T)
        C.tick_garden(state, T)
        restored = json.loads(json.dumps(state))
        now = complete(restored)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "room.json"
            R.save_state(path, restored)
            reboot = R.load_state(path)
        for offset in range(10):
            C.tick_garden(reboot, now + offset)
        self.assertEqual(reboot["garden"]["stats"]["harvests"], 1)
        self.assertEqual(reboot["garden"]["care"]["receipts"][0]["status"], "completed")

    def test_commands_and_invalid_requests_are_atomic(self):
        self.assertEqual(C.parse_garden_command("播种 5 胡萝卜"), {"action": "plant", "plot": 4, "crop": "carrot"})
        self.assertEqual(C.parse_garden_command("auto off"), {"action": "auto_off"})
        self.assertEqual(C.parse_garden_command("buy-seeds tomato 2"), {"action": "buySeed", "crop": "tomato", "quantity": 2})
        state = room()
        before = deepcopy(state)
        for arguments in [{"action": "erase"}, {"action": "water", "plot": 9}, {"action": "buySeed", "crop": "radish", "quantity": -1},
                          {"action": "visit", "request_id": "bad\n"}]:
            with self.assertRaises(ValueError):
                C.control_garden(state, now_seconds=T, **arguments)
            self.assertEqual(state, before)

    def test_one_hour_autonomy_covers_eight_actions_and_twelve_crops(self):
        state = room()
        state["garden"]["care"]["autoEnabled"] = True
        done, crops = set(), set()
        for now in range(T, T + 3601):
            R.tick(state, now)
            C.tick_garden(state, now)
            done.update(v["type"] for v in state["garden"]["care"]["recent"] if v["ok"])
            crops.update(p["cropId"] for p in state["garden"]["plots"] if p["cropId"])
        self.assertEqual(done, G.ACTIONS)
        self.assertEqual(len(crops), 12)
        self.assertGreaterEqual(state["garden"]["stats"]["harvests"], 20)
        self.assertGreaterEqual(state["garden"]["coins"], 0)


if __name__ == "__main__":
    unittest.main()
