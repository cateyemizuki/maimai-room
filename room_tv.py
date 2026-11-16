"""Explicitly submitted TV stills: bounded local save or configured VLM review.

No display capture, filesystem input, URL fetching, automatic model calls or QQ
sends occur here. The browser must separately obtain and submit one still.
"""
from __future__ import annotations

from contextlib import suppress
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from typing import Any

import asyncio
import base64
import hashlib
import os
import re
import time

from PIL import Image, UnidentifiedImageError

MAX_DATA_URL = 48000
MAX_BYTES = 36000
MIMES = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
NOTICE = "仅在你点击后发送当前这一帧到宿主已配置的 vlm 视觉模型，可能产生调用费用；不自动截屏、不发 QQ。"


def sanitize_frame(image_data: str) -> dict[str, Any]:
    if not isinstance(image_data, str) or not 1 <= len(image_data) <= MAX_DATA_URL:
        raise ValueError("单帧 Data URL 必须不超过 48000 字符，请先降低分辨率或画质")
    match = re.fullmatch(r"data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})", image_data)
    if not match:
        raise ValueError("单帧只接受 JPEG/PNG/WebP 的 base64 Data URL，不接受 URL 或文件路径")
    mime, encoded = match.groups()
    try:
        raw = base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise ValueError("单帧 base64 无效") from exc
    if not 1 <= len(raw) <= MAX_BYTES:
        raise ValueError("单帧原始数据不得超过 36000 字节")
    try:
        with Image.open(BytesIO(raw)) as image:
            if image.format != MIMES[mime] or image.width > 512 or image.height > 512 or image.width * image.height > 262144:
                raise ValueError("图片实际 MIME 必须匹配，尺寸双边不得超过 512 像素")
            if getattr(image, "n_frames", 1) != 1:
                raise ValueError("只接受单帧静态图片")
            image.load()
            picture = image.convert("RGB")
            picture.info.clear()
        # Canonical JPEG removes any client metadata and EXIF. Never read a file.
        for edge in (512, 384, 256):
            current = picture.copy()
            current.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            for quality in (78, 60, 42):
                buffer = BytesIO()
                current.save(buffer, format="JPEG", quality=quality, optimize=True)
                canonical = buffer.getvalue()
                if len(canonical) <= MAX_BYTES:
                    return {"bytes": canonical, "width": current.width, "height": current.height,
                            "sha256": hashlib.sha256(canonical).hexdigest(),
                            "dataUrl": "data:image/jpeg;base64," + base64.b64encode(canonical).decode("ascii")}
        raise ValueError("这一帧仍过大，请降低分辨率")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("图片无法安全解码") from exc


