"""Native plugin-owned chat, routed through its dedicated SDK gateway."""
from __future__ import annotations

from contextlib import suppress
from copy import deepcopy
from typing import Any

import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import time

PLATFORM, ACCOUNT, USER, SCOPE, GATEWAY = "maimai_room", "maimai_room_bot", "room_owner", "maimai_room", "maimai_room_chat"
SOURCE = "maibot-room-chat"
NOTICE = "这是麦麦的小屋专属宿主聊天流。消息和回复会保存在此聊天流中，可在宿主聊天记录里查看。"

async def finish_disk_job(function: Any) -> Any:
    worker = asyncio.create_task(asyncio.to_thread(function))
    try:
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        await worker
        raise


class RoomChatBridge:
    def __init__(self, ctx: Any, directory: Path | None = None) -> None:
        self.ctx = ctx
        self.identity: dict[str, str] | None = None
        self.turns: dict[str, dict[str, Any]] = {}
        self.tasks: set[asyncio.Task] = set()
        self.session_id = ""
        self.history: list[dict[str, Any]] = []
        self.path = directory / "room_chat.json" if directory else None
        self.open_lock = asyncio.Lock()
        self.save_lock = asyncio.Lock()

    async def open(self) -> str:
        async with self.open_lock:
            if self.session_id:
                return self.session_id
            ready = await self.ctx.gateway.update_state(GATEWAY, ready=True, platform=PLATFORM, account_id=ACCOUNT, scope=SCOPE)
            if not ready:
                raise ValueError("房间聊天网关尚未就绪")
            stream = await self.ctx.chat.open_session(platform=PLATFORM, chat_type="private",
                                                      user_id=USER, account_id=ACCOUNT, scope=SCOPE)
            if not isinstance(stream, dict) or stream.get("success") is False:
                raise ValueError("宿主未能创建专属聊天流")
            value = stream.get("stream") if isinstance(stream.get("stream"), dict) else stream
            session_id = str(value.get("session_id") or value.get("stream_id") or value.get("chat_id") or "")
            if not session_id:
                raise ValueError("宿主没有返回专属聊天流 ID")
            if self.path and self.path.exists():
                async with self.save_lock:
                    saved = json.loads(await finish_disk_job(lambda: self.path.read_text(encoding="utf8")))
                self.history = [r for r in saved.get("messages", []) if isinstance(r, dict)][-200:]
            self.session_id = session_id
            self.identity = {"platform": PLATFORM, "user_id": USER}
            return self.session_id

    def _append(self, message_id: str, role: str, text: str, status: str = "sent") -> None:
        if any(row["id"] == message_id for row in self.history):
            return
        seq = self.history[-1]["seq"] + 1 if self.history else 1
        self.history.append({"seq": seq, "id": message_id, "role": role, "text": text[:8000], "status": status, "at": int(time.time()*1000)})
        self.history = self.history[-200:]

    async def _save(self) -> None:
        if self.path:
            async with self.save_lock:
                body = json.dumps({"sessionId": self.session_id, "messages": self.history}, ensure_ascii=False)
                def write() -> None:
                    self.path.parent.mkdir(parents=True, exist_ok=True)
                    temp = self.path.with_suffix(".json.tmp")
                    temp.write_text(body, encoding="utf8")
                    os.replace(temp, self.path)
                await finish_disk_job(write)

    def messages(self, after_seq: int = 0) -> dict[str, Any]:
        if type(after_seq) is not int or after_seq < 0:
            raise ValueError("after_seq 须为非负整数")
        rows, characters = [], 0
        for row in self.history:
            if row["seq"] <= after_seq:
                continue
            if len(rows) >= 50 or characters + len(row["text"]) > 40000:
                break
            rows.append(row)
            characters += len(row["text"])
        return {"sessionId": self.session_id, "platform": PLATFORM, "messages": deepcopy(rows), "notice": NOTICE}

    async def receive(self, message: dict[str, Any], route: dict[str, Any]) -> dict[str, Any]:
        if route.get("platform") != PLATFORM or str(route.get("scope") or "") != SCOPE:
            return {"success": False, "error": "聊天流不属于麦麦的小屋"}
        info = message.get("message_info") or {}
        platform = message.get("platform") or info.get("platform")
        if platform and platform != PLATFORM:
            return {"success": False, "error": "消息平台不匹配"}
        if info.get("group_info"):
            return {"success": False, "error": "房间专属流仅接收本流私聊回复"}
        if self.session_id and message.get("session_id") and message["session_id"] != self.session_id:
            return {"success": False, "error": "聊天流 ID 不匹配"}
        extra = info.get("additional_config") or {}
        if extra.get("platform_io_target_user_id") and extra["platform_io_target_user_id"] != USER:
            return {"success": False, "error": "聊天目标不匹配"}
        message_id = str(message.get("message_id") or info.get("message_id") or "")
        if not message_id:
            return {"success": False, "error": "回复缺少消息 ID"}
        text = message.get("processed_plain_text") or ""
        if not text:
            rows = message.get("raw_message") or []
            text = "".join(r["data"] for r in rows if isinstance(r, dict) and r.get("type") == "text" and isinstance(r.get("data"), str)) if isinstance(rows, list) else ""
        if text:
            self._append(message_id, "assistant", str(text))
            reply_to = str(message.get("reply_to") or extra.get("reply_message_id") or "")
            turn = next((r for r in self.turns.values() if r["messageId"] == reply_to), None)
            if turn and message_id not in turn["replyMessageIds"]:
                turn["reply"] = (turn["reply"] + "\n" + str(text)).strip()[:8000]
                turn["replyMessageIds"].append(message_id)
                turn.update(status="replied", correlation="reply_message_id")
            await self._save()
        return {"success": True, "message_id": message_id}

    def _prune(self) -> None:
        now = time.time()
        self.turns = {key: value for key, value in self.turns.items() if value["expiresAt"] > now * 1000}

    def submit(self, text: str, request_id: str) -> dict[str, Any]:
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 2000:
            raise ValueError("聊天内容须为 1–2000 字符")
        if not re.fullmatch(r"[a-zA-Z0-9_-]{16,128}", request_id):
            raise ValueError("聊天请求需要 16–128 位独立请求 ID")
        self._prune()
        digest = hashlib.sha256(text.strip().encode()).hexdigest()
        if request_id in self.turns:
            if self.turns[request_id]["textHash"] != digest:
                raise ValueError("同一聊天请求 ID 不得替换消息内容")
            return self.status(request_id)
        if any(turn["status"] == "queued" for turn in self.turns.values()):
            raise ValueError("上一条内部聊天消息仍在投递，请稍候")
        if len(self.turns) >= 8:
            oldest = next(iter(self.turns))
            self.turns.pop(oldest)
        self.turns[request_id] = {"requestId": request_id, "textHash": digest, "status": "queued", "messageId": "room-" + request_id,
                                  "reply": "", "replyMessageIds": [], "source": SOURCE, "correlation": "none",
                                  "notice": NOTICE, "expiresAt": int((time.time() + 600) * 1000)}
        task = asyncio.create_task(self._deliver(text.strip(), request_id), name="maimai-room-internal-chat")
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return self.status(request_id)

    async def _deliver(self, text: str, request_id: str) -> None:
        turn = self.turns[request_id]
        attempted = False
        try:
            await asyncio.wait_for(self.open(), timeout=8)
            message_id = "room-" + request_id
            turn["messageId"] = message_id
            previous = next((r for r in self.history if r["id"] == message_id), None)
            if previous:
                if previous["text"] != text:
                    raise ValueError("聊天请求 ID 已用于其他内容")
                turn.update(status="sent" if previous.get("status", "sent") == "sent" else "unknown",
                            notice="这条消息已有专属流记录，请查看聊天记录")
                return
            message = {"account_id": ACCOUNT, "scope": SCOPE,
                       "message_info": {"platform": PLATFORM, "message_id": message_id, "time": time.time(),
                                        "user_info": {"platform": PLATFORM, "user_id": USER, "user_nickname": "博士 · 麦麦的小屋"},
                                        "additional_config": {"at_bot": True, "relayed_by_plugin": "cateye.maimai_room"}},
                       "message_segment": {"type": "seglist", "data": [{"type": "text", "data": text}]},
                       "raw_message": text, "processed_plain_text": text}
            self._append(message_id, "user", text, "queued")
            attempted = True
            accepted = await asyncio.wait_for(self.ctx.gateway.route_message(
                GATEWAY, message, external_message_id=message_id, dedupe_key=message_id), timeout=75)
            if not accepted and turn["status"] != "replied":
                turn.update(status="error", notice="宿主未接收房间聊天消息")
                self.history = [r for r in self.history if r["id"] != message_id]
                await self._save()
                return
            next((r for r in self.history if r["id"] == message_id), {})["status"] = "sent"
            if turn["status"] == "queued":
                turn.update(status="sent", notice="已送入麦麦的小屋专属聊天流")
            await self._save()
        except asyncio.CancelledError:
            turn.update(status="unknown", notice="插件已重载；投递状态请在宿主原生聊天室核实，勿直接重复发送。")
            raise
        except TimeoutError:
            turn.update(status="unknown", notice="内部聊天投递状态未确认，请在宿主原生聊天室核实，勿直接重复发送。")
            for row in self.history:
                if row["id"] == turn["messageId"]:
                    row["status"] = "unknown"
            await self._save()
        except Exception:
            turn.update(status="unknown" if attempted else "error", notice="专属聊天投递尚未确认，请在宿主聊天记录中核实" if attempted else "专属聊天流当前不可用")
            if attempted:
                for row in self.history:
                    if row["id"] == turn["messageId"]:
                        row["status"] = "unknown"
                await self._save()

    def status(self, request_id: str) -> dict[str, Any]:
        self._prune()
        turn = self.turns.get(request_id)
        if turn is None:
            return {"requestId": request_id, "status": "missing", "reply": "", "source": SOURCE,
                    "notice": "本页请求未找到或已过期；完整对话见宿主原生聊天室。"}
        return deepcopy({key: value for key, value in turn.items() if key != "textHash"})

    def observe(self, **kwargs: Any) -> None:
        # Replies are received exclusively by the dedicated gateway.
        return

    async def close(self) -> None:
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
        self.tasks.clear()
        await self._save()
        self.turns.clear()
