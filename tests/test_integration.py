"""Regression coverage for ownership, chat permissions and asynchronous media."""
from copy import deepcopy
from datetime import datetime
import asyncio
import base64
import gzip
import hashlib
import json
import time
from types import SimpleNamespace
from unittest.mock import patch
import unittest

import test_room as room_tests
from test_room import CORE, MODULE, ROOT


class IntegrationTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = room_tests.SDKTests.asyncSetUp
    asyncTearDown = room_tests.SDKTests.asyncTearDown

    async def test_read_snapshot_projects_walking_to_its_server_time(self):
        now = time.time()
        self.plugin._state = CORE.empty_state(now - .4)
        CORE.travel(self.plugin._state, CORE.resolve_target("balcony"), "stand", "webui", now - .4)
        original = json.dumps(self.plugin._state, sort_keys=True)
        expected = deepcopy(self.plugin._state)
        CORE.tick(expected, now, 1.15)
        with patch.object(MODULE.time, "time", return_value=now):
            view = await self.plugin.room_snapshot()
        self.assertEqual(view["character"]["position"], expected["character"]["position"])
        self.assertNotEqual(view["character"]["position"], self.plugin._state["character"]["position"])
        self.assertEqual(json.dumps(self.plugin._state, sort_keys=True), original)
        self.assertEqual(view["revision"], self.plugin._state["revision"])

    async def test_projection_exposes_and_uses_the_configured_speed(self):
        cfg = self.plugin.config.model_dump()
        cfg["behaviour"]["walking_speed"] = 2.4
        self.plugin.set_plugin_config(cfg)
        now = time.time()
        self.plugin._state = CORE.empty_state(now - .4)
        CORE.travel(self.plugin._state, CORE.resolve_target("balcony"), "stand", "webui", now - .4)
        expected = deepcopy(self.plugin._state)
        CORE.tick(expected, now, 2.4)
        with patch.object(MODULE.time, "time", return_value=now):
            view = await self.plugin.room_snapshot()
        self.assertEqual(view["movementSpeed"], 2.4)
        self.assertEqual(view["character"]["position"], expected["character"]["position"])

    async def test_retarget_commits_the_current_position_before_changing_route(self):
        now = time.time()
        self.plugin._state = CORE.empty_state(now - .4)
        CORE.travel(self.plugin._state, CORE.resolve_target("balcony"), "stand", "webui", now - .4)
        expected = deepcopy(self.plugin._state)
        CORE.tick(expected, now, 1.15)
        with patch.object(MODULE.time, "time", return_value=now):
            await self.plugin.room_interact("walk", "bed", "retarget-current-position")
        self.assertEqual(self.plugin._state["character"]["position"], expected["character"]["position"])
        self.assertEqual(self.plugin._state["character"]["target"]["id"], "her_room.bed")

    async def test_invalid_retarget_does_not_commit_partial_simulation(self):
        now = time.time()
        self.plugin._state = CORE.empty_state(now - .4)
        CORE.travel(self.plugin._state, CORE.resolve_target("balcony"), "stand", "webui", now - .4)
        before = json.dumps(self.plugin._state, sort_keys=True)
        with self.assertRaises(ValueError):
            await self.plugin.room_interact("walk", "../unknown", "invalid-retarget")
        self.assertEqual(json.dumps(self.plugin._state, sort_keys=True), before)
    async def test_exact_floor_destination_and_wall_rejection(self):
        target = CORE.resolve_target("6.7,2.1")
        self.assertEqual(target["pos"], [6.7, 2.1])
        self.assertEqual(CORE.path_to([6.3, 1.5], target)[-1], [6.7, 2.1])
        with self.assertRaises(ValueError):
            CORE.resolve_target("6.3,5.1")
        with self.assertRaises(ValueError):
            CORE.resolve_target("8.4,2.0")

    async def test_mid_edge_route_does_not_return_to_nearest_vertex(self):
        nav = __import__(MODULE.__package__+".room_navigation", fromlist=["find_route"])
        nodes = {"a": [5, 2], "b": [7, 2], "c": [7, 4]}
        target = {"id": "end", "pos": [7, 4], "access": "c"}
        route = nav.find_route([5.6, 2], target, nodes, [["a", "b"], ["b", "c"]],
                               [{"bounds": [4.2, 0, 8.4, 7.6]}])
        self.assertTrue(all(p[0] >= 5.6 for p in route), route)
        self.assertEqual(route[-1], [7, 4])

    async def test_walk_to_furniture_stops_at_its_access(self):
        now = time.time()
        state = CORE.empty_state(now)
        CORE.travel(state, CORE.resolve_target("sofa"), "stand", "webui", now)
        self.assertEqual(state["character"]["target"]["pos"], CORE.NODES["living_sofa"])

    async def test_interaction_signals_dedupe_and_exclude_private_fields(self):
        await self.plugin.room_ui_event("chat.send", '{"control":"chatSend","text":"private","url":"secret"}', "event-once")
        await self.plugin.room_ui_event("chat.send", "{}", "event-once")
        result = await self.plugin.room_events()
        self.assertEqual(len(result["events"]), 1)
        self.assertEqual(result["events"][0]["detail"], {"control": "chatSend"})
        self.assertEqual((await self.plugin.room_events(result["latestSeq"]))["events"], [])
        before = len(result["events"])
        await self.plugin.room_interact("lamp", request_id="signal-action-once")
        await self.plugin.room_interact("lamp", request_id="signal-action-once")
        events = (await self.plugin.room_events())["events"]
        self.assertEqual(len(events), before + 1)
        self.assertEqual(events[-1]["type"], "room.action")

    async def test_interaction_callback_reaches_another_plugin(self):
        async def get_api(name, version):
            return {"enabled": True, "public": True}
        self.ctx.api.get = get_api
        subscription = await self.plugin.room_events_subscribe("example.listener.on_room_event")
        await self.plugin.room_ui_event("object.select", '{"room":"living","spot":"sofa"}', "event-callback")
        await asyncio.wait_for(self.plugin._event_queue.join(), 2)
        self.assertEqual(self.ctx.api.calls[-1][0], "example.listener.on_room_event")
        self.assertEqual(self.ctx.api.calls[-1][1]["event"]["name"], "object.select")
        with self.assertRaises(ValueError):
            await self.plugin.room_events_subscribe("example.listener.on_room_event", remove=True)
        await self.plugin.room_events_subscribe("example.listener.on_room_event", token=subscription["token"], remove=True)

    async def test_native_chat_tool_uses_explicit_namespaced_permission(self):
        cfg = self.plugin.config.model_dump()
        cfg["tools"]["private_users"] = ["maimai_room:room_owner"]
        self.plugin.set_plugin_config(cfg)
        result = await self.plugin.room_adjust_state("stand", platform="maimai_room", user_id="room_owner")
        self.assertTrue(result["success"])
        denied = await self.plugin.room_adjust_state("stand", platform="qq", user_id="room_owner")
        self.assertFalse(denied["success"])

    async def test_event_paging_bounds_large_unicode_payloads(self):
        payload = json.dumps({k: "甲"*120 for k in ("control", "room", "spot", "plot", "camera", "button", "command", "target", "kind")}, ensure_ascii=False)
        for i in range(100):
            await self.plugin.room_ui_event("button", payload, f"budget-{i}")
        first = await self.plugin.room_events(limit=256)
        self.assertLess(len(first["events"]), 100)
        self.assertLess(len(json.dumps(first, ensure_ascii=False).encode("utf8")), 524288)
        second = await self.plugin.room_events(first["events"][-1]["seq"], limit=256)
        self.assertEqual(len(first["events"])+len(second["events"]), 100)

    async def test_callback_registration_rejects_sdk_error_receipts(self):
        async def unavailable(name, version):
            return {"success": False, "error": "API unavailable"}
        self.ctx.api.get = unavailable
        with self.assertRaises(ValueError):
            await self.plugin.room_events_subscribe("example.missing.callback")
        self.assertFalse(self.plugin._state.get("interactionSubscribers"))

    async def test_native_chat_retry_after_reload_does_not_resend(self):
        request_id = "native-durable-request-001"
        await self.plugin.room_chat_send("持久回执测试", request_id)
        await asyncio.gather(*list(self.plugin._chat.tasks))
        self.assertEqual(len(self.ctx.gateway.sends), 1)
        await self.plugin._chat.close()
        chat_module = __import__(MODULE.__package__+".room_chat", fromlist=["RoomChatBridge"])
        self.plugin._chat = chat_module.RoomChatBridge(self.ctx, self.ctx.paths.data_dir)
        await self.plugin.room_chat_send("持久回执测试", request_id)
        await asyncio.gather(*list(self.plugin._chat.tasks))
        self.assertEqual(len(self.ctx.gateway.sends), 1)
        self.assertEqual((await self.plugin.room_chat_status(request_id))["status"], "sent")

    async def test_native_gateway_payload_rejection_is_definitive(self):
        async def reject(*args, **kwargs):
            raise RuntimeError("[E_BAD_PAYLOAD] invalid route fields")
        self.ctx.gateway.route_message = reject
        request_id = "native-invalid-route-001"
        await self.plugin.room_chat_send("无效网关参数测试", request_id)
        await asyncio.gather(*list(self.plugin._chat.tasks))
        self.assertEqual((await self.plugin.room_chat_status(request_id))["status"], "error")
        history = await self.plugin.room_chat_history()
        self.assertFalse(any(r["id"] == "room-"+request_id for r in history["messages"]))

    async def test_tool_default_lists_and_force_do_not_grant_access(self):
        defaults = self.plugin.get_default_config()
        self.assertTrue(defaults["tools"]["enabled"])
        self.assertFalse(defaults["tools"]["force_enabled"])
        self.assertEqual(defaults["tools"]["private_users"], [])
        self.assertEqual(defaults["tools"]["groups"], [])
        denied = await self.plugin.room_adjust_state("stand", platform="qq", user_id="123")
        self.assertFalse(denied["success"])
        self.plugin.set_plugin_config({"plugin": {"config_version": "1.2.0"}, "tools": {"force_enabled": True}})
        denied = await self.plugin.room_adjust_state("stand", platform="qq", user_id="123")
        self.assertFalse(denied["success"])

    async def test_chat_modes_and_takeover_visibility(self):
        toggles = []
        async def record(name, component_type, **kwargs):
            toggles.append((name, component_type))
        self.ctx.component = SimpleNamespace(enable_component=record, disable_component=record)
        self.plugin.set_plugin_config({"plugin": {"config_version": "1.2.0"}, "tools": {"private_users": ["qq:123"], "groups": ["456"]}})
        self.assertTrue((await self.plugin.room_adjust_state("stand", platform="qq", user_id="123"))["success"])
        self.assertFalse((await self.plugin.room_adjust_state("stand", platform="qq", user_id="123", group_id="999"))["success"])
        self.assertTrue((await self.plugin.room_adjust_state("mood", "开心", platform="qq", user_id="999", group_id="456"))["success"])
        claim = await self.plugin.room_control("claim", "test.owner", ttl_seconds=10)
        self.assertFalse(self.plugin._tool_available())
        self.assertFalse((await self.plugin.room_adjust_state("stand", platform="qq", user_id="123"))["success"])
        self.plugin.set_plugin_config({"plugin": {"config_version": "1.2.0"}, "tools": {"private_users": ["123"], "force_enabled": True}})
        self.assertTrue((await self.plugin.room_adjust_state("stand", platform="qq", user_id="123"))["success"])
        self.assertFalse((await self.plugin.room_adjust_state("stand", platform="qq", user_id="999"))["success"])
        await self.plugin.room_control("release", token=claim["token"])
        self.assertTrue(self.plugin._tool_available())
        self.assertTrue(toggles)

    async def test_lease_conflict_invalid_token_and_expiry_fallback(self):
        receipt = await self.plugin.room_control("claim", "test.owner", ttl_seconds=10)
        token = receipt["token"]
        with self.assertRaises(ValueError):
            await self.plugin.room_control("claim", "test.intruder")
        with self.assertRaises(ValueError):
            await self.plugin.room_control_action("invalid", "sleep")
        await self.plugin.room_control_action(token, "sit", "desk", "once")
        view = await self.plugin.room_snapshot()
        self.assertEqual(view["character"]["source"], "plugin:test.owner")
        self.assertGreater(view["manualUntil"], 0)
        self.plugin._control.until = time.time() - 1
        view = await self.plugin.room_snapshot()
        self.assertEqual(view["manualUntil"], 0)
        self.assertEqual(view["life"]["source"], "room-routine")
        with self.assertRaises(ValueError):
            await self.plugin.room_control_action(token, "stand")

    async def test_force_config_reload_keeps_the_active_lease(self):
        receipt = await self.plugin.room_control("claim", "test.owner")
        cfg = self.plugin.config.model_dump()
        cfg["tools"].update(private_users=["123"], force_enabled=True)
        await self.plugin.on_config_update(MODULE.CONFIG_RELOAD_SCOPE_SELF, cfg, "test-update-1")
        self.plugin._control.require(receipt["token"], time.time())
        self.assertTrue((await self.plugin.room_adjust_state("stand", platform="qq", user_id="123"))["success"])
        cfg["tools"]["force_enabled"] = False
        await self.plugin.on_config_update(MODULE.CONFIG_RELOAD_SCOPE_SELF, cfg, "test-update-2")
        self.plugin._control.require(receipt["token"], time.time())
        self.assertFalse((await self.plugin.room_adjust_state("stand", platform="qq", user_id="123"))["success"])

    async def test_explicit_schedule_destination_and_invalid_push_atomicity(self):
        receipt = await self.plugin.room_control("claim", "test.owner")
        token = receipt["token"]
        await self.plugin.room_schedule_update(token, {"name": "看书", "command": "sit", "target": "desk"})
        self.plugin._state["manualUntil"] = 0
        CORE.advance_auto(self.plugin._state, self.plugin._life, time.time())
        self.assertEqual(self.plugin._state["character"]["target"]["id"], "her_room.desk")
        before = deepcopy(self.plugin._control.life)
        with self.assertRaises(ValueError):
            await self.plugin.room_schedule_update(token, {"name": "invalid", "target": "../private"})
        self.assertEqual(before, self.plugin._control.life)
        await self.plugin.room_control("release", token=token)
        self.assertEqual((await self.plugin.room_snapshot())["life"]["source"], "room-routine")

    async def test_fixed_schedule_uses_shanghai_time(self):
        integration = __import__(MODULE.__package__+".room_integration", fromlist=["routine_life"])
        for hour, target in [(2, "bed"), (7, "bathroom"), (9, "desk"), (12, "dining"), (19, "sofa"), (23, "bed")]:
            now = datetime(2026, 11, 16, hour, 10, tzinfo=CORE.TZ).timestamp()
            life = integration.routine_life(now)
            self.assertEqual(life["activity"]["target"], target)
            self.assertEqual(life["timezone"], "Asia/Shanghai")

    async def test_gzip_keeps_exact_original_model_bytes(self):
        for quality, name in [("mobile", "maisaka.glb"), ("high", "maisaka-hi.glb")]:
            info = await self.plugin.room_model_info(quality=quality, encoding="gzip")
            parts = [await self.plugin.room_model_chunk(index=i, quality=quality, encoding="gzip") for i in range(info["chunks"])]
            zipped = b"".join(base64.b64decode(p["data"]) for p in parts)
            self.assertEqual(hashlib.sha256(zipped).hexdigest(), info["sha256"])
            self.assertEqual(gzip.decompress(zipped), (ROOT/"web/assets/models"/name).read_bytes())
        self.assertEqual((await self.plugin.room_model_info(encoding="gzip"))["chunks"], 9)

    async def test_media_relay_pause_seek_stop_and_stale_read(self):
        media = self.plugin._media
        data = b"synthetic-media-for-offline-contract-test"
        def download(url, media_id):
            media.directory.mkdir(parents=True, exist_ok=True)
            path = media.directory/(media_id+".part")
            path.write_bytes(data)
            return path, {"size": len(data), "mime": "video/mp4", "chunks": 1, "chunkSize": 196608,
                          "sha256": hashlib.sha256(data).hexdigest()}
        with patch.object(media, "_download", side_effect=download):
            receipt = await self.plugin.room_media_control("play", "https://example.invalid/video.mp4", title="测试")
            await asyncio.gather(*list(media.jobs))
        current = await self.plugin.room_media_status()
        self.assertEqual(current["status"], "ready")
        self.assertNotIn("url", current)
        chunk = await self.plugin.room_media_chunk(receipt["id"], 0)
        self.assertEqual(base64.b64decode(chunk["data"]), data)
        await self.plugin.room_media_control("pause")
        self.assertTrue((await self.plugin.room_media_status())["paused"])
        await self.plugin.room_media_control("seek", position_seconds=3.5)
        self.assertEqual((await self.plugin.room_media_status())["position"], 3.5)
        await self.plugin.room_media_control("stop")
        with self.assertRaises(ValueError):
            await self.plugin.room_media_chunk(receipt["id"], 0)
        with self.assertRaises(ValueError):
            await self.plugin.room_media_control("play", "file:///C:/private")

    async def test_replaced_media_cannot_publish_stale_completion(self):
        media = self.plugin._media
        started, release = asyncio.Event(), asyncio.Event()
        async def delayed_prepare(url, media_id):
            started.set()
            await release.wait()
            if media.state["id"] == media_id:
                media.state["status"] = "ready"
        with patch.object(media, "_prepare", side_effect=delayed_prepare):
            await self.plugin.room_media_control("play", "https://example.invalid/old.mp4")
            await started.wait()
            await self.plugin.room_media_control("stop")
            release.set()
            await asyncio.gather(*list(media.jobs))
        self.assertEqual((await self.plugin.room_media_status())["status"], "stopped")
