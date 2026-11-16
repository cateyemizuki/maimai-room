"""Explicit, expiring behaviour ownership and a local Asia/Shanghai routine."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import secrets
from typing import Any

from .room_core import TZ, clean, resolve_target

ROUTINE = [
    ("00:00", "睡觉", "bed", "sleep"), ("07:00", "起床洗漱", "bathroom", "walk"),
    ("07:30", "吃早餐", "dining", "sit"), ("08:00", "学习与工作", "desk", "sit"),
    ("12:00", "吃午餐", "dining", "sit"), ("13:00", "午间休息", "sofa", "sit"),
    ("14:00", "学习与工作", "desk", "sit"), ("17:30", "准备晚饭", "kitchen", "walk"),
    ("18:00", "吃晚餐", "dining", "sit"), ("19:00", "休闲时间", "sofa", "sit"),
    ("21:30", "晚间洗漱", "bathroom", "walk"), ("22:00", "睡觉", "bed", "sleep"),
]


def routine_life(now: float) -> dict[str, Any]:
    clock = datetime.fromtimestamp(now, TZ).strftime("%H:%M")
    row = next(item for item in reversed(ROUTINE) if item[0] <= clock)
    return {"available": True, "source": "room-routine", "updatedAt": int(now * 1000),
            "timezone": "Asia/Shanghai", "reason": "",
            "activity": {"name": row[1], "target": row[2], "command": row[3]},
            "schedule": [{"time": t, "activity": name, "day_offset": 0} for t, name, _, _ in ROUTINE],
            "mood": {"available": False, "source": "unavailable", "label": "未接入情绪接口"}}


def normalize_activity(value: dict[str, Any]) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError("activity 必须是对象")
    fields = {k: clean(value.get(k), 180) for k in ("name", "description", "goal_type", "time_window")}
    if "target" in value or "command" in value:
        command = value.get("command", "walk")
        if command not in {"walk", "sit", "sleep", "stand"}:
            raise ValueError("日程 command 支持 walk/sit/sleep/stand")
        target = clean(value.get("target") or ("bed" if command == "sleep" else "sofa"), 80)
        resolve_target(target)
        fields.update(target=target, command=command)
    return fields


class BehaviourControl:
    """Only a lease receipt can mutate an active owner's behaviour."""
    def __init__(self) -> None:
        self.provider = ""
        self.token = ""
        self.until = 0.0
        self.life: dict[str, Any] | None = None

    def active(self, now: float) -> bool:
        return bool(self.token and self.until > now)

    def view(self, now: float) -> dict[str, Any]:
        return {"active": self.active(now), "provider": self.provider if self.active(now) else "",
                "expiresAt": int(self.until * 1000) if self.active(now) else 0,
                "scheduleConnected": self.active(now) and self.life is not None}

    def require(self, token: str, now: float) -> None:
        if not self.active(now) or not isinstance(token, str) or not secrets.compare_digest(token, self.token):
            raise ValueError("接管已到期或 token 无效，请重新取得接管回执")

    def acquire(self, provider: str, ttl_seconds: int, token: str = "", *, now: float) -> dict[str, Any]:
        if not isinstance(provider, str) or not provider.strip() or len(provider) > 128:
            raise ValueError("provider 必须填写调用方插件标识，最长 128 字符")
        if type(ttl_seconds) is not int or not 10 <= ttl_seconds <= 86400:
            raise ValueError("ttl_seconds 须在 10 到 86400 秒之间")
        if self.active(now):
            self.require(token, now)
            if provider != self.provider:
                raise ValueError("当前接管方与 provider 不一致")
        else:
            self.provider, self.token, self.life = provider, secrets.token_urlsafe(32), None
        self.until = now + ttl_seconds
        return dict(self.view(now), token=self.token, ok=True)

    def release(self, token: str, now: float) -> None:
        self.require(token, now)
        self.provider, self.token, self.until, self.life = "", "", 0.0, None

    def update(self, token: str, activity: dict[str, Any], schedule: list[dict[str, Any]],
               mood: str, now: float) -> None:
        self.require(token, now)
        current = normalize_activity(activity)
        if not isinstance(schedule, list) or len(schedule) > 80 or any(not isinstance(r, dict) for r in schedule):
            raise ValueError("schedule 必须是最多 80 行的列表")
        rows = [{"time": clean(r.get("time"), 32), "activity": clean(r.get("activity"), 120),
                 "day_offset": 1 if r.get("day_offset") == 1 else 0} for r in schedule]
        self.life = {"available": True, "source": "plugin:" + self.provider, "activity": current,
                     "schedule": rows, "timezone": "Asia/Shanghai", "updatedAt": int(now * 1000),
                     "mood": {"available": bool(mood), "source": "plugin:" + self.provider,
                              "label": clean(mood, 120)}, "reason": ""}

    def current(self, now: float) -> dict[str, Any]:
        return deepcopy(self.life) if self.active(now) and self.life is not None else routine_life(now)
