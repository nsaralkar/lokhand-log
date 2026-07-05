import { useEffect, useState } from 'react'
import { get, patch, del, toDisplay, fromDisplay, unitLabel, fmtDuration } from '../api'

export default function History({ user }) {
  const units = user.units
  const [sessions, setSessions] = useState([])
  const [open, setOpen] = useState(null)      // session summary
  const [editing, setEditing] = useState(null) // entry being edited
  const [exercises, setExercises] = useState({})

  const load = () => get('/sessions').then(setSessions)
  useEffect(() => {
    load()
    get('/exercises').then((xs) => setExercises(Object.fromEntries(xs.map((x) => [x.id, x]))))
  }, [])

  async function openSession(sid) {
    setOpen(await get(`/sessions/${sid}`))
  }

  async function saveEdit() {
    const p = { reps: Number(editing.reps) }
    if (editing.weight != null && editing.weight !== '')
      p.weight_kg = fromDisplay(Number(editing.weight), units)
    await patch(`/entries/${editing.id}`, p)
    setEditing(null)
    openSession(open.session_id)
  }

  async function remove(id) {
    if (!confirm('Delete this entry? (git history keeps the audit trail)')) return
    await del(`/entries/${id}`)
    openSession(open.session_id)
  }

  if (open) {
    const sets = open.entries.filter((e) => e.type === 'set' || e.type === 'cardio')
    return (
      <>
        <button className="ghost" onClick={() => { setOpen(null); load() }}>← Sessions</button>
        <h1>{open.entries[0]?.ts?.slice(0, 10)}</h1>
        <p className="muted">
          {fmtDuration(open.duration_s)} · {toDisplay(open.tonnage_kg, units)} {unitLabel(units)} total
        </p>
        <div className="card">
          {sets.map((e) => (
            <div className="entry" key={e.id}>
              <div>
                <div className="main">
                  {e.type === 'cardio' ? e.activity : (exercises[e.exercise_id]?.name || e.exercise_id)}
                </div>
                <div className="meta">
                  {e.since_prev_s != null && `+${fmtDuration(e.since_prev_s)}`}
                  {e.rpe ? ` · RPE ${e.rpe}` : ''}{e.notes ? ` · ${e.notes}` : ''}
                </div>
              </div>
              {editing?.id === e.id ? (
                <div className="row" style={{ maxWidth: 260 }}>
                  <input inputMode="decimal" value={editing.weight ?? ''} placeholder={unitLabel(units)}
                    onChange={(ev) => setEditing({ ...editing, weight: ev.target.value })} />
                  <input inputMode="numeric" value={editing.reps}
                    onChange={(ev) => setEditing({ ...editing, reps: ev.target.value })} />
                  <button className="primary" onClick={saveEdit}>✓</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="load">
                    {e.type === 'cardio'
                      ? `${e.distance_km ?? '—'} km`
                      : `${toDisplay(e.weight_kg ?? e.added_weight_kg, units) ?? 'bw'}×${e.reps}`}
                  </div>
                  {e.type === 'set' && (
                    <>
                      <button className="ghost" style={{ minHeight: 40, padding: '0 10px' }}
                        onClick={() => setEditing({ id: e.id, reps: e.reps, weight: toDisplay(e.weight_kg, units) })}>✎</button>
                      <button className="ghost danger" style={{ minHeight: 40, padding: '0 10px' }}
                        onClick={() => remove(e.id)}>✕</button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      <h1>History</h1>
      {sessions.map((s) => (
        <div className="card" key={s.session_id} onClick={() => openSession(s.session_id)}
          style={{ cursor: 'pointer' }}>
          <div className="entry" style={{ borderBottom: 'none', padding: 0 }}>
            <div>
              <div className="main">{s.name || 'Workout'}</div>
              <div className="meta">{s.date}{s.open ? ' · open' : ''}</div>
            </div>
            <div className="load">{s.n_sets} <span className="pill">sets</span></div>
          </div>
        </div>
      ))}
    </>
  )
}
