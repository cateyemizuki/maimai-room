"""Floor routes with exact destinations and connections to the current path edge."""
from __future__ import annotations

import heapq
import math
from typing import Any

# Solid wall portions at floor height. Doorways stay open.
WALLS = [
    ("z", 0, 0, 5.77), ("z", 0, 6.76, 7.6),
    ("x", 0, 0, 13.2), ("z", 13.2, 0, 8.2),
    ("z", 8.4, 0, 4.52), ("z", 8.4, 5.49, 7.6),
    ("x", 4.4, 8.4, 8.69), ("x", 4.4, 9.67, 13.2),
    ("x", 5.6, 8.4, 9.11), ("x", 5.6, 10.10, 11.89), ("x", 5.6, 12.81, 13.2),
    ("z", 10.8, 5.6, 8.2),
    ("x", 7.6, 0, 4.68), ("x", 7.6, 7.97, 10.8),
    ("x", 8.2, 10.8, 13.2),
]
OBSTACLES = [
    ("kitchen.fridge", [.17, 2.18, .91, 3.06]),
    ("kitchen.counter", [.31, .06, 3.99, .94]),
    ("kitchen.dining", [1.34, 4.295, 2.86, 5.185]),
    ("living.sofa", [5.235, 4.71, 7.365, 5.55]),
    ("living.shelf", [7.94, 1.065, 8.32, 2.595]),
    ("her_room.bed", [10.52, .265, 12.28, 2.515]),
    ("her_room.desk", [8.59, 2.525, 9.19, 3.755]),
    ("her_room.wardrobe", [11.31, 3.805, 12.81, 4.355]),
    ("laundry.washer", [9.955, 6.30, 10.645, 7.08]),
    ("balcony.chair", [7.3025, 7.94, 7.8975, 8.62]),
]
OBSTACLES += [(f"garden.plot{i}", [2 + (i % 4)*2.7 - 1.025, (-2.2 if i < 4 else -5) - .825,
                                  2 + (i % 4)*2.7 + 1.025, (-2.2 if i < 4 else -5) + .825])
              for i in range(8)]


def _in_rectangle(point: list[float], rect: list[float], margin: float = 0) -> bool:
    x, z = point
    return rect[0] - margin < x < rect[2] + margin and rect[1] - margin < z < rect[3] + margin


def ground_point_valid(point: list[float], rooms: list[dict[str, Any]]) -> bool:
    if not all(math.isfinite(v) for v in point):
        return False
    inside = any(_in_rectangle(point, room["bounds"], .001) for room in rooms)
    inside = inside or _in_rectangle(point, [-.21, 5.77, .21, 6.76])
    wall_contact = any(abs(point[1 if axis == "x" else 0] - fixed) < .075
                       and lo - .025 < point[0 if axis == "x" else 1] < hi + .025
                       for axis, fixed, lo, hi in WALLS)
    return inside and not wall_contact and not any(_in_rectangle(point, rect, .035) for _, rect in OBSTACLES)


def _project(point: list[float], a: list[float], b: list[float]) -> list[float]:
    dx, dz = b[0] - a[0], b[1] - a[1]
    denominator = dx * dx + dz * dz
    t = max(0, min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / denominator)) if denominator else 0
    return [a[0] + t * dx, a[1] + t * dz]


def _segment_clear(a: list[float], b: list[float], rooms: list[dict[str, Any]], allowed: str = "") -> bool:
    for axis, fixed, lo, hi in WALLS:
        perpendicular, along = (1, 0) if axis == "x" else (0, 1)
        change = b[perpendicular] - a[perpendicular]
        if abs(change) < 1e-9:
            continue
        t = (fixed - a[perpendicular]) / change
        cross = a[along] + (b[along] - a[along]) * t
        if 1e-6 < t < 1 - 1e-6 and lo - .025 < cross < hi + .025:
            return False
    steps = max(1, math.ceil(math.dist(a, b) / .06))
    for i in range(steps + 1):
        p = [a[j] + (b[j] - a[j]) * i / steps for j in (0, 1)]
        if not any(_in_rectangle(p, r["bounds"], .001) for r in rooms) and not _in_rectangle(p, [-.21, 5.77, .21, 6.76]):
            return False
        if any(name != allowed and _in_rectangle(p, rect, .035) for name, rect in OBSTACLES):
            return False
    return True


def find_route(point: list[float], target: dict[str, Any], nodes: dict[str, list[float]],
               edges: list[list[str]], rooms: list[dict[str, Any]], start_access: str = "") -> list[list[float]]:
    finish = list(target["pos"])
    free = str(target.get("id", "")).startswith("free:")
    if free and not ground_point_valid(finish, rooms):
        raise ValueError("这里没有可站立的地面，请选择家具之外的位置")
    if free and _segment_clear(point, finish, rooms):
        return [finish] if math.dist(point, finish) > .001 else []
    graph: dict[str, list[tuple[str, float, list[list[float]]]]] = {n: [] for n in nodes}
    graph["__start"] = []
    graph["__finish"] = []
    legal = [(a, b) for a, b in edges if _segment_clear(nodes[a], nodes[b], rooms)]
    for a, b in legal:
        distance = math.dist(nodes[a], nodes[b])
        graph[a].append((b, distance, [list(nodes[b])]))
        graph[b].append((a, distance, [list(nodes[a])]))

    def connections(pos: list[float]) -> list[tuple[str, float, list[list[float]]]]:
        choices = []
        for a, b in legal:
            projected = _project(pos, nodes[a], nodes[b])
            if _segment_clear(pos, projected, rooms):
                choices.append((math.dist(pos, projected), a, b, projected))
        if not choices:
            raise ValueError("这个位置暂时无法接入可行走的小径")
        nearest = min(row[0] for row in choices)
        result = []
        for distance, a, b, projected in choices:
            if distance <= nearest + .001:
                for node in (a, b):
                    result.append((node, distance + math.dist(projected, nodes[node]), [projected, list(nodes[node])]))
        return result

    if start_access in nodes:
        graph["__start"].append((start_access, math.dist(point, nodes[start_access]), [list(nodes[start_access])]))
    else:
        graph["__start"] = connections(point)
    if free:
        for node, distance, connector in connections(finish):
            graph[node].append(("__finish", distance, list(reversed(connector[:-1])) + [finish]))
    else:
        access = target["access"]
        if not _segment_clear(nodes[access], finish, rooms, str(target.get("id", ""))):
            raise ValueError("目的地入口被挡住，无法安全走过去")
        graph[access].append(("__finish", math.dist(nodes[access], finish), [finish]))

    queue: list[tuple[float, str, list[list[float]]]] = [(0, "__start", [])]
    seen = set()
    while queue:
        distance, node, route = heapq.heappop(queue)
        if node in seen:
            continue
        seen.add(node)
        if node == "__finish":
            cleaned = []
            previous = point
            for step in route:
                if math.dist(previous, step) > .001:
                    cleaned.append(list(step))
                    previous = step
            return cleaned
        for following, cost, steps in graph[node]:
            if following not in seen:
                heapq.heappush(queue, (distance + cost, following, route + steps))
    raise ValueError("目的地无法到达，请选择有通路的位置")
