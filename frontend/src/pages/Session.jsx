import { useEffect, useMemo, useRef, useState } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'
import { get, post, patch, del, WEIGHT_UNIT, exColor, fmtSet, scoreLabel, scoreFmt } from '../api'
import { unlockAudio, beep } from '../audio'
import Confirm from '../components/Confirm'
import ExercisePicker from '../components/ExercisePicker'
import RoutinePreview from '../components/RoutinePreview'

// Fixed taxonomy — mirrors backend config.MUSCLE_GROUPS (used by the add form).
const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'core', 'cardio']
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
  const [qty, setQty] = useState(10)           // reps, seconds, or miles — per exercise.metric
  const [rpe, setRpe] = useState(null)
  const [timer, setTimer] = useState(null)     // {target, startedAt}: rest countdown
  const [now, setNow] = useState(0)            // ticks every 500ms while a session is live
  const [setStartAt, setSetStartAt] = useState(0) // when the current set went active (count-up base)
  const [prog, setProg] = useState([])         // full progression for current exercise
  const [exTab, setExTab] = useState('exercise') // 'exercise' | 'history' | 'info'
  const [logged, setLogged] = useState([])
  const [editId, setEditId] = useState(null)   // logged set being edited
  const [editVal, setEditVal] = useState({ weight: '', kind: 'reps', qty: '' })
  const [adding, setAdding] = useState(false)  // add-exercise form open
  const [confirmId, setConfirmId] = useState(null) // set pending delete
  const [planCollapsed, setPlanCollapsed] = useState(true) // hide the rows below the current one
  const [completedCollapsed, setCompletedCollapsed] = useState(true) // hide the logged-set rows
  const [pickerOpen, setPickerOpen] = useState(false) // main exercise-picker modal
  const [swapIdx, setSwapIdx] = useState(null)     // plan index being re-assigned (opens the picker modal)
  const [planEditing, setPlanEditing] = useState(false) // Plan header pencil: reveals row edit/drag affordances
  const [dragIdx, setDragIdx] = useState(null)     // plan row index currently being dragged
  const [sessionNotes, setSessionNotes] = useState('') // freeform notes for the session
  const [notesOpen, setNotesOpen] = useState(false)    // session-notes box expanded
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState(null) // {slug, day, name, yaml} — routine-day look-before-you-start
  const wakeLock = useRef(null)
  const hydrated = useRef(false)
  const beeped = useRef(false)
  const rowRefs = useRef({})   // plan index -> row DOM node, for drag-drop hit testing
  const autoPop = useRef(true)   // gate last-set autofill to genuine exercise switches (off on resume)

  const loadExercises = () =>
    get('/exercises').then((xs) => { setExercises(xs); setExErr('') })
      .catch((e) => setExErr(e.message))

  useEffect(() => {
    loadExercises()
    get('/routines').then(setRoutines)
  }, [])

  const nameOf = (id) => exercises.find((e) => e.id === id)?.name || id
  const colorOf = (id) => exColor(exercises.find((e) => e.id === id)?.primary)
  const isBwOf = (id) => !!exercises.find((e) => e.id === id)?.bodyweight

  // The Completed list is the server's truth, not a client-side copy — so it
  // always reflects the actual file (incl. edits made directly to the JSONL).
  const refreshLogged = (sid) =>
    get(`/sessions/${sid}`)
      .then((s) => setLogged((s.entries || []).filter((e) => e.type === 'set').reverse()))
      .catch(() => {})

  // Resume a workout left running when we last unmounted (tab switch / reload).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null')
      if (saved?.session) {
        setSession(saved.session)
        refreshLogged(saved.session.session_id)
        setExText(saved.exText || '')
        setWeight(saved.weight ?? null)
        setQty(saved.qty ?? 10)
        setSetStartAt(saved.setStartAt ?? Date.now())
        setSessionNotes(saved.sessionNotes || '')
        setNotesOpen(!!saved.notesOpen)
        autoPop.current = false  // don't clobber the restored entry with last-set values
      }
    } catch { /* corrupt/absent resume state — start fresh */ }
    hydrated.current = true
  }, [])

  // Persist active-workout state so it survives an unmount. `weight`/`qty` are
  // kept too — the previous set stays in the entry area, so a repeat is one tap.
  // `session` carries the plan, so on-the-fly Up-next swaps survive too.
  useEffect(() => {
    if (!hydrated.current) return
    if (session) {
      localStorage.setItem(RESUME_KEY, JSON.stringify({
        session, exText, weight, qty, setStartAt, sessionNotes, notesOpen }))
    } else {
      localStorage.removeItem(RESUME_KEY)
    }
  }, [session, exText, weight, qty, setStartAt, sessionNotes, notesOpen])

  // The picker stores/searches by name; the canonical id is derived from it.
  const exercise = useMemo(
    () => exercises.find((e) => e.name === exText),
    [exercises, exText])
  const exerciseId = exercise?.id || ''
  const isBw = exercise?.bodyweight
  const metric = exercise?.metric || 'reps'
  const qtyUnit = metric === 'duration' ? 'sec' : metric === 'distance' ? 'mi' : 'reps'
  // No weight concept for pure duration/distance cardio (running, cycling...);
  // bodyweight movements still track their added/assist weight regardless of metric.
  const showWeight = metric === 'reps' || isBw

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
        if (autoPop.current) {
          // bw movements have their own added-weight history (often 0) —
          // recall it instead of leaving the previous exercise's weight in the field.
          if (isBw) setWeight(last?.added_weight_lb ?? 0)
          else if (last) setWeight(last.load_lb)  // load_lb == weight for non-bw
        }
        if (autoPop.current && last) {
          setQty(last.duration_s ?? last.distance_mi ?? last.reps)
          setRpe(last.rpe ?? null)            // RPE recalls the last set too
        }
        autoPop.current = true
      })
      .catch(() => {})
  }, [exerciseId])

  // Keep the exercise picker in sync with the plan's current row — covers the
  // normal advance after logging a set as well as edits (swap/reorder) that
  // change what's current. Only overrides once the plan actually has a current
  // row; once it's exhausted, whatever's in the picker is the lifter's own pick.
  useEffect(() => {
    if (!hydrated.current) return
    const cur = session?.plan?.[session.planIdx]
    if (cur) setExText(nameOf(cur.exercise_id))
  }, [session?.plan, session?.planIdx])

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

  // One clock ticks the whole live session — it drives both the rest countdown
  // and the always-on set stopwatch (the count-up beside the Log-set button).
  useEffect(() => {
    if (!session) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [session])

  // Fresh rest timer -> re-arm the end-of-rest beep.
  useEffect(() => { beeped.current = false }, [timer])

  // When rest hits zero: beep once, drop the timer entirely (it does NOT flip to
  // a count-up), and start the next set's stopwatch from zero.
  useEffect(() => {
    if (!timer) return
    const left = timer.target - Math.floor((now - timer.startedAt) / 1000)
    if (left <= 0) {
      if (!beeped.current) { beeped.current = true; beep() }
      setTimer(null)
      setSetStartAt(Date.now())
    }
  }, [now, timer])

  async function start(routine, day) {
    const r = await post('/sessions/start', { routine, day })
    setSession({ session_id: r.session_id, plan: r.plan, planIdx: 0 })
    setLogged([]); setExTab('exercise'); setPlanCollapsed(true); setCompletedCollapsed(true); setSwapIdx(null)
    setTimer(null); setSetStartAt(Date.now())
    if (!r.plan?.length) setExText('')
  }

  // Look-before-you-start: fetch the day's raw YAML instead of jumping straight
  // into the session. Starting is a separate, explicit step from the modal.
  // day may be undefined (unnamed day) — find_day then falls back to the
  // routine's first day, same as start() always has.
  async function openPreview(slug, day) {
    const qs = day ? `?day=${encodeURIComponent(day)}` : ''
    const r = await get(`/routines/${encodeURIComponent(slug)}/preview${qs}`)
    setPreview({ slug, day, name: r.name, yaml: r.yaml })
  }

  async function addExercise(form) {
    setErr('')
    try {
      const created = await post('/exercises', {
        name: form.name.trim(),
        primary: form.primary,
        metric: form.metric,
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
        session_id: session.session_id, exercise_id: exerciseId,
        rpe: rpe || undefined,
      }
      if (metric === 'duration') body.duration_s = qty
      else if (metric === 'distance') body.distance_mi = qty
      else body.reps = qty
      if (isBw) body.added_weight_lb = weight ?? 0
      else if (metric === 'reps') body.weight_lb = weight
      const r = await post('/sets', body)
      setLogged((l) => [{ ...body, id: r.id }, ...l])  // optimistic; reconciled below
      refreshLogged(session.session_id)
      // In-plan sets carry a positional rest (within-block vs end-of-block);
      // off-plan sets fall back to the backend's end-of-block default.
      const restS = session.plan?.[session.planIdx]?.rest_s ?? r.rest_s
      setTimer({ target: restS, startedAt: Date.now() })
      if (session.plan) setSession({ ...session, planIdx: session.planIdx + 1 })
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

  // Drop an upcoming set from the in-session plan (routine YAML untouched).
  function removePlanRow(idx) {
    setSwapIdx(null)
    // Removing the last remaining current set: the sync effect only retargets the
    // picker when the plan still has a current row, so clear it explicitly here.
    if (idx === session.planIdx && !session.plan[idx + 1]) setExText('')
    setSession((s) => {
      const plan = s.plan.slice()
      plan.splice(idx, 1)
      return { ...s, plan }
    })
  }

  // Append a new planned set and open it for picking. rest_s is left null so it
  // falls back to the backend default when logged.
  function addPlanRow() {
    const newIdx = (session.plan || []).length
    setSession((s) => ({ ...s,
      plan: [...(s.plan || []), { exercise_id: exerciseId || '', round: 1, rest_s: null }] }))
    setPlanCollapsed(false)
    setSwapIdx(newIdx)
  }

  // Move a planned set from one absolute plan index to another (drag reorder).
  function reorderPlan(from, to) {
    setSession((s) => {
      const plan = s.plan.slice()
      const [row] = plan.splice(from, 1)
      plan.splice(to, 0, row)
      return { ...s, plan }
    })
  }

  // Drag-to-reorder via Pointer Events (works for touch and mouse alike, unlike
  // HTML5 drag-and-drop). Live-swaps the plan row whenever the pointer crosses
  // into a neighboring row's bounds; row DOM nodes are tracked in rowRefs.
  function startRowDrag(e, idx) {
    e.preventDefault()
    setDragIdx(idx)
    let current = idx
    const onMove = (ev) => {
      const y = ev.clientY
      for (const [key, el] of Object.entries(rowRefs.current)) {
        if (!el) continue
        const target = Number(key)
        const r = el.getBoundingClientRect()
        if (y >= r.top && y <= r.bottom && target !== current) {
          reorderPlan(current, target)
          current = target
          setDragIdx(target)
          break
        }
      }
    }
    const onUp = () => {
      setDragIdx(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function startEdit(l) {
    const kind = l.duration_s != null ? 'duration_s' : l.distance_mi != null ? 'distance_mi' : 'reps'
    setEditId(l.id)
    setEditVal({ weight: l.weight_lb ?? l.added_weight_lb ?? '', kind, qty: l[kind] })
  }

  async function saveEdit(l) {
    const p = { [editVal.kind]: Number(editVal.qty) }
    const w = editVal.weight === '' ? null : Number(editVal.weight)
    if (isBwOf(l.exercise_id)) p.added_weight_lb = w ?? 0
    else p.weight_lb = w
    try {
      await patch(`/entries/${l.id}`, p)
      setEditId(null)
      refreshLogged(session.session_id)
    } catch (e) { setErr(e.message) }
  }

  async function deleteSet(id) {
    try {
      await del(`/entries/${id}`)
      if (editId === id) setEditId(null)
      refreshLogged(session.session_id)
    } catch (e) { setErr(e.message) }
    setConfirmId(null)
  }

  async function endSession() {
    await post(`/sessions/${session.session_id}/end`, { notes: sessionNotes.trim() || undefined })
    setSession(null); setTimer(null); setExText(''); setLogged([])
    setSessionNotes(''); setNotesOpen(false)
  }

  if (!session) {
    const routineList = Object.entries(routines)
    return (
      <>
        <div className="pagehead">{menuBtn}<h1>Workout</h1></div>
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
                  onClick={() => openPreview(slug, d.name)}>{d.name || `Day ${i + 1}`}</button>
              ))}
              {!(r.days || []).length && <p className="muted">No days defined in this routine.</p>}
            </div>
          </div>
        ))}
        {!routineList.length && (
          <p className="muted">No routines yet. Drop a routine YAML in your data repo's <code>shared/routines/</code>.</p>
        )}
        <RoutinePreview preview={preview}
          onStart={() => { const p = preview; setPreview(null); start(p.slug, p.day) }}
          onClose={() => setPreview(null)} />
      </>
    )
  }

  const plan = session.plan || []
  const upcoming = plan.slice(session.planIdx)
  // The current/next set always shows; the chevron reveals the ones below it.
  const shownUpcoming = planCollapsed ? upcoming.slice(0, 1) : upcoming
  // Rest countdown (the effect clears the timer at zero, so this stays >= 0).
  const remaining = timer ? Math.max(0, timer.target - Math.floor((now - timer.startedAt) / 1000)) : 0
  const cmm = Math.floor(remaining / 60), css = String(remaining % 60).padStart(2, '0')
  // Set stopwatch: seconds the current set has been active, always counting up.
  const setElapsed = Math.max(0, Math.floor((now - setStartAt) / 1000))
  const smm = Math.floor(setElapsed / 60), sss = String(setElapsed % 60).padStart(2, '0')

  return (
    <>
      <div className="pagehead">{menuBtn}<h1>Workout</h1></div>
      <div className="card">
        <div className="subtabs">
          <button className={exTab === 'exercise' ? 'on' : ''} onClick={() => setExTab('exercise')}>Exercise</button>
          <button className={exTab === 'history' ? 'on' : ''} onClick={() => setExTab('history')}>History</button>
          <button className={exTab === 'info' ? 'on' : ''} onClick={() => setExTab('info')}>Info</button>
        </div>

        {exTab === 'exercise' && (
          <>
            {exErr && <p className="error">{exErr}</p>}
            <div className="ex-picker">
              <button className="expicker-trigger" onClick={() => setPickerOpen(true)}>
                {exText || <span className="muted">choose exercise…</span>}
              </button>
              <button className="addex" aria-label={adding ? 'Cancel new exercise' : 'New exercise'}
                onClick={() => { setErr(''); setAdding((v) => !v) }}>{adding ? '×' : '+'}</button>
            </div>
            {adding && <AddExerciseForm onSubmit={addExercise} />}

            <div className="fields">
              {showWeight && (
                <div className="field">
                  <input className="numval" inputMode="decimal" value={weight ?? ''}
                    onChange={(e) => setWeight(e.target.value === '' ? null : Number(e.target.value))} />
                  <span className="unit">{WEIGHT_UNIT}</span>
                </div>
              )}
              <div className="field">
                <input className="numval" inputMode={metric === 'distance' ? 'decimal' : 'numeric'} value={qty ?? ''}
                  onChange={(e) => setQty(e.target.value === '' ? null : Number(e.target.value))} />
                <span className="unit">{qtyUnit}</span>
              </div>
              <div className="field">
                <input className="numval" inputMode="decimal" value={rpe ?? ''}
                  onChange={(e) => setRpe(e.target.value === '' ? null : Number(e.target.value))} />
                <span className="unit">rpe</span>
              </div>
            </div>

            {err && <p className="error">{err}</p>}
            {timer ? (
              <div className="logtimer">
                <button className="adj" aria-label="Subtract 30 seconds"
                  onClick={() => setTimer((t) => ({ ...t, target: t.target - 30 }))}>−30</button>
                <div className="logtimer-clock">{cmm}:{css}</div>
                <button className="adj" aria-label="Add 30 seconds"
                  onClick={() => setTimer((t) => ({ ...t, target: t.target + 30 }))}>+30</button>
                <button className="adj skip" aria-label="Skip rest"
                  onClick={() => { setTimer(null); setSetStartAt(Date.now()) }}>✕</button>
              </div>
            ) : (
              <div className="logrow">
                <button className="big primary" onClick={logSet} disabled={!exerciseId}>Log set</button>
                <div className="setclock" title="Time on current set" aria-label="Time on current set">{smm}:{sss}</div>
              </div>
            )}
          </>
        )}

        {exTab === 'history' && (
          !exerciseId
            ? <p className="muted">Pick an exercise on the Exercise tab to see its history.</p>
            : (
              <>
                <h3 className="exhead"><span className="exdot" style={{ background: colorOf(exerciseId) }} />{exercise?.name}</h3>
                {history.length === 0
                  ? <p className="muted">No history yet.</p>
                  : (
                    <>
                      {trend.length > 1 && (
                        <div style={{ height: 200, margin: '6px 0 10px' }}>
                          <ResponsiveContainer>
                            <LineChart data={trend}>
                              <XAxis dataKey="date" {...axis} /><YAxis {...axis} width={44} domain={['auto', 'auto']} />
                              <Tooltip {...tip} />
                              <Line type="monotone" dataKey="e1rm" stroke="#3b7dd8" strokeWidth={2} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                      {history.map((s) => (
                        <div className="entry" key={s.session_id}>
                          <div>
                            <button className="linkdate" onClick={() => navigate('history', { session: s.session_id })}>
                              {s.date}
                            </button>
                            <div className="meta">
                              {s.sets.map((x) => fmtSet(x)).join('  ')}
                            </div>
                          </div>
                          <div className="load">{scoreFmt(s.e1rm_lb, metric)} <span className="pill">{scoreLabel(metric)}</span></div>
                        </div>
                      ))}
                    </>
                  )}
              </>
            )
        )}

        {exTab === 'info' && (
          !exerciseId
            ? <p className="muted">Pick an exercise on the Exercise tab to see its notes.</p>
            : (
              <>
                <h3 className="exhead"><span className="exdot" style={{ background: colorOf(exerciseId) }} />{exercise?.name}</h3>
                {exercise?.notes
                  ? <p className="exnotes">{exercise.notes}</p>
                  : <p className="muted">No notes for {exercise?.name}. Add a <code>notes:</code> key in exercises.yaml.</p>}
              </>
            )
        )}
      </div>

      {upcoming.length > 0 && (
        <div className="card">
          <div className="upnext-head">
            <div className="upnext-head-left">
              <button className="section-toggle" aria-expanded={!planCollapsed}
                disabled={upcoming.length < 2}
                onClick={() => { setPlanCollapsed((c) => !c); setSwapIdx(null) }}>
                <span className={`chev ${planCollapsed ? '' : 'open'}`}
                  style={{ visibility: upcoming.length > 1 ? 'visible' : 'hidden' }}>▸</span> Plan
              </button>
              {upcoming.length > 1 && planCollapsed && (
                <span className="muted plan-more">+{upcoming.length - 1} more</span>
              )}
            </div>
            <button className="plan-x" aria-label={planEditing ? 'Done editing plan' : 'Edit plan'}
              onClick={() => {
                setSwapIdx(null)
                if (!planEditing) setPlanCollapsed(false)
                setPlanEditing((v) => !v)
              }}>{planEditing ? '✓' : '✎'}</button>
          </div>
          {shownUpcoming.map((p, i) => {
            const idx = session.planIdx + i
            return (
              <div className={`plan-row ${i === 0 ? 'current' : ''} ${dragIdx === idx ? 'dragging' : ''}`}
                key={`up-${idx}`} ref={(el) => (rowRefs.current[idx] = el)}>
                <div className="plan-main">
                  {planEditing && (
                    <span className="plan-handle" aria-label="Drag to reorder"
                      onPointerDown={(e) => startRowDrag(e, idx)}>⠿</span>
                  )}
                  <span className="exdot" style={{ background: colorOf(p.exercise_id) }} />
                  <span className="plan-ex">{nameOf(p.exercise_id)}</span>
                </div>
                <div className="plan-right">
                  <span className="muted">
                    {p.block ? `${p.block} · ` : ''}round {p.round}
                  </span>
                  {planEditing && (
                    <>
                      <button className="plan-x" aria-label="Swap exercise"
                        onClick={() => setSwapIdx(idx)}>✎</button>
                      <button className="plan-x danger" aria-label="Remove from plan"
                        onClick={() => removePlanRow(idx)}>×</button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
          {planEditing && <button className="plan-add" onClick={addPlanRow}>＋ add exercise</button>}
        </div>
      )}

      {logged.length > 0 && (
        <div className="card completed">
          <button className="section-toggle" aria-expanded={!completedCollapsed}
            style={{ marginBottom: completedCollapsed ? 0 : 6 }}
            onClick={() => setCompletedCollapsed((c) => !c)}>
            <span className={`chev ${completedCollapsed ? '' : 'open'}`}>▸</span>
            Completed <span className="muted">· {logged.length} set{logged.length === 1 ? '' : 's'}</span>
          </button>
          {!completedCollapsed && logged.map((l) => (
            <div className="entry" key={l.id}>
              <div className="main exname">
                <span className="exdot" style={{ background: colorOf(l.exercise_id) }} />
                {nameOf(l.exercise_id)}
              </div>
              {editId === l.id ? (
                <div className="row" style={{ maxWidth: 280 }}>
                  <input inputMode="decimal" value={editVal.weight} placeholder={WEIGHT_UNIT}
                    onChange={(e) => setEditVal({ ...editVal, weight: e.target.value })} />
                  <input inputMode={editVal.kind === 'distance_mi' ? 'decimal' : 'numeric'} value={editVal.qty}
                    onChange={(e) => setEditVal({ ...editVal, qty: e.target.value })} />
                  <button className="primary" onClick={() => saveEdit(l)}>✓</button>
                  <button className="ghost danger" style={{ minHeight: 40, padding: '0 10px' }}
                    onClick={() => setConfirmId(l.id)}>✕</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="load">
                    {fmtSet(l)}
                  </div>
                  <button className="ghost" style={{ minHeight: 40, padding: '0 10px' }}
                    onClick={() => startEdit(l)}>✎</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <button className="section-toggle" aria-expanded={notesOpen}
          onClick={() => setNotesOpen((o) => !o)}>
          <span className={`chev ${notesOpen ? 'open' : ''}`}>▸</span> Session notes
          {!notesOpen && sessionNotes.trim() && <span className="notes-dot" />}
        </button>
        {notesOpen && (
          <textarea className="notes-area" rows={4} value={sessionNotes}
            placeholder="How did the session go? Energy, aches, PRs…"
            onChange={(e) => setSessionNotes(e.target.value)} />
        )}
      </div>

      <button className="big danger" onClick={endSession}>Finish workout</button>

      <ExercisePicker open={pickerOpen} exercises={exercises} value={exText}
        onSelect={(name) => { setExText(name); setPickerOpen(false) }}
        onClose={() => setPickerOpen(false)} />

      <ExercisePicker open={swapIdx != null} exercises={exercises}
        value={swapIdx != null ? nameOf(plan[swapIdx]?.exercise_id) : ''}
        onSelect={(name) => applySwap(swapIdx, name)}
        onClose={() => setSwapIdx(null)} />

      <Confirm open={confirmId != null}
        message="Delete this set? git history keeps the audit trail."
        onConfirm={() => deleteSet(confirmId)} onCancel={() => setConfirmId(null)} />
    </>
  )
}

function AddExerciseForm({ onSubmit }) {
  const [f, setF] = useState({
    name: '', primary: 'chest', metric: 'reps', equipment: '', bodyweight: false, default_rest_s: 120 })
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
      </select>
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
