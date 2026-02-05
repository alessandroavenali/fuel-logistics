# Handoff Notes - Fuel Logistics

## Current Status
- CP-SAT solver integration is active in backend (`optimizer=cpsat` default).
- Core solver is time-indexed (15-minute slots) with:
  - inventory by slot (`FT/ET/Tf/Te`)
  - per-driver no-overlap
  - ADR driving limits (daily/weekly/biweekly)
  - 4h30 -> 45m break enforced via rolling window
  - Livigno entry window (08:00-18:30, configurable)
- Safety hardening added:
  - conversion no longer uses unsafe fallback resource assignment
  - solver->DB conversion must match solver objective liters, otherwise persistence is aborted
  - solver output now includes `refill_starts` with `count`
- Self-check endpoint + frontend button added:
  - backend: `POST /api/schedules/:id/optimizer-self-check`
  - frontend Schedule Detail: `Self-check` button and diagnostics card
- Async job system for long-running solver calls:
  - MAX: `POST /api/schedules/calculate-max/jobs`, `GET /api/schedules/calculate-max/jobs/:jobId`, `POST /api/schedules/calculate-max/jobs/:jobId/stop`
  - Optimize: `POST /api/schedules/:id/optimize/jobs`, `GET /api/schedules/:id/optimize/jobs/:jobId`, `POST /api/schedules/:id/optimize/jobs/:jobId/stop`
  - Progress reports best-so-far liters + solution count; Stop returns best-so-far if available.

## Key Files
- Solver Python:
  - `backend/src/solver/solver.py`
  - `backend/src/solver/main.py`
  - `backend/src/solver/turns.py`
- CP-SAT backend service:
  - `backend/src/services/optimizer-cpsat.service.ts`
- Schedule controllers/routes:
  - `backend/src/controllers/schedules.controller.ts`
  - `backend/src/routes/index.ts`
- Frontend integration:
  - `frontend/src/api/client.ts`
  - `frontend/src/hooks/useSchedules.ts`
  - `frontend/src/pages/ScheduleDetail.tsx`

## Backups Created
- Code archive: `~/dev/demo/backups/fuel-logistics_20260204_174443.tar.gz`
- Git bundle: `~/dev/demo/backups/fuel-logistics_20260204_174443.bundle`
- DB dump: `~/dev/demo/backups/fuel-logistics_db_20260204_174818.dump`

## Constraints Agreed with Stakeholders
- Road constraint: no trailer on Tirano<->Livigno.
- Fleet model: 4 trailers total, 3 tractors at Tirano + 1 dedicated at Livigno.
- Driver model: individual drivers, interchangeable during day, sleep at base.
- Operational windows:
  - day window 06:00-18:00 (default `shift_minutes=720`)
  - Livigno entry only 08:00-18:30 (`livigno_entry_*`)
- ADR strategy:
  - enforce driving rules (not fixed calendar shift limit)

## Known Caveats
- Backend + frontend both compile with `tsc --noEmit`, but full `npm run build` may fail if local `dist/` permissions are locked.
- There are pre-existing unrelated local changes in repo; do not reset blindly.

## How to Run (Typical Local)
1. Backend:
   - `cd backend`
   - `npm run dev`
2. Frontend:
   - `cd frontend`
   - `npm run dev`
3. Health:
   - `GET /health`
4. Core APIs:
   - `POST /api/schedules/calculate-max`
   - `POST /api/schedules/:id/optimize`
   - `POST /api/schedules/:id/optimizer-self-check`
   - `POST /api/schedules/:id/validate`

## Regression Checks to Run First
1. MAX recompute changes with date range (no stale/cached behavior).
2. Optimize then self-check:
   - ensure `persistedLiters == solverObjectiveLiters`
3. ADR validation on generated schedule.

## Recommended Next Steps
1. Add CI check for solver/DB coherence:
   - fail pipeline if `optimizer-self-check` returns mismatch.
2. Add endpoint/report for per-day mismatch diagnostics (trip-level diff).
3. Add golden scenario tests (input + expected liters) for CP-SAT solver.
4. Consider SSE/WebSocket for live progress instead of polling (optional).

## Quick Session Restart Prompt
Use this at the start of next session:

`Project path: ~/dev/runs/fuel-logistics. Read README_HANDOFF.md first, then continue from "Regression Checks to Run First". Prioritize solver/DB coherence and frontend diagnostics.`
