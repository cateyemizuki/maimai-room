"""Offline tests using the real installed maibot_sdk; never connect to QQ."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import asyncio
import base64
import hashlib
import importlib.util
import json
import logging
import re
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("maimai_room_test_plugin", ROOT / "plugin.py", submodule_search_locations=[str(ROOT)])
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
CORE = sys.modules[SPEC.name + ".room_core"]


class CoreTests(unittest.TestCase):
    def test_navigation_graph_arrival_and_pose(self):
        state = CORE.empty_state(1000)
        CORE.apply_action(state, "睡", now=1000, hold_seconds=900)
        self.assertTrue(state["character"]["walking"])
        self.assertEqual(state["character"]["pose"], "stand")
        for now in range(1001, 1060):
            CORE.tick(state, now)
        char = state["character"]
        self.assertEqual((char["action"], char["pose"], char["room"]), ("sleep", "lie", "her_room"))
        self.assertAlmostEqual(char["elevation"], 0.52)
        CORE.apply_action(state, "唤醒", now=1060)
        self.assertEqual(char["pose"], "stand")
        self.assertEqual([char["position"]["x"], char["position"]["z"]], CORE.NODES["beside"])

    def test_manual_override_then_true_life_activity(self):
        state = CORE.empty_state(1000)
        life = {"available": True, "activity": {"name": "认真学习", "goal_type": "study"}}
        CORE.apply_action(state, "sit", "sofa", now=1000, hold_seconds=60)
        self.assertFalse(CORE.advance_auto(state, life, 1010))
        self.assertTrue(CORE.advance_auto(state, life, 1061))
        self.assertEqual(state["character"]["target"]["id"], "her_room.desk")
        self.assertEqual(state["character"]["source"], "life-activity")

    def test_duplicate_and_invalid_actions_are_atomic(self):
        state = CORE.empty_state(1000)
        CORE.apply_action(state, "lamp", now=1000, request_id="same")
        before = json.dumps(state, sort_keys=True)
        changed, _ = CORE.apply_action(state, "lamp", now=1001, request_id="same")
        self.assertFalse(changed)
        self.assertEqual(before, json.dumps(state, sort_keys=True))
        with self.assertRaises(ValueError):
            CORE.apply_action(state, "walk", "nan,inf", now=1002)
        self.assertEqual(before, json.dumps(state, sort_keys=True))
        with self.assertRaises(ValueError):
            CORE.apply_action(state, "mood", "arbitrary", now=1002)
        self.assertEqual(before, json.dumps(state, sort_keys=True))

    def test_expression_source_expiry_and_persistence(self):
        state = CORE.empty_state(1000)
        CORE.apply_action(state, "心情", "开心", now=1000, hold_seconds=10)
        view = CORE.snapshot(state, MODULE.unavailable_life(), "麦麦", 1001)
        self.assertEqual(view["character"]["expression"]["source"], "user")
        self.assertFalse(view["life"]["mood"]["available"])
        CORE.tick(state, 1011)
        self.assertEqual(state["character"]["expression"]["source"], "default")
        CORE.apply_action(state, "心情", "开心", now=1012, hold_seconds=10)
        CORE.apply_action(state, "心情", "恢复", now=1013)
        self.assertEqual(state["character"]["expression"]["source"], "default")
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "room.json"
            CORE.save_state(path, state)
            loaded = CORE.load_state(path)
            self.assertEqual(loaded["revision"], state["revision"])
            self.assertEqual(loaded["room"], state["room"])
            path.write_text('{"schemaVersion":999}', encoding="utf-8")
            with self.assertRaises(ValueError):
                CORE.load_state(path)
            self.assertEqual(path.read_text(), '{"schemaVersion":999}')

    def test_cross_room_path_goes_through_doorways(self):
        target = CORE.resolve_target("bed")
        path = CORE.path_to([6.3, 1.5], target)
        self.assertIn(CORE.NODES["gate"], path)
        self.assertIn(CORE.NODES["bedroom_in"], path)
        self.assertEqual(path[-1], target["pos"])
        point = CORE.resolve_target("12.5,3")
        self.assertEqual(point["pos"], [12.5, 3.0])
        self.assertEqual(CORE.resolve_target("dining")["room"], "dining")

    def test_transient_gesture_is_shared_and_expires_without_life_mutation(self):
        state = CORE.empty_state(1000)
        life = MODULE.unavailable_life()
        for action in ("pet", "poke", "feed", "water", "play", "dance", "stretch", "bow"):
            CORE.apply_action(state, action, now=1000, source="qq", request_id="gesture:" + action)
            gesture = CORE.snapshot(state, life, "麦麦", 1000)["character"]["gesture"]
            self.assertEqual(gesture["name"], action)
            self.assertEqual(gesture["source"], "qq")
            self.assertFalse(CORE.advance_auto(state, life, 1001))
        CORE.tick(state, 1010)
        self.assertIsNone(state["character"]["gesture"])
        self.assertEqual(life, MODULE.unavailable_life())


class FakeAPI:
    def __init__(self):
        self.calls = []
        self.failed = False

    async def call(self, name, **kwargs):
        self.calls.append((name, kwargs))
        if self.failed:
            raise RuntimeError("public API offline")
        if name.endswith("get_current_activity"):
            return {"has_activity": True, "activity": {"name": "书桌学习", "goal_type": "study", "time_window": "09:00-10:00"}, "error": None, "timezone": "Asia/Shanghai"}
        if name.endswith("companion_get_schedule"):
            return [{"time": "09:00", "activity": "学习", "day_offset": 0, "private_extra": "must be discarded"}]
        return {"label": "平静"}


class FakeSend:
    def __init__(self):
        self.messages = []

    async def text(self, text, stream_id):
        self.messages.append((text, stream_id))


class FakeConfig:
    def __init__(self):
        self.permissions = []
        self.keys = []
        self.failed = False

    async def get(self, key, default=None):
        self.keys.append(key)
        if self.failed:
            raise RuntimeError("host config unavailable")
        return self.permissions if key == "plugin.permission" else default


class FakeInternalChat:
    def __init__(self):
        self.sends = []
        self.supported = True

    async def identity(self):
        return {"platform": "internal" if self.supported else "unsupported", "user_id": "owner"}

    async def send(self, text):
        self.sends.append(text)
        return {"message_id": "internal-message-" + str(len(self.sends))}


class FakeGateway:
    def __init__(self):
        self.sends = []
        self.supported = True

    async def update_state(self, *args, **kwargs):
        return self.supported

    async def route_message(self, gateway_name, message, **kwargs):
        if not self.supported:
            return False
        if message.get("platform") != "maimai_room" or not message.get("message_id") or not isinstance(message.get("raw_message"), list):
            raise RuntimeError("[E_BAD_PAYLOAD] Gateway messages require top-level route fields")
        self.sends.append(message)
        return True


class FakeChat:
    async def open_session(self, **kwargs):
        return {"success": True, "session_id": "room-native-stream", "platform": "maimai_room"}


class SDKTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.plugin = MODULE.create_plugin()
        self.plugin.set_plugin_config({"plugin": {"config_version": "1.0.0"}, "access": {"allowed_users": ["qq:123"], "allowed_groups": ["456"]},
                                       "behaviour": {"automatic": False}, "life": {"enabled": False}})
        self.ctx = SimpleNamespace(paths=SimpleNamespace(data_dir=Path(self.temp.name)), api=FakeAPI(),
                                   config=FakeConfig(), internal_chat=FakeInternalChat(), gateway=FakeGateway(), chat=FakeChat(), send=FakeSend(), logger=logging.getLogger("test-room"))
        self.plugin._set_context(self.ctx)
        await self.plugin.on_load()

    async def asyncTearDown(self):
        await self.plugin.on_unload()
        self.temp.cleanup()

    async def test_real_sdk_factory_registration_and_default_schema(self):
        from maibot_sdk import MaiBotPlugin
        self.assertIsInstance(self.plugin, MaiBotPlugin)
        components = {item["name"]: item for item in self.plugin.get_components()}
        self.assertEqual(set(components), {"maimai_room", "room_snapshot", "room_interact", "room_model_info", "room_model_chunk","room_runtime_chunk",
                                           "room_chat_send", "room_chat_status", "maimai_room_chat", "room_garden_action",
                                           "room_chat_history", "room_ui_event", "room_events", "room_events_subscribe",
                                           "room_tv_review", "room_tv_save_frame", "room_tv_status",
                                           "room_adjust_state", "room_schedule_update", "room_control", "room_media_control",
                                           "room_media_chunk", "room_control_action", "room_client_config", "room_media_status"})
        self.assertFalse(components["room_interact"]["metadata"]["public"])
        self.assertTrue(self.plugin.get_webui_config_schema())
        self.assertEqual(self.plugin.get_default_config()["access"]["allowed_users"], [])

    async def test_actual_command_kwargs_authorization_and_shared_state(self):
        context = {"text": "/房间 坐 沙发", "stream_id": "mock-stream", "platform": "qq", "user_id": "123", "group_id": "456",
                   "matched_groups": {"room_args": "坐 沙发"}}
        success, _, _ = await self.plugin.command_room(**dict(context, user_id="intruder"))
        self.assertFalse(success)
        self.assertEqual(self.plugin._state["revision"], 0)
        success, _, _ = await self.plugin.command_room(**context)
        self.assertTrue(success)
        view = await self.plugin.room_snapshot()
        self.assertEqual(view["character"]["target"]["id"], "living.sofa")
        self.assertEqual(view["character"]["source"], "qq")
        self.assertTrue((Path(self.temp.name) / "room.json").is_file())
        self.assertEqual(len(self.ctx.send.messages), 2)
        self.assertFalse(self.plugin._authorized(dict(context, platform="other")))
        self.assertFalse(self.plugin._authorized(dict(context, group_id="not-allowed")))
        self.assertTrue(self.plugin._authorized({"is_local_operator": True}))

    async def test_webui_action_idempotency_and_snapshot_read_only(self):
        first = await self.plugin.room_interact(command="lamp", request_id="id-1")
        second = await self.plugin.room_interact(command="lamp", request_id="id-1")
        self.assertEqual(first["revision"], second["revision"])
        self.assertEqual(first["room"]["lamp"], second["room"]["lamp"])
        self.assertFalse(second["changed"])
        before = json.dumps(self.plugin._state, sort_keys=True)
        self.assertEqual((await self.plugin.room_snapshot())["revision"], second["revision"])
        self.assertEqual(before, json.dumps(self.plugin._state, sort_keys=True))
        self.assertEqual(self.ctx.send.messages, [])

    async def test_frequent_controls_do_not_starve_a_walk(self):
        await self.plugin.room_snapshot()
        start = await self.plugin.room_interact("walk", "balcony", "start-walk")
        self.assertTrue(start["character"]["walking"])
        for i in range(10):
            await asyncio.sleep(0.09)
            await self.plugin.room_interact("lamp", request_id=f"lamp-{i}")
        after = await self.plugin.room_snapshot()
        self.assertNotEqual(start["character"]["position"], after["character"]["position"])

    async def test_schedule_uses_explicit_push_and_never_pulls_legacy_life(self):
        self.plugin.set_plugin_config({"plugin": {"config_version": "1.2.0"}, "life": {"enabled": True}})
        view = await self.plugin.room_snapshot()
        self.assertEqual(view["life"]["source"], "room-routine")
        self.assertEqual(self.ctx.api.calls, [])
        receipt = await self.plugin.room_control("claim", "test.schedule")
        await self.plugin.room_schedule_update(receipt["token"],
            {"name": "认真学习", "target": "desk", "command": "sit"},
            [{"time": "09:00", "activity": "学习", "private_extra": "hidden"}])
        view = await self.plugin.room_snapshot()
        self.assertEqual(view["life"]["source"], "plugin:test.schedule")
        self.assertNotIn("private_extra", view["life"]["schedule"][0])
        self.assertNotIn("token", view["integration"])
        self.assertEqual(self.ctx.api.calls, [])

    async def test_model_chunks_reassemble_and_reject_paths(self):
        model = Path(self.temp.name) / "model.glb"
        raw = bytes(range(256)) * 2100
        model.write_bytes(raw)
        with patch.object(self.plugin, "_model_path", return_value=model):
            info = await self.plugin.room_model_info()
            chunks = [await self.plugin.room_model_chunk(index=i) for i in range(info["chunks"])]
            rebuilt = b"".join(base64.b64decode(chunk["data"]) for chunk in chunks)
            self.assertEqual(rebuilt, raw)
            self.assertEqual(info["sha256"], hashlib.sha256(raw).hexdigest())
            self.assertLess(max(len(json.dumps(chunk).encode()) for chunk in chunks), 524288)
            with self.assertRaises(ValueError):
                await self.plugin.room_model_chunk(index=info["chunks"])
            with self.assertRaises(ValueError):
                await self.plugin.room_model_chunk(index=True)
        with self.assertRaises(ValueError):
            await self.plugin.room_model_info(asset="../../config.toml")
        with self.assertRaises(ValueError):
            await self.plugin.room_model_info(quality="../../config.toml")

    async def test_model_quality_uses_two_fixed_paths_and_separate_cache(self):
        expected = ROOT / "web" / "assets" / "models"
        self.assertEqual(self.plugin._model_path("maisaka.glb", "mobile"), expected / "maisaka.glb")
        self.assertEqual(self.plugin._model_path("maisaka.glb", "high"), expected / "maisaka-hi.glb")
        paths = {quality: Path(self.temp.name) / (quality + ".glb") for quality in ("mobile", "high")}
        paths["mobile"].write_bytes(b"mobile")
        paths["high"].write_bytes(b"high-resolution-model")
        with patch.object(self.plugin, "_model_path", side_effect=lambda asset, quality="mobile", encoding="plain": paths[quality]):
            mobile = await self.plugin.room_model_info()
            high = await self.plugin.room_model_info(quality="high")
            self.assertEqual(mobile["quality"], "mobile")
            self.assertEqual(high["quality"], "high")
            self.assertNotEqual(mobile["sha256"], high["sha256"])
            self.assertEqual((await self.plugin.room_model_info())["sha256"], mobile["sha256"])
            chunk = await self.plugin.room_model_chunk(index=0, quality="high")
            self.assertEqual(chunk["asset"], "maisaka.glb")
            self.assertEqual(chunk["quality"], "high")
            self.assertEqual(base64.b64decode(chunk["data"]), b"high-resolution-model")

    async def test_regex_root_is_scoped(self):
        self.assertIsNotNone(re.fullmatch(MODULE.ROOT_PATTERN, "/room sleep"))
        self.assertIsNone(re.fullmatch(MODULE.ROOT_PATTERN, "/roommate sleep"))
        self.assertIsNone(re.fullmatch(MODULE.ROOT_PATTERN, "普通聊天 /room sleep"))

    async def test_sdk_host_operator_inheritance_is_qq_scoped_and_group_limited(self):
        self.plugin.set_plugin_config({"plugin": {"config_version": "1.0.0"},
                                       "access": {"allowed_users": [], "allowed_groups": ["456"]}})
        self.ctx.config.permissions = ["qq:123", "other:987", "888", True]
        context = {"platform": "qq", "user_id": "123", "group_id": "456"}
        self.assertTrue(await self.plugin._command_authorized(context))
        self.assertFalse(await self.plugin._command_authorized(dict(context, group_id="other")))
        self.assertFalse(await self.plugin._command_authorized(dict(context, user_id="987")))
        self.assertFalse(await self.plugin._command_authorized(dict(context, user_id="888")))
        self.assertFalse(await self.plugin._command_authorized(dict(context, platform="other")))
        self.assertEqual(set(self.ctx.config.keys), {"plugin.permission"})
        self.ctx.config.permissions = []
        self.assertFalse(await self.plugin._command_authorized(context))
        self.ctx.config.failed = True
        self.assertFalse(await self.plugin._command_authorized(context))

    async def test_explicit_room_allowlist_overrides_host_operators(self):
        self.ctx.config.permissions = ["qq:987"]
        self.assertFalse(await self.plugin._command_authorized({"platform": "qq", "user_id": "987"}))
        self.assertEqual(self.ctx.config.keys, [])
        self.plugin.set_plugin_config({"plugin": {"config_version": "1.0.0"},
                                       "access": {"allowed_users": [], "inherit_host_operators": False}})
        self.assertFalse(await self.plugin._command_authorized({"platform": "qq", "user_id": "987"}))
        self.assertEqual(self.ctx.config.keys, [])

    async def test_chat_isolated_gateway_and_exact_reply_receipt(self):
        self.assertEqual(self.ctx.internal_chat.sends, [])
        request_id = "room-chat-request-0001"
        await self.plugin.room_chat_send(text="你好", request_id=request_id)
        await asyncio.gather(*list(self.plugin._chat.tasks))
        submitted = await self.plugin.room_chat_status(request_id)
        self.assertEqual(len(self.ctx.gateway.sends), 1)
        inbound = self.ctx.gateway.sends[0]
        self.assertEqual(inbound["message_info"]["platform"], "maimai_room")
        self.assertEqual(inbound["message_info"]["user_info"]["user_id"], "room_owner")
        self.assertEqual(self.ctx.internal_chat.sends, [])
        message = {"platform": "maimai_room", "message_id": "reply-1",
                   "message_info": {"additional_config": {"platform_io_target_user_id": "room_owner"}},
                   "processed_plain_text": "专属聊天回复", "reply_to": submitted["messageId"]}
        denied = await self.plugin.room_chat_gateway(message, {"platform": "qq", "scope": "maimai_room"})
        self.assertFalse(denied["success"])
        self.assertEqual((await self.plugin.room_chat_status(request_id))["reply"], "")
        route = {"platform": "maimai_room", "scope": "maimai_room"}
        await self.plugin.room_chat_gateway(message, route)
        await self.plugin.room_chat_gateway(message, route)
        result = await self.plugin.room_chat_status(request_id)
        self.assertEqual(result["reply"], "专属聊天回复")
        self.assertEqual(result["replyMessageIds"], ["reply-1"])
        history = await self.plugin.room_chat_history()
        self.assertEqual([r["role"] for r in history["messages"]], ["user", "assistant"])
        self.assertEqual(self.ctx.send.messages, [])

    async def test_chat_unsupported_and_disabled_never_fabricates_or_sends(self):
        self.ctx.gateway.supported = False
        result = await self.plugin.room_chat_send(text="测试", request_id="unsupported-request-0001")
        await asyncio.gather(*list(self.plugin._chat.tasks))
        result = await self.plugin.room_chat_status(result["requestId"])
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["reply"], "")
        self.assertEqual(self.ctx.internal_chat.sends, [])
        self.plugin.set_plugin_config({"plugin": {"config_version": "1.0.0"}, "chat": {"enabled": False}})
        with self.assertRaises(ValueError):
            await self.plugin.room_chat_send(text="测试", request_id="disabled-request-0001")

    async def test_garden_facade_is_shared_atomic_and_idempotent(self):
        original = json.dumps(self.plugin._state, sort_keys=True)
        with self.assertRaises(ValueError):
            await self.plugin.room_garden_action(action="plant", plot=100, crop="arbitrary")
        self.assertEqual(json.dumps(self.plugin._state, sort_keys=True), original)
        coins = (await self.plugin.room_snapshot())["garden"]["coins"]
        first = await self.plugin.room_garden_action(action="buySeed", crop="radish", quantity=1, request_id="garden-buy-1")
        self.assertTrue(first["accepted"])
        self.assertEqual(first["garden"]["coins"], coins)
        repeated = await self.plugin.room_garden_action(action="buySeed", crop="radish", quantity=1, request_id="garden-buy-1")
        self.assertFalse(repeated["changed"])
        self.assertEqual(first["revision"], repeated["revision"])
        persisted = json.loads((Path(self.temp.name) / "room.json").read_text(encoding="utf-8"))
        self.assertEqual(persisted["garden"]["coins"], coins)
        self.assertEqual(len(persisted["garden"]["care"]["queue"]), 1)
        self.assertEqual(self.ctx.send.messages, [])

    async def test_qq_garden_route_uses_the_same_transaction(self):
        success, response, _ = await self.plugin.command_room(text="/room 菜园 买种子 胡萝卜 1", platform="qq", user_id="123", group_id="456",
                                                              stream_id="mock-stream", matched_groups={"room_args": "菜园 买种子 胡萝卜 1"})
        self.assertTrue(success)
        queue = self.plugin._state["garden"]["care"]["queue"]
        self.assertEqual(len(queue), 1)
        self.assertEqual(queue[0]["action"]["cropId"], "carrot")
        self.assertIn("走到现场", response)


if __name__ == "__main__":
    unittest.main(verbosity=2)
