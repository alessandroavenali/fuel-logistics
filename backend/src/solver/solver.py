from __future__ import annotations

from dataclasses import dataclass
from datetime import date as _date
from typing import Dict, List, Tuple

from ortools.sat.python import cp_model


@dataclass
class SolveResult:
    status: str
    objective_deliveries: int
    objective_liters: int
    days: List[Dict]


STATUS_MAP = {
    cp_model.OPTIMAL: "OPTIMAL",
    cp_model.FEASIBLE: "FEASIBLE",
    cp_model.INFEASIBLE: "INFEASIBLE",
    cp_model.MODEL_INVALID: "MODEL_INVALID",
    cp_model.UNKNOWN: "UNKNOWN",
}


def _iso_year_week(date_str: str) -> Tuple[int, int, int]:
    year, month, day = map(int, date_str.split("-"))
    iso = _date(year, month, day).isocalendar()
    return int(iso[0]), int(iso[1]), int(iso[2])


def solve(data: Dict) -> SolveResult:
    days = data["days"]
    n = len(days)
    liters_per_unit = int(data.get("liters_per_unit", 17500))

    shift_minutes = int(data.get("shift_minutes", 720))
    slot_minutes = int(data.get("slot_minutes", 15))
    slots_per_day = shift_minutes // slot_minutes
    livigno_entry_start_minutes = int(data.get("livigno_entry_start_minutes", 120))  # 08:00 if day starts at 06:00
    livigno_entry_end_minutes = int(data.get("livigno_entry_end_minutes", 750))  # 18:30 if day starts at 06:00
    livigno_entry_start_slot = livigno_entry_start_minutes // slot_minutes
    livigno_entry_end_slot = livigno_entry_end_minutes // slot_minutes
    break_window_minutes = int(data.get("break_window_minutes", 315))
    break_drive_cap_minutes = int(data.get("break_drive_cap_minutes", 270))
    break_window_slots = break_window_minutes // slot_minutes
    break_drive_cap_slots = break_drive_cap_minutes // slot_minutes

    max_resident_trips = int(data.get("max_resident_trips", 2))
    max_adr_trips = int(data.get("max_adr_trips", 1))
    adr_weekly_cap = int(data.get("adr_weekly_cap", 2))

    drive_minutes_daily = int(data.get("drive_minutes_daily", 540))
    drive_minutes_extended = int(data.get("drive_minutes_extended", 600))
    max_extended_days_per_week = int(data.get("max_extended_days_per_week", 2))
    weekly_drive_limit_minutes = int(data.get("weekly_drive_limit_minutes", 3360))
    biweekly_drive_limit_minutes = int(data.get("biweekly_drive_limit_minutes", 5400))

    drivers_T_base = int(data.get("drivers_T_base", 4))
    drivers_L_base = int(data.get("drivers_L_base", 1))

    init = data["initial_state"]
    init_FT = int(init["FT"])
    init_ET = int(init["ET"])
    init_Tf = int(init["Tf"])
    init_Te = int(init["Te"])

    total_trailers = int(data.get("total_trailers", init_FT + init_ET))
    total_tractors = int(data.get("total_tractors", init_Tf + init_Te))

    # Durations in slots.
    supply_slots = 345 // slot_minutes  # 23
    shuttle_slots = 240 // slot_minutes  # 16
    resident_slots = 270 // slot_minutes  # 18
    adr_slots = 585 // slot_minutes  # 39
    refill_slots = 30 // slot_minutes  # 2

    # Offsets (in slots) for inventory effects.
    supply_end_offset = supply_slots
    shuttle_end_offset = shuttle_slots
    refill_end_offset = refill_slots

    resident_refill_start_offset = 90 // slot_minutes  # 6
    resident_refill_end_offset = (90 + 30) // slot_minutes  # 8

    adr_refill_start_offset = 90 // slot_minutes  # 6 (attach ET at Tirano)
    adr_supply_end_offset = adr_refill_start_offset + supply_end_offset  # 29

    # Driving profiles inside tasks (slot offsets where the driver is actually driving).
    supply_drive_offsets = set(list(range(0, 10)) + list(range(13, 23)))
    shuttle_drive_offsets = set(list(range(0, 8)) + list(range(10, 16)))
    resident_drive_offsets = set(list(range(0, 6)) + list(range(8, 16)))
    adr_drive_offsets = set(list(range(0, 16)) + list(range(19, 37)))

    # Livigno-entry offsets from task start (in slots).
    shuttle_livigno_entry_offset = 120 // slot_minutes
    resident_livigno_entry_offset = 240 // slot_minutes
    adr_livigno_entry_offset = 555 // slot_minutes

    model = cp_model.CpModel()

    # Inventory per day and slot (start of slot).
    FT = []
    ET = []
    Tf = []
    Te = []

    # Start variables per driver and slot.
    S_start = []  # [d][i][t]
    U_start = []  # [d][i][t]
    V_start = []  # [d][j][t]
    A_start = []  # [d][j][t]
    R_start = []  # [d][t]

    for d in range(n):
        # Inventory arrays for day d.
        FT_d = [model.new_int_var(0, total_trailers, f"FT_{d}_{t}") for t in range(slots_per_day + 1)]
        ET_d = [model.new_int_var(0, total_trailers, f"ET_{d}_{t}") for t in range(slots_per_day + 1)]
        Tf_d = [model.new_int_var(0, total_tractors, f"Tf_{d}_{t}") for t in range(slots_per_day + 1)]
        Te_d = [model.new_int_var(0, total_tractors, f"Te_{d}_{t}") for t in range(slots_per_day + 1)]

        FT.append(FT_d)
        ET.append(ET_d)
        Tf.append(Tf_d)
        Te.append(Te_d)

        # Refill starts (Tirano, no driver required).
        R_start.append([model.new_int_var(0, total_trailers, f"R_{d}_{t}") for t in range(slots_per_day)])

        # Tirano drivers.
        S_day: List[List[cp_model.IntVar]] = []
        U_day: List[List[cp_model.IntVar]] = []
        for i in range(drivers_T_base):
            available = 1 if i < int(days[d]["D_T"]) else 0
            s_i = []
            u_i = []
            for t in range(slots_per_day):
                if available and t + supply_slots <= slots_per_day:
                    s_i.append(model.new_bool_var(f"S_{d}_T{i}_{t}"))
                else:
                    s_i.append(model.new_constant(0))
                if available and t + shuttle_slots <= slots_per_day:
                    entry_slot = t + shuttle_livigno_entry_offset
                    if livigno_entry_start_slot <= entry_slot <= livigno_entry_end_slot:
                        u_i.append(model.new_bool_var(f"U_{d}_T{i}_{t}"))
                    else:
                        u_i.append(model.new_constant(0))
                else:
                    u_i.append(model.new_constant(0))
            S_day.append(s_i)
            U_day.append(u_i)

            # No-overlap per driver (Tirano).
            for t in range(slots_per_day):
                cover = []
                for t0 in range(max(0, t - supply_slots + 1), min(t + 1, slots_per_day)):
                    if t0 + supply_slots <= slots_per_day:
                        cover.append(s_i[t0])
                for t0 in range(max(0, t - shuttle_slots + 1), min(t + 1, slots_per_day)):
                    if t0 + shuttle_slots <= slots_per_day:
                        cover.append(u_i[t0])
                model.add(sum(cover) <= 1)

            # Daily driving limits per driver (Tirano).
            drive_day = model.new_int_var(0, drive_minutes_extended, f"drive_T_{d}_T{i}")
            ext = model.new_bool_var(f"ext_T_{d}_T{i}") if available else model.new_constant(0)
            model.add(
                drive_day
                == sum(s_i[t] * 300 + u_i[t] * 210 for t in range(slots_per_day))
            )
            model.add(drive_day <= drive_minutes_daily + ext * (drive_minutes_extended - drive_minutes_daily))

            # 4h30 driving -> 45m break: in any 315m window, max 270m driving.
            drive_slots = []
            for t in range(slots_per_day):
                contributors = []
                for t0 in range(max(0, t - supply_slots + 1), min(t + 1, slots_per_day)):
                    if t0 + supply_slots <= slots_per_day and (t - t0) in supply_drive_offsets:
                        contributors.append(s_i[t0])
                for t0 in range(max(0, t - shuttle_slots + 1), min(t + 1, slots_per_day)):
                    if t0 + shuttle_slots <= slots_per_day and (t - t0) in shuttle_drive_offsets:
                        contributors.append(u_i[t0])
                drv_t = model.new_bool_var(f"drv_T_{d}_T{i}_{t}")
                model.add(drv_t == sum(contributors))
                drive_slots.append(drv_t)

            if break_window_slots <= slots_per_day:
                for t0 in range(slots_per_day - break_window_slots + 1):
                    model.add(sum(drive_slots[t0 : t0 + break_window_slots]) <= break_drive_cap_slots)

        S_start.append(S_day)
        U_start.append(U_day)

        # Livigno drivers.
        V_day: List[List[cp_model.IntVar]] = []
        A_day: List[List[cp_model.IntVar]] = []
        for j in range(drivers_L_base):
            available = 1 if j < int(days[d]["D_L"]) else 0
            v_j = []
            a_j = []
            for t in range(slots_per_day):
                if available and t + resident_slots <= slots_per_day:
                    entry_slot = t + resident_livigno_entry_offset
                    if livigno_entry_start_slot <= entry_slot <= livigno_entry_end_slot:
                        v_j.append(model.new_bool_var(f"V_{d}_L{j}_{t}"))
                    else:
                        v_j.append(model.new_constant(0))
                else:
                    v_j.append(model.new_constant(0))
                if available and t + adr_slots <= slots_per_day:
                    entry_slot = t + adr_livigno_entry_offset
                    if livigno_entry_start_slot <= entry_slot <= livigno_entry_end_slot:
                        a_j.append(model.new_bool_var(f"A_{d}_L{j}_{t}"))
                    else:
                        a_j.append(model.new_constant(0))
                else:
                    a_j.append(model.new_constant(0))
            V_day.append(v_j)
            A_day.append(a_j)

            # No-overlap per driver (Livigno).
            for t in range(slots_per_day):
                cover = []
                for t0 in range(max(0, t - resident_slots + 1), min(t + 1, slots_per_day)):
                    if t0 + resident_slots <= slots_per_day:
                        cover.append(v_j[t0])
                for t0 in range(max(0, t - adr_slots + 1), min(t + 1, slots_per_day)):
                    if t0 + adr_slots <= slots_per_day:
                        cover.append(a_j[t0])
                model.add(sum(cover) <= 1)

            # Daily driving limits per driver (Livigno).
            drive_day = model.new_int_var(0, drive_minutes_extended, f"drive_L_{d}_L{j}")
            ext = model.new_bool_var(f"ext_L_{d}_L{j}") if available else model.new_constant(0)
            model.add(
                drive_day
                == sum(v_j[t] * 210 + a_j[t] * 510 for t in range(slots_per_day))
            )
            model.add(drive_day <= drive_minutes_daily + ext * (drive_minutes_extended - drive_minutes_daily))

            # 4h30 driving -> 45m break: in any 315m window, max 270m driving.
            drive_slots = []
            for t in range(slots_per_day):
                contributors = []
                for t0 in range(max(0, t - resident_slots + 1), min(t + 1, slots_per_day)):
                    if t0 + resident_slots <= slots_per_day and (t - t0) in resident_drive_offsets:
                        contributors.append(v_j[t0])
                for t0 in range(max(0, t - adr_slots + 1), min(t + 1, slots_per_day)):
                    if t0 + adr_slots <= slots_per_day and (t - t0) in adr_drive_offsets:
                        contributors.append(a_j[t0])
                drv_t = model.new_bool_var(f"drv_L_{d}_L{j}_{t}")
                model.add(drv_t == sum(contributors))
                drive_slots.append(drv_t)

            if break_window_slots <= slots_per_day:
                for t0 in range(slots_per_day - break_window_slots + 1):
                    model.add(sum(drive_slots[t0 : t0 + break_window_slots]) <= break_drive_cap_slots)

            # Max trips per day (if configured).
            if max_resident_trips >= 0:
                model.add(sum(v_j[t] for t in range(slots_per_day)) <= max_resident_trips)
            if max_adr_trips >= 0:
                model.add(sum(a_j[t] for t in range(slots_per_day)) <= max_adr_trips)

        V_start.append(V_day)
        A_start.append(A_day)

    # Inventory initialization and transitions.
    for d in range(n):
        if d == 0:
            model.add(FT[d][0] == init_FT)
            model.add(ET[d][0] == init_ET)
            model.add(Tf[d][0] == init_Tf)
            model.add(Te[d][0] == init_Te)
        else:
            model.add(FT[d][0] == FT[d - 1][slots_per_day])
            model.add(ET[d][0] == ET[d - 1][slots_per_day])
            model.add(Tf[d][0] == Tf[d - 1][slots_per_day])
            model.add(Te[d][0] == Te[d - 1][slots_per_day])

        for t in range(slots_per_day):
            # Aggregate starts for this slot.
            supply_start = sum(S_start[d][i][t] for i in range(drivers_T_base))
            shuttle_start = sum(U_start[d][i][t] for i in range(drivers_T_base))
            resident_start = sum(V_start[d][j][t] for j in range(drivers_L_base))
            adr_start = sum(A_start[d][j][t] for j in range(drivers_L_base))
            refill_start = R_start[d][t]

            supply_end = 0
            if t - supply_end_offset >= 0:
                supply_end = sum(S_start[d][i][t - supply_end_offset] for i in range(drivers_T_base))

            shuttle_end = 0
            if t - shuttle_end_offset >= 0:
                shuttle_end = sum(U_start[d][i][t - shuttle_end_offset] for i in range(drivers_T_base))

            refill_end = 0
            if t - refill_end_offset >= 0:
                refill_end = R_start[d][t - refill_end_offset]

            resident_refill_start = 0
            if t - resident_refill_start_offset >= 0:
                resident_refill_start = sum(V_start[d][j][t - resident_refill_start_offset] for j in range(drivers_L_base))

            resident_refill_end = 0
            if t - resident_refill_end_offset >= 0:
                resident_refill_end = sum(V_start[d][j][t - resident_refill_end_offset] for j in range(drivers_L_base))

            adr_refill_start = 0
            if t - adr_refill_start_offset >= 0:
                adr_refill_start = sum(A_start[d][j][t - adr_refill_start_offset] for j in range(drivers_L_base))

            adr_supply_end = 0
            if t - adr_supply_end_offset >= 0:
                adr_supply_end = sum(A_start[d][j][t - adr_supply_end_offset] for j in range(drivers_L_base))

            # Resource availability at slot start.
            model.add(supply_start <= ET[d][t])
            model.add(supply_start + refill_start <= Te[d][t])
            model.add(shuttle_start <= Tf[d][t])
            model.add(refill_start <= FT[d][t])

            # Inventory transitions.
            model.add(
                FT[d][t + 1]
                == FT[d][t] + supply_end + adr_supply_end - refill_start - resident_refill_start
            )
            model.add(
                ET[d][t + 1]
                == ET[d][t] - supply_start + refill_end + resident_refill_end - adr_refill_start
            )
            model.add(
                Tf[d][t + 1]
                == Tf[d][t] + supply_end + refill_end - shuttle_start
            )
            model.add(
                Te[d][t + 1]
                == Te[d][t] - supply_start - refill_start + shuttle_end
            )

            # Assets can be in transit, so on-site totals are upper-bounded.
            model.add(FT[d][t + 1] + ET[d][t + 1] <= total_trailers)
            model.add(Tf[d][t + 1] + Te[d][t + 1] <= total_tractors)

    # Weekly and biweekly limits per driver + ADR cap.
    weeks: Dict[Tuple[int, int], List[int]] = {}
    for d, day in enumerate(days):
        year, week, _ = _iso_year_week(day["date"])
        weeks.setdefault((year, week), []).append(d)

    if adr_weekly_cap >= 0:
        for j in range(drivers_L_base):
            for (year, week), idxs in weeks.items():
                model.add(
                    sum(sum(A_start[d][j][t] for t in range(slots_per_day)) for d in idxs)
                    <= adr_weekly_cap
                )

    if max_extended_days_per_week >= 0:
        # Approximate: count any day with > drive_minutes_daily as extension.
        for i in range(drivers_T_base):
            for (year, week), idxs in weeks.items():
                ext_days = []
                for d in idxs:
                    drive_day = model.new_int_var(0, drive_minutes_extended, f"drive_T_week_{d}_T{i}")
                    model.add(
                        drive_day
                        == sum(S_start[d][i][t] * 300 + U_start[d][i][t] * 210 for t in range(slots_per_day))
                    )
                    ext = model.new_bool_var(f"ext_flag_T_{d}_T{i}")
                    model.add(drive_day > drive_minutes_daily).only_enforce_if(ext)
                    model.add(drive_day <= drive_minutes_daily).only_enforce_if(ext.Not())
                    ext_days.append(ext)
                model.add(sum(ext_days) <= max_extended_days_per_week)
        for j in range(drivers_L_base):
            for (year, week), idxs in weeks.items():
                ext_days = []
                for d in idxs:
                    drive_day = model.new_int_var(0, drive_minutes_extended, f"drive_L_week_{d}_L{j}")
                    model.add(
                        drive_day
                        == sum(V_start[d][j][t] * 210 + A_start[d][j][t] * 510 for t in range(slots_per_day))
                    )
                    ext = model.new_bool_var(f"ext_flag_L_{d}_L{j}")
                    model.add(drive_day > drive_minutes_daily).only_enforce_if(ext)
                    model.add(drive_day <= drive_minutes_daily).only_enforce_if(ext.Not())
                    ext_days.append(ext)
                model.add(sum(ext_days) <= max_extended_days_per_week)

    if weekly_drive_limit_minutes >= 0:
        for i in range(drivers_T_base):
            for (year, week), idxs in weeks.items():
                model.add(
                    sum(
                        sum(S_start[d][i][t] * 300 + U_start[d][i][t] * 210 for t in range(slots_per_day))
                        for d in idxs
                    )
                    <= weekly_drive_limit_minutes
                )
        for j in range(drivers_L_base):
            for (year, week), idxs in weeks.items():
                model.add(
                    sum(
                        sum(V_start[d][j][t] * 210 + A_start[d][j][t] * 510 for t in range(slots_per_day))
                        for d in idxs
                    )
                    <= weekly_drive_limit_minutes
                )

    if biweekly_drive_limit_minutes >= 0 and len(weeks) > 1:
        week_keys = sorted(weeks.keys())
        for i in range(drivers_T_base):
            for k in range(len(week_keys) - 1):
                idxs = weeks[week_keys[k]] + weeks[week_keys[k + 1]]
                model.add(
                    sum(
                        sum(S_start[d][i][t] * 300 + U_start[d][i][t] * 210 for t in range(slots_per_day))
                        for d in idxs
                    )
                    <= biweekly_drive_limit_minutes
                )
        for j in range(drivers_L_base):
            for k in range(len(week_keys) - 1):
                idxs = weeks[week_keys[k]] + weeks[week_keys[k + 1]]
                model.add(
                    sum(
                        sum(V_start[d][j][t] * 210 + A_start[d][j][t] * 510 for t in range(slots_per_day))
                        for d in idxs
                    )
                    <= biweekly_drive_limit_minutes
                )

    # Objective: maximize deliveries.
    total_deliveries = model.new_int_var(0, n * slots_per_day, "total_deliveries")
    model.add(
        total_deliveries
        == sum(
            sum(U_start[d][i][t] for i in range(drivers_T_base) for t in range(slots_per_day))
            + sum(V_start[d][j][t] for j in range(drivers_L_base) for t in range(slots_per_day))
            + sum(A_start[d][j][t] for j in range(drivers_L_base) for t in range(slots_per_day))
            for d in range(n)
        )
    )
    model.maximize(total_deliveries)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(data.get("time_limit_seconds", 10))
    solver.parameters.num_search_workers = int(data.get("num_search_workers", 8))

    status_code = solver.solve(model)
    status = STATUS_MAP.get(status_code, "UNKNOWN")

    days_out: List[Dict] = []
    for d in range(n):
        s_count = sum(int(solver.value(S_start[d][i][t])) for i in range(drivers_T_base) for t in range(slots_per_day))
        u_count = sum(int(solver.value(U_start[d][i][t])) for i in range(drivers_T_base) for t in range(slots_per_day))
        v_count = sum(int(solver.value(V_start[d][j][t])) for j in range(drivers_L_base) for t in range(slots_per_day))
        a_count = sum(int(solver.value(A_start[d][j][t])) for j in range(drivers_L_base) for t in range(slots_per_day))
        r_count = sum(int(solver.value(R_start[d][t])) for t in range(slots_per_day))

        drivers_T = []
        for i in range(drivers_T_base):
            starts = []
            for t in range(slots_per_day):
                if int(solver.value(S_start[d][i][t])):
                    starts.append({"task": "S", "slot": t})
                if int(solver.value(U_start[d][i][t])):
                    starts.append({"task": "U", "slot": t})
            drivers_T.append({"starts": starts})

        drivers_L = []
        for j in range(drivers_L_base):
            starts = []
            for t in range(slots_per_day):
                if int(solver.value(V_start[d][j][t])):
                    starts.append({"task": "V", "slot": t})
                if int(solver.value(A_start[d][j][t])):
                    starts.append({"task": "A", "slot": t})
            drivers_L.append({"starts": starts})

        days_out.append(
            {
                "date": days[d]["date"],
                "D_T": int(days[d]["D_T"]),
                "D_L": int(days[d]["D_L"]),
                "S": s_count,
                "U": u_count,
                "V": v_count,
                "A": a_count,
                "R": r_count,
                "drivers_T": drivers_T,
                "drivers_L": drivers_L,
                "FT_start": int(solver.value(FT[d][0])),
                "ET_start": int(solver.value(ET[d][0])),
                "Tf_start": int(solver.value(Tf[d][0])),
                "Te_start": int(solver.value(Te[d][0])),
                "FT_end": int(solver.value(FT[d][slots_per_day])),
                "ET_end": int(solver.value(ET[d][slots_per_day])),
                "Tf_end": int(solver.value(Tf[d][slots_per_day])),
                "Te_end": int(solver.value(Te[d][slots_per_day])),
            }
        )

    total_deliveries_val = int(solver.value(total_deliveries)) if status in {"OPTIMAL", "FEASIBLE"} else 0
    total_liters = total_deliveries_val * liters_per_unit

    return SolveResult(
        status=status,
        objective_deliveries=total_deliveries_val,
        objective_liters=total_liters,
        days=days_out,
    )
