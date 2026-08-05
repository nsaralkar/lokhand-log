import { useEffect, useMemo, useRef, useState } from 'react'
import { get, post, patch, del, WEIGHT_UNIT, RESUME_KEY, exColor, fmtSet, scoreLabel, scoreFmt } from '../api'
import { unlockAudio, beep } from '../audio'
import Confirm from '../components/Confirm'
import ExercisePicker from '../components/ExercisePicker'
import ExerciseTrend from '../components/ExerciseTrend'
import PlanRowEdit from '../components/PlanRowEdit'

export default function Session({ user, navigate, menuBtn, workoutClock }) {
  const [exercises, setExercises] = useState([])
  const [exErr, setExErr] = useState('')
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
  const [editVal, setEditVal] = useState({ exercise_id: '', weight: '', kind: 'reps', qty: '', rpe: '' })
  const [editPick, setEditPick] = useState(false)  // exercise picker for the set being edited
  const [confirmId, setConfirmId] = useState(null) // set pending delete
  const [confirmFinish, setConfirmFinish] = useState(false) // finish-workout pending confirmation
  const [planCollapsed, setPlanCollapsed] = useState(true) // hide the rows below the current one
  const [completedCollapsed, setCompletedCollapsed] = useState(true) // hide the logged-set rows
  const [pickerOpen, setPickerOpen] = useState(false) // main exercise-picker modal
  const [swapIdx, setSwapIdx] = useState(null)     // plan index being re-assigned (opens the picker modal)
  const [planEditIdx, setPlanEditIdx] = useState(null) // plan row open in the edit (choose-exercise/delete) modal
  const [dragIdx, setDragIdx] = useState(null)     // plan row index currently being dragged
  const [sessionNotes, setSessionNotes] = useState('') // freeform notes for the session
  const [notesOpen, setNotesOpen] = useState(false)    // session-notes box expanded
  const [err, setErr] = useState('')
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
  }, [])

  const nameOf = (id) => exercises.find((e) => e.id === id)?.name || id
  const colorOf = (id) => exColor(exercises.find((e) => e.id === id)?.primary)
  // Which entry field a set of this exercise fills, and how that field reads.
  const kindOf = (metric) => metric === 'duration' ? 'duration_s' : metric === 'distance' ? 'distance_mi' : 'reps'
  const unitOf = (kind) => kind === 'duration_s' ? 'sec' : kind === 'distance_mi' ? 'mi' : 'reps'

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
  const metric = exercise?.metric || 'reps'
  const qtyUnit = unitOf(kindOf(metric))
  // No weight concept for pure duration/distance work (planks, running...). For
  // everything else the field always shows: 0 is bodyweight, negative is assisted.
  const showWeight = metric === 'reps'

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
          setWeight(last.load_lb)
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
  //
  // `exercises` is a dependency because the picker holds a *name* while the plan
  // holds an id: on a remount (tab switch) the library is still in flight, so
  // this runs once with nothing to resolve against and again once it lands.
  // Without the rerun the raw yaml id ("deadlift_single_alt_db") stuck in the
  // field, matched no exercise, and Log set stayed disabled.
  useEffect(() => {
    if (!hydrated.current) return
    const cur = session?.plan?.[session.planIdx]
    if (!cur) return
    const ex = exercises.find((e) => e.id === cur.exercise_id)
    if (ex) setExText(ex.name)
    else if (exercises.length) setExText('')  // planned id isn't in the library — prompt for a pick
  }, [session?.plan, session?.planIdx, exercises])

  const history = useMemo(() => prog.slice(-3).reverse(), [prog])

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

  async function start() {
    const r = await post('/sessions/start', {})
    setSession({ session_id: r.session_id, plan: r.plan, planIdx: 0, startedAt: Date.now() })
    setLogged([]); setExTab('exercise'); setPlanCollapsed(true); setCompletedCollapsed(true); setSwapIdx(null)
    setTimer(null); setSetStartAt(Date.now())
    setExText('')
  }

  async function logSet() {
    setErr('')
    unlockAudio()  // user gesture — lets the rest timer beep at zero
    try {
      const body = {
        session_id: session.session_id, exercise_id: exerciseId,
        rpe: rpe || undefined,
      }
      body[kindOf(metric)] = qty
      if (showWeight) body.weight_lb = weight
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
    setEditVal({ exercise_id: l.exercise_id, kind,
      weight: l.weight_lb ?? l.added_weight_lb ?? '', qty: l[kind] ?? '', rpe: l.rpe ?? '' })
  }

  // Re-point a logged set at a different exercise. If the new one is tracked by
  // another metric the quantity field switches with it, and the old number is
  // dropped rather than silently reinterpreted (45 seconds isn't 45 reps).
  function editExercise(name) {
    const ex = exercises.find((e) => e.name === name)
    setEditPick(false)
    if (!ex) return
    const kind = kindOf(ex.metric)
    setEditVal((v) => ({ ...v, exercise_id: ex.id, kind, qty: v.kind === kind ? v.qty : '' }))
  }

  async function saveEdit(l) {
    const num = (v) => (v === '' || v == null ? null : Number(v))
    // The patch merges into the stored entry, so every field the set no longer
    // uses has to be nulled explicitly — omitting it would leave the old value.
    const p = {
      exercise_id: editVal.exercise_id, weight_lb: num(editVal.weight), rpe: num(editVal.rpe),
      reps: null, duration_s: null, distance_mi: null, added_weight_lb: null,
      [editVal.kind]: num(editVal.qty),
    }
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
    setSessionNotes(''); setNotesOpen(false); setConfirmFinish(false)
  }

  if (!session) {
    return (
      <>
        <div className="pagehead">{menuBtn}<h1>Session</h1>{workoutClock}</div>
        <div className="card">
          <button className="big primary" onClick={start}>Start empty workout</button>
        </div>
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
      <div className="pagehead">{menuBtn}<h1>Session</h1>{workoutClock}</div>
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
            </div>

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
                      <ExerciseTrend sessions={prog} metric={metric} />
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
          {/* Expanding the plan *is* the edit mode — the rows' drag handles and
              per-row buttons ride along with it, so there's no separate toggle. */}
          <div className="upnext-head">
            <button className="section-toggle" aria-expanded={!planCollapsed}
              onClick={() => { setPlanCollapsed((c) => !c); setSwapIdx(null) }}>
              <span className={`chev ${planCollapsed ? '' : 'open'}`}>▸</span> Plan
            </button>
            {upcoming.length > 1 && planCollapsed && (
              <span className="muted count-hint">+{upcoming.length - 1} more</span>
            )}
          </div>
          {shownUpcoming.map((p, i) => {
            const idx = session.planIdx + i
            return (
              <div className={`plan-row ${i === 0 ? 'current' : ''} ${dragIdx === idx ? 'dragging' : ''}`}
                key={`up-${idx}`} ref={(el) => (rowRefs.current[idx] = el)}>
                <div className="plan-main">
                  {!planCollapsed && (
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
                  {!planCollapsed && (
                    <button className="plan-x" aria-label="Edit plan row"
                      onClick={() => setPlanEditIdx(idx)}>✎</button>
                  )}
                </div>
              </div>
            )
          })}
          {!planCollapsed && <button className="plan-add" onClick={addPlanRow}>＋ add exercise</button>}
        </div>
      )}

      {logged.length > 0 && (
        <div className="card completed">
          <button className="section-toggle" aria-expanded={!completedCollapsed}
            style={{ marginBottom: completedCollapsed ? 0 : 6 }}
            onClick={() => setCompletedCollapsed((c) => !c)}>
            <span className={`chev ${completedCollapsed ? '' : 'open'}`}>▸</span>
            Completed <span className="muted count-hint">· {logged.length} set{logged.length === 1 ? '' : 's'}</span>
          </button>
          {/* A logged set is fully editable — exercise included. The editor takes
              over the row so all four fields fit a 360px screen in one column. */}
          {!completedCollapsed && logged.map((l) => editId === l.id ? (
            <div className="setedit" key={l.id}>
              <button className="expicker-trigger" onClick={() => setEditPick(true)}>
                <span className="exdot" style={{ background: colorOf(editVal.exercise_id) }} />
                {nameOf(editVal.exercise_id)}
              </button>
              <div className="setedit-fields">
                <label className="setedit-field">
                  <input inputMode="decimal" value={editVal.weight} aria-label={WEIGHT_UNIT}
                    onChange={(e) => setEditVal({ ...editVal, weight: e.target.value })} />
                  <span className="unit">{WEIGHT_UNIT}</span>
                </label>
                <label className="setedit-field">
                  <input inputMode={editVal.kind === 'distance_mi' ? 'decimal' : 'numeric'}
                    value={editVal.qty} aria-label={unitOf(editVal.kind)}
                    onChange={(e) => setEditVal({ ...editVal, qty: e.target.value })} />
                  <span className="unit">{unitOf(editVal.kind)}</span>
                </label>
                <label className="setedit-field">
                  <input inputMode="decimal" value={editVal.rpe} aria-label="rpe"
                    onChange={(e) => setEditVal({ ...editVal, rpe: e.target.value })} />
                  <span className="unit">rpe</span>
                </label>
              </div>
              <div className="row">
                <button className="primary" onClick={() => saveEdit(l)}>Save</button>
                <button className="ghost" onClick={() => setEditId(null)}>Cancel</button>
                <button className="ghost danger" onClick={() => setConfirmId(l.id)}>Delete</button>
              </div>
            </div>
          ) : (
            <div className="entry" key={l.id}>
              <div className="main exname">
                <span className="exdot" style={{ background: colorOf(l.exercise_id) }} />
                {nameOf(l.exercise_id)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="load">
                  {fmtSet(l)}
                </div>
                <button className="ghost" style={{ minHeight: 40, padding: '0 10px' }}
                  onClick={() => startEdit(l)}>✎</button>
              </div>
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
          <textarea className="notes-area no-autoselect" rows={4} value={sessionNotes}
            placeholder="How did the session go? Energy, aches, PRs…"
            onChange={(e) => setSessionNotes(e.target.value)} />
        )}
      </div>

      <button className="big danger" onClick={() => setConfirmFinish(true)}>Finish workout</button>

      <ExercisePicker open={pickerOpen} exercises={exercises} value={exText}
        onSelect={(name) => { setExText(name); setPickerOpen(false) }}
        onClose={() => setPickerOpen(false)} />

      {/* Rendered before the swap picker below: two same-z-index modal-scrims
          stack by DOM order, and the picker needs to land on top when the
          "choose exercise" tap inside this modal opens it. */}
      <PlanRowEdit open={planEditIdx != null}
        name={planEditIdx != null ? nameOf(plan[planEditIdx]?.exercise_id) : ''}
        color={planEditIdx != null ? colorOf(plan[planEditIdx]?.exercise_id) : ''}
        onPick={() => setSwapIdx(planEditIdx)}
        onDelete={() => { removePlanRow(planEditIdx); setPlanEditIdx(null) }}
        onClose={() => setPlanEditIdx(null)} />

      <ExercisePicker open={swapIdx != null} exercises={exercises}
        value={swapIdx != null ? nameOf(plan[swapIdx]?.exercise_id) : ''}
        onSelect={(name) => { applySwap(swapIdx, name); setPlanEditIdx(null) }}
        onClose={() => setSwapIdx(null)} />

      <ExercisePicker open={editPick} exercises={exercises} value={nameOf(editVal.exercise_id)}
        onSelect={editExercise} onClose={() => setEditPick(false)} />

      <Confirm open={confirmId != null}
        message="Delete this set? git history keeps the audit trail."
        onConfirm={() => deleteSet(confirmId)} onCancel={() => setConfirmId(null)} />

      <Confirm open={confirmFinish}
        message="Finish this workout? You won't be able to log more sets to it."
        confirmLabel="Finish" onConfirm={endSession} onCancel={() => setConfirmFinish(false)} />
    </>
  )
}