class RoomTVBridge:
    def __init__(self, ctx: Any, data_dir: Path, cooldown: int = 30) -> None:
        self.ctx = ctx
        self.directory = data_dir / "tv_frames"
        self.cooldown = cooldown
        self.last_review = -1e9
        self.turns: dict[str, dict[str, Any]] = {}
        self.tasks: set[asyncio.Task] = set()
        self.lock = asyncio.Lock()

    def _request(self, request_id: str, kind: str, digest: str) -> dict[str, Any] | None:
        if not isinstance(request_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{16,128}", request_id):
            raise ValueError("单帧操作需要 16–128 位独立请求 ID")
        self.turns = {key: value for key, value in self.turns.items() if value["expiresAt"] > time.time() * 1000}
        existing = self.turns.get(request_id)
        if existing:
            if existing["kind"] != kind or existing["sha256"] != digest:
                raise ValueError("同一请求 ID 不得用于另一帧或另一种操作")
            return self.status(request_id)
        if len(self.turns) >= 8:
            removable = next((key for key, value in self.turns.items() if value["status"] != "queued"), None)
            if removable is None:
                raise ValueError("仍有单帧操作进行中，请稍候")
            self.turns.pop(removable)
        return None

    def _turn(self, request_id: str, kind: str, frame: dict[str, Any]) -> dict[str, Any]:
        return {"requestId": request_id, "kind": kind, "status": "queued", "sha256": frame["sha256"],
                "width": frame["width"], "height": frame["height"], "reply": "", "saved": False,
                "source": "maibot-vlm" if kind == "review" else "local-room-save", "expiresAt": int((time.time() + 600) * 1000)}

    async def review(self, image_data: str, request_id: str) -> dict[str, Any]:
        frame = await asyncio.to_thread(sanitize_frame, image_data)
        async with self.lock:
            existing = self._request(request_id, "review", frame["sha256"])
            if existing:
                return existing
            if any(value["status"] == "queued" and value["kind"] == "review" for value in self.turns.values()):
                raise ValueError("上一帧仍在点评，请稍候")
            if time.monotonic() - self.last_review < self.cooldown:
                raise ValueError(f"单帧点评每 {self.cooldown} 秒最多一次")
            self.last_review = time.monotonic()
            self.turns[request_id] = self._turn(request_id, "review", frame)
            self.turns[request_id]["notice"] = NOTICE
            task = asyncio.create_task(self._review(frame, request_id), name="maimai-room-tv-vlm")
            self.tasks.add(task)
            task.add_done_callback(self.tasks.discard)
            return self.status(request_id)

    async def _review(self, frame: dict[str, Any], request_id: str) -> None:
        turn = self.turns[request_id]
        try:
            tasks = await asyncio.wait_for(self.ctx.llm.get_available_models(), timeout=3)
            if not isinstance(tasks, list) or "vlm" not in tasks:
                turn.update(status="error", notice="宿主未提供已配置的 vlm 视觉任务，请先配置视觉模型。")
                return
            prompt = [{"role": "user", "content": [
                {"type": "text", "text": "这是用户主动分享的电视当前单帧。请只根据可见画面，用中文给一句简短观后感，不假设看过前后剧情。"},
                {"type": "image_url", "image_url": {"url": frame["dataUrl"]}}]}]
            result = await asyncio.wait_for(self.ctx.llm.generate(prompt=prompt, task_name="vlm", max_tokens=160, temperature=0.5), timeout=75)
            response = result.get("response") if isinstance(result, dict) and result.get("success") is True else None
            if not isinstance(response, str) or not response.strip():
                turn.update(status="error", notice="宿主视觉模型当前不可用或未正确配置，没有生成点评。")
                return
            turn.update(status="complete", reply=response.strip()[:800], notice="这是宿主已配置视觉模型对你主动提交的这一帧的点评。")
        except asyncio.CancelledError:
            raise
        except TimeoutError:
            turn.update(status="error", notice="视觉点评超时，未自动重试；本次模型请求可能已发出。")
        except Exception:
            turn.update(status="error", notice="宿主视觉模型当前不可用，请检查 vlm 配置；未自动重试。")

    def _save(self, frame: dict[str, Any], request_id: str) -> dict[str, Any]:
        self.directory.mkdir(parents=True, exist_ok=True)
        if self.directory.is_symlink() or self.directory.is_junction() or not self.directory.resolve().is_relative_to(self.directory.parent.resolve()):
            raise ValueError("截图保存目录必须位于插件数据目录内且不能是链接")
        if sum(1 for file in self.directory.iterdir() if file.is_file()) >= 100:
            raise ValueError("房间已保存 100 帧，请先在本机整理 tv_frames 目录")
        filename = "tv-" + hashlib.sha256(request_id.encode()).hexdigest()[:24] + ".jpg"
        try:
            descriptor = os.open(self.directory / filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError as exc:
            raise ValueError("此请求的截图文件已存在，请在本机核实，未覆盖原文件") from exc
        with os.fdopen(descriptor, "wb") as file:
            file.write(frame["bytes"])
            file.flush()
            os.fsync(file.fileno())
        return {"filename": filename, "bytes": len(frame["bytes"]), "sha256": frame["sha256"]}

    async def save(self, image_data: str, request_id: str) -> dict[str, Any]:
        frame = await asyncio.to_thread(sanitize_frame, image_data)
        async with self.lock:
            existing = self._request(request_id, "save", frame["sha256"])
            if existing:
                return existing
            receipt = await asyncio.to_thread(self._save, frame, request_id)
            turn = self._turn(request_id, "save", frame)
            turn.update(receipt, status="complete", saved=True, notice="已保存到 MaiBot 本机插件数据目录 tv_frames；没有发给模型或 QQ。")
            self.turns[request_id] = turn
            return self.status(request_id)

    def status(self, request_id: str) -> dict[str, Any]:
        turn = self.turns.get(request_id)
        if not turn or turn["expiresAt"] <= time.time() * 1000:
            return {"requestId": request_id, "status": "missing", "reply": "", "saved": False, "notice": "此单帧请求不存在或已过期。"}
        return deepcopy(turn)

    async def close(self) -> None:
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
        self.tasks.clear()
        self.turns.clear()
