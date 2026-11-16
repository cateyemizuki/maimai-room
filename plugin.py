"""MaiBot SDK room plugin. All platform and cross-plugin access goes through ctx."""
from __future__ import annotations

from contextlib import suppress
from copy import deepcopy
from pathlib import Path
from typing import Any

import asyncio
import base64
import hashlib
import json
import math
import re
import secrets
import time

from maibot_sdk import API, Command, CONFIG_RELOAD_SCOPE_SELF, Field, MaiBotPlugin, MessageGateway, PluginConfigBase, Tool

from .room_chat import NOTICE as CHAT_NOTICE, RoomChatBridge, PLATFORM as CHAT_PLATFORM, ACCOUNT as CHAT_ACCOUNT, SCOPE as CHAT_SCOPE, GATEWAY as CHAT_GATEWAY
from .room_tv import NOTICE as TV_NOTICE, RoomTVBridge
from .room_integration import BehaviourControl
from .room_media import RoomMedia
from .garden_care import control_garden, ensure_garden, garden_snapshot, parse_garden_command, tick_garden
from .room_core import (ACTION_NAMES, COMMANDS, advance_auto, apply_action, clean, empty_state,
                        load_state, save_state, snapshot, tick)

ROOT_PATTERN = r"^/(?:room|房间)(?=\s|$)(?:\s+(?P<room_args>.*))?\s*$"
MODEL_ASSET = "maisaka.glb"
MODEL_FILES = {"mobile": "maisaka.glb", "high": "maisaka-hi.glb"}
CHUNK_SIZE = 196608
HELP = ("房间指令：/room 状态；/room 站；/room 走 阳台；/room 坐 沙发；/room 睡；/room 唤醒；"
        "/room 自动；/room 心情 开心|困|恢复；/room 灯 on|off；/room 摸头|喂食|倒水|陪玩|跳舞|伸懒腰|行礼。中文根 /房间 同样可用。"
        "/room 菜园 状态|翻土 5|播种 5 胡萝卜|浇水 5|施肥 5|采收 1|买种子 番茄 2|自动 on|off。"
        "地点：沙发、床、书桌、阳台、厨房、餐桌、卫生间、菜园、门口。第三方可通过公开接口接管行为与日程。")


class PluginSection(PluginConfigBase):
    config_version: str = Field(default="1.2.0", description="插件配置版本")
    enabled: bool = Field(default=True, description="启用房间")
    character_name: str = Field(default="麦麦", max_length=32, description="房间角色显示名")


class AccessSection(PluginConfigBase):
    allowed_users: list[str] = Field(default_factory=list, description="可操控房间的 QQ 用户，填写 qq:号码；非空时优先使用此名单")
    inherit_host_operators: bool = Field(default=True, description="房间用户白名单为空时，只读继承宿主 plugin.permission 中明确配置的 QQ 管理员")
    allowed_groups: list[str] = Field(default_factory=list, description="允许的 QQ 群号，留空不额外限制；仍须用户白名单")
    public_status: bool = Field(default=False, description="允许非白名单用户查询状态；默认关闭")
    webui_controls: bool = Field(default=True, description="允许已经登录 MaiBot WebUI 的用户操作房间")


class BehaviourSection(PluginConfigBase):
    automatic: bool = Field(default=True, description="按第三方主动接入的活动运行；没有接入时使用固定作息")
    manual_hold_seconds: int = Field(default=900, ge=10, le=28800, description="手动姿态覆盖自动活动的秒数；/room 自动 可立即解除")
    walking_speed: float = Field(default=1.15, ge=0.2, le=3, description="房间每秒移动米数")


class LifeSection(PluginConfigBase):
    enabled: bool = Field(default=False, description="兼容旧配置的保留字段；新版通过 room_control / room_schedule_update 主动接入")
    plugin_id: str = Field(default="cateye.life_belonging_to_maimai", max_length=128, description="生活插件 manifest ID")
    poll_seconds: int = Field(default=30, ge=10, le=600, description="生活公开 API 查询间隔")
    mood_api: str = Field(default="", max_length=160, description="可选受支持的公开情绪 API 完整名；当前生活插件没有公开情绪 API，默认保持空")


class ToolSection(PluginConfigBase):
    enabled: bool = Field(default=True, description="允许 bot 用工具调节房间中的自身状态；仍须会话名单放行")
    force_enabled: bool = Field(default=False, description="第三方插件接管行为时仍允许调节工具；会话名单限制继续生效")
    private_mode: str = Field(default="whitelist", pattern="^(whitelist|blacklist)$", description="私聊 whitelist 白名单 / blacklist 黑名单")
    private_users: list[str] = Field(default_factory=list, description="私聊身份，QQ 可填纯号码或 qq:号码，房间专属流填 maimai_room:room_owner；默认空白名单")
    group_mode: str = Field(default="whitelist", pattern="^(whitelist|blacklist)$", description="群聊 whitelist 白名单 / blacklist 黑名单")
    groups: list[str] = Field(default_factory=list, description="QQ 群号，可填纯号码或 qq:号码；默认空白名单")


