import { useEffect, useMemo, useRef, useState } from 'react'
import { get, post, toDisplay, fromDisplay, unitLabel } from '../api'
import Stepper from '../components/Stepper'
import Timer from '../components/Timer'

const RPE = [6, 7, 8, 9, 10]

export default function Session({ user }) {
  const units = user.units
  const [exercises, setExercises] = useState([])
  const [templates, setTemplates] = useState({})
  const [session, setSession] = useState(null) // {session_id, plan, planIdx}
  const [exerciseId, setExerciseId] = useState('')
  const [weight, setWeight] = useState(null)   // display units
  const [reps, setReps] = useState(10)
  const [rpe, setRpe] = useState(null)
  const [notes, setNotes] = useState('')
  const [timer, setTimer] = useState(null)     // {target, startedAt}
  const [history, setHistory] = useState(null)
  const [logged, setLogged] = useState([])
  const [err, setErr] = useState('')
  const wakeLock = useRef(null)

  useEffect(() => {
    get('/exercises').then(setExercises)
    get('/templates').then(setTemplates)
  }, [])

  const exercise = useMemo(
    () => exercises.find((e) => e.id === exerciseId),
    [exercises, exerciseId])
  const isBw = exercise?.bodyweight

  // Recent history for the selected exercise — the "what should I do" panel.
  useEffect(() => {
    setHistory(null)
    if (!exerciseId) return
    get(`/analytics/exercises/${exerciseId}/progression`)
      .then((p) => setHistory(p.sessions.slice(-3).reverse()))
      .catch(() => {})
  }, [exerciseId])

  // Keep the screen awake mid-session so the rest timer stays visible.
  useEffect(() => {
    if (session && 'wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then((l) => (wakeLock.current = l)).catch(() => {})
    }
    return () => wakeLock.current?.release?.()
  }, [session])

  async function start(template) {
    const r = await post('/sessions/start', {
      name: template ? templates[template].name : null, template })
    setSession({ session_id: r.session_id, plan: r.plan, planIdx: 0 })
    setLogged([])
    if (r.plan?.length) setExerciseId(r.plan[0].exercise_id)
  }

  async function logSet() {
    setErr('')
    try {
      const body = {
        session_id: session.session_id, exercise_id: exerciseId, reps,
        rpe: rpe || undefined, notes: notes || undefined,
      }
      if (isBw) body.added_weight_kg = fromDisplay(weight, units) ?? 0
      else body.weight_kg = fromDisplay(weight, units)
      const r = await post('/sets', body)
      setLogged((l) => [{ ...body, id: r.id, name: exercise?.name }, ...l])
      setTimer({ target: r.rest_s, startedAt: Date.now() })
      setRpe(null); setNotes('')
      if (session.plan) {
        const next = session.planIdx + 1
        setSession({ ...session, planIdx: next })
        const nx = session.plan[next]
        if (nx && nx.exercise_id !== exerciseId) setExerciseId(nx.exercise_id)
      }
    } catch (e) { setErr(e.message) }
  }

  async function endSession() {
    await post(`/sessions/${session.session_id}/end`)
    setSession(null); setTimer(null); setExerciseId('')
  }

  if (!session) {
    return (
      <>
        <h1>Iron Log</h1>
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

  const planNext = session.plan?.[session.planIdx]
  const nextLabel = planNext
    ? exercises.find((e) => e.id === planNext.exercise_id)?.name
    : exercise?.name

  return (
    <>
      {timer && (
        <Timer
          target={timer.target} startedAt={timer.startedAt} label={nextLabel}
          onAdjust={(d) => d === 'skip' ? setTimer(null)
            : setTimer((t) => ({ ...t, target: t.target + d }))}
        />
      )}

      <div className="card">
        <label>Exercise</label>
        <input list="exlist" value={exerciseId}
          onChange={(e) => setExerciseId(e.target.value)} placeholder="start typing…" />
        <datalist id="exlist">
          {exercises.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </datalist>
        {planNext && (
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Plan: {nextLabel} · round {planNext.round}
            {planNext.target_reps ? ` · target ${planNext.target_reps} reps` : ''}
          </p>
        )}

        <label>{isBw ? `Added weight (${unitLabel(units)})` : `Weight (${unitLabel(units)})`}</label>
        <Stepper value={weight} onChange={setWeight}
          step={units === 'imperial' ? 5 : 2.5} min={isBw ? -200 : 0} suffix={unitLabel(units)} />

        <label>Reps</label>
        <Stepper value={reps} onChange={setReps} step={1} min={1} />

        <label>RPE (optional)</label>
        <div className="rpe-row">
          {RPE.map((v) => (
            <button key={v} className={rpe === v ? 'on' : ''}
              onClick={() => setRpe(rpe === v ? null : v)}>{v}</button>
          ))}
        </div>

        <label>Notes</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="left shoulder pinch…" />

        {err && <p className="error">{err}</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="big primary" onClick={logSet} disabled={!exerciseId}>Log set</button>
        </div>
        {logged[0] && (
          <button className="big ghost" style={{ marginTop: 8 }} onClick={logSet}>
            Repeat last set
          </button>
        )}
      </div>

      {history && history.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Last sessions — {exercise?.name}</h2>
          {history.map((s) => (
            <div className="entry" key={s.session_id}>
              <div>
                <div className="main">{s.date}</div>
                <div className="meta">
                  {s.sets.map((x) => `${toDisplay(x.load_kg, units)}×${x.reps}`).join('  ')}
                </div>
              </div>
              <div className="load">{toDisplay(s.e1rm_kg, units)} <span className="pill">e1RM</span></div>
            </div>
          ))}
        </div>
      )}

      {logged.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>This session</h2>
          {logged.map((l) => (
            <div className="entry" key={l.id}>
              <div className="main">{l.name || l.exercise_id}</div>
              <div className="load">
                {toDisplay(l.weight_kg ?? l.added_weight_kg, units) ?? 'bw'}×{l.reps}
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="big danger" onClick={endSession}>Finish workout</button>
    </>
  )
}
