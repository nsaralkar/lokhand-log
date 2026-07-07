import { useEffect, useMemo, useRef, useState } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'
import { get, post, patch, del, toDisplay, fromDisplay, unitLabel } from '../api'
import { unlockAudio, beep } from '../audio'
import Confirm from '../components/Confirm'

const RPE = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]
// Fixed taxonomy — mirrors backend config.MUSCLE_GROUPS (used by the add form).
const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'core']
// Active workout is persisted here so switching tabs (which unmounts this page)
// and coming back resumes exactly where you left off.
const RESUME_KEY = 'ironlog.active'
const axis = { stroke: '#7e8894', fontSize: 12 }
const tip = { contentStyle: { background: '#1d222a', border: '1px solid #313a46', borderRadius: 8, color: '#edeff2' } }

export default function Session({ user, navigate, menuBtn }) {
  const units = user.units
  const [exercises, setExercises] = useState([])
  const [exErr, setExErr] = useState('')
  const [templates, setTemplates] = useState({})
  const [session, setSession] = useState(null) // {session_id, plan, planIdx}
  const [exText, setExText] = useState('')     // exercise picker text (name)
  const [weight, setWeight] = useState(null)   // display units
  const [reps, setReps] = useState(10)
  const [rpe, setRpe] = useState(null)
  const [notes, setNotes] = useState('')
  const [timer, setTimer] = useState(null)     // {target, startedAt}
  const [now, setNow] = useState(0)            // ticks while the rest timer runs
  const [prog, setProg] = useState([])         // full progression for current exercise
  const [exTab, setExTab] = useState('exercise') // 'exercise' | 'history' | 'trend'
  const [logged, setLogged] = useState([])
  const [editId, setEditId] = useState(null)   // logged set being edited
  const [editVal, setEditVal] = useState({ weight: '', reps: '' })
  const [adding, setAdding] = useState(false)  // add-exercise form open
  const [confirmId, setConfirmId] = useState(null) // set pending delete
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
    get('/templates').then(setTemplates)
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
  useEffect(() => {
    setProg([])
    if (!exerciseId) return
    get(`/analytics/exercises/${exerciseId}/progression`)
      .then((p) => {
        setProg(p.sessions)
        const last = p.sessions.at(-1)?.sets.at(-1)
        if (autoPop.current && last) {
          if (!isBw) setWeight(toDisplay(last.load_kg, units))  // load_kg == weight for non-bw
          setReps(last.reps)
        }
        autoPop.current = true
      })
      .catch(() => {})
  }, [exerciseId])

  const history = useMemo(() => prog.slice(-3).reverse(), [prog])
  const trend = useMemo(
    () => prog.map((s) => ({ date: s.date, e1rm: toDisplay(s.e1rm_kg, units) })),
    [prog, units])

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

  async function start(template) {
    const r = await post('/sessions/start', {
      name: template ? templates[template].name : null, template })
    setSession({ session_id: r.session_id, plan: r.plan, planIdx: 0 })
    setLogged([]); setExTab('exercise')
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
      if (isBw) body.added_weight_kg = fromDisplay(weight, units) ?? 0
      else body.weight_kg = fromDisplay(weight, units)
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

  function startEdit(l) {
    setEditId(l.id)
    setEditVal({
      weight: toDisplay(l.weight_kg ?? l.added_weight_kg, units) ?? '',
      reps: l.reps,
    })
  }

  async function saveEdit(l) {
    const p = { reps: Number(editVal.reps) }
    const w = editVal.weight === '' ? null : fromDisplay(Number(editVal.weight), units)
    if (l.bodyweight) p.added_weight_kg = w ?? 0
    else p.weight_kg = w
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
    return (
      <>
        <div className="pagehead">{menuBtn}<h1>Iron Log</h1></div>
        <div className="card">
          <button className="big primary" onClick={() => start(null)}>Start empty workout</button>
        </div>
        <h2>From template</h2>
        {Object.entries(templates).map(([slug, t]) => (
          <div className="card" key={slug}>
            <button className="big" onClick={() => start(slug)}>{t.name || slug}</button>
          </div>
        ))}
        {!Object.keys(templates).length && (
          <p className="muted">No templates yet. Save one from a finished session in History, or drop a YAML in your data repo.</p>
        )}
      </>
    )
  }

  const plan = session.plan || []
  const upcoming = plan.slice(session.planIdx)
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
        </div>

        {exTab === 'exercise' && (
          <>
            {exErr && <p className="error">{exErr}</p>}
            <div className="ex-picker">
              <input list="exlist" value={exText} onFocus={(e) => e.target.select()}
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
                <input className="numval" inputMode="decimal" value={weight ?? ''} onFocus={(e) => e.target.select()}
                  onChange={(e) => setWeight(e.target.value === '' ? null : Number(e.target.value))} />
                <span className="unit">{unitLabel(units)}</span>
              </div>
              <div className="field">
                <input className="numval" inputMode="numeric" value={reps ?? ''} onFocus={(e) => e.target.select()}
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
                      {s.sets.map((x) => `${toDisplay(x.load_kg, units)}×${x.reps}`).join('  ')}
                    </div>
                  </div>
                  <div className="load">{toDisplay(s.e1rm_kg, units)} <span className="pill">e1RM</span></div>
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
      </div>

      {(logged.length > 0 || plan.length > 0) && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>This session</h2>
          {logged.map((l) => (
            <div className="entry" key={l.id}>
              <div className="main exname">{l.name || l.exercise_id}</div>
              {editId === l.id ? (
                <div className="row" style={{ maxWidth: 240 }}>
                  <input inputMode="decimal" value={editVal.weight} placeholder={unitLabel(units)}
                    onChange={(e) => setEditVal({ ...editVal, weight: e.target.value })} />
                  <input inputMode="numeric" value={editVal.reps}
                    onChange={(e) => setEditVal({ ...editVal, reps: e.target.value })} />
                  <button className="primary" onClick={() => saveEdit(l)}>✓</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="load">
                    {toDisplay(l.weight_kg ?? l.added_weight_kg, units) ?? 'bw'}×{l.reps}
                  </div>
                  <button className="ghost" style={{ minHeight: 40, padding: '0 10px' }}
                    onClick={() => startEdit(l)}>✎</button>
                  <button className="ghost danger" style={{ minHeight: 40, padding: '0 10px' }}
                    onClick={() => setConfirmId(l.id)}>✕</button>
                </div>
              )}
            </div>
          ))}

          {upcoming.length > 0 && (
            <>
              <div className="session-subhead">Up next</div>
              {upcoming.map((p, i) => (
                <div className={`plan-row ${i === 0 ? 'current' : ''}`} key={`up-${session.planIdx + i}`}>
                  <span className="plan-ex">{nameOf(p.exercise_id)}</span>
                  <span className="muted">
                    {p.block ? `${p.block} · ` : ''}round {p.round}
                    {p.target_reps ? ` · ${p.target_reps} reps` : ''}
                  </span>
                </div>
              ))}
            </>
          )}

          {logged.length === 0 && upcoming.length === 0 && (
            <p className="muted">No sets logged yet.</p>
          )}
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
