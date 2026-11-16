"""Recoverable physical garden jobs, adapted from upstream garden-autonomy.js.

The garden, job receipt, character route and rewards share room.json's atomic
commit. Callers hold the room lock and persist when ``changed`` is true.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any

import json
import time

from .garden import (ACTIONS, BY_ID, CROPS, PLOT_ACTIONS, RULES, advance_garden, apply_garden_action,
                     clean, create_garden, garden_view, plan_garden_action)
from .room_core import apply_action, bump, resolve_target, travel

LABELS = {"till": "松土", "plant": "播种", "water": "浇水", "fertilize": "施肥", "harvest": "采收",
          "sell": "出售收成", "buySeed": "购买种子", "buyCompost": "补充堆肥", "visit": "巡视菜园"}
DURATIONS = {"till": 7000, "plant": 6500, "water": 6500, "fertilize": 6000, "harvest": 8000,
             "sell": 6000, "buySeed": 5000, "buyCompost": 6000, "visit": 4500}
TZ = timezone(timedelta(hours=8))


def ensure_garden(room: dict[str, Any], now_seconds: float | None = None) -> bool:
    now = time.time() if now_seconds is None else now_seconds
    raw = room.get("garden")
    if raw is not None and (not isinstance(raw, dict) or raw.get("version", 1) != 1):
        raise ValueError("菜园存档格式或版本不支持；原文件保留")
    garden = create_garden(now * 1000) if raw is None else advance_garden(raw, now * 1000)
    changed = garden != raw
    room["garden"] = garden
    return changed


def garden_snapshot(room: dict[str, Any], now_seconds: float | None = None) -> dict[str, Any]:
    now = time.time() if now_seconds is None else now_seconds
    # garden_view advances a copy only. A summary never mutates the save.
    garden = garden_view(room.get("garden") or create_garden(now * 1000), now * 1000)
    task = garden["care"]["task"]
    if task:
        garden["care"]["task"] = dict(task, **task["action"])
    garden["care"]["queued"] = len(garden["care"]["queue"])
    char = room["character"]
    garden["care"]["character"] = {"room": char["room"], "activity": "garden_" + task["action"]["type"] if task else char["action"],
                                     "walking": char["walking"]}
    garden["catalog"] = deepcopy(list(CROPS))
    garden["rules"] = dict(RULES)
    return garden


def fingerprint(action: dict[str, Any]) -> str:
    return json.dumps([action["type"], action.get("plotId"), action.get("cropId"), action.get("quantity", 1), action.get("enabled")],
                      ensure_ascii=False, separators=(",", ":"))


def _job(garden, action, source, at, request_id=""):
    garden["care"]["nextId"] += 1
    plot = garden["plots"][action["plotId"]] if action["type"] in PLOT_ACTIONS else None
    return {"id": "garden-" + str(garden["care"]["nextId"]), "requestId": request_id,
            "action": action, "source": source, "phase": "queued", "createdAt": at,
            "startedAt": 0, "workUntil": 0, "fingerprint": fingerprint(action),
            "expectedPlot": {"cropId": plot["cropId"], "plantedAt": plot["plantedAt"]} if plot else None}


def _finish(garden, job, ok, message, at, status=None):
    care = garden["care"]
    care["recent"] = (care["recent"] + [{"id": job["id"], "type": job["action"]["type"], "ok": ok,
                                        "message": clean(message), "at": at}])[-16:]
    receipt = next((r for r in care["receipts"] if r["jobId"] == job["id"]), None)
    if receipt is not None:
        receipt.update(status=status or ("completed" if ok else "failed"), message=clean(message), at=at)
    care.update(task=None, status=clean(message), nextPlanAt=at + 2500)
    if ok and job["action"]["type"] == "plant":
        care["rotation"] = (next(i for i, c in enumerate(CROPS) if c["id"] == job["action"]["cropId"]) + 1) % 12


def _valid(garden, job, at):
    expected = job["expectedPlot"]
    plot = garden["plots"][job["action"]["plotId"]] if expected is not None else None
    if plot and any(plot[k] != expected[k] for k in ("cropId", "plantedAt")):
        return {"ok": False, "message": "这畦已经有人照料过，已取消旧任务，重新安排"}
    return {"ok": True, "state": garden, "message": "到了菜园门口，看看菜畦的长势"} if job["action"]["type"] == "visit" else apply_garden_action(garden, job["action"], at)


def _blocker(room, now, forced=False, life=None):
    if forced:
        return ""
    char = room["character"]
    if char["action"] == "sleep" or char["pose"] == "lie":
        return "正在休息，醒来后再照料菜园"
    if now < room.get("manualUntil", 0) and char.get("source") != "garden":
        return "先完成你的房间安排，稍后再照料菜园"
    if isinstance(life, dict) and life.get("available") and isinstance(life.get("activity"), dict):
        activity = life["activity"]
        title = " ".join(str(activity.get(k) or "") for k in ("name", "goal_type", "description")).lower()
        if any(word in title for word in ("sleep", "睡", "就寝", "入梦")):
            return "生活日程正在休息，醒来后再照料菜园"
        if not any(word in title for word in ("garden", "菜园", "园艺", "自由", "空闲", "休闲", "放松", "散步", "idle", "leisure")):
            return "先完成生活日程中的活动，空闲时再照料菜园"
    local = datetime.fromtimestamp(now, TZ)
    hour = local.hour + local.minute / 60
    if hour >= 22.5 or hour < 6.8:
        return "天晚了，醒来后再照料菜园"
    # No second physiology system is introduced. Real life sleep/manual room
    # arrangements remain authoritative; garden autonomy only uses free time.
    return ""


def _target(action):
    key = ("plot" + str(action["plotId"]) if action["type"] in PLOT_ACTIONS else
           "compost" if action["type"] == "buyCompost" else "market" if action["type"] == "sell" else
           "gate" if action["type"] == "visit" else "shop")
    return resolve_target("garden." + key)


def control_garden(room: dict[str, Any], action: str, plot: int = -1, crop: str = "", quantity: int = 1,
                   request_id: str = "", source: str = "webui", now_seconds: float | None = None, life: Any = None) -> dict[str, Any]:
    now = time.time() if now_seconds is None else now_seconds
    at = int(now * 1000)
    supported = ACTIONS | {"visit", "auto", "auto_on", "auto_off", "pause", "careNow", "careForce", "careDefer", "status"}
    if not isinstance(action, str) or action not in supported:
        raise ValueError("未知菜园操作")
    if not isinstance(request_id, str) or len(request_id) > 96 or clean(request_id, 96) != request_id:
        raise ValueError("菜园请求编号须为不含控制字符的 0 至 96 字文本")
    if action == "status":
        return {"ok": True, "changed": False, "message": "菜园状态", "garden": garden_snapshot(room, now)}
    garden = advance_garden(room.get("garden") or create_garden(at), at)
    care = garden["care"]
    fields = {"type": action}
    if action in PLOT_ACTIONS:
        fields["plotId"] = plot
    if action in {"plant", "sell", "buySeed"}:
        fields["cropId"] = crop
    if action in {"sell", "buySeed", "buyCompost"}:
        fields["quantity"] = quantity
    if action in {"auto", "auto_on", "auto_off", "pause"}:
        fields = {"type": "auto", "enabled": action not in {"auto_off", "pause"}}
    key = fingerprint(fields)
    receipt = next((r for r in care["receipts"] if request_id and r["requestId"] == request_id), None)
    if receipt:
        if receipt["fingerprint"] != key:
            raise ValueError("相同请求编号不能用于不同的菜园操作")
        return {"ok": receipt["status"] not in {"failed", "cancelled"}, "changed": False,
                "accepted": receipt["status"] == "queued", "status": receipt["status"], "message": receipt["message"],
                "garden": garden_snapshot(room, now)}
    if action in ACTIONS:
        valid = apply_garden_action(garden, fields, at)
        if not valid["ok"]:
            raise ValueError(valid["message"])
    if action in ACTIONS | {"visit"}:
        if len(care["queue"]) >= 16:
            raise ValueError("菜园已有 16 项安排，请先等一部分完成")
        job = _job(garden, fields, "requested", at, request_id)
        care["queue"].append(job)
        care["nextPlanAt"] = 0
        message = f"已记下{LABELS[action]}，麦麦会走到现场完成，完成后才结算"
        status, accepted, job_id = "queued", True, job["id"]
    elif fields["type"] == "auto":
        care["autoEnabled"] = fields["enabled"]
        care["nextPlanAt"] = 0
        if not fields["enabled"] and care["task"] and care["task"]["source"] == "auto":
            _finish(garden, care["task"], False, "自主照料已暂停", at, "cancelled")
            room["character"]["gardenWork"] = None
            if room["character"].get("source") == "garden":
                room["character"]["source"] = "room-routine"
        message = "麦麦会自己安排照料菜园" if fields["enabled"] else "已暂停自主照料"
        care["status"] = message
        status, accepted, job_id = "completed", False, ""
    else:
        reason = _blocker(room, now, life=life)
        if action == "careNow" and reason and not care["task"]:
            question = reason + "。先做完手头的事，还是直接去菜园？30 秒未选择会先做手头的事。"
            care["pendingConflict"] = {"id": "care-" + str(at), "question": question, "kind": "room",
                                       "createdAt": at, "deadline": at + 30000, "defaultDecision": "defer"}
            care["status"] = question
            message = question
        elif action == "careDefer":
            care.update(pendingConflict=None, nextPlanAt=at + 15000, status="先完成手头的事，稍后再照料菜园")
            message = care["status"]
        else:
            care.update(autoEnabled=True, pendingConflict=None, nextPlanAt=0)
            if action == "careForce":
                care["forceUntil"] = at + 5 * 60000
                apply_action(room, "wake", now=now, source="garden", hold_seconds=0)
                room["manualUntil"] = 0
            message = "已经安排照料菜园"
        status, accepted, job_id = "completed", True, ""
    if request_id:
        care["receipts"] = (care["receipts"] + [{"requestId": request_id, "jobId": job_id, "fingerprint": key,
                                                "status": status, "message": clean(message), "at": at}])[-64:]
    room["garden"] = garden
    bump(room, now)
    return {"ok": True, "changed": True, "accepted": accepted, "status": status, "message": message,
            "conflict": bool(care["pendingConflict"]), "pending": care["pendingConflict"], "garden": garden_snapshot(room, now)}


def tick_garden(room: dict[str, Any], now_seconds: float | None = None, life: Any = None) -> dict[str, Any]:
    now = time.time() if now_seconds is None else now_seconds
    at = int(now * 1000)
    before = room.get("garden")
    garden = advance_garden(before or create_garden(at), at)
    care, char = garden["care"], room["character"]
    before_care = deepcopy(care)
    pending = care["pendingConflict"]
    if pending and at >= pending["deadline"]:
        care.update(pendingConflict=None, nextPlanAt=at + 15000, status="先完成手头的事，稍后再照料菜园")
    reason = "正在等你选择照料安排" if care["pendingConflict"] else _blocker(room, now, care["forceUntil"] > at, life=life)
    job = care["task"]
    if job and reason:
        _finish(garden, job, False, reason + "；这项菜园任务已暂停", at, "cancelled")
        if char.get("source") == "garden":
            char.update(source="room-routine", gardenWork=None)
        job = None
    target = char.get("target") or {}
    if job:
        if target.get("gardenJobId") != job["id"]:
            if char.get("source") != "garden" and char.get("walking"):
                _finish(garden, job, False, "你的新安排已接手，原菜园任务已取消", at, "cancelled")
                job = None
            else:
                destination = _target(job["action"])
                destination.update(gardenJobId=job["id"], gardenAction=job["action"]["type"])
                travel(room, destination, "stand", "garden", now)
                job.update(phase="walking", startedAt=at, workUntil=0)
        elif char["walking"]:
            job["phase"] = "walking"
            care["status"] = "正在走去" + LABELS[job["action"]["type"]]
        elif job["phase"] != "working":
            job.update(phase="working", workUntil=at + DURATIONS[job["action"]["type"]])
            care["status"] = "麦麦正在" + LABELS[job["action"]["type"]]
        elif at >= job["workUntil"]:
            outcome = _valid(garden, job, at)
            if outcome.get("state") is not None:
                garden = outcome["state"]
                care = garden["care"]
            _finish(garden, job, outcome["ok"], "麦麦：" + outcome["message"], at)
            char.update(source="room-routine", gardenWork=None)
            job = None
    if not care["task"]:
        if reason:
            care["status"] = reason
        elif at >= care["nextPlanAt"]:
            next_job = care["queue"].pop(0) if care["queue"] else None
            if next_job is None and care["autoEnabled"]:
                action = plan_garden_action(garden, care["rotation"], at)
                if action:
                    next_job = _job(garden, action, "auto", at)
            if next_job:
                valid = _valid(garden, next_job, at)
                if not valid["ok"]:
                    _finish(garden, next_job, False, valid["message"], at)
                else:
                    care["task"] = next_job
                    destination = _target(next_job["action"])
                    destination.update(gardenJobId=next_job["id"], gardenAction=next_job["action"]["type"])
                    travel(room, destination, "stand", "garden", now)
                    next_job.update(phase="walking", startedAt=at)
                    care["status"] = "出发去" + LABELS[next_job["action"]["type"]]
            elif care["autoEnabled"]:
                care.update(status="菜园照料好了，等作物慢慢长大", nextPlanAt=at + 15000)
            else:
                care["status"] = "自主照料已暂停，仍可安排指定操作"
    task = care["task"]
    if task and char.get("source") == "garden":
        char["gardenWork"] = dict(task["action"], id=task["id"], phase=task["phase"], workUntil=task["workUntil"])
    else:
        char["gardenWork"] = None
    room["garden"] = garden
    changed = garden != before
    if care != before_care or (isinstance(before, dict) and garden["plots"] != before.get("plots")):
        bump(room, now)
    return {"changed": changed, "busy": bool(task) or bool(care["pendingConflict"])}


def parse_garden_command(text: str) -> dict[str, Any]:
    """QQ display plot numbers are 1..8; the returned engine index is 0..7."""
    parts = clean(text, 180).split()
    word = parts[0] if parts else "status"
    aliases = {"状态": "status", "商店": "status", "仓库": "status", "翻土": "till", "松土": "till", "hoe": "till",
               "播种": "plant", "种": "plant", "浇水": "water", "施肥": "fertilize", "采收": "harvest", "收获": "harvest",
               "出售": "sell", "买种子": "buySeed", "buy-seeds": "buySeed", "买堆肥": "buyCompost", "buy-compost": "buyCompost",
               "自动": "auto", "照料": "careNow", "巡视": "visit", "暂停": "auto_off"}
    action = aliases.get(word, word)
    fields: dict[str, Any] = {"action": action}
    if action == "status" and len(parts) <= 1:
        return fields
    if action == "auto":
        if len(parts) > 2 or (len(parts) == 2 and parts[1].lower() not in {"on", "off", "开", "关"}):
            raise ValueError("菜园自动可用 on/off")
        fields["action"] = "auto_off" if len(parts) == 2 and parts[1].lower() in {"off", "关"} else "auto_on"
        return fields
    if action in {"auto_on", "auto_off", "careNow", "careForce", "careDefer", "visit"} and len(parts) == 1:
        return fields
    crop_aliases = {c["name"]: c["id"] for c in CROPS} | {"萝卜": "radish"}
    expected = 3 if action == "plant" else 2 if action in PLOT_ACTIONS else None
    if expected:
        if len(parts) != expected or not parts[1].isdigit() or not 1 <= int(parts[1]) <= 8:
            raise ValueError("地块编号须为 1 至 8；示例：播种 5 胡萝卜")
        fields["plot"] = int(parts[1]) - 1
        if action == "plant":
            fields["crop"] = crop_aliases.get(parts[2], parts[2])
            if fields["crop"] not in BY_ID:
                raise ValueError("未知作物，请查看菜园商店中的 12 种作物")
        return fields
    if action in {"buySeed", "sell"} and 2 <= len(parts) <= 3:
        fields["crop"] = crop_aliases.get(parts[1], parts[1])
        if fields["crop"] not in BY_ID:
            raise ValueError("未知作物")
        count = parts[2] if len(parts) == 3 else "1"
    elif action == "buyCompost" and len(parts) <= 2:
        count = parts[1] if len(parts) == 2 else "1"
    else:
        raise ValueError("园艺指令：状态 / 翻土 5 / 播种 5 胡萝卜 / 浇水 5 / 施肥 5 / 采收 1 / 出售 小萝卜 3 / 买种子 番茄 2 / 买堆肥 1 / 自动 on|off")
    if not count.isdigit() or not 1 <= int(count) <= 99:
        raise ValueError("每次数量须为 1 至 99")
    fields["quantity"] = int(count)
    return fields
