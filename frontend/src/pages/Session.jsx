import { useEffect, useMemo, useRef, useState } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'
import { get, post, patch, del, WEIGHT_UNIT } from '../api'
import { unlockAudio, beep } from '../audio'
import Confirm from '../components/Confirm'

const RPE = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]
// Fixed taxonomy — mirrors backend config.MUSCLE_GROUPS (used by the add form).
const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'core']
// Active workout is persisted here so switching tabs (which unmounts this page)
// and coming back resumes exactly where you left off.
const RESUME_KEY = 'ironlog.active'
const axis = { stroke: '#8a94a2', fontSize: 12 }
const tip = { contentStyle: { background: '#262c36', border: '1px solid #3d4653', borderRadius: 8, color: '#edeff2' } }

export default function Session({ user, navigate, menuBtn }) {
  const [exercises, setExercises] = useState([])
  const [exErr, setExErr] = useState('')
  const [routines, setRoutines] = useState({})
  const [session, setSession] = useState(null) // {session_id, plan, planIdx}
  const [exText, setExText] = useState('')     // exercise picker text (name)
  const [weight, setWeight] = useState(null)   // pounds
  const [reps, setReps] = useState(10)
  const [rpe, setRpe] = useState(null)
  const [notes, setNotes] = useState('')
  const [timer, setTimer] = useState(null)     // {target, startedAt}
  const [now, setNow] = useState(0)            // ticks while the rest timer runs
  const [prog, setProg] = useState([])         // full progression for current exercise
  const [exTab, setExTab] = useState('exercise') // 'exercise' | 'history' | 'trend' | 'info'
  const [logged, setLogged] = useState([])
  const [editId, setEditId] = useState(null)   // logged set being edited
  const [editVal, setEditVal] = useState({ weight: '', reps: '' })
  const [adding, setAdding] = useState(false)  // add-exercise form open
  const [confirmId, setConfirmId] = useState(null) // set pending delete
  const [planOpen, setPlanOpen] = useState(false)  // Up-next expanded vs. next-only
  const [swapIdx, setSwapIdx] = useState(null)     // plan index being re-assigned
  const [err, setErr] = useState('')
  const wakeLock = useRef(null)
  const hydrated = useRef(false)
  const beeped = useRef(false)
  const autoPop = useRef(true)   // gate last-set autofill to genuine exercise switches (off on resume)

  const loadExercises = () =>
    get('/exercises').then((xs) => { setExercises(xs); setExErr('') })
      .catch((e) => setExErr(e.message))

  useEffect(() => {
    loadExercises()
    get('/routines').then(setRoutines)
  }, [])

  const nameOf = (id) => exercises.find((e) => e.id === id)?.name || id

  // Resume a workout left running when we last unmounted (tab switch / reload).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null')
      if (saved?.session) {
        setSession(saved.session)
        setLogged(saved.logged || [])
        setExText(saved.exText || '')
        setWeight(saved.weight ?? null)
        setReps(saved.reps ?? 10)
        autoPop.current = false  // don't clobber the restored entry with last-set values
      }
    } catch { /* corrupt/absent resume state — start fresh */ }
    hydrated.current = true
  }, [])

  // Persist active-workout state so it survives an unmount. `weight`/`reps` are
  // kept too — the previous set stays in the entry area, so a repeat is one tap.
  // `session` carries the plan, so on-the-fly Up-next swaps survive too.
  useEffect(() => {
    if (!hydrated.current) return
    if (session) {
      localStorage.setItem(RESUME_KEY, JSON.stringify({
        session, logged, exText, weight, reps }))
    } else {
      localStorage.removeItem(RESUME_KEY)
    }
  }, [session, logged, exText, weight, reps])

  // The picker stores/searches by name; the canonical id is derived from it.
  const exercise = useMemo(
    () => exercises.find((e) => e.name === exText),
    [exercises, exText])
  const exerciseId = exercise?.id || ''
  const isBw = exercise?.bodyweight

  // Progression for the selected exercise — feeds the History/Trend subtabs and
  // prefills the entry with the last set's values when you switch exercises.
  // We populate the last set verbatim (never auto-increment the weight).
  useEffect(() => {
    setProg([])
    if (!exerciseId) return
    get(`/analytics/exercises/${exerciseId}/progression`)
      .then((p) => {
        setProg(p.sessions)
        const last = p.sessions.at(-1)?.sets.at(-1)
        if (autoPop.current && last) {
          if (!isBw) setWeight(last.load_lb)  // load_lb == weight for non-bw
          setReps(last.reps)
        }
        autoPop.current = true
      })
      .catch(() => {})
  }, [exerciseId])

  const history = useMemo(() => prog.slice(-3).reverse(), [prog])
  const trend = useMemo(
    () => prog.map((s) => ({ date: s.date, e1rm: s.e1rm_lb })),
    [prog])

  // Keep the screen awake mid-session so the rest timer stays visible.
  useEffect(() => {
    if (session && 'wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then((l) => (wakeLock.current = l)).catch(() => {})
    }
    return () => wakeLock.current?.release?.()
  }, [session])

  // Rest countdown lives in the Log-set button's place; tick while it runs.
  useEffect(() => {
    if (!timer) return
    beeped.current = false
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [timer])

  async function start(routine, day) {
    const r = await post('/sessions/start', { routine, day })
    setSession({ session_id: r.session_id, plan: r.plan, planIdx: 0 })
    setLogged([]); setExTab('exercise'); setPlanOpen(false); setSwapIdx(null)
    if (r.plan?.length) setExText(nameOf(r.plan[0].exercise_id))
  }

  async function addExercise(form) {
    setErr('')
    try {
      const created = await post('/exercises', {
        name: form.name.trim(),
        primary: form.primary,
        equipment: form.equipment || undefined,
        bodyweight: form.bodyweight,
        default_rest_s: Number(form.default_rest_s) || 120,
      })
      await loadExercises()
      setExText(created.name)
      setAdding(false)
    } catch (e) { setErr(e.message) }
  }

  async function logSet() {
    setErr('')
    unlockAudio()  // user gesture — lets the rest timer beep at zero
    try {
      const body = {
        session_id: session.session_id, exercise_id: exerciseId, reps,
        rpe: rpe || undefined, notes: notes || undefined,
      }
      if (isBw) body.added_weight_lb = weight ?? 0
      else body.weight_lb = weight
      const r = await post('/sets', body)
      setLogged((l) => [{ ...body, id: r.id, name: exercise?.name, bodyweight: isBw }, ...l])
      setTimer({ target: r.rest_s, startedAt: Date.now() })
      setRpe(null); setNotes('')
      if (session.plan) {
        const next = session.planIdx + 1
        setSession({ ...session, planIdx: next })
        const nx = session.plan[next]
        if (nx && nx.exercise_id !== exerciseId) setExText(nameOf(nx.exercise_id))
      }
    } catch (e) { setErr(e.message) }
  }

  // Substitute a different exercise into an upcoming planned set. This edits the
  // in-session plan only (state + resume storage) — the routine YAML is untouched.
  function applySwap(idx, name) {
    const ex = exercises.find((e) => e.name === name)
    setSwapIdx(null)
    if (ex) setSession((s) => ({ ...s,
      plan: s.plan.map((row, i) => i === idx ? { ...row, exercise_id: ex.id } : row) }))
  }

  function startEdit(l) {
    setEditId(l.id)
    setEditVal({ weight: l.weight_lb ?? l.added_weight_lb ?? '', reps: l.reps })
  }

  async function saveEdit(l) {
    const p = { reps: Number(editVal.reps) }
    const w = editVal.weight === '' ? null : Number(editVal.weight)
    if (l.bodyweight) p.added_weight_lb = w ?? 0
    else p.weight_lb = w
    try {
      await patch(`/entries/${l.id}`, p)
      setLogged((rows) => rows.map((r) => r.id === l.id ? { ...r, ...p } : r))
      setEditId(null)
    } catch (e) { setErr(e.message) }
  }

  async function deleteSet(id) {
    try {
      await del(`/entries/${id}`)
      setLogged((rows) => rows.filter((r) => r.id !== id))
      if (editId === id) setEditId(null)
    } catch (e) { setErr(e.message) }
    setConfirmId(null)
  }

  async function endSession() {
    await post(`/sessions/${session.session_id}/end`)
    setSession(null); setTimer(null); setExText(''); setLogged([])
  }

  if (!session) {
    const routineList = Object.entries(routines)
    return (
      <>
        <div className="pagehead">{menuBtn}<h1>Iron Log</h1></div>
        <div className="card">
          <button className="big primary" onClick={() => start()}>Start empty workout</button>
        </div>
        {routineList.map(([slug, r]) => (
          <div key={slug}>
            <h2>{r.name || slug}</h2>
            <div className="card">
              {(r.days || []).map((d, i) => (
                <button className="big" key={d.name || i}
                  style={{ marginBottom: i < r.days.length - 1 ? 8 : 0 }}
                  onClick={() => start(slug, d.name)}>{d.name || `Day ${i + 1}`}</button>
              ))}
              {!(r.days || []).length && <p className="muted">No days defined in this routine.</p>}
            </div>
          </div>
        ))}
        {!routineList.length && (
          <p className="muted">No routines yet. Drop a routine YAML in your data repo's <code>shared/routines/</code>.</p>
        )}
      </>
    )
  }

  const plan = session.plan || []
  const upcoming = plan.slice(session.planIdx)
  const shownUpcoming = planOpen ? upcoming : upcoming.slice(0, 1)
  // Rest countdown derived from the timer + tick.
  const remaining = timer ? timer.target - Math.floor((now - timer.startedAt) / 1000) : 0
  const cAbs = Math.abs(remaining)
  const cmm = Math.floor(cAbs / 60), css = String(cAbs % 60).padStart(2, '0')
  if (timer && remaining <= 0 && !beeped.current) { beeped.current = true; beep() }

  return (
    <>
      <div className="card">
        <div className="subtabs">
          {menuBtn}
          <button className={exTab === 'exercise' ? 'on' : ''} onClick={() => setExTab('exercise')}>Exercise</button>
          <button className={exTab === 'history' ? 'on' : ''} onClick={() => setExTab('history')}>History</button>
          <button className={exTab === 'trend' ? 'on' : ''} onClick={() => setExTab('trend')}>Trend</button>
          <button className={exTab === 'info' ? 'on' : ''} onClick={() => setExTab('info')}>Info</button>
        </div>

        {exTab === 'exercise' && (
          <>
            {exErr && <p className="error">{exErr}</p>}
            <div className="ex-picker">
              <input list="exlist" value={exText}
                onChange={(e) => setExText(e.target.value)} placeholder="start typing…" />
              <button className="addex" aria-label={adding ? 'Cancel new exercise' : 'New exercise'}
                onClick={() => { setErr(''); setAdding((v) => !v) }}>{adding ? '×' : '+'}</button>
            </div>
            <datalist id="exlist">
              {exercises.map((e) => <option key={e.id} value={e.name} />)}
            </datalist>
            {adding && <AddExerciseForm onSubmit={addExercise} />}

            <div className="fields">
              <div className="field">
                <input className="numval" inputMode="decimal" value={weight ?? ''}
                  onChange={(e) => setWeight(e.target.value === '' ? null : Number(e.target.value))} />
                <span className="unit">{WEIGHT_UNIT}</span>
              </div>
              <div className="field">
                <input className="numval" inputMode="numeric" value={reps ?? ''}
                  onChange={(e) => setReps(e.target.value === '' ? null : Number(e.target.value))} />
                <span className="unit">reps</span>
              </div>
            </div>

            <div className="row">
              <input style={{ flex: 3 }} value={notes} placeholder="notes"
                onChange={(e) => setNotes(e.target.value)} />
              <select style={{ flex: 1 }} value={rpe ?? ''}
                onChange={(e) => setRpe(e.target.value ? Number(e.target.value) : null)}>
                <option value="">RPE</option>
                {RPE.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>

            {err && <p className="error">{err}</p>}
            {timer ? (
              <div className="logtimer">
                <button className="adj" aria-label="Subtract 30 seconds"
                  onClick={() => setTimer((t) => ({ ...t, target: t.target - 30 }))}>−30</button>
                <div className={`logtimer-clock ${remaining < 0 ? 'over' : ''}`}>
                  {remaining < 0 ? '+' : ''}{cmm}:{css}
                </div>
                <button className="adj" aria-label="Add 30 seconds"
                  onClick={() => setTimer((t) => ({ ...t, target: t.target + 30 }))}>+30</button>
                <button className="adj skip" aria-label="Skip rest"
                  onClick={() => setTimer(null)}>✕</button>
              </div>
            ) : (
              <div className="row" style={{ marginTop: 12 }}>
                <button className="big primary" onClick={logSet} disabled={!exerciseId}>Log set</button>
              </div>
            )}
          </>
        )}

        {exTab === 'history' && (
          !exerciseId
            ? <p className="muted">Pick an exercise on the Exercise tab to see its history.</p>
            : history.length === 0
              ? <p className="muted">No history for {exercise?.name} yet.</p>
              : history.map((s) => (
                <div className="entry" key={s.session_id}>
                  <div>
                    <button className="linkdate" onClick={() => navigate('history', { session: s.session_id })}>
                      {s.date}
                    </button>
                    <div className="meta">
                      {s.sets.map((x) => `${x.load_lb}×${x.reps}`).join('  ')}
                    </div>
                  </div>
                  <div className="load">{s.e1rm_lb} <span className="pill">e1RM</span></div>
                </div>
              ))
        )}

        {exTab === 'trend' && (
          !exerciseId
            ? <p className="muted">Pick an exercise on the Exercise tab to see its trend.</p>
            : trend.length > 1
              ? (
                <div style={{ height: 200, marginTop: 6 }}>
                  <ResponsiveContainer>
                    <LineChart data={trend}>
                      <XAxis dataKey="date" {...axis} /><YAxis {...axis} width={44} domain={['auto', 'auto']} />
                      <Tooltip {...tip} />
                      <Line type="monotone" dataKey="e1rm" stroke="#3b7dd8" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )
              : <p className="muted">Not enough sessions to chart yet.</p>
        )}

        {exTab === 'info' && (
          !exerciseId
            ? <p className="muted">Pick an exercise on the Exercise tab to see its notes.</p>
            : exercise?.notes
              ? <p className="exnotes">{exercise.notes}</p>
              : <p className="muted">No notes for {exercise?.name}. Add a <code>notes:</code> key in exercises.yaml.</p>
        )}
      </div>

      {upcoming.length > 0 && (
        <div className="card">
          <div className="upnext-head">
            <span>Up next</span>
            {upcoming.length > 1 && (
              <button className="toggle" onClick={() => { setPlanOpen((o) => !o); setSwapIdx(null) }}>
                {planOpen ? 'Collapse' : `+${upcoming.length - 1} more`}
              </button>
            )}
          </div>
          {shownUpcoming.map((p, i) => {
            const idx = session.planIdx + i
            return (
              <div className={`plan-row ${i === 0 ? 'current' : ''}`} key={`up-${idx}`}>
                {swapIdx === idx ? (
                  <div className="plan-swap">
                    <input list="exlist" autoFocus defaultValue={nameOf(p.exercise_id)}
                      placeholder="swap in an exercise…"
                      onBlur={(e) => applySwap(idx, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') applySwap(idx, e.target.value) }} />
                  </div>
                ) : (
                  <button className="plan-ex tap" onClick={() => setSwapIdx(idx)}>{nameOf(p.exercise_id)}</button>
                )}
                <span className="muted">
                  {p.block ? `${p.block} · ` : ''}round {p.round}
                  {p.target_reps ? ` · ${p.target_reps} reps` : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {logged.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>This session</h2>
          {logged.map((l) => (
            <div className="entry" key={l.id}>
              <div className="main exname">{l.name || l.exercise_id}</div>
              {editId === l.id ? (
                <div className="row" style={{ maxWidth: 240 }}>
                  <input inputMode="decimal" value={editVal.weight} placeholder={WEIGHT_UNIT}
                    onChange={(e) => setEditVal({ ...editVal, weight: e.target.value })} />
                  <input inputMode="numeric" value={editVal.reps}
                    onChange={(e) => setEditVal({ ...editVal, reps: e.target.value })} />
                  <button className="primary" onClick={() => saveEdit(l)}>✓</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="load">
                    {(l.weight_lb ?? l.added_weight_lb) ?? 'bw'}×{l.reps}
                  </div>
                  <button className="ghost" style={{ minHeight: 40, padding: '0 10px' }}
                    onClick={() => startEdit(l)}>✎</button>
                  <button className="ghost danger" style={{ minHeight: 40, padding: '0 10px' }}
                    onClick={() => setConfirmId(l.id)}>✕</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button className="big danger" onClick={endSession}>Finish workout</button>

      <Confirm open={confirmId != null}
        message="Delete this set? git history keeps the audit trail."
        onConfirm={() => deleteSet(confirmId)} onCancel={() => setConfirmId(null)} />
    </>
  )
}

function AddExerciseForm({ onSubmit }) {
  const [f, setF] = useState({
    name: '', primary: 'chest', equipment: '', bodyweight: false, default_rest_s: 120 })
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
      <label>Equipment (optional)</label>
      <input value={f.equipment} onChange={(e) => set('equipment', e.target.value)}
        placeholder="dumbbell / barbell / cable / machine" />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
        <input type="checkbox" style={{ width: 20, minHeight: 0 }}
          checked={f.bodyweight} onChange={(e) => set('bodyweight', e.target.checked)} />
        Bodyweight movement
      </label>
      <button className="big primary" style={{ marginTop: 10 }}
        disabled={!f.name.trim()} onClick={() => onSubmit(f)}>Add exercise</button>
    </div>
  )
}