class PerformanceSection(PluginConfigBase):
    render_grace_seconds: int = Field(default=600, ge=0, le=3600, description="已打开的房间切出后保留渲染资源的秒数，超时释放")
    desktop_fps: int = Field(default=60, ge=24, le=120, description="标准画质前台目标帧率；省电档使用 24 FPS")


class ChatSection(PluginConfigBase):
    enabled: bool = Field(default=True, description="启用房间专属宿主聊天流，仅在用户发送时投递消息")


class TVSection(PluginConfigBase):
    plugin_playback_enabled: bool = Field(default=True, description="允许其他插件通过公开接口指定音视频 HTTP(S) 直链")
    max_video_mib: int = Field(default=64, ge=1, le=256, description="单个接入视频的下载上限，MiB；经宿主分块传入页面")
    save_enabled: bool = Field(default=True, description="允许用户主动保存已预览的单帧到本机插件数据目录")
    review_enabled: bool = Field(default=True, description="允许用户主动把预览的单帧发给已配置 vlm 视觉模型，可能产生调用费用；不自动截屏或发送")
    cooldown_seconds: int = Field(default=30, ge=30, le=3600, description="单帧视觉点评最短间隔秒数")


class RoomConfig(PluginConfigBase):
    plugin: PluginSection = Field(default_factory=PluginSection)
    access: AccessSection = Field(default_factory=AccessSection)
    behaviour: BehaviourSection = Field(default_factory=BehaviourSection)
    life: LifeSection = Field(default_factory=LifeSection)
    chat: ChatSection = Field(default_factory=ChatSection)
    tv: TVSection = Field(default_factory=TVSection)
    tools: ToolSection = Field(default_factory=ToolSection)
    performance: PerformanceSection = Field(default_factory=PerformanceSection)


def unavailable_life(reason: str = "awaiting_first_poll") -> dict[str, Any]:
    return {"available": False, "source": "unavailable", "activity": None, "schedule": [],
            "mood": {"available": False, "source": "unavailable", "label": "未接入生活情绪"},
            "reason": reason, "updatedAt": 0}


