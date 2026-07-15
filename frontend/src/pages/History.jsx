import { useEffect, useState } from 'react'
import { get, patch, del, WEIGHT_UNIT, fmtDuration, exColor } from '../api'
import Confirm from '../components/Confirm'

export default function History({ openSession: deepLink, onOpened, menuBtn }) {
  const [sessions, setSessions] = useState([])
  const [open, setOpen] = useState(null)      // session summary
  const [editing, setEditing] = useState(null) // entry being edited
  const [confirmId, setConfirmId] = useState(null) // entry pending delete
  const [sessEdit, setSessEdit] = useState(null)   // session name/notes being edited
  const [confirmDelSession, setConfirmDelSession] = useState(false)
  const [exercises, setExercises] = useState({})

  const load = () => get('/sessions').then(setSessions)
  useEffect(() => {
    load()
    get('/exercises').then((xs) => setExercises(Object.fromEntries(xs.map((x) => [x.id, x]))))
  }, [])

  // Deep-link from another tab (e.g. tapping a date in the workout view).
  useEffect(() => {
    if (deepLink) { openSession(deepLink); onOpened?.() }
  }, [deepLink])

  async function openSession(sid) {
    setOpen(await get(`/sessions/${sid}`))
  }

  async function saveEdit() {
    const p = { reps: Number(editing.reps) }
    if (editing.weight != null && editing.weight !== '')
      p.weight_lb = Number(editing.weight)
    await patch(`/entries/${editing.id}`, p)
    setEditing(null)
    openSession(open.session_id)
  }

  async function remove(id) {
    await del(`/entries/${id}`)
    setConfirmId(null)
    openSession(open.session_id)
  }

  // Session-level edit: name lives on the session_start entry, notes on the
  // session_end — both patched through the same per-entry endpoint.
  function startSessionEdit(start, end) {
    setSessEdit({ name: start?.name || '', notes: end?.notes || '',
                  startId: start?.id, endId: end?.id })
  }

  async function saveSession(start, end) {
    if (sessEdit.startId && sessEdit.name !== (start?.name || ''))
      await patch(`/entries/${sessEdit.startId}`, { name: sessEdit.name.trim() || null })
    if (sessEdit.endId && sessEdit.notes !== (end?.notes || ''))
      await patch(`/entries/${sessEdit.endId}`, { notes: sessEdit.notes.trim() || null })
    setSessEdit(null)
    openSession(open.session_id)
  }

  async function removeSession() {
    await del(`/sessions/${open.session_id}`)
    setConfirmDelSession(false); setSessEdit(null); setOpen(null); load()
  }

  if (open) {
    const sets = open.entries.filter((e) => e.type === 'set' || e.type === 'cardio')
    const start = open.entries.find((e) => e.type === 'session_start')
    const end = open.entries.find((e) => e.type === 'session_end')
    return (
      <>
        <div className="pagehead">
          {menuBtn}
          <button className="ghost" onClick={() => { setOpen(null); setSessEdit(null); load() }}>← Sessions</button>
        </div>
        <div className="sess-head">
          <div>
            <h1 style={{ margin: 0 }}>{start?.name || 'Workout'}</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {open.entries[0]?.ts?.slice(0, 10)} · {fmtDuration(open.duration_s)} · {open.tonnage_lb} {WEIGHT_UNIT}
            </p>
          </div>
          {!sessEdit && (
            <button className="ghost" aria-label="Edit session"
              onClick={() => startSessionEdit(start, end)}>✎</button>
          )}
        </div>

        {sessEdit ? (
          <div className="card">
            <label>Session name</label>
            <input value={sessEdit.name} placeholder="Workout"
              onChange={(e) => setSessEdit({ ...sessEdit, name: e.target.value })} />
            {sessEdit.endId && (
              <>
                <label>Session notes</label>
                <textarea rows={3} value={sessEdit.notes}
                  onChange={(e) => setSessEdit({ ...sessEdit, notes: e.target.value })} />
              </>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" onClick={() => saveSession(start, end)}>Save</button>
              <button className="ghost" onClick={() => setSessEdit(null)}>Cancel</button>
            </div>
            <button className="big danger" style={{ marginTop: 10 }}
              onClick={() => setConfirmDelSession(true)}>Delete session</button>
          </div>
        ) : (
          end?.notes && <p className="exnotes">{end.notes}</p>
        )}

        <div className="card">
          {sets.map((e) => (
            <div className="entry" key={e.id}>
              <div>
                <div className="main">
                  <span className="exdot" style={{ background: e.type === 'cardio' ? '#7e8894' : exColor(exercises[e.exercise_id]?.primary) }} />
                  {e.type === 'cardio' ? e.activity : (exercises[e.exercise_id]?.name || e.exercise_id)}
                </div>
                <div className="meta">
                  {e.since_prev_s != null && `+${fmtDuration(e.since_prev_s)}`}
                  {e.rpe ? ` · RPE ${e.rpe}` : ''}{e.notes ? ` · ${e.notes}` : ''}
                </div>
              </div>
              {editing?.id === e.id ? (
                <div className="row" style={{ maxWidth: 260 }}>
                  <input inputMode="decimal" value={editing.weight ?? ''} placeholder={WEIGHT_UNIT}
                    onChange={(ev) => setEditing({ ...editing, weight: ev.target.value })} />
                  <input inputMode="numeric" value={editing.reps}
                    onChange={(ev) => setEditing({ ...editing, reps: ev.target.value })} />
                  <button className="primary" onClick={saveEdit}>✓</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="load">
                    {e.type === 'cardio'
                      ? `${e.distance_mi ?? '—'} mi`
                      : `${(e.weight_lb ?? e.added_weight_lb) ?? 'bw'}×${e.reps}`}
                  </div>
                  {e.type === 'set' && (
                    <>
                      <button className="ghost" style={{ minHeight: 40, padding: '0 10px' }}
                        onClick={() => setEditing({ id: e.id, reps: e.reps, weight: e.weight_lb })}>✎</button>
                      <button className="ghost danger" style={{ minHeight: 40, padding: '0 10px' }}
                        onClick={() => setConfirmId(e.id)}>✕</button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <Confirm open={confirmId != null}
          message="Delete this entry? git history keeps the audit trail."
          onConfirm={() => remove(confirmId)} onCancel={() => setConfirmId(null)} />
        <Confirm open={confirmDelSession}
          message="Delete this whole session and all its sets? git history keeps the audit trail."
          onConfirm={removeSession} onCancel={() => setConfirmDelSession(false)} />
      </>
    )
  }

  return (
    <>
      <div className="pagehead">{menuBtn}<h1>History</h1></div>
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
