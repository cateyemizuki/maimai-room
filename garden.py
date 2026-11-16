"""Garden rules ported from feiyu-room-template garden-state.js (MIT).

Upstream commit 201a4ecad48e7e77cfdd6422fb8f55a77a7b9f5f. Pure operations
return fresh state. Time is trusted server time, expressed in milliseconds.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import json
import math
import os
import time

MINUTE = 60_000
MAX_STOCK = 1_000_000_000
RULES = {"version": 1, "plotCount": 8, "compostCost": 8, "waterDurationFactor": .75,
         "fertilizerGrowth": 1.2, "fertilizerYield": 2}
_ROWS = [
    ("radish", "小萝卜", 2, 2, 2, 3, "root", 0xdb5268),
    ("carrot", "胡萝卜", 4, 3, 3, 3, "root", 0xe98935),
    ("lettuce", "生菜", 3, 2, 2, 4, "leaf", 0x83b84d),
    ("tomato", "番茄", 6, 4, 4, 4, "fruit", 0xd94b35),
    ("cucumber", "黄瓜", 7, 4, 4, 4, "vine", 0x43804b),
    ("eggplant", "茄子", 9, 5, 5, 4, "fruit", 0x714078),
    ("pepper", "甜椒", 8, 5, 5, 4, "fruit", 0xde7840),
    ("pumpkin", "南瓜", 12, 7, 9, 3, "vine", 0xd68c31),
    ("corn", "玉米", 10, 6, 6, 4, "corn", 0xe6bd50),
    ("strawberry", "草莓", 6, 5, 5, 5, "berry", 0xdc4e62),
    ("potato", "土豆", 8, 4, 4, 5, "root", 0xb18a54),
    ("cabbage", "卷心菜", 11, 6, 7, 4, "leaf", 0x8bac66),
]
CROPS = tuple(dict(zip(("id", "name", "growMs", "seedCost", "sellPrice", "yield", "type", "color"),
                      (i, name, minutes * MINUTE, seed, sale, count, kind, color)))
              for i, name, minutes, seed, sale, count, kind, color in _ROWS)
BY_ID = {crop["id"]: crop for crop in CROPS}
PLOT_ACTIONS = {"till", "plant", "water", "fertilize", "harvest"}
ACTIONS = PLOT_ACTIONS | {"buySeed", "sell", "buyCompost"}


def finite(value: Any, fallback: float = 0) -> float:
    return value if type(value) in (int, float) and math.isfinite(value) else fallback


def stock(value: Any, fallback: int = 0) -> int:
    return math.floor(max(0, min(MAX_STOCK, finite(value, fallback))))


def timestamp(value: Any, fallback: int = 0) -> int:
    return math.floor(max(0, min(2**53 - 1, finite(value, fallback))))


def now_ms(now: float | None = None) -> int:
    return timestamp(time.time() * 1000 if now is None else now)


def clean(value: Any, limit: int = 160) -> str:
    return "".join(c for c in value if ord(c) >= 32 and ord(c) != 127)[:limit] if isinstance(value, str) else ""


def empty_plot(index: int) -> dict[str, Any]:
    return {"id": index, "tilled": False, "cropId": None, "progress": 0,
            "moisture": 0, "fertilized": False, "plantedAt": None}


def crop_stocks(raw: Any, fallback: int = 0) -> dict[str, int]:
    return {crop["id"]: stock(raw.get(crop["id"]), fallback) if isinstance(raw, dict) else fallback for crop in CROPS}


def normalize_care(raw: Any = None) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    def action(value):
        if not isinstance(value, dict) or not isinstance(value.get("type"), str) or value.get("type") not in ACTIONS | {"visit"}:
            return None
        out = {"type": value["type"]}
        if type(value.get("plotId")) is int and 0 <= value["plotId"] < 8:
            out["plotId"] = value["plotId"]
        if isinstance(value.get("cropId"), str) and value.get("cropId") in BY_ID:
            out["cropId"] = value["cropId"]
        if type(value.get("quantity")) is int and 1 <= value["quantity"] <= 99:
            out["quantity"] = value["quantity"]
        return out
    def job(value):
        if not isinstance(value, dict) or not clean(value.get("id"), 96) or action(value.get("action")) is None:
            return None
        expected = value.get("expectedPlot")
        return {"id": clean(value["id"], 96), "requestId": clean(value.get("requestId"), 96),
                "action": action(value["action"]), "source": "requested" if value.get("source") == "requested" else "auto",
                "phase": value.get("phase") if value.get("phase") in {"queued", "walking", "working"} else "queued",
                "createdAt": timestamp(value.get("createdAt")), "startedAt": timestamp(value.get("startedAt")),
                "workUntil": timestamp(value.get("workUntil")), "fingerprint": clean(value.get("fingerprint")),
                "expectedPlot": {"cropId": expected.get("cropId") if isinstance(expected.get("cropId"), str) and expected.get("cropId") in BY_ID else None,
                                 "plantedAt": None if expected.get("plantedAt") is None else timestamp(expected.get("plantedAt"))}
                if isinstance(expected, dict) else None}
    pending = raw.get("pendingConflict")
    pending = ({"id": clean(pending.get("id"), 64), "question": clean(pending.get("question"), 260),
                "kind": clean(pending.get("kind"), 32), "createdAt": timestamp(pending.get("createdAt")),
                "deadline": timestamp(pending.get("deadline")), "defaultDecision": "defer"}
               if isinstance(pending, dict) and clean(pending.get("id")) and clean(pending.get("question")) else None)
    receipts = []
    for value in (raw.get("receipts") if isinstance(raw.get("receipts"), list) else [])[-64:]:
        if isinstance(value, dict) and clean(value.get("requestId"), 96):
            receipts.append({"requestId": clean(value["requestId"], 96), "jobId": clean(value.get("jobId"), 96),
                             "fingerprint": clean(value.get("fingerprint")),
                             "status": value.get("status") if value.get("status") in {"queued", "completed", "failed", "cancelled"} else "failed",
                             "message": clean(value.get("message")), "at": timestamp(value.get("at"))})
    recent = [{"id": clean(value.get("id"), 96), "type": clean(value.get("type"), 24), "ok": value.get("ok") is True,
               "message": clean(value.get("message")), "at": timestamp(value.get("at"))}
              for value in (raw.get("recent") if isinstance(raw.get("recent"), list) else [])[-16:]
              if isinstance(value, dict) and clean(value.get("id"), 96)]
    return {"autoEnabled": raw.get("autoEnabled") is not False, "nextId": stock(raw.get("nextId")),
            "rotation": stock(raw.get("rotation")), "nextPlanAt": timestamp(raw.get("nextPlanAt")),
            "forceUntil": timestamp(raw.get("forceUntil")),
            "status": clean(raw.get("status")) or "麦麦会在空闲时照料菜园", "pendingConflict": pending,
            "task": job(raw.get("task")),
            "queue": [value for value in (job(v) for v in (raw.get("queue") if isinstance(raw.get("queue"), list) else [])) if value][:16],
            "receipts": receipts, "recent": recent}


def create_garden(now: float | None = None) -> dict[str, Any]:
    at = now_ms(now)
    plots = [empty_plot(i) for i in range(8)]
    for i, crop, progress, moisture, elapsed in [(0, "radish", 1, .4, 2), (1, "lettuce", .4, .5, 1.2),
                                               (2, "tomato", .7, .5, 4.2), (3, "carrot", .25, .65, 1)]:
        plots[i].update(tilled=True, cropId=crop, progress=progress, moisture=moisture,
                        plantedAt=max(0, int(at - elapsed * MINUTE)))
    return {"version": 1, "updatedAt": at, "coins": 36, "seeds": crop_stocks(None, 3),
            "inventory": crop_stocks(None), "compost": 3, "plots": plots, "care": normalize_care(),
            "stats": {"harvests": 0, "totalYield": 0},
            "log": [{"at": at, "text": "菜园开张了：小萝卜已成熟，生菜、番茄和胡萝卜正在长大；另有四块田等你播种。"}]}


def normalize_garden(raw: Any, now: float | None = None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return create_garden(now)
    at = timestamp(raw.get("updatedAt"), now_ms(now))
    plots = []
    candidates = raw.get("plots") if isinstance(raw.get("plots"), list) else []
    for i in range(8):
        saved = next((p for p in candidates if isinstance(p, dict) and type(p.get("id")) is int and p["id"] == i), {})
        plot = empty_plot(i)
        crop = BY_ID.get(saved.get("cropId")) if isinstance(saved.get("cropId"), str) else None
        if crop:
            plot.update(tilled=True, cropId=crop["id"], progress=max(0, min(1, finite(saved.get("progress")))),
                        moisture=max(0, min(1, finite(saved.get("moisture")))), fertilized=saved.get("fertilized") is True,
                        plantedAt=timestamp(saved.get("plantedAt"), at))
        else:
            plot["tilled"] = saved.get("tilled") is True
        plots.append(plot)
    stats = raw.get("stats") if isinstance(raw.get("stats"), dict) else {}
    return {"version": 1, "updatedAt": at, "coins": stock(raw.get("coins")), "seeds": crop_stocks(raw.get("seeds")),
            "inventory": crop_stocks(raw.get("inventory")), "compost": stock(raw.get("compost")), "plots": plots,
            "care": normalize_care(raw.get("care")),
            "stats": {"harvests": stock(stats.get("harvests")), "totalYield": stock(stats.get("totalYield"))},
            "log": [{"at": timestamp(v.get("at"), at), "text": clean(v["text"])}
                    for v in (raw.get("log") if isinstance(raw.get("log"), list) else [])[-30:]
                    if isinstance(v, dict) and isinstance(v.get("text"), str)]}


def advance_garden(raw: Any, now: float | None = None) -> dict[str, Any]:
    state = normalize_garden(raw, now)
    at = max(now_ms(now), state["updatedAt"])
    elapsed = at - state["updatedAt"]
    for plot in state["plots"]:
        crop = BY_ID.get(plot["cropId"])
        if elapsed <= 0 or not crop or plot["progress"] >= 1 or plot["moisture"] <= 0:
            continue
        rate = RULES["fertilizerGrowth"] if plot["fertilized"] else 1
        duration = crop["growMs"] * RULES["waterDurationFactor"]
        active = min(elapsed, plot["moisture"] * duration, (1 - plot["progress"]) * crop["growMs"] / rate)
        plot["progress"] = min(1, plot["progress"] + active * rate / crop["growMs"])
        plot["moisture"] = max(0, plot["moisture"] - active / duration)
        if plot["progress"] >= 1 - 1e-10:
            plot["progress"] = 1
        if plot["moisture"] < 1e-10:
            plot["moisture"] = 0
    state["updatedAt"] = at
    return state


def apply_garden_action(raw: Any, action: Any, now: float | None = None) -> dict[str, Any]:
    state = advance_garden(raw, now)
    def result(ok, message):
        if ok:
            state["log"] = (state["log"] + [{"at": state["updatedAt"], "text": message}])[-30:]
        return {"state": state, "ok": ok, "message": message}
    fail = lambda message: result(False, message)
    done = lambda message: result(True, message)
    if not isinstance(action, dict) or not isinstance(action.get("type"), str) or action.get("type") not in ACTIONS:
        return fail("没有识别出这个菜园操作。")
    kind = action["type"]
    plot = None
    if kind in PLOT_ACTIONS:
        index = action.get("plotId")
        if type(index) is not int or not 0 <= index < 8:
            return fail("这块田地不存在。")
        plot = state["plots"][index]
    crop_id = action.get("cropId")
    crop = BY_ID.get(crop_id) if isinstance(crop_id, str) else None
    quantity = action.get("quantity", 1)
    if kind in {"buySeed", "sell", "buyCompost"} and (type(quantity) is not int or not 1 <= quantity <= 99):
        return fail("每次数量需要是 1 到 99 的整数。")
    if kind == "till":
        if plot["cropId"]:
            return fail("这里已经种着作物，先等它成熟再收获。")
        if plot["tilled"]:
            return fail("这块田已经松好土，可以直接播种。")
        plot["tilled"] = True
        return done(f"{plot['id'] + 1} 号田已松土，挑一种喜欢的种子吧。")
    if kind == "plant":
        if not crop:
            return fail("这种种子暂时不在种子铺里。")
        if plot["cropId"]:
            return fail("这里已经种着作物，不能重复播种。")
        if not plot["tilled"]:
            return fail("先松土，种子才能住进这块田。")
        if state["seeds"][crop_id] < 1:
            return fail(f"{crop['name']}种子用完了，去种子铺补充一些。")
        state["seeds"][crop_id] -= 1
        plot.update(cropId=crop_id, progress=0, moisture=.8, fertilized=False, plantedAt=state["updatedAt"])
        return done(f"{plot['id'] + 1} 号田种下了{crop['name']}，记得留意土壤水分。")
    if kind == "water":
        if not plot["cropId"]:
            return fail("先播下种子，再给它浇水吧。")
        if plot["progress"] >= 1:
            return fail("作物已经成熟，可以直接收获。")
        if plot["moisture"] >= .98:
            return fail("土壤还很湿润，暂时不用再浇水。")
        plot["moisture"] = 1
        return done(f"给 {plot['id'] + 1} 号田浇好了水，小苗继续生长。")
    if kind == "fertilize":
        if not plot["cropId"]:
            return fail("先种下作物，再给这一茬施肥。")
        if plot["progress"] >= 1:
            return fail("这一茬已经成熟，留着肥料给下一茬吧。")
        if plot["fertilized"]:
            return fail("这一茬已经施过肥了。")
        if not state["compost"]:
            return fail("堆肥用完了，可以到种子铺补充。")
        state["compost"] -= 1
        plot["fertilized"] = True
        return done(f"{plot['id'] + 1} 号田用上了堆肥：生长加快，收获时多得 2 份。")
    if kind == "harvest":
        planted = BY_ID.get(plot["cropId"])
        if not planted:
            return fail("这块田暂时没有可以收获的作物。")
        if plot["progress"] < 1:
            return fail("还没长熟，再照顾它一会儿。")
        count = planted["yield"] + (2 if plot["fertilized"] else 0)
        if state["inventory"][planted["id"]] > MAX_STOCK - count:
            return fail("仓库里这种作物太多了，先卖出一些再收获。")
        state["inventory"][planted["id"]] += count
        state["stats"]["harvests"] = min(MAX_STOCK, state["stats"]["harvests"] + 1)
        state["stats"]["totalYield"] = min(MAX_STOCK, state["stats"]["totalYield"] + count)
        plot.update(empty_plot(plot["id"]), tilled=True)
        return done(f"收获{planted['name']} × {count}，已经放进仓库；这块田可以再播种了。")
    if kind == "buySeed":
        if not crop:
            return fail("种子铺没有这种种子。")
        cost = crop["seedCost"] * quantity
        if state["coins"] < cost:
            return fail("金币不够，可以先卖出仓库里的收成。")
        if state["seeds"][crop_id] > MAX_STOCK - quantity:
            return fail("这种种子已经很多了，先用掉一些吧。")
        state["coins"] -= cost
        state["seeds"][crop_id] += quantity
        return done(f"买到了{crop['name']}种子 × {quantity}，花费 {cost} 金币。")
    if kind == "sell":
        if not crop:
            return fail("仓库里没有这种作物。")
        if state["inventory"][crop_id] < quantity:
            return fail(f"仓库里的{crop['name']}数量不够。")
        income = crop["sellPrice"] * quantity
        if state["coins"] > MAX_STOCK - income:
            return fail("金币存放已满，先到种子铺消费一些吧。")
        state["inventory"][crop_id] -= quantity
        state["coins"] += income
        return done(f"卖出{crop['name']} × {quantity}，收入 {income} 金币。")
    cost = RULES["compostCost"] * quantity
    if state["coins"] < cost:
        return fail("金币不够，堆肥可以下次再买。")
    if state["compost"] > MAX_STOCK - quantity:
        return fail("堆肥存放已满，先给作物施肥吧。")
    state["coins"] -= cost
    state["compost"] += quantity
    return done(f"补充堆肥 × {quantity}，花费 {cost} 金币。")


def garden_view(raw: Any, now: float | None = None) -> dict[str, Any]:
    state = advance_garden(raw, now)
    for plot in state["plots"]:
        crop = BY_ID.get(plot["cropId"])
        mature = bool(crop and plot["progress"] >= 1)
        rate = RULES["fertilizerGrowth"] if plot["fertilized"] else 1
        plot.update(mature=mature, stage=3 if mature else 2 if plot["progress"] >= .45 else 1 if plot["progress"] >= .15 else 0,
                    remainingMs=math.ceil((1 - plot["progress"]) * crop["growMs"] / rate) if crop else 0,
                    waterRemainingMs=math.ceil(plot["moisture"] * crop["growMs"] * .75) if crop and not mature else 0,
                    needsWater=bool(crop and not mature and plot["moisture"] <= 0),
                    expectedYield=crop["yield"] + (2 if plot["fertilized"] else 0) if crop else 0)
    return state


def plan_garden_action(raw: Any, rotation: int = 0, now: float | None = None) -> dict[str, Any] | None:
    garden = advance_garden(raw, now)
    dry = sorted((p for p in garden["plots"] if p["cropId"] and p["progress"] < 1 and p["moisture"] < .25), key=lambda p: p["moisture"])
    if dry:
        return {"type": "water", "plotId": dry[0]["id"]}
    mature = next((p for p in garden["plots"] if p["cropId"] and p["progress"] >= 1), None)
    if mature:
        return {"type": "harvest", "plotId": mature["id"]}
    sale = next((c for c in CROPS if garden["inventory"][c["id"]] > 1 or (garden["coins"] < 2 and garden["inventory"][c["id"]] > 0)), None)
    if sale:
        return {"type": "sell", "cropId": sale["id"], "quantity": min(99, garden["inventory"][sale["id"]] - (0 if garden["coins"] < 2 else 1))}
    order = [CROPS[(rotation + i) % len(CROPS)] for i in range(len(CROPS))]
    planted = {p["cropId"] for p in garden["plots"]}
    empty = next((p for p in garden["plots"] if not p["cropId"]), None)
    if empty:
        if not empty["tilled"]:
            return {"type": "till", "plotId": empty["id"]}
        chosen = next((c for c in order if c["id"] not in planted and garden["seeds"][c["id"]] > 0), None)
        chosen = chosen or next((c for c in order if garden["seeds"][c["id"]] > 0), None)
        if chosen:
            return {"type": "plant", "plotId": empty["id"], "cropId": chosen["id"]}
        buy = next((c for c in order if c["id"] not in planted and c["seedCost"] <= garden["coins"]), None)
        buy = buy or next((c for c in order if c["seedCost"] <= garden["coins"]), None)
        if buy:
            return {"type": "buySeed", "cropId": buy["id"], "quantity": 1}
    feed = next((p for p in garden["plots"] if p["cropId"] and p["progress"] < .75 and not p["fertilized"]), None)
    if feed and garden["compost"] > 0:
        return {"type": "fertilize", "plotId": feed["id"]}
    if feed and garden["compost"] == 0 and garden["coins"] >= 20:
        return {"type": "buyCompost", "quantity": 1}
    missing = next((c for c in order if garden["seeds"][c["id"]] == 0 and garden["coins"] >= c["seedCost"] + 8), None)
    return {"type": "buySeed", "cropId": missing["id"], "quantity": 1} if missing else None


def load_garden(path: Path, now: float | None = None) -> dict[str, Any]:
    if not path.exists():
        return create_garden(now)
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or finite(raw.get("version")) > 1:
        raise ValueError("菜园存档格式或版本不支持；原文件保留")
    return normalize_garden(raw, now)


def save_garden(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    with temporary.open("w", encoding="utf-8") as output:
        json.dump(state, output, ensure_ascii=False, allow_nan=False)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
