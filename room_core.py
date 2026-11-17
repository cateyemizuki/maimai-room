"""Room-only facts and navigation. No host internals, QQ data or second mood model.

The room graph and furniture coordinates in layout.json are derived from
sh2234113/feiyu-room-template src/home-state.js (MIT). Travel uses its doorway
graph; furniture poses are applied only on arrival.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import json
import math
import os
import re
import time

from .room_navigation import OBSTACLES, find_route, ground_point_valid

DATA = json.loads(Path(__file__).with_name("layout.json").read_text(encoding="utf-8"))
LAYOUT, NODES, EDGES = DATA["layout"], DATA["nodes"], DATA["edges"]
SPOTS = {f"{room}.{key}": dict(value, room=room, key=key)
         for room, spots in LAYOUT["spots"].items() for key, value in spots.items()}
ALIASES = {"sofa": "living.sofa", "沙发": "living.sofa", "bed": "her_room.bed", "床": "her_room.bed",
           "desk": "her_room.desk", "书桌": "her_room.desk", "balcony": "balcony.rail", "阳台": "balcony.rail",
           "kitchen": "kitchen.fridge", "厨房": "kitchen.fridge", "dining": "kitchen.dining", "餐桌": "kitchen.dining",
           "water": "living.water", "饮水机": "living.water", "bathroom": "bathroom.sink", "卫生间": "bathroom.sink",
           "garden": "garden.gate", "菜园": "garden.gate", "door": "foyer.door", "门口": "foyer.door"}
COMMANDS = {"站": "stand", "站立": "stand", "走": "walk", "走路": "walk", "去": "walk", "go": "walk",
            "坐": "sit", "坐下": "sit", "睡": "sleep", "睡觉": "sleep", "唤醒": "wake", "叫醒": "wake",
            "醒来": "wake", "状态": "status", "自动": "auto", "恢复自动": "auto", "灯": "lamp", "开灯": "lamp_on",
            "关灯": "lamp_off", "摸头": "pet", "戳": "poke", "喂食": "feed", "倒水": "water", "陪玩": "play",
            "心情": "mood", "表情": "mood", "expression": "mood", "帮助": "help"}
COMMANDS.update({"跳舞": "dance", "伸懒腰": "stretch", "行礼": "bow"})
GESTURES = {"pet": (3, "摸了摸麦麦的头"), "poke": (2, "轻轻戳了麦麦一下"),
            "feed": (5, "递给麦麦一份点心"), "water": (5, "给麦麦倒了一杯水"),
            "play": (8, "陪麦麦玩了一会儿"), "wake": (3, "叫醒了麦麦"),
            "dance": (8, "麦麦跳了一小段舞"), "stretch": (5, "麦麦伸了个懒腰"), "bow": (3.3, "麦麦轻轻行礼")}
EXPRESSIONS = {"开心": "happy", "高兴": "happy", "happy": "happy", "困": "sleepy", "困倦": "sleepy",
               "sleepy": "sleepy", "恢复": "neutral", "平静": "neutral", "neutral": "neutral", "reset": "neutral"}
EXPRESSIONS.update({"生气": "angry", "angry": "angry", "低落": "sad", "难过": "sad", "sad": "sad",
                    "放松": "relaxed", "relaxed": "relaxed", "惊讶": "surprised", "surprised": "surprised",
                    "眨眼": "wink", "单眼": "wink", "wink": "wink", "惊喜": "delighted", "delighted": "delighted",
                    "委屈": "pout", "pout": "pout"})
ACTION_NAMES = {"stand": "站着", "walk": "走路", "sit": "坐着", "sleep": "睡觉", "wake": "醒着"}
TZ = timezone(timedelta(hours=8))


def clean(value: Any, limit: int = 120) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", "", str(value or ""))).strip()[:limit]


def room_at(point: list[float]) -> str | None:
    candidates = []
    for room in LAYOUT["rooms"]:
        x0, z0, x1, z1 = room["bounds"]
        if x0 <= point[0] <= x1 and z0 <= point[1] <= z1:
            candidates.append(((x1 - x0) * (z1 - z0), room["id"]))
    if candidates:
        return min(candidates)[1]
    # The entrance threshold connects the outdoor path to the foyer.
    if -.21 <= point[0] <= .21 and 5.77 <= point[1] <= 6.76:
        return "foyer"
    return None


def nearest(point: list[float], room: str | None = None) -> str:
    options = [key for key, pos in NODES.items() if room is None or room_at(pos) == room]
    return min(options or NODES, key=lambda key: math.dist(point, NODES[key]))


def resolve_target(target: str, default: str = "sofa") -> dict[str, Any]:
    name = clean(target or default, 80)
    key = ALIASES.get(name, name)
    if key in SPOTS:
        result = deepcopy(dict(SPOTS[key], id=key))
        # The upstream groups the dining-chair spot under "kitchen", although
        # its real position is in the dining room. Display the physical room.
        result["room"] = room_at(result["pos"]) or result["room"]
        return result
    if re.fullmatch(r"[-+]?\d+(?:\.\d+)?\s*,\s*[-+]?\d+(?:\.\d+)?", name):
        point = [float(x) for x in name.split(",")]
        room = room_at(point)
        if room and ground_point_valid(point, LAYOUT["rooms"]):
            node = nearest(point, room)
            return {"id": f"free:{point[0]:.3f},{point[1]:.3f}", "room": room, "key": node, "access": node,
                    "pos": point, "pose": "stand", "facing": 0, "label": "指定位置"}
    raise ValueError("未知目标，可用 sofa/bed/desk/balcony/kitchen/dining/garden 或房间内 x,z")


def path_to(point: list[float], target: dict[str, Any], start_access: str = "") -> list[list[float]]:
    return find_route(point, target, NODES, EDGES, LAYOUT["rooms"], start_access)


def display_route(start: list[float], finish: list[float]) -> list[list[float]]:
    """A read-only, walkable bridge for a client that missed route history."""
    if room_at(start) is None or not all(math.isfinite(v) for v in start):
        raise ValueError("显示位置不在房间范围内")
    def occupied(point):
        return next((name for name, rect in OBSTACLES if name in SPOTS and
                     rect[0]-.035 < point[0] < rect[2]+.035 and rect[1]-.035 < point[1] < rect[3]+.035), "")
    first, last = occupied(start), occupied(finish)
    room = room_at(finish)
    if room is None:
        raise ValueError("服务端位置不在房间范围内")
    target = dict(SPOTS[last], id=last) if last else {"id": "free:presentation", "access": nearest(finish, room), "room": room}
    target["pos"] = list(finish)
    return [list(start), *path_to(start, target, SPOTS[first]["access"] if first else "")]


def empty_state(now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    return {"schemaVersion": 1, "revision": 0, "updatedAt": int(now * 1000), "lastTick": now, "movementSeq": 0,
            "manualUntil": 0, "character": {"id": "maisaka", "name": "麦麦", "action": "stand", "pose": "stand",
            "position": {"x": 6.3, "z": 1.5}, "room": "living", "elevation": 0, "facing": 0,
            "walking": False, "path": [], "target": None, "motion": None, "source": "room-routine", "poseUntil": 0,
            "expression": {"name": "neutral", "source": "default", "expiresAt": 0}, "gesture": None},
            "room": {"lamp": True, "counts": {}, "events": []}, "processed": {}}


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return empty_state()
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("schemaVersion") != 1:
        raise ValueError("房间状态版本不支持；原文件保留，请先备份后迁移")
    # Validate critical persisted fields before they can reach arithmetic/JSON APIs.
    char = raw["character"]
    char.setdefault("gesture", None)
    char.setdefault("motion", None)
    raw.setdefault("movementSeq", 0)
    pos = [float(char["position"][axis]) for axis in ("x", "z")]
    if not all(math.isfinite(v) for v in pos) or room_at(pos) is None:
        raise ValueError("房间存档位置无效；原文件保留")
    raw["lastTick"] = time.time()  # Do not replay a process outage as a long walk.
    raw["processed"] = {str(k): float(v) for k, v in raw.get("processed", {}).items()}
    return raw


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    data = json.dumps(state, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def bump(state: dict[str, Any], now: float) -> None:
    state["revision"] += 1
    state["updatedAt"] = int(now * 1000)


def tick(state: dict[str, Any], now: float, speed: float = 1.15) -> bool:
    char = state["character"]
    remaining = max(0, min(5, now - state["lastTick"])) * speed
    state["lastTick"] = now
    changed = False
    if char.get("gesture") and char["gesture"]["expiresAt"] <= now * 1000:
        char["gesture"] = None
        changed = True
    expression = char["expression"]
    if expression["expiresAt"] and expression["expiresAt"] <= now * 1000:
        char["expression"] = {"name": "neutral", "source": "default", "expiresAt": 0}
        changed = True
    while char["walking"] and char["path"] and remaining > 0:
        point = [char["position"]["x"], char["position"]["z"]]
        destination = char["path"][0]
        distance = math.dist(point, destination)
        char["facing"] = math.degrees(math.atan2(destination[0] - point[0], -(destination[1] - point[1])))
        if distance <= remaining:
            char["position"] = dict(zip(("x", "z"), destination))
            char["path"].pop(0)
            remaining -= distance
        else:
            char["position"] = dict(zip(("x", "z"), [a + (b - a) * remaining / distance for a, b in zip(point, destination)]))
            remaining = 0
        char["room"] = room_at([char["position"]["x"], char["position"]["z"]]) or char["room"]
        changed = True
    if char["walking"] and not char["path"]:
        target = char["target"]
        char.update(walking=False, action=target["arrivalAction"], pose=target["arrivalPose"],
                    elevation=target.get("elev", 0), facing=target.get("facing", 0), room=target["room"])
        changed = True
    if changed:
        bump(state, now)
    return changed


def record_motion(state: dict[str, Any], points: list[list[float]], now: float) -> dict[str, Any]:
    char = state["character"]
    previous = char.get("motion") or {}
    history = list(previous.get("history", []))
    if previous.get("id") and previous.get("route"):
        old_route = previous["route"]
        total = sum(math.dist(a, b) for a, b in zip(old_route, old_route[1:]))
        remaining = [[char["position"]["x"], char["position"]["z"]], *char["path"]]
        rest = sum(math.dist(a, b) for a, b in zip(remaining, remaining[1:]))
        history.append({"id": previous["id"], "route": old_route, "endArc": max(0, total - rest)})
    route = []
    for point in points:
        if not route or math.dist(route[-1], point) > 1e-7:
            route.append(list(point))
    state["movementSeq"] = int(state.get("movementSeq", 0)) + 1
    return {"id": f"{int(now * 1000000)}-{state['movementSeq']}", "route": route, "history": history[-2:]}


def travel(state: dict[str, Any], target: dict[str, Any], action: str, source: str, now: float) -> None:
    char = state["character"]
    target = deepcopy(target)
    target["arrivalAction"] = action
    target["arrivalPose"] = "lie" if action == "sleep" else "sit" if action == "sit" else "stand"
    if action == "stand":
        target["elev"] = 0
    point = [char["position"]["x"], char["position"]["z"]]
    previous = char.get("target") or {}
    start_access = previous.get("access", "") if char["pose"] in {"sit", "lie"} or not ground_point_valid(point, LAYOUT["rooms"]) else ""
    if action == "stand" and target.get("pose") in {"sit", "lie"} and not target["id"].startswith("free:"):
        target["pos"] = list(NODES[target["access"]])
        target["pose"] = "stand"
    route = path_to(point, target, start_access)
    motion = record_motion(state, [point, *route], now)
    state["lastTick"] = now
    char.update(target=target, path=route, motion=motion, walking=True, pose="stand", elevation=0,
                action="walk", source=source)
    tick(state, now)


def apply_action(state: dict[str, Any], command: str, target: str = "", *, now: float,
                 source: str = "webui", request_id: str = "", hold_seconds: int = 900) -> tuple[bool, str]:
    command = COMMANDS.get(clean(command).lower(), clean(command).lower())
    if command in {"status", "help"}:
        return False, "状态" if command == "status" else "帮助"
    supported = {"stand", "walk", "sit", "sleep", "wake", "auto", "lamp", "lamp_on", "lamp_off", "pet", "poke", "feed", "water", "play", "mood", "dance", "stretch", "bow"}
    if command not in supported:
        raise ValueError("未知动作：" + clean(command, 24))
    # Validate every field before modifying state, including expiry or processed IDs.
    destination = None
    if command in {"walk", "sit", "sleep"}:
        destination = resolve_target(target, "bed" if command == "sleep" else "sofa")
    if command == "mood" and target not in EXPRESSIONS:
        raise ValueError("房间表情可用：开心 / 困 / 生气 / 低落 / 放松 / 惊讶 / 眨眼 / 惊喜 / 委屈 / 恢复")
    if command == "lamp" and target and target not in {"on", "off", "开", "关", "true", "false"}:
        raise ValueError("灯目标可用 on/off 或留空切换")
    processed = {k: v for k, v in state["processed"].items() if now - v < 86400}
    if request_id and request_id in processed:
        return False, "请求已处理"
    char = state["character"]
    if command in GESTURES and command != "wake":
        if (char.get("gesture") or {}).get("expiresAt", 0) > now * 1000:
            raise ValueError("麦麦正在互动，请等这个动作结束后再试")
        if char["walking"]:
            raise ValueError("麦麦还在走路，请等她到达后再互动")
        if char["pose"] in {"lie", "sleep"} or char["action"] == "sleep":
            raise ValueError("麦麦正在睡觉，先叫醒她再互动")
        if char.get("source") == "garden" and (char.get("gardenWork") or {}).get("phase") in {"queued", "walking", "working"}:
            raise ValueError("麦麦正在照料菜园，等这项工作完成再互动")
    if command in {"stand", "wake"}:
        before = [char["position"]["x"], char["position"]["z"]]
        after = before
        if char["pose"] in {"lie", "sit"} and char["target"]:
            # Step off furniture to the associated access point before standing.
            node = char["target"]["access"]
            after = list(NODES[node])
        motion = record_motion(state, [before, after], now)
        char.update(action="stand", pose="stand", walking=False, path=[], target=None, motion=motion, gesture=None, gardenWork=None, elevation=0,
                    position=dict(zip(("x", "z"), after)), source=source)
    elif destination:
        char["gesture"] = None
        char["gardenWork"] = None
        arrival = "sleep" if command == "sleep" else "sit" if command == "sit" else "stand"
        travel(state, destination, arrival, source, now)
    elif command == "auto":
        state["manualUntil"] = 0
        char["source"] = "room-routine"
    elif command.startswith("lamp"):
        state["room"]["lamp"] = (True if command == "lamp_on" else False if command == "lamp_off"
                                  else target in {"on", "开", "true"} if target else not state["room"]["lamp"])
    elif command == "mood":
        name = EXPRESSIONS[target]
        expression_source = source if source == "tool" or source.startswith("plugin:") else "user"
        char["expression"] = {"name": name, "source": expression_source if name != "neutral" else "default",
                              "expiresAt": int((now + hold_seconds) * 1000) if name != "neutral" else 0}
    if command in GESTURES:
        duration, text = GESTURES[command]
        char["gesture"] = {"name": command, "startedAt": int(now * 1000), "expiresAt": int((now + duration) * 1000),
                           "source": source, "text": text}
    if command in {"stand", "wake", "walk", "sit", "sleep"}:
        state["manualUntil"] = now + hold_seconds
        char["poseUntil"] = int(state["manualUntil"] * 1000)
    counts = state["room"]["counts"]
    counts[command] = counts.get(command, 0) + 1
    state["room"]["events"].append({"at": int(now * 1000), "action": command, "target": clean(target, 80), "source": source})
    state["room"]["events"] = state["room"]["events"][-40:]
    if request_id:
        processed[request_id] = now
    state["processed"] = dict(list(processed.items())[-256:])
    bump(state, now)
    return True, (char["gesture"]["text"] if command in GESTURES else "已恢复自动活动" if command == "auto" else "已执行 " + command)


def activity_destination(life: dict[str, Any], now: float) -> tuple[str, str, str]:
    activity = life.get("activity") or {}
    text = str(activity.get("name", "")) + " " + str(activity.get("goal_type", ""))
    if life.get("available") and activity:
        source = life.get("source", "life-activity")
        if source == "room-routine" or str(source).startswith("plugin:"):
            if activity.get("target"):
                action = activity.get("command", "walk")
                return activity["target"], "stand" if action == "walk" else action, source
            source = source if str(source).startswith("plugin:") else "room-routine"
        else:
            source = "life-activity"
        rules = [(r"sleep|睡|小憩", "bed", "sleep"), (r"洗|浴|刷牙|bath", "bathroom", "stand"),
                 (r"做饭|烹饪|cook", "kitchen", "stand"), (r"吃|早餐|午餐|晚餐|eat|meal", "dining", "sit"),
                 (r"工作|学习|写|读|work|study|read", "desk", "sit"), (r"花|菜园|garden", "garden", "stand"),
                 (r"散步|阳台|walk", "balcony", "stand")]
        for pattern, spot, action in rules:
            if re.search(pattern, text, re.I):
                return spot, action, source
        return "sofa", "sit", source
    hour = datetime.fromtimestamp(now, TZ).hour
    # An explicitly labelled room routine, never reported as a life-plugin fact.
    if hour < 7:
        return "bed", "sleep", "room-routine"
    options = [("balcony", "stand"), ("desk", "sit"), ("sofa", "sit"), ("kitchen", "stand")]
    spot, action = options[int(now // 180) % len(options)]
    return spot, action, "room-routine"


def advance_auto(state: dict[str, Any], life: dict[str, Any], now: float) -> bool:
    if state["manualUntil"] > now:
        return False
    char = state["character"]
    if char.get("gesture") and char["gesture"]["expiresAt"] > now * 1000:
        return False
    spot, action, source = activity_destination(life, now)
    target = resolve_target(spot)
    if char["target"] and char["target"]["id"] == target["id"] and char["target"]["arrivalAction"] == action and char["source"] == source:
        return False
    travel(state, target, action, source, now)
    char["poseUntil"] = 0
    bump(state, now)
    return True


def snapshot(state: dict[str, Any], life: dict[str, Any], name: str, now: float) -> dict[str, Any]:
    char = deepcopy(state["character"])
    if char.get("motion"):
        route = char["motion"]["route"]
        total = sum(math.dist(a, b) for a, b in zip(route, route[1:]))
        remaining = [[char["position"]["x"], char["position"]["z"]], *char["path"]]
        rest = sum(math.dist(a, b) for a, b in zip(remaining, remaining[1:])) if char["walking"] else 0
        char["motion"]["arc"] = max(0, total - rest)
    char["name"] = clean(name, 32)
    if char["expression"]["source"] == "default" and char["action"] == "sleep":
        char["expression"] = {"name": "sleepy", "source": "activity-inference", "expiresAt": 0}
    return {"schemaVersion": 1, "revision": state["revision"], "updatedAt": state["updatedAt"], "serverTime": int(now * 1000),
            "character": char, "life": deepcopy(life), "room": deepcopy(state["room"]),
            "manualUntil": int(state["manualUntil"] * 1000), "timezone": "Asia/Shanghai"}
