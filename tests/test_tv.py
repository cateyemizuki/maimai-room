"""Two model-provider doubles and synthetic stills only; no inference or capture."""
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import asyncio
import base64
import tempfile
import unittest

from PIL import Image
from test_room import MODULE

TV_MODULE = __import__(MODULE.__package__ + ".room_tv", fromlist=["sanitize_frame"])


def still(size=(512, 288), format="PNG", mime="image/png"):
    data = BytesIO()
    Image.new("RGB", size, (22, 65, 100)).save(data, format=format)
    return "data:" + mime + ";base64," + base64.b64encode(data.getvalue()).decode()


class SuccessVLM:
    def __init__(self):
        self.calls = []
        self.discovery = 0

    async def get_available_models(self):
        self.discovery += 1
        return ["utils", "vlm"]

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        return {"success": True, "response": "离线视觉替身结果"}


class UnavailableVLM(SuccessVLM):
    async def get_available_models(self):
        self.discovery += 1
        return []


class FrameTests(unittest.TestCase):
    def test_real_mime_dimensions_and_input_limits(self):
        valid = TV_MODULE.sanitize_frame(still())
        self.assertEqual((valid["width"], valid["height"]), (512, 288))
        self.assertTrue(valid["dataUrl"].startswith("data:image/jpeg;base64,"))
        self.assertLessEqual(len(valid["bytes"]), 36000)
        for value in ("https://example.invalid/frame.jpg", "C:/private.jpg", "data:image/svg+xml;base64,AA==",
                      "data:image/png;base64,not-image", "x" * 48001, still((513, 8)),
                      still(mime="image/jpeg")):
            with self.subTest(value=value[:60]):
                with self.assertRaises(ValueError):
                    TV_MODULE.sanitize_frame(value)


class TVTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.llm = SuccessVLM()
        self.ctx = SimpleNamespace(llm=self.llm)
        self.plugin = MODULE.create_plugin()
        self.plugin.set_plugin_config({})
        self.plugin._set_context(self.ctx)
        self.plugin._tv = MODULE.RoomTVBridge(self.ctx, Path(self.temp.name))

    async def asyncTearDown(self):
        await self.plugin._tv.close()
        self.temp.cleanup()

    async def test_explicit_review_real_multimodal_payload_dedup_and_cooldown(self):
        self.plugin._view()
        self.assertEqual(self.llm.calls, [])
        self.assertEqual(self.llm.discovery, 0)
        frame = still()
        queued = await self.plugin.room_tv_review(frame, "review-request-0001")
        self.assertEqual(queued["status"], "queued")
        await asyncio.gather(*list(self.plugin._tv.tasks))
        result = await self.plugin.room_tv_status("review-request-0001")
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["source"], "maibot-vlm")
        self.assertEqual(result["reply"], "离线视觉替身结果")
        call = self.llm.calls[0]
        self.assertEqual(call["task_name"], "vlm")
        self.assertEqual(call["max_tokens"], 160)
        parts = call["prompt"][0]["content"]
        self.assertEqual(parts[1]["type"], "image_url")
        self.assertTrue(parts[1]["image_url"]["url"].startswith("data:image/jpeg;base64,"))
        self.assertLess(len(parts[1]["image_url"]["url"]), 48000)
        repeated = await self.plugin.room_tv_review(frame, "review-request-0001")
        self.assertEqual(repeated["status"], "complete")
        self.assertEqual(len(self.llm.calls), 1)
        with self.assertRaises(ValueError):
            await self.plugin.room_tv_review(frame, "review-request-0002")
        self.assertEqual(len(self.llm.calls), 1)

    async def test_missing_vlm_makes_no_inference_and_no_fake_reply(self):
        self.ctx.llm = UnavailableVLM()
        await self.plugin.room_tv_review(still(), "unavailable-vlm-0001")
        await asyncio.gather(*list(self.plugin._tv.tasks))
        result = await self.plugin.room_tv_status("unavailable-vlm-0001")
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["reply"], "")
        self.assertIn("配置", result["notice"])
        self.assertEqual(self.ctx.llm.calls, [])

    async def test_local_save_has_receipt_no_model_call_and_no_overwrite(self):
        frame = still()
        result = await self.plugin.room_tv_save_frame(frame, "save-frame-request-0001")
        self.assertTrue(result["saved"])
        self.assertEqual(result["status"], "complete")
        directory = Path(self.temp.name) / "tv_frames"
        path = directory / result["filename"]
        self.assertTrue(path.is_file())
        self.assertEqual(path.stat().st_size, result["bytes"])
        with Image.open(path) as saved:
            self.assertEqual(saved.format, "JPEG")
            self.assertEqual(saved.size, (512, 288))
        await self.plugin.room_tv_save_frame(frame, "save-frame-request-0001")
        self.assertEqual(len(list(directory.iterdir())), 1)
        self.assertEqual(self.llm.calls, [])
        self.assertEqual(self.llm.discovery, 0)

    async def test_disabled_review_and_save_never_infer_or_write(self):
        self.plugin.set_plugin_config({"plugin": {"config_version": "1.0.0"}, "tv": {"save_enabled": False, "review_enabled": False}})
        with self.assertRaises(ValueError):
            await self.plugin.room_tv_review(still(), "disabled-review-0001")
        with self.assertRaises(ValueError):
            await self.plugin.room_tv_save_frame(still(), "disabled-save-frame-0001")
        self.assertFalse((Path(self.temp.name) / "tv_frames").exists())
        self.assertEqual(self.llm.calls, [])
