# Data format

The private data repo is the entire persistence layer. Everything is plain text:
JSONL for logs (machine-append-friendly), YAML for things a human edits
(exercise library, templates, users).

## Invariants

1. **Native imperial units in files.** Loads in lb, distances in mi, dimensions
   in in, durations in seconds — the units the athlete trains in. No conversion
   happens anywhere; files never mix units.
2. **One JSON line per entry**, monthly files (`2026-07.jsonl`), chronological
   append. Monthly sharding keeps individual files LLM-context-sized.
3. **Append-only in normal operation.** Corrections rewrite the monthly file;
   the git commit (`fix: edit entry <id>`) is the audit trail.
4. Every entry has `id` (12-hex), `ts` (ISO-8601 with UTC offset), optional
   `notes` (freeform — lives with the entry, not in a side channel).

## Entry types (`users/<name>/workouts/YYYY-MM.jsonl`)

```json
{"id":"a1b2c3d4e5f6","ts":"2026-07-04T09:12:31-04:00","type":"session_start","session_id":"9f8e7d6c5b4a","name":"Push Day","routine":"dumbbell_split","day":"Push Day"}
{"id":"...","ts":"...","type":"set","session_id":"9f8e7d6c5b4a","exercise_id":"chest_press_db_incline","weight_lb":100,"reps":12,"rpe":8,"notes":"felt strong"}
{"id":"...","ts":"...","type":"set","session_id":"9f8e7d6c5b4a","exercise_id":"pullup","added_weight_lb":25.0,"reps":6}
{"id":"...","ts":"...","type":"cardio","session_id":"...","activity":"run","duration_s":1860,"distance_mi":3.1,"avg_hr":152}
{"id":"...","ts":"...","type":"session_end","session_id":"9f8e7d6c5b4a"}
```

- **Sets are the atomic record.** Supersets/circuits are simply consecutive
  `set` entries with different `exercise_id`s. No block structure is stored —
  it's recoverable from ordering and timestamps.
- **Rest/exercise time = timestamp deltas.** The API computes `since_prev_s`
  per entry; nothing extra is stored.
- **Bodyweight movements** omit `weight_lb` and use `added_weight_lb`
  (positive = belt/vest, negative = assistance, 0 = strict bodyweight).
  Tonnage uses the latest logged body weight when available.
- `warmup: true` excludes a set from volume/PR analytics.
- **Session lifecycle:** `session_start` opens; `session_end` closes; an open
  session idle for >3h (configurable) gets an `auto_closed` end stamped at its
  last activity.

## Metrics (`users/<name>/metrics/YYYY-MM.jsonl`)

```json
{"id":"...","ts":"...","type":"metric","metric":"weight","value":160.0,"unit":"lb"}
{"id":"...","ts":"...","type":"metric","metric":"bicep_l","value":13.0,"unit":"in"}
```

`metric` names are conventional, not enumerated — new dimensions (or future
wearable-derived metrics like `resting_hr`) are new names, not schema changes.

## Exercise library (`shared/exercises.yaml`)

A mapping of exercise id -> attributes. Canonical ids prevent the "DB Incline
Press" vs "Chest Press, Incline, DB" history-fragmentation problem, and keying
by id makes uniqueness structural. `primary`/`secondary` must come from the
fixed muscle-group taxonomy (see `backend/app/config.py`).

```yaml
chest_press_db_incline:
  name: Chest Press, Incline, DB
  equipment: dumbbell        # barbell | dumbbell | cable | machine | bodyweight
  primary: chest
  secondary: [triceps, shoulders]
  bodyweight: false          # true = load is body weight ± added/assist
  default_rest_s: 120
  notes: Bench at 30°...     # optional form cues, shown on the app's Info tab
```

Set and cardio entries reference an exercise by its id (the `exercise_id`
field); routines reference it too. Those are the map keys here.

## Routines (`shared/routines/*.yaml`)

Routines are **shared** (like the exercise library). Each file is one training
program with a `name` and a list of `days`; each day holds `blocks`. The app
lists the days under the routine heading — you start a session from a day.

```yaml
name: Dumbbell Split
days:
  - name: Push Day
    blocks:
      - type: straight          # sets x one exercise
        exercise: chest_press_db_incline
        sets: 3
        target_reps: 10
      - type: superset          # rounds x [exercises] — circuits are the same with more exercises
        rounds: 3
        exercises: [lateral_raise_db, pullup]
  - name: Lower Day
    blocks:
      - type: straight
        exercise: goblet_squat_db
        sets: 3
```

Routines are plans; logging expands the chosen day into ordinary `set` entries.
Substituting an exercise mid-session edits only that session's plan — the
routine YAML is never rewritten.
