import { useState } from 'react'

// Structured add-exercise form (name / primary muscle / rest / tracked-by /
// equipment), posting to the structured POST /exercises. Stashed: not wired
// into any page right now (Library's Add Exercise is YAML-based instead) --
// kept here in case a non-YAML add flow is wanted again later.
const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'core', 'cardio']

export default function AddExerciseForm({ onSubmit }) {
  const [f, setF] = useState({
    name: '', primary: 'chest', metric: 'reps', equipment: '', default_rest_s: 120 })
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))
  return (
    <div className="card" style={{ background: 'var(--surface-2)', marginTop: 8 }}>
      <label>Name</label>
      <input value={f.name} onChange={(e) => set('name', e.target.value)}
        placeholder="Chest Press, Incline, DB" />
      <div className="row">
        <div>
          <label>Primary muscle</label>
          <select value={f.primary} onChange={(e) => set('primary', e.target.value)}>
            {MUSCLE_GROUPS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label>Rest (s)</label>
          <input inputMode="numeric" value={f.default_rest_s}
            onChange={(e) => set('default_rest_s', e.target.value)} />
        </div>
      </div>
      <label>Tracked by</label>
      <select value={f.metric} onChange={(e) => set('metric', e.target.value)}>
        <option value="reps">Reps</option>
        <option value="duration">Duration (e.g. planks, holds)</option>
        <option value="distance">Distance (e.g. carries, runs)</option>
        <option value="duration+distance">Duration + distance (e.g. Peloton, runs w/ pace)</option>
      </select>
      <label>Equipment (optional)</label>
      <input value={f.equipment} onChange={(e) => set('equipment', e.target.value)}
        placeholder="dumbbell / barbell / cable / machine" />
      <button className="big primary" style={{ marginTop: 10 }}
        disabled={!f.name.trim()} onClick={() => onSubmit(f)}>Add exercise</button>
    </div>
  )
}
