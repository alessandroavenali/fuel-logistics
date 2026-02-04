#!/usr/bin/env python3
"""
CLI wrapper for the OR-Tools CP-SAT fuel logistics solver.

Usage:
    python main.py < input.json > output.json
    python main.py input.json > output.json
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta
from typing import Dict, List

from solver import solve
from turns import build_turns_for_day


def _parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def build_days(start_date: str, end_date: str, d_t, d_l, include_weekend: bool = True) -> List[Dict]:
    start = _parse_date(start_date)
    end = _parse_date(end_date)
    if end < start:
        raise ValueError("end_date must be on or after start_date")

    days = []
    cur = start
    idx = 0
    while cur <= end:
        day_str = cur.isoformat()
        weekday = cur.weekday()  # Monday=0 ... Sunday=6
        if (not include_weekend) and weekday >= 5:
            cur += timedelta(days=1)
            continue
        if isinstance(d_t, dict):
            d_t_val = int(d_t.get(day_str, 0))
        else:
            d_t_val = int(d_t[idx]) if idx < len(d_t) else 0
        if isinstance(d_l, dict):
            d_l_val = int(d_l.get(day_str, 0))
        else:
            d_l_val = int(d_l[idx]) if idx < len(d_l) else 0
        days.append({"date": day_str, "D_T": d_t_val, "D_L": d_l_val})
        idx += 1
        cur += timedelta(days=1)

    return days


def main() -> int:
    # Read input from file argument or stdin
    if len(sys.argv) >= 2 and sys.argv[1] != '-':
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    include_weekend = bool(data.get("include_weekend", True))
    days = build_days(
        data["start_date"],
        data["end_date"],
        data["D_T"],
        data["D_L"],
        include_weekend=include_weekend,
    )
    data["days"] = days

    result = solve(data)

    output_days = []
    for day in result.days:
        turns = build_turns_for_day(day, shift_minutes=int(data.get("shift_minutes", 720)))
        output_days.append({**day, "turns": turns})

    output = {
        "status": result.status,
        "objective_deliveries": result.objective_deliveries,
        "objective_liters": result.objective_liters,
        "days": output_days,
    }

    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
