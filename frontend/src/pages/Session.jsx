import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { get, post, patch, del, WEIGHT_UNIT, RESUME_KEY, exColor, fmtSet, scoreLabel, scoreFmt } from '../api'
import { unlockAudio, beep } from '../audio'
import Confirm from '../components/Confirm'
import ExercisePicker from '../components/ExercisePicker'
import ExerciseTrend from '../components/ExerciseTrend'

// How many past sessions the History subtab shows before you expand it.
const HIST_PREVIEW = 3

// Preview a plan-row drag without committing it: the same array with the row
// identified by `key` moved to `toIdx`. Used to render/measure while a drag
// is in flight so `session` (and its localStorage write) stays untouched
// until drop — see startRowDrag.
function movePreview(planArr, key, toIdx) {
  if (key == null) return planArr
  const fromIdx = planArr.findIndex((p) => p._key === key)
  if (fromIdx === -1 || fromIdx === toIdx) return planArr
  const copy = planArr.slice()
  const [item] = copy.splice(fromIdx, 1)
  copy.splice(toIdx, 0, item)
  return copy
}

export default function Session({ user, navigate, menuBtn, workoutClock }) {
  const [exercises, setExercises] = useState([])
  const [exErr, setExErr] = useState('')
  const [session, setSession] = useState(null) // {session_id, plan, planIdx}
  const [exText, setExText] = useState('')     // exercise picker text (name)
  const [weight, setWeight] = useState(null)   // pounds
  const [qty, setQty] = useState(10)           // reps, seconds, or miles — per exercise.metric
  const [qty2, setQty2] = useState(null)       // distance (mi), only for duration+distance exercises
  const [rpe, setRpe] = useState(null)
  const [timer, setTimer] = useState(null)     // {target, startedAt}: rest countdown
  const [now, setNow] = useState(0)            // ticks every 500ms while a session is live
  const [setStartAt, setSetStartAt] = useState(0) // when the current set went active (count-up base)
  const [prog, setProg] = useState([])         // full progression for current exercise
  const [exTab, setExTab] = useState('exercise') // 'exercise' | 'history' | 'info'
  const [logged, setLogged] = useState([])
  const [editId, setEditId] = useState(null)   // logged set being edited
  const [editVal, setEditVal] = useState({ exercise_id: '', weight: '', kind: 'reps', qty: '', qty2: '', rpe: '' })
  const [editPick, setEditPick] = useState(false)  // exercise picker for the set being edited
  const [editNoteId, setEditNoteId] = useState(null) // logged note being edited
  const [editNoteText, setEditNoteText] = useState('')
  const [confirmId, setConfirmId] = useState(null) // entry (set or note) pending delete
  const [confirmFinish, setConfirmFinish] = useState(false) // finish-workout pending confirmation
  const [planCollapsed, setPlanCollapsed] = useState(true) // hide the rows below the current one
  const [completedCollapsed, setCompletedCollapsed] = useState(true) // hide the logged-set rows
  const [histCollapsed, setHistCollapsed] = useState(true) // History subtab: show only the last HIST_PREVIEW sessions
  const [pickerOpen, setPickerOpen] = useState(false) // main exercise-picker modal
  const [swapIdx, setSwapIdx] = useState(null)     // plan index being re-assigned (opens the picker modal)
  const [planEditIdx, setPlanEditIdx] = useState(null) // plan row expanded inline for edit (choose-exercise/delete)
  const [dragIdx, setDragIdx] = useState(null)     // plan row index currently being dragged
  const [sessionNotes, setSessionNotes] = useState('') // draft text in the note composer
  const [notesOpen, setNotesOpen] = useState(false)    // session-notes box expanded
  const [err, setErr] = useState('')
  const wakeLock = useRef(null)
  const hydrated = useRef(false)
  const beeped = useRef(false)
  const rowRefs = useRef({})   // plan index -> row DOM node, for drag-drop hit testing
  const keyedRowRefs = useRef({})  // plan-row _key -> DOM node, for FLIP-animating reorders
  const flipRects = useRef({})     // plan-row _key -> last-measured rect, FLIP's "First"
  const flipFrames = useRef({})    // plan-row _key -> pending {raf1, raf2} release, so overlapping reorders don't stomp each other
  const floatRef = useRef(null)    // the floating ghost row that tracks the pointer while dragging
  const dragMeta = useRef(null)    // { grabDY, left, width, top, item } for the row currently being grabbed
  const autoPop = useRef(true)   // gate last-set autofill to genuine exercise switches (off on resume)

  // Stable per-row identity for React keys / FLIP tracking, independent of the
  // row's position in the plan (which changes on every reorder). Routine-
  // expanded plans and manually-added rows don't carry one from the backend.
  const mintKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const withKeys = (planArr) => planArr.map((p) => (p._key ? p : { ...p, _key: mintKey() }))

  const loadExercises = () =>
    get('/exercises').then((xs) => { setExercises(xs); setExErr('') })
      .catch((e) => setExErr(e.message))

  useEffect(() => {
    loadExercises()
  }, [])

  const nameOf = (id) => exercises.find((e) => e.id === id)?.name || id
  const colorOf = (id) => exColor(exercises.find((e) => e.id === id)?.primary)
  // Which entry field a set of this exercise fills, and how that field reads.
  // duration+distance carries both duration_s and distance_mi — qty covers the
  // former (like plain `duration`), qty2 covers the latter.
  const kindOf = (metric) => metric === 'duration' || metric === 'duration+distance' ? 'duration_s'
    : metric === 'distance' ? 'distance_mi' : 'reps'
  const unitOf = (kind) => kind === 'duration_s' ? 'sec' : kind === 'distance_mi' ? 'mi' : 'reps'
  const isCombo = (metric) => metric === 'duration+distance'

  // The Completed list is the server's truth, not a client-side copy — so it
  // always reflects the actual file (incl. edits made directly to the JSONL).
  // Sets and notes interleave in the order they were logged/posted.
  const refreshLogged = (sid) =>
    get(`/sessions/${sid}`)
      .then((s) => setLogged((s.entries || []).filter((e) => e.type === 'set' || e.type === 'note').reverse()))
      .catch(() => {})

  // Resume a workout left running when we last unmounted (tab switch / reload).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null')
      if (saved?.session) {
        // Backfill _key on a session resumed from before this field existed.
        const plan = saved.session.plan ? withKeys(saved.session.plan) : saved.session.plan
        setSession({ ...saved.session, plan })
        refreshLogged(saved.session.session_id)
        setExText(saved.exText || '')
        setWeight(saved.weight ?? null)
        setQty(saved.qty ?? 10)
        setQty2(saved.qty2 ?? null)
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
        session, exText, weight, qty, qty2, setStartAt, sessionNotes, notesOpen }))
    } else {
      localStorage.removeItem(RESUME_KEY)
    }
  }, [session, exText, weight, qty, qty2, setStartAt, sessionNotes, notesOpen])

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
    setHistCollapsed(true)
    if (!exerciseId) return
    get(`/analytics/exercises/${exerciseId}/progression`)
      .then((p) => {
        setProg(p.sessions)
        const last = p.sessions.at(-1)?.sets.at(-1)
        if (autoPop.current && last) {
          setWeight(last.load_lb)
          setQty(last.duration_s ?? last.distance_mi ?? last.reps)
          setQty2(last.distance_mi ?? null)   // only shown for duration+distance
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

  // FLIP the plan rows whenever their order changes (drag, swap, add, remove):
  // measure each row's position, and if it moved since the last pass, invert
  // the jump into a transform and release it — so neighbors visibly slide into
  // the gap instead of snapping. Skipped for the row currently being finger-
  // dragged; that one tracks the pointer directly via the floating ghost.
  //
  // A fast drag can trigger this effect again before the previous pass's
  // slide has finished (each pointer-crossing updates dragIdx and re-runs
  // it, against the local preview — see `plan` below). Two things guard
  // against that overlap turning into jitter:
  // - every node is snapped to transform:none right before it's measured, so
  //   getBoundingClientRect always reads a settled natural position instead
  //   of whatever point a still-running CSS transition happened to be at
  //   (that mid-transition sampling was the actual bug — it fed essentially
  //   random deltas into the next invert, throwing rows way outside the list).
  // - any release still pending from an earlier pass is cancelled before a
  //   node is touched again, so a stale rAF can't clobber a fresh invert.
  useLayoutEffect(() => {
    const draggedKey = dragMeta.current?.item?._key
    const prev = flipRects.current
    for (const [key, node] of Object.entries(keyedRowRefs.current)) {
      if (!node) continue
      const pending = flipFrames.current[key]
      if (pending) {
        cancelAnimationFrame(pending.raf1)
        if (pending.raf2) cancelAnimationFrame(pending.raf2)
        delete flipFrames.current[key]
      }
      node.style.transition = 'none'
      node.style.transform = ''
    }
    const next = {}
    for (const [key, node] of Object.entries(keyedRowRefs.current)) {
      if (!node) continue
      const rect = node.getBoundingClientRect()
      next[key] = rect
      if (key === draggedKey) continue
      const before = prev[key]
      if (before && before.top !== rect.top) {
        const dy = before.top - rect.top
        node.style.transform = `translateY(${dy}px)`
        const handle = {}
        handle.raf1 = requestAnimationFrame(() => {
          handle.raf2 = requestAnimationFrame(() => {
            node.style.transition = 'transform 180ms ease'
            node.style.transform = ''
            delete flipFrames.current[key]
          })
        })
        flipFrames.current[key] = handle
      }
    }
    flipRects.current = next
  }, [session?.plan, dragIdx])

  // Newest-first, and the collapsed view is just the head of it.
  const history = useMemo(() => prog.slice().reverse(), [prog])
  const shownHistory = histCollapsed ? history.slice(0, HIST_PREVIEW) : history

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
    flipRects.current = {}; flipFrames.current = {}; keyedRowRefs.current = {}
    setSession({ session_id: r.session_id, plan: r.plan ? withKeys(r.plan) : r.plan,
      planIdx: 0, startedAt: Date.now() })
    setLogged([]); setExTab('exercise'); setPlanCollapsed(true); setCompletedCollapsed(true); setSwapIdx(null)
    setTimer(null); setSetStartAt(Date.now())
    setExText('')
  }

  async function logSet() {
    setErr('')
    unlockAudio()  // user gesture — lets the rest timer beep at zero
    try {
      const num = (v) => (v === '' || v == null ? null : Number(v))
      const body = {
        session_id: session.session_id, exercise_id: exerciseId,
        rpe: num(rpe) || undefined,
      }
      body[kindOf(metric)] = num(qty)
      if (isCombo(metric)) body.distance_mi = num(qty2)
      if (showWeight) body.weight_lb = num(weight)
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
      plan: [...(s.plan || []), { exercise_id: exerciseId || '', round: 1, rest_s: null, _key: mintKey() }] }))
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
  // HTML5 drag-and-drop). A press only becomes a drag after a 200ms hold on
  // the handle, so a quick tap doesn't accidentally grab the row. The
  // pointer's latest position is tracked the whole time (not just once
  // dragging), so a finger that drifts during that hold doesn't leave the
  // ghost's grab point stale the moment it mounts.
  //
  // Once armed, the grabbed row turns into a floating ghost that tracks the
  // pointer directly (see the render below); the row's own slot in the list
  // becomes an empty placeholder. Nothing is committed to `session` while
  // dragging, though — dragIdx only drives a local preview (the `plan` above)
  // that the ghost/placeholder/FLIP render from; reorderPlan runs exactly
  // once, on drop. Committing on every pointer-crossing (the previous
  // approach) meant every crossing also fired the session-persistence
  // effect's synchronous localStorage write and a forced layout, competing
  // with the FLIP animation for the same frames — the actual source of the
  // stutter/jitter on a fast drag, separate from the transform-math bug.
  function startRowDrag(e, idx) {
    e.preventDefault()
    const downY = e.clientY   // original touch point — the grab offset within
    let current = idx         // the row is fixed relative to this, not to
    let dragging = false      // wherever the finger ends up by arm time
    let lastY = downY
    const armTimer = setTimeout(() => {
      const rect = rowRefs.current[idx]?.getBoundingClientRect()
      if (!rect) return
      dragging = true
      const grabDY = downY - rect.top
      dragMeta.current = {
        grabDY, left: rect.left, width: rect.width,
        top: lastY - grabDY,   // mount under the finger's current spot, not
        item: plan[idx],       // the row's original one, in case it drifted
      }
      setDragIdx(idx)
    }, 200)

    const onMove = (ev) => {
      lastY = ev.clientY
      if (!dragging) return
      if (floatRef.current) floatRef.current.style.top = `${ev.clientY - dragMeta.current.grabDY}px`
      for (const [key, el] of Object.entries(rowRefs.current)) {
        if (!el) continue
        const target = Number(key)
        if (target === current) continue
        const r = el.getBoundingClientRect()
        if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
          current = target
          setDragIdx(target)
          break
        }
      }
    }
    const onUp = () => {
      clearTimeout(armTimer)
      if (dragging) {
        // Bookkeep the ghost's last floating rect as this row's "before" spot,
        // so the FLIP effect animates it landing back into the list instead of
        // just popping into place once the ghost unmounts.
        if (floatRef.current && dragMeta.current) {
          flipRects.current[dragMeta.current.item._key] = floatRef.current.getBoundingClientRect()
        }
        // Commit the reorder exactly once, from the row's real (undragged)
        // index to wherever the preview ended up.
        const fromIdx = (session.plan || []).findIndex((p) => p._key === dragMeta.current?.item?._key)
        if (fromIdx !== -1 && fromIdx !== current) reorderPlan(fromIdx, current)
        dragMeta.current = null
        setDragIdx(null)
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function startEdit(l) {
    const kind = l.duration_s != null && l.distance_mi != null ? 'combo'
      : l.duration_s != null ? 'duration_s' : l.distance_mi != null ? 'distance_mi' : 'reps'
    setEditId(l.id)
    setEditVal({ exercise_id: l.exercise_id, kind,
      weight: l.weight_lb ?? l.added_weight_lb ?? '',
      qty: kind === 'combo' ? l.duration_s : (l[kind] ?? ''),
      qty2: kind === 'combo' ? l.distance_mi : '',
      rpe: l.rpe ?? '' })
  }

  // Re-point a logged set at a different exercise. If the new one is tracked by
  // another metric the quantity field switches with it, and the old number is
  // dropped rather than silently reinterpreted (45 seconds isn't 45 reps).
  function editExercise(name) {
    const ex = exercises.find((e) => e.name === name)
    setEditPick(false)
    if (!ex) return
    const kind = isCombo(ex.metric) ? 'combo' : kindOf(ex.metric)
    setEditVal((v) => ({ ...v, exercise_id: ex.id, kind,
      qty: v.kind === kind ? v.qty : '', qty2: v.kind === kind ? v.qty2 : '' }))
  }

  async function saveEdit(l) {
    const num = (v) => (v === '' || v == null ? null : Number(v))
    // The patch merges into the stored entry, so every field the set no longer
    // uses has to be nulled explicitly — omitting it would leave the old value.
    const p = {
      exercise_id: editVal.exercise_id, weight_lb: num(editVal.weight), rpe: num(editVal.rpe),
      reps: null, duration_s: null, distance_mi: null, added_weight_lb: null,
      ...(editVal.kind === 'combo'
        ? { duration_s: num(editVal.qty), distance_mi: num(editVal.qty2) }
        : { [editVal.kind]: num(editVal.qty) }),
    }
    try {
      await patch(`/entries/${l.id}`, p)
      setEditId(null)
      refreshLogged(session.session_id)
    } catch (e) { setErr(e.message) }
  }

  async function deleteEntry(id) {
    try {
      await del(`/entries/${id}`)
      if (editId === id) setEditId(null)
      if (editNoteId === id) setEditNoteId(null)
      refreshLogged(session.session_id)
    } catch (e) { setErr(e.message) }
    setConfirmId(null)
  }

  // Posts the composer's text as its own note entry immediately — chat-style,
  // not accumulated into one blob for session_end. Shows up in Completed (and
  // History) interleaved with sets in the order it landed.
  async function postNote() {
    const text = sessionNotes.trim()
    if (!text) return
    try {
      await post('/notes', { session_id: session.session_id, text })
      setSessionNotes('')
      refreshLogged(session.session_id)
    } catch (e) { setErr(e.message) }
  }

  function startEditNote(n) {
    setEditNoteId(n.id)
    setEditNoteText(n.text || '')
  }

  async function saveEditNote() {
    const text = editNoteText.trim()
    if (!text) return
    try {
      await patch(`/entries/${editNoteId}`, { text })
      setEditNoteId(null)
      refreshLogged(session.session_id)
    } catch (e) { setErr(e.message) }
  }

  async function endSession() {
    await post(`/sessions/${session.session_id}/end`, {})
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

  const realPlan = session.plan || []
  // While a row is being dragged, render/measure a local preview (the real
  // plan reordered to wherever dragIdx currently is) instead of committing —
  // see startRowDrag for why.
  const plan = dragIdx != null ? movePreview(realPlan, dragMeta.current?.item?._key, dragIdx) : realPlan
  const upcoming = plan.slice(session.planIdx)
  // The current/next set always shows; the chevron reveals the ones below it.
  const shownUpcoming = planCollapsed ? upcoming.slice(0, 1) : upcoming
  const nSets = logged.reduce((n, l) => n + (l.type === 'set' ? 1 : 0), 0)
  const nNotes = logged.length - nSets
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
                    onChange={(e) => setWeight(e.target.value)} />
                  <span className="unit">{WEIGHT_UNIT}</span>
                </div>
              )}
              <div className="field">
                <input className="numval" inputMode={metric === 'distance' ? 'decimal' : 'numeric'} value={qty ?? ''}
                  onChange={(e) => setQty(e.target.value)} />
                <span className="unit">{qtyUnit}</span>
              </div>
              {isCombo(metric) && (
                <div className="field">
                  <input className="numval" inputMode="decimal" value={qty2 ?? ''}
                    onChange={(e) => setQty2(e.target.value)} />
                  <span className="unit">mi</span>
                </div>
              )}
              <div className="field">
                <input className="numval" inputMode="decimal" value={rpe ?? ''}
                  onChange={(e) => setRpe(e.target.value)} />
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
                      {/* Everything's here, but only the last few sessions show
                          until you ask for the rest. */}
                      {history.length > HIST_PREVIEW && (
                        <button className="section-toggle" aria-expanded={!histCollapsed}
                          onClick={() => setHistCollapsed((c) => !c)}>
                          <span className={`chev ${histCollapsed ? '' : 'open'}`}>▸</span>
                          History <span className="muted count-hint">· {history.length} sessions</span>
                        </button>
                      )}
                      {shownHistory.map((s) => (
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
            const rowRef = (el) => { rowRefs.current[idx] = el; keyedRowRefs.current[p._key] = el }
            // Editing a plan row expands it inline — exercise picker + delete —
            // the same pattern as a Completed set, instead of a modal.
            if (planEditIdx === idx) {
              return (
                <div className="setedit" key={p._key} ref={rowRef}>
                  <button className="expicker-trigger" onClick={() => setSwapIdx(idx)}>
                    <span className="exdot" style={{ background: colorOf(p.exercise_id) }} />
                    {nameOf(p.exercise_id) || <span className="muted">choose exercise…</span>}
                  </button>
                  <div className="row">
                    <button className="ghost" onClick={() => setPlanEditIdx(null)}>Cancel</button>
                    <button className="ghost danger"
                      onClick={() => { removePlanRow(idx); setPlanEditIdx(null) }}>Delete</button>
                  </div>
                </div>
              )
            }
            // The row currently being finger-dragged is a blank placeholder —
            // an empty slot at wherever the pointer is hovering — while its
            // actual content floats separately as the ghost rendered below.
            if (dragIdx === idx) {
              return <div className="plan-row" key={p._key} ref={rowRef} />
            }
            return (
              <div className={`plan-row ${i === 0 ? 'current' : ''}`} key={p._key} ref={rowRef}>
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

      {dragIdx != null && dragMeta.current && (
        <div className="plan-row plan-ghost" ref={floatRef}
          style={{ left: dragMeta.current.left, width: dragMeta.current.width, top: dragMeta.current.top }}>
          <div className="plan-main">
            <span className="plan-handle" aria-hidden="true">⠿</span>
            <span className="exdot" style={{ background: colorOf(dragMeta.current.item.exercise_id) }} />
            <span className="plan-ex">{nameOf(dragMeta.current.item.exercise_id)}</span>
          </div>
        </div>
      )}

      {logged.length > 0 && (
        <div className="card completed">
          <button className="section-toggle" aria-expanded={!completedCollapsed}
            style={{ marginBottom: completedCollapsed ? 0 : 6 }}
            onClick={() => setCompletedCollapsed((c) => !c)}>
            <span className={`chev ${completedCollapsed ? '' : 'open'}`}>▸</span>
            Completed <span className="muted count-hint">
              · {nSets} set{nSets === 1 ? '' : 's'}{nNotes ? `, ${nNotes} note${nNotes === 1 ? '' : 's'}` : ''}
            </span>
          </button>
          {/* Sets and notes interleave in logged order. A logged set is fully
              editable — exercise included — with the editor taking over the row
              so all four fields fit a 360px screen in one column; a note is
              just its text with an inline edit. */}
          {!completedCollapsed && logged.map((l) => l.type === 'note' ? (
            editNoteId === l.id ? (
              <div className="setedit" key={l.id}>
                <textarea className="notes-area no-autoselect" rows={3} value={editNoteText}
                  onChange={(e) => setEditNoteText(e.target.value)} />
                <div className="row">
                  <button className="primary" disabled={!editNoteText.trim()} onClick={saveEditNote}>Save</button>
                  <button className="ghost" onClick={() => setEditNoteId(null)}>Cancel</button>
                  <button className="ghost danger" onClick={() => setConfirmId(l.id)}>Delete</button>
                </div>
              </div>
            ) : (
              <div className="entry note-entry" key={l.id}>
                <div className="main note-text">{l.text}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className="ghost" style={{ minHeight: 40, padding: '0 10px' }}
                    onClick={() => startEditNote(l)}>✎</button>
                </div>
              </div>
            )
          ) : editId === l.id ? (
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
                    value={editVal.qty} aria-label={editVal.kind === 'combo' ? 'sec' : unitOf(editVal.kind)}
                    onChange={(e) => setEditVal({ ...editVal, qty: e.target.value })} />
                  <span className="unit">{editVal.kind === 'combo' ? 'sec' : unitOf(editVal.kind)}</span>
                </label>
                {editVal.kind === 'combo' && (
                  <label className="setedit-field">
                    <input inputMode="decimal" value={editVal.qty2} aria-label="mi"
                      onChange={(e) => setEditVal({ ...editVal, qty2: e.target.value })} />
                    <span className="unit">mi</span>
                  </label>
                )}
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
          <>
            <textarea className="notes-area no-autoselect" rows={4} value={sessionNotes}
              placeholder="How did that go? Energy, aches, PRs…"
              onChange={(e) => setSessionNotes(e.target.value)} />
            <button className="primary" style={{ marginTop: 8 }}
              disabled={!sessionNotes.trim()} onClick={postNote}>Post</button>
          </>
        )}
      </div>

      <button className="big danger" onClick={() => setConfirmFinish(true)}>Finish workout</button>

      <ExercisePicker open={pickerOpen} exercises={exercises} value={exText}
        onSelect={(name) => { setExText(name); setPickerOpen(false) }}
        onClose={() => setPickerOpen(false)} />

      <ExercisePicker open={swapIdx != null} exercises={exercises}
        value={swapIdx != null ? nameOf(plan[swapIdx]?.exercise_id) : ''}
        onSelect={(name) => { applySwap(swapIdx, name); setPlanEditIdx(null) }}
        onClose={() => setSwapIdx(null)} />

      <ExercisePicker open={editPick} exercises={exercises} value={nameOf(editVal.exercise_id)}
        onSelect={editExercise} onClose={() => setEditPick(false)} />

      <Confirm open={confirmId != null}
        message="Delete this entry? git history keeps the audit trail."
        onConfirm={() => deleteEntry(confirmId)} onCancel={() => setConfirmId(null)} />

      <Confirm open={confirmFinish}
        message="Finish this workout? You won't be able to log more sets to it."
        confirmLabel="Finish" onConfirm={endSession} onCancel={() => setConfirmFinish(false)} />
    </>
  )
}
