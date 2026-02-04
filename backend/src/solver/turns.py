from __future__ import annotations

from typing import Dict, List


def pack_tasks(task_durations: List[int], num_drivers: int, shift_minutes: int) -> List[Dict]:
    """Simple first-fit packing of tasks into driver shifts.

    This is for reporting only, not for optimization.
    """
    drivers = [{"minutes": 0, "tasks": []} for _ in range(num_drivers)]
    for duration in task_durations:
        placed = False
        for d in drivers:
            if d["minutes"] + duration <= shift_minutes:
                d["minutes"] += duration
                d["tasks"].append(duration)
                placed = True
                break
        if not placed:
            # If it doesn't fit, append anyway to highlight overload.
            drivers[0]["minutes"] += duration
            drivers[0]["tasks"].append(duration)
    return drivers


def build_turns_for_day(day: Dict, shift_minutes: int = 720) -> Dict:
    if "drivers_T" in day and "drivers_L" in day:
        tirano_turns = []
        for driver in day["drivers_T"]:
            tasks = []
            for start in driver.get("starts", []):
                if start["task"] == "S":
                    tasks.append(345)
                elif start["task"] == "U":
                    tasks.append(240)
            tirano_turns.append({"minutes": sum(tasks), "tasks": tasks})
        livigno_turns = []
        for driver in day["drivers_L"]:
            tasks = []
            for start in driver.get("starts", []):
                if start["task"] == "V":
                    tasks.append(270)
                elif start["task"] == "A":
                    tasks.append(585)
            livigno_turns.append({"minutes": sum(tasks), "tasks": tasks})
        return {
            "tirano": {"drivers": int(day["D_T"]), "turns": tirano_turns},
            "livigno": {"drivers": int(day["D_L"]), "turns": livigno_turns},
        }

    tirano_tasks = [345] * int(day["S"]) + [240] * int(day["U"])
    livigno_tasks = [270] * int(day["V"]) + [585] * int(day.get("A", 0))

    tirano_drivers = int(day["D_T"])
    livigno_drivers = int(day["D_L"])

    return {
        "tirano": {
            "drivers": tirano_drivers,
            "turns": pack_tasks(tirano_tasks, tirano_drivers, shift_minutes),
        },
        "livigno": {
            "drivers": livigno_drivers,
            "turns": pack_tasks(livigno_tasks, livigno_drivers, shift_minutes),
        },
    }
