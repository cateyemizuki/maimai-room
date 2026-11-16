"""Download a caller-selected video once and relay bounded bytes through the SDK."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import math
from pathlib import Path
import secrets
import time
import threading
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from typing import Any

CHUNK_SIZE = 196608
MIMES = {"video/mp4", "video/webm", "video/ogg", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/webm"}


class RoomMedia:
    def __init__(self, directory: Path, max_bytes: int) -> None:
        self.directory, self.max_bytes = directory / "tv_media", max_bytes
        self.state: dict[str, Any] = {"id": "", "revision": 0, "status": "stopped"}
        self.path: Path | None = None
        self.jobs: set[asyncio.Task] = set()
        self.closed = False
        self.file_lock = threading.Lock()

    def view(self) -> dict[str, Any]:
        return dict(self.state)

    def _remove_current(self) -> None:
        with self.file_lock:
            if self.path:
                self.path.unlink(missing_ok=True)
                self.path = None

    async def control(self, action: str, url: str = "", title: str = "", loop: bool = False,
                      muted: bool = True, volume: float = 0.5, position_seconds: float = 0) -> dict[str, Any]:
        if self.closed:
            raise ValueError("视频服务已关闭")
        if action == "play":
            if not isinstance(url, str) or len(url) > 8192:
                raise ValueError("视频地址最长 8192 字符")
            parsed = urlsplit(url)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("视频地址须为 HTTP(S) 媒体直链")
            if not isinstance(volume, (int, float)) or not 0 <= volume <= 1:
                raise ValueError("volume 须在 0 到 1 之间")
            self._remove_current()
            revision = self.state["revision"] + 1
            media_id = secrets.token_hex(12)
            self.state = {"id": media_id, "revision": revision, "status": "loading",
                          "title": str(title)[:160] or "插件指定的视频", "loop": bool(loop),
                          "muted": bool(muted), "volume": volume, "paused": False,
                          "position": 0, "seekRevision": 0}
            job = asyncio.create_task(self._prepare(url, media_id), name="room-media-download")
            self.jobs.add(job)
            job.add_done_callback(self.jobs.discard)
        elif action == "stop":
            self._remove_current()
            self.state = {"id": "", "revision": self.state["revision"] + 1, "status": "stopped"}
        elif action in {"pause", "resume", "seek", "volume"}:
            if not self.state.get("id") or self.state["status"] == "error":
                raise ValueError("尚未指定可控制的视频")
            if action == "seek" and (not isinstance(position_seconds, (float, int)) or not 0 <= position_seconds <= 864000):
                raise ValueError("position_seconds 须在 0 到 864000 秒之间")
            if action == "volume" and (not isinstance(volume, (int, float)) or not 0 <= volume <= 1):
                raise ValueError("volume 须在 0 到 1 之间")
            if action in {"pause", "resume"}:
                self.state["paused"] = action == "pause"
            elif action == "seek":
                self.state.update(position=position_seconds, seekRevision=self.state["seekRevision"] + 1)
            else:
                self.state.update(volume=volume, muted=bool(muted))
            self.state["revision"] += 1
        else:
            raise ValueError("视频 action 支持 play/stop/pause/resume/seek/volume")
        return dict(self.view(), ok=True)

    def _download(self, url: str, media_id: str) -> tuple[Path, dict[str, Any]]:
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self.directory / (media_id + ".part")
        try:
            started = time.monotonic()
            digest, size = hashlib.sha256(), 0
            request = Request(url, headers={"User-Agent": "MaiBot-Room/1.2", "Accept": "video/*,audio/*"})
            with urlopen(request, timeout=15) as response, path.open("xb") as output:
                mime = response.headers.get_content_type()
                if mime not in MIMES:
                    raise ValueError("地址未返回 MP4/WebM/Ogg 或受支持的音视频文件，请由提供方解析媒体直链")
                length = response.headers.get("Content-Length")
                if length and int(length) > self.max_bytes:
                    raise ValueError("视频超过配置的下载大小")
                while block := response.read(65536):
                    if self.closed or self.state.get("id") != media_id:
                        raise ValueError("视频选择已变化")
                    size += len(block)
                    if size > self.max_bytes or time.monotonic() - started > 90:
                        raise ValueError("视频超过大小或下载时间限制")
                    digest.update(block)
                    output.write(block)
                if not size or length and size != int(length):
                    raise ValueError("视频响应不完整")
            return path, {"size": size, "mime": mime, "sha256": digest.hexdigest(),
                          "chunkSize": CHUNK_SIZE, "chunks": math.ceil(size / CHUNK_SIZE)}
        except BaseException:
            path.unlink(missing_ok=True)
            raise

    async def _prepare(self, url: str, media_id: str) -> None:
        worker = asyncio.create_task(asyncio.to_thread(self._download, url, media_id))
        try:
            path, info = await asyncio.shield(worker)
            if self.closed or self.state.get("id") != media_id:
                path.unlink(missing_ok=True)
                return
            self.path = path
            self.state.update(info, status="ready", revision=self.state["revision"] + 1)
        except asyncio.CancelledError:
            try:
                path, _ = await worker
                path.unlink(missing_ok=True)
            except Exception:
                pass
            raise
        except Exception as error:
            if self.state.get("id") == media_id:
                self.state.update(status="error", error=str(error) if isinstance(error, ValueError) else
                                  "视频下载失败，请检查直链是否有效、可访问及是否需要登录",
                                  revision=self.state["revision"] + 1)

    def read_chunk(self, media_id: str, index: int) -> dict[str, Any]:
        with self.file_lock:
            current, path = self.state, self.path
            if media_id != current.get("id") or current["status"] != "ready" or not path:
                raise ValueError("视频已变化或尚未准备完成")
            if type(index) is not int or not 0 <= index < current["chunks"]:
                raise ValueError("视频分块索引无效")
            with path.open("rb") as handle:
                handle.seek(index * CHUNK_SIZE)
                data = handle.read(CHUNK_SIZE)
        return {"id": media_id, "index": index, "data": base64.b64encode(data).decode("ascii")}

    async def close(self) -> None:
        self.closed = True
        for job in list(self.jobs):
            job.cancel()
        await asyncio.gather(*list(self.jobs), return_exceptions=True)
        self._remove_current()