class MaiMaimaiRoomPlugin(MaiBotPlugin):
    config_model = RoomConfig

    def __init__(self) -> None:
        super().__init__()
        self._state = empty_state()
        self._life = unavailable_life()
        self._lock = asyncio.Lock()
        self._workers: list[asyncio.Task] = []
        self._state_path: Path | None = None
        self._dirty = False
        self._last_saved = 0.0
        self._viewer_until = 0.0
        self._activity_wakeup = asyncio.Event()
        self._model_cache: dict[str, tuple[int, int, dict[str, Any]]] = {}
        self._last_command: dict[str, float] = {}
        self._integration_reason = ""
        self._chat: RoomChatBridge | None = None
        self._tv: RoomTVBridge | None = None
        self._media: RoomMedia | None = None
        self._control = BehaviourControl()
        self._tool_visible: bool | None = None
        self._event_queue: asyncio.Queue = asyncio.Queue(maxsize=128)

    async def on_load(self) -> None:
        self._state_path = Path(self.ctx.paths.data_dir) / "room.json"
        self._state = await asyncio.to_thread(load_state, self._state_path)
        if not self.config.plugin.enabled or not self._control.active(time.time()):
            self._control = BehaviourControl()
        self._tool_visible = None
        self._life = self._control.current(time.time())
        if self._state["character"]["source"].startswith("plugin:") and not self._control.active(time.time()):
            self._state["manualUntil"] = 0
            self._dirty = True
        self._dirty = ensure_garden(self._state, time.time()) or self._dirty
        self._chat = RoomChatBridge(self.ctx, Path(self.ctx.paths.data_dir))
        self._tv = RoomTVBridge(self.ctx, Path(self.ctx.paths.data_dir), self.config.tv.cooldown_seconds)
        self._media = RoomMedia(Path(self.ctx.paths.data_dir), self.config.tv.max_video_mib * 1024 * 1024)
        if self.config.plugin.enabled:
            self._workers = [asyncio.create_task(self._tick_loop(), name="maimai-room-tick"),
                             asyncio.create_task(self._event_loop(), name="maimai-room-signals")]
            if self.config.chat.enabled:
                self._workers.append(asyncio.create_task(self._open_chat(), name="maimai-room-chat-open"))
        await self._refresh_tool_visibility()
        self.ctx.logger.info("MaiMaimai 房间已加载；QQ 写入须房间白名单或宿主 QQ 管理员；不会主动发消息")

    async def on_unload(self) -> None:
        for worker in self._workers:
            worker.cancel()
        for worker in self._workers:
            with suppress(asyncio.CancelledError):
                await worker
        self._workers.clear()
        if self._media:
            await self._media.close()
            self._media = None
        if self._tv:
            await self._tv.close()
            self._tv = None
        if self._chat:
            await self._chat.close()
            self._chat = None
        async with self._lock:
            if self._dirty and self._state_path:
                await asyncio.to_thread(save_state, self._state_path, self._state)
                self._dirty = False

    async def on_config_update(self, scope: str, config_data: dict[str, Any], version: str) -> None:
        del version
        if scope == CONFIG_RELOAD_SCOPE_SELF:
            self.set_plugin_config(config_data)
            # Runner normally applies the model before this callback. Applying it
            # explicitly also supports the documented standalone SDK lifecycle.
            await self.on_unload()
            await self.on_load()

    async def _persist_locked(self) -> None:
        if self._state_path and self._dirty:
            await asyncio.to_thread(save_state, self._state_path, self._state)
            self._dirty = False
            self._last_saved = time.monotonic()

    async def _tick_loop(self) -> None:
        last_tick = time.monotonic()
        while True:
            walking = self._state["character"]["walking"]
            interval = (0.5 if time.monotonic() < self._viewer_until else 3.0) if walking else 5.0
            remaining = max(0.0, last_tick + interval - time.monotonic())
            try:
                await asyncio.wait_for(self._activity_wakeup.wait(), timeout=remaining)
                self._activity_wakeup.clear()
                continue
            except asyncio.TimeoutError:
                pass
            last_tick = time.monotonic()
            try:
                async with self._lock:
                    now = time.time()
                    self._update_integration(now)
                    changed = tick(self._state, now, self.config.behaviour.walking_speed)
                    garden_life = ({"available": True, "activity": {"name": "外部插件正在接管行为"}}
                                   if self._control.active(now) and self._control.life is None else self._life)
                    garden_tick = tick_garden(self._state, now, garden_life)
                    changed = garden_tick["changed"] or changed
                    if self.config.behaviour.automatic and not garden_tick["busy"] and (
                            not self._control.active(now) or self._control.life is not None):
                        changed = advance_auto(self._state, self._life, now) or changed
                    self._dirty = self._dirty or changed
                    if self._dirty and time.monotonic() - self._last_saved >= 5:
                        await self._persist_locked()
                await self._refresh_tool_visibility()
            except asyncio.CancelledError:
                raise
            except Exception:
                self.ctx.logger.exception("房间 tick/落盘失败；下轮重试")

    def _view(self) -> dict[str, Any]:
        now = time.time()
        self._update_integration(now)
        # The simulation tick can precede a poll by half a second. Project only
        # the character to the sampling time, keeping read APIs side-effect free.
        projected = dict(self._state, character=deepcopy(self._state["character"]))
        tick(projected, now, self.config.behaviour.walking_speed)
        projected["revision"] = self._state["revision"]
        result = snapshot(projected, self._life, self.config.plugin.character_name, now)
        result["movementSpeed"] = self.config.behaviour.walking_speed
        result["controlsEnabled"] = self.config.plugin.enabled and self.config.access.webui_controls
        result["garden"] = garden_snapshot(self._state, now)
        result["chat"] = {"enabled": result["controlsEnabled"] and self.config.chat.enabled,
                          "source": "maibot-room-chat", "notice": CHAT_NOTICE,
                          "sessionId": self._chat.session_id if self._chat else "",
                          "nativeChatHint": "在宿主聊天记录中查看 maimai_room 专属聊天流"}
        result["tv"] = {"saveEnabled": result["controlsEnabled"] and self.config.tv.save_enabled,
                        "reviewEnabled": result["controlsEnabled"] and self.config.tv.review_enabled,
                        "notice": TV_NOTICE, "maxDataUrlCharacters": 48000, "maxEdge": 512}
        result["tv"]["playback"] = self._media.view() if self._media else {"id": "", "revision": 0, "status": "stopped"}
        result["integration"] = self._control.view(now)
        result["tools"] = {"enabled": self.config.tools.enabled, "available": self._tool_available(),
                           "forceEnabled": self.config.tools.force_enabled}
        return result

    async def _open_chat(self) -> None:
        try:
            if self._chat:
                await asyncio.wait_for(self._chat.open(), timeout=8)
        except Exception:
            self.ctx.logger.info("房间专属聊天将在打开聊天面板时重试")

    def _emit_locked(self, kind: str, name: str, detail: dict[str, Any], event_id: str = "") -> None:
        events = self._state.setdefault("interactionEvents", [])
        identity = event_id or secrets.token_hex(16)
        if any(row["id"] == identity for row in events):
            return
        seq = self._state.get("interactionSeq", 0) + 1
        event = {"id": identity, "seq": seq, "at": int(time.time()*1000),
                 "type": kind, "name": name, "detail": detail}
        self._state["interactionSeq"] = seq
        self._state["interactionEvents"] = (events + [event])[-256:]
        self._dirty = True
        with suppress(asyncio.QueueFull):
            self._event_queue.put_nowait(event)

    async def _event_loop(self) -> None:
        while True:
            event = await self._event_queue.get()
            try:
                subscribers = list(self._state.get("interactionSubscribers", {}).items())
                for callback, subscription in subscribers:
                    try:
                        result = await asyncio.wait_for(self.ctx.api.call(callback, version=subscription["version"],
                                                                         event=deepcopy(event)), timeout=2.5)
                        if isinstance(result, dict) and result.get("success") is False:
                            raise ValueError("回调未接收")
                    except Exception:
                        self.ctx.logger.warning("互动信号回调 %s 暂不可用，可通过公开事件游标补读", callback)
            finally:
                self._event_queue.task_done()

    @API("room_ui_event", description="已登录页面发送一次点击或场景交互意图", version="1")
    async def room_ui_event(self, name: str, detail: str = "{}", request_id: str = "") -> dict[str, Any]:
        if not self.config.plugin.enabled or not re.fullmatch(r"[a-zA-Z0-9_.-]{1,64}", name):
            raise ValueError("互动名称无效或插件已停用")
        if len(detail) > 2048 or len(request_id) > 128:
            raise ValueError("互动参数过长")
        values = json.loads(detail)
        if not isinstance(values, dict):
            raise ValueError("互动 detail 须为对象")
        allowed = {"control", "room", "spot", "plot", "camera", "button", "command", "target", "kind"}
        safe = {k: (clean(v, 120) if isinstance(v, str) else v) for k, v in values.items()
                if k in allowed and isinstance(v, (str, int, float, bool))
                and (not isinstance(v, float) or math.isfinite(v))}
        async with self._lock:
            kind = "ui.click"
            if name in {"camera.pan", "camera.orbit", "camera.zoom"}:
                kind = "ui.gesture"
            elif name in {"control.change", "media.select"}:
                kind = "ui.change"
            self._emit_locked(kind, name, safe, request_id)
            return {"ok": True, "seq": self._state["interactionSeq"]}

    @API("room_events", description="其他插件按序号读取有界互动信号；支持补读和事件 ID 去重", version="1", public=True)
    async def room_events(self, after_seq: int = 0, limit: int = 100) -> dict[str, Any]:
        if type(after_seq) is not int or after_seq < 0 or type(limit) is not int or not 1 <= limit <= 256:
            raise ValueError("事件游标或条数无效")
        async with self._lock:
            events = self._state.get("interactionEvents", [])
            rows, size = [], 0
            for event in events:
                if event["seq"] <= after_seq:
                    continue
                length = len(json.dumps(event, ensure_ascii=False).encode("utf8"))
                if len(rows) >= limit or size + length > 200 * 1024:
                    break
                rows.append(event)
                size += length
            return {"events": deepcopy(rows),
                    "latestSeq": self._state.get("interactionSeq", 0),
                    "oldestSeq": events[0]["seq"] if events else 0,
                    "gap": bool(events and after_seq > 0 and after_seq < events[0]["seq"] - 1)}

    @API("room_events_subscribe", description="注册其他插件的公开 API 接收互动信号；返回管理 token", version="1", public=True)
    async def room_events_subscribe(self, callback_api: str, version: str = "1", token: str = "", remove: bool = False) -> dict[str, Any]:
        if "." not in callback_api or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_.-]{2,159}", callback_api) or callback_api.startswith("cateye.maimai_room."):
            raise ValueError("请提供其他插件的完整公开 API 名称")
        if not isinstance(version, str) or not version or len(version) > 64:
            raise ValueError("回调版本须为 1–64 字符")
        if not remove:
            meta = await asyncio.wait_for(self.ctx.api.get(callback_api, version=version), timeout=3)
            if not isinstance(meta, dict) or meta.get("success") is False or meta.get("enabled") is False:
                raise ValueError("回调 API 不可用")
        async with self._lock:
            rows = self._state.setdefault("interactionSubscribers", {})
            existing = rows.get(callback_api)
            if existing and not token and not remove and existing["version"] == version:
                return {"ok": True, "alreadyRegistered": True, "latestSeq": self._state.get("interactionSeq", 0)}
            if existing and not secrets.compare_digest(str(token), existing["token"]):
                raise ValueError("管理此回调需要注册回执中的 token")
            if remove:
                rows.pop(callback_api, None)
                result = {"ok": True}
            else:
                if not existing and len(rows) >= 16:
                    raise ValueError("最多注册 16 个互动信号回调")
                key = existing["token"] if existing else secrets.token_urlsafe(24)
                rows[callback_api] = {"version": version, "token": key}
                result = {"ok": True, "token": key, "latestSeq": self._state.get("interactionSeq", 0)}
            self._dirty = True
            await self._persist_locked()
            return result

    def _update_integration(self, now: float) -> None:
        if not self._control.active(now) and self._state["character"]["source"].startswith("plugin:"):
            self._state["manualUntil"] = 0
        self._life = self._control.current(now)

    def _tool_available(self) -> bool:
        cfg = self.config.tools
        chats = bool(cfg.private_users or cfg.groups or cfg.private_mode == "blacklist" or cfg.group_mode == "blacklist")
        return bool(self.config.plugin.enabled and cfg.enabled and chats and (
            cfg.force_enabled or not self._control.active(time.time())))

    def get_components(self) -> list[dict[str, Any]]:
        components = super().get_components()
        for item in components:
            if item["name"] == "room_adjust_state":
                item["enabled"] = self._tool_available()
        return components

    async def _refresh_tool_visibility(self) -> None:
        desired = self._tool_available()
        if desired == self._tool_visible:
            return
        component = getattr(self.ctx, "component", None)
        if component is None:
            return
        try:
            action = component.enable_component if desired else component.disable_component
            await action("cateye.maimai_room.room_adjust_state", "tool", scope="global")
            self._tool_visible = desired
        except Exception:
            self.ctx.logger.warning("房间调节工具可见性将在下轮重试")

    @Tool("room_adjust_state", platforms=["qq", CHAT_PLATFORM], brief_description="调节你在房间中的动作、位置和表情",
          detailed_description="根据当前对话调节房间中的自身状态。只在配置允许的私聊或群聊调用。支持站、走、坐、睡、唤醒、自动、心情、灯和基础互动。目标使用房间地点名或开心/困/恢复。",
          parameters={"type": "object", "additionalProperties": False, "required": ["command"],
                      "properties": {
                          "command": {"type": "string", "maxLength": 24, "description": "动作，如 walk、sit、sleep、wake、mood、auto、dance"},
                          "target": {"type": "string", "maxLength": 80, "description": "地点，如 sofa、bed、desk、balcony，或心情 开心/困/恢复"}}})
    async def room_adjust_state(self, command: str = "", target: str = "", **kwargs: Any) -> dict[str, Any]:
        platform = str(kwargs.get("platform", "")).lower()
        if not self._tool_available() or platform not in {"qq", CHAT_PLATFORM}:
            return {"success": False, "content": "房间调节工具当前未开放"}
        cfg = self.config.tools
        group = str(kwargs.get("group_id") or "")
        identity = group or str(kwargs.get("user_id") or "")
        mode, values = (cfg.group_mode, cfg.groups) if group else (cfg.private_mode, cfg.private_users)
        normalized = {v.strip() for v in values}
        candidates = {platform + ":" + identity}
        if platform == "qq":
            candidates.add(identity)
        listed = bool(candidates.intersection(normalized))
        permitted = bool(identity) and (listed if mode == "whitelist" else not listed)
        if not permitted:
            return {"success": False, "content": "当前会话未开放房间调节工具"}
        try:
            result = await self._interact(command, target, "", "tool")
            return {"success": True, "content": result["message"], "character": result["character"]}
        except ValueError as error:
            return {"success": False, "content": str(error)}

    @API("room_client_config", description="房间渲染保留时间与前台帧率设置", version="1")
    async def room_client_config(self) -> dict[str, Any]:
        return {"renderGraceSeconds": self.config.performance.render_grace_seconds,
                "desktopFps": self.config.performance.desktop_fps}

    @API("room_control", description="第三方行为接管 claim/renew/release/status；回执 token 用于后续写入", version="1", public=True)
    async def room_control(self, action: str = "status", provider: str = "", token: str = "", ttl_seconds: int = 300) -> dict[str, Any]:
        async with self._lock:
            now = time.time()
            if action == "status":
                return dict(self._control.view(now), ok=True)
            if not self.config.plugin.enabled:
                raise ValueError("房间已停用")
            if action in {"claim", "renew"}:
                if action == "renew":
                    self._control.require(token, now)
                result = self._control.acquire(provider, ttl_seconds, token, now=now)
            elif action == "release":
                self._control.release(token, now)
                self._update_integration(now)
                result = dict(self._control.view(now), ok=True)
            else:
                raise ValueError("action 支持 claim/renew/release/status")
            self._activity_wakeup.set()
        await self._refresh_tool_visibility()
        return result

    @API("room_schedule_update", description="接管方主动推送当前活动、日程和可选情绪", version="1", public=True)
    async def room_schedule_update(self, token: str, activity: dict[str, Any], schedule: list[dict[str, Any]] | None = None, mood: str = "") -> dict[str, Any]:
        async with self._lock:
            self._control.update(token, activity, [] if schedule is None else schedule, mood, time.time())
            self._update_integration(time.time())
            self._activity_wakeup.set()
            return {"ok": True, "integration": self._control.view(time.time())}

    @API("room_control_action", description="行为接管方调节位置、姿态与表情；须有效接管 token", version="1", public=True)
    async def room_control_action(self, token: str, command: str, target: str = "", request_id: str = "") -> dict[str, Any]:
        return await self._interact(command, target, request_id, "external", control_token=token)

    @API("room_media_control", description="其他插件指定媒体直链或暂停、继续、跳转、停止电视", version="1", public=True)
    async def room_media_control(self, action: str, url: str = "", title: str = "", loop: bool = False,
                                 muted: bool = True, volume: float = 0.5, position_seconds: float = 0) -> dict[str, Any]:
        if not self.config.plugin.enabled or not self.config.tv.plugin_playback_enabled or not self._media:
            raise ValueError("插件视频接入已关闭")
        return await self._media.control(action, url, title, loop, muted, volume, position_seconds)

    @API("room_media_status", description="公开读取电视播放状态与准备结果", version="1", public=True)
    async def room_media_status(self) -> dict[str, Any]:
        return self._media.view() if self._media else {"status": "stopped", "id": "", "revision": 0}

    @API("room_media_chunk", description="页面只读读取当前指定媒体的有界分块", version="1")
    async def room_media_chunk(self, media_id: str, index: int) -> dict[str, Any]:
        if not self._media:
            raise ValueError("视频尚未就绪")
        return await asyncio.to_thread(self._media.read_chunk, media_id, index)

    @API("room_snapshot", description="只读房间快照；所有来源明确标注", version="1", public=True)
    async def room_snapshot(self) -> dict[str, Any]:
        async with self._lock:
            self._viewer_until = time.monotonic() + 6
            return self._view()

    async def _interact(self, command: str, target: str, request_id: str, source: str, *, control_token: str = "") -> dict[str, Any]:
        if not self.config.plugin.enabled:
            raise ValueError("房间已停用")
        if len(command) > 24 or len(target) > 80 or len(request_id) > 128:
            raise ValueError("动作参数过长")
        async with self._lock:
            if source == "external":
                self._control.require(control_token, time.time())
                source = "plugin:" + self._control.provider
            if source == "tool" and not self._tool_available():
                raise ValueError("第三方已接管行为，调节工具已关闭")
            command = clean(command, 24).lower()
            command = COMMANDS.get(command, command)
            now = time.time()
            candidate = deepcopy(self._state)
            tick(candidate, now, self.config.behaviour.walking_speed)
            changed, message = apply_action(candidate, command, target, now=now, source=source,
                                            request_id=request_id, hold_seconds=self.config.behaviour.manual_hold_seconds)
            if changed:
                self._state = candidate
                if source in {"webui", "qq"}:
                    self._emit_locked("room.action", command, {"command": command, "target": target, "kind": source},
                                      "action:" + request_id if request_id else "")
                self._dirty = True
                self._activity_wakeup.set()
                await self._persist_locked()
            return dict(self._view(), ok=True, changed=changed, message=message)

    @API("room_interact", description="已认证 WebUI 房间操作，不外发 QQ、不修改生活数据", version="1")
    async def room_interact(self, command: str, target: str = "", request_id: str = "") -> dict[str, Any]:
        if not self.config.access.webui_controls:
            raise ValueError("WebUI 房间操作已关闭")
        return await self._interact(command, target, request_id, "webui")

    async def _garden_interact(self, action: str, plot: int = -1, crop: str = "", quantity: int = 1,
                               request_id: str = "", source: str = "webui") -> dict[str, Any]:
        if not self.config.plugin.enabled:
            raise ValueError("房间已停用")
        async with self._lock:
            # Garden jobs, route, inventory and dedupe receipt commit as one
            # room-state transaction. Invalid commands never touch live state.
            candidate = deepcopy(self._state)
            now = time.time()
            tick(candidate, now, self.config.behaviour.walking_speed)
            result = control_garden(candidate, action, plot=plot, crop=crop, quantity=quantity,
                                    request_id=request_id, source=source, now_seconds=now, life=self._life)
            if result["changed"]:
                self._state = candidate
                if source in {"webui", "qq"}:
                    self._emit_locked("garden.action", action, {"command": action, "plot": plot, "target": crop, "kind": source},
                                      "garden:" + request_id if request_id else "")
                self._activity_wakeup.set()
                self._dirty = True
                await self._persist_locked()
            return dict(self._view(), **result)

    @API("room_garden_action", description="共享房间事务中的园艺指令；走到现场后才结算", version="1")
    async def room_garden_action(self, action: str, plot: int = -1, crop: str = "", quantity: int = 1, request_id: str = "") -> dict[str, Any]:
        if not self.config.access.webui_controls:
            raise ValueError("WebUI 房间操作已关闭")
        return await self._garden_interact(action, plot, crop, quantity, request_id, "webui")

    @API("room_chat_send", description="用户主动投递至麦麦的小屋专属宿主聊天流", version="1")
    async def room_chat_send(self, text: str, request_id: str) -> dict[str, Any]:
        if not self.config.plugin.enabled or not self.config.access.webui_controls or not self.config.chat.enabled or not self._chat:
            raise ValueError("房间内部聊天已关闭")
        result = self._chat.submit(text, request_id)
        async with self._lock:
            self._emit_locked("chat.action", "send", {"kind": "plugin-chat"}, "chat:" + request_id)
        return result

    @API("room_chat_status", description="只读取本页请求及按回复 ID 精确关联的回答，不查询历史", version="1")
    async def room_chat_status(self, request_id: str) -> dict[str, Any]:
        if not self._chat:
            raise ValueError("房间内部聊天尚未就绪")
        return self._chat.status(request_id)

    @API("room_chat_history", description="只读取麦麦的小屋专属聊天流的页面镜像", version="1")
    async def room_chat_history(self, after_seq: int = 0) -> dict[str, Any]:
        if not self._chat or not self.config.chat.enabled:
            raise ValueError("房间专属聊天已关闭")
        await asyncio.wait_for(self._chat.open(), timeout=8)
        return self._chat.messages(after_seq)

    @API("room_tv_review", description="用户主动提交电视单帧给宿主已配置的 vlm 视觉模型，可能产生调用费用", version="1")
    async def room_tv_review(self, image_data: str, request_id: str) -> dict[str, Any]:
        if not self._tv or not self.config.plugin.enabled or not self.config.access.webui_controls or not self.config.tv.review_enabled:
            raise ValueError("单帧视觉点评已关闭")
        return await self._tv.review(image_data, request_id)

    @API("room_tv_save_frame", description="仅用户主动保存已预览单帧到本机，不读取文件、不发模型或 QQ", version="1")
    async def room_tv_save_frame(self, image_data: str, request_id: str) -> dict[str, Any]:
        if not self._tv or not self.config.plugin.enabled or not self.config.access.webui_controls or not self.config.tv.save_enabled:
            raise ValueError("房间本机截图保存已关闭")
        return await self._tv.save(image_data, request_id)

    @API("room_tv_status", description="只读本页显式单帧操作结果，不抓屏不调用模型", version="1")
    async def room_tv_status(self, request_id: str) -> dict[str, Any]:
        if not self._tv:
            raise ValueError("房间电视尚未就绪")
        return self._tv.status(request_id)

    @MessageGateway("duplex", name=CHAT_GATEWAY, platform=CHAT_PLATFORM, account_id=CHAT_ACCOUNT, scope=CHAT_SCOPE,
                    description="麦麦的小屋专属原生聊天流的收发网关")
    async def room_chat_gateway(self, message: dict[str, Any], route: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
        if not self._chat or not self.config.chat.enabled:
            return {"success": False, "error": "房间聊天已关闭"}
        return await self._chat.receive(message, route)

    def _model_path(self, asset: str, quality: str = "mobile", encoding: str = "plain") -> Path:
        if asset != MODEL_ASSET:
            raise ValueError("未声明的模型资源")
        if quality not in MODEL_FILES:
            raise ValueError("模型精度仅支持 mobile/high")
        if encoding not in {"plain", "gzip"}:
            raise ValueError("模型编码仅支持 plain/gzip")
        name = MODEL_FILES[quality] + (".gz" if encoding == "gzip" else "")
        return Path(__file__).parent / "web" / "assets" / "models" / name

    @API("room_runtime_chunk", description="按可见房间页面的请求读取绘制程序分块", version="1")
    async def room_runtime_chunk(self, encoding: str, index: int) -> dict[str, Any]:
        files = {"gzip": "room.js.gz", "plain": "room.js"}
        if encoding not in files or type(index) is not int or not 0 <= index < 32:
            raise ValueError("房间资源分块无效")
        def read() -> dict[str, Any]:
            path = Path(__file__).parent / "web" / "runtime" / files[encoding]
            with path.open("rb") as handle:
                size = handle.seek(0, 2)
                if not index * CHUNK_SIZE < size <= 32 * CHUNK_SIZE:
                    raise ValueError("房间分块索引超出范围")
                handle.seek(index * CHUNK_SIZE)
                data = handle.read(CHUNK_SIZE)
            return {"index": index, "size": size, "data": base64.b64encode(data).decode("ascii")}
        return await asyncio.to_thread(read)

    def _read_model_info(self, asset: str, quality: str = "mobile", encoding: str = "plain") -> dict[str, Any]:
        path = self._model_path(asset, quality, encoding)
        stat = path.stat()
        if not 0 < stat.st_size <= 20 * 1024 * 1024:
            raise ValueError("模型大小须在 1 字节至 20 MiB")
        key = quality + ":" + encoding
        cached = self._model_cache.get(key)
        if cached and cached[:2] == (stat.st_mtime_ns, stat.st_size):
            return dict(cached[2])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        info = {"asset": asset, "quality": quality, "transportEncoding": encoding, "size": stat.st_size, "chunkSize": CHUNK_SIZE,
                "chunks": math.ceil(stat.st_size / CHUNK_SIZE), "sha256": digest, "revision": digest}
        self._model_cache[key] = (stat.st_mtime_ns, stat.st_size, info)
        return dict(info)

    @API("room_model_info", description="只读许可模型的大小、摘要和分页信息", version="1")
    async def room_model_info(self, asset: str = MODEL_ASSET, quality: str = "mobile", encoding: str = "plain") -> dict[str, Any]:
        return await asyncio.to_thread(self._read_model_info, asset, quality, encoding)

    def _read_model_chunk(self, asset: str, index: int, quality: str = "mobile", encoding: str = "plain") -> dict[str, Any]:
        info = self._read_model_info(asset, quality, encoding)
        if type(index) is not int or not 0 <= index < info["chunks"]:
            raise ValueError("模型分块索引超出范围")
        with self._model_path(asset, quality, encoding).open("rb") as file:
            file.seek(index * CHUNK_SIZE)
            data = file.read(CHUNK_SIZE)
        return {"asset": asset, "quality": quality, "index": index, "encoding": "base64", "data": base64.b64encode(data).decode("ascii"),
                "revision": info["revision"]}

    @API("room_model_chunk", description="经宿主预算限制的只读模型分块", version="1")
    async def room_model_chunk(self, index: int, asset: str = MODEL_ASSET, quality: str = "mobile", encoding: str = "plain") -> dict[str, Any]:
        return await asyncio.to_thread(self._read_model_chunk, asset, index, quality, encoding)

    def _authorized(self, kwargs: dict[str, Any]) -> bool:
        if kwargs.get("is_local_operator") is True:
            return True
        platform = str(kwargs.get("platform") or "").lower()
        if platform != "qq":
            return False
        user_id = str(kwargs.get("user_id") or "")
        candidates = {"qq:" + user_id, user_id} if user_id else set()
        if not candidates.intersection(self.config.access.allowed_users):
            return False
        group_id = str(kwargs.get("group_id") or "")
        return not group_id or not self.config.access.allowed_groups or group_id in self.config.access.allowed_groups

    async def _command_authorized(self, kwargs: dict[str, Any]) -> bool:
        if self._authorized(kwargs):
            return True
        access = self.config.access
        # A nonempty local allowlist is an intentional override, not an additive
        # list. Inheritance never expands it or grants an entire chat permission.
        if access.allowed_users or not access.inherit_host_operators:
            return False
        if str(kwargs.get("platform") or "").lower() != "qq":
            return False
        group_id = str(kwargs.get("group_id") or "")
        if group_id and access.allowed_groups and group_id not in access.allowed_groups:
            return False
        user_id = str(kwargs.get("user_id") or "")
        if not re.fullmatch(r"[0-9]{1,20}", user_id):
            return False
        try:
            values = await asyncio.wait_for(self.ctx.config.get("plugin.permission", []), timeout=2.5)
        except asyncio.CancelledError:
            raise
        except Exception:
            return False
        if not isinstance(values, list):
            return False
        # Only explicitly scoped QQ accounts from the normal host admin field.
        # No target/affection/known-person inference, no bare ID or chat grants.
        for value in values:
            if not isinstance(value, str):
                continue
            platform, separator, identity = value.strip().partition(":")
            if separator and platform.strip().lower() == "qq" and identity.strip() == user_id:
                return True
        return False

    @Command("maimai_room", description="QQ 房间指令：站/走/坐/睡/唤醒/状态/自动/心情", pattern=ROOT_PATTERN)
    async def command_room(self, **kwargs: Any) -> tuple[bool, str, int]:
        groups = kwargs.get("matched_groups") or {}
        text = str(groups.get("room_args") or "") if isinstance(groups, dict) and "room_args" in groups else ""
        if not text:
            match = re.match(ROOT_PATTERN, str(kwargs.get("text") or ""))
            text = str(match.group("room_args") or "") if match else ""
        parts = text.strip().split(maxsplit=1)
        command = COMMANDS.get(parts[0].lower(), parts[0].lower()) if parts else "help"
        target = parts[1].strip() if len(parts) > 1 else ""
        allowed = await self._command_authorized(kwargs)
        public = self.config.access.public_status and command in {"status", "help"}
        stream = str(kwargs.get("stream_id") or "")
        if not allowed and not public:
            response = "房间指令仅对白名单用户开放"
            success = False
        elif command == "help":
            response, success = HELP, True
        elif command == "status":
            view = await self.room_snapshot()
            char = view["character"]
            source = {"room-routine": "房间例行活动", "life-activity": "生活公开活动", "qq": "QQ 手动", "webui": "WebUI 手动"}.get(char["source"], char["source"])
            response = f"{char['name']}：{ACTION_NAMES.get(char['action'], char['action'])}，{char['room']}；来源：{source}；灯{'开' if view['room']['lamp'] else '关'}"
            expression = char["expression"]
            response += f"；房间表情：{expression['name']}（{expression['source']}）"
            response += "；生活心情：" + (view["life"]["mood"]["label"] or "未接入")
            success = True
        else:
            key = str(kwargs.get("platform") or "") + ":" + str(kwargs.get("user_id") or "")
            now = time.monotonic()
            if now - self._last_command.get(key, -1e9) < 1:
                response, success = "房间操作太快，稍等一秒", False
            else:
                self._last_command = {k: v for k, v in self._last_command.items() if now - v < 60}
                self._last_command[key] = now
                message = kwargs.get("message") or {}
                message_id = str(message.get("message_id") or (message.get("message_info") or {}).get("message_id") or "") if isinstance(message, dict) else ""
                request_id = "qq:" + hashlib.sha256((key + ":" + stream + ":" + message_id).encode()).hexdigest() if message_id else ""
                try:
                    if command in {"garden", "菜园", "园艺"}:
                        fields = parse_garden_command(target)
                        result = await self._garden_interact(**fields, request_id=request_id, source="qq")
                        if fields["action"] == "status":
                            garden = result["garden"]
                            planted = sum(bool(plot["cropId"]) for plot in garden["plots"])
                            result["message"] = f"菜园：{planted}/8 畦已种植，金币 {garden['coins']}，堆肥 {garden['compost']}；{garden['care']['status']}"
                    else:
                        result = await self._interact(command, target, request_id, "qq")
                    response, success = result["message"], bool(result.get("ok", True))
                except ValueError as exc:
                    response, success = str(exc), False
        if stream:
            await self.ctx.send.text(text=response, stream_id=stream)
        return success, response, 2


def create_plugin() -> MaiMaimaiRoomPlugin:
    return MaiMaimaiRoomPlugin()
