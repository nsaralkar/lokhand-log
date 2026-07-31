import { useEffect, useState } from 'react'
import { get, post, put, RESUME_KEY } from '../api'
import YamlItemDialog from '../components/YamlItemDialog'

const NEW_DAY_TEMPLATE = `name: New Day
blocks:
  - exercises: [exercise_id]
    rounds: 3
`

// Each routine YAML file (a program with a name + days) is one collapsible
// section; each day inside it is a tappable "routine" that opens a
// preview/edit/start dialog. Files themselves aren't created here -- add a
// day to an existing file, or drop a new YAML into shared/routines/ by hand.
export default function Routines({ navigate, menuBtn, workoutClock }) {
  const [routines, setRoutines] = useState({})
  const [expanded, setExpanded] = useState(new Set())
  const [initialized, setInitialized] = useState(false)
  const [dialog, setDialog] = useState(null) // {slug, idx, day, title, yaml, isNew}
  const [err, setErr] = useState('')

  const load = () => get('/routines').then((r) => {
    setRoutines(r)
    if (!initialized) { setExpanded(new Set(Object.keys(r))); setInitialized(true) }
  })
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(slug) {
    setExpanded((s) => {
      const next = new Set(s)
      next.has(slug) ? next.delete(slug) : next.add(slug)
      return next
    })
  }

  async function openDay(slug, idx, day) {
    setErr('')
    try {
      const qs = day.name ? `?day=${encodeURIComponent(day.name)}` : ''
      const r = await get(`/routines/${encodeURIComponent(slug)}/preview${qs}`)
      setDialog({ slug, idx, day, title: r.name, yaml: r.yaml, isNew: false })
    } catch (e) { setErr(e.message) }
  }

  function openNewDay(slug) {
    setErr('')
    setDialog({ slug, idx: null, day: null, title: 'New routine', yaml: NEW_DAY_TEMPLATE, isNew: true })
  }

  async function saveDay(text) {
    if (dialog.isNew) await post(`/routines/${encodeURIComponent(dialog.slug)}/days`, { text })
    else await put(`/routines/${encodeURIComponent(dialog.slug)}/days/${dialog.idx}`, { text })
    await load()
  }

  async function startDay() {
    const r = await post('/sessions/start', { routine: dialog.slug, day: dialog.day?.name })
    localStorage.setItem(RESUME_KEY, JSON.stringify({
      session: { session_id: r.session_id, plan: r.plan, planIdx: 0, startedAt: Date.now() } }))
    navigate('session')
  }

  const routineList = Object.entries(routines)
  return (
    <>
      <div className="pagehead">{menuBtn}<h1>Routines</h1>{workoutClock}</div>
      {err && <p className="error">{err}</p>}
      {routineList.map(([slug, r]) => (
        <div className="card" key={slug}>
          <button className="section-toggle" aria-expanded={expanded.has(slug)} onClick={() => toggle(slug)}>
            <span className={`chev ${expanded.has(slug) ? 'open' : ''}`}>▸</span> {r.name || slug}
          </button>
          {expanded.has(slug) && (
            <div style={{ marginTop: 10 }}>
              {(r.days || []).map((d, i) => (
                <button className="big" key={d.name || i} style={{ marginBottom: 8 }}
                  onClick={() => openDay(slug, i, d)}>{d.name || `Day ${i + 1}`}</button>
              ))}
              <button className="big" onClick={() => openNewDay(slug)}>+ Add Routine</button>
            </div>
          )}
        </div>
      ))}
      {!routineList.length && (
        <p className="muted">No routines yet. Drop a routine YAML in your data repo's <code>shared/routines/</code>.</p>
      )}

      <YamlItemDialog open={dialog != null} title={dialog?.title} yaml={dialog?.yaml} isNew={dialog?.isNew}
        onSave={saveDay} onStart={dialog && !dialog.isNew ? startDay : undefined}
        onClose={() => setDialog(null)} />
    </>
  )
}
