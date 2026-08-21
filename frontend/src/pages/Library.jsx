import { useEffect, useMemo, useState } from 'react'
import { exColor, get, MUSCLE_COLORS, post, put } from '../api'
import YamlItemDialog from '../components/YamlItemDialog'

const NEW_EXERCISE_TEMPLATE = `name: New Exercise
primary: chest
`

// Canonical muscle-group order (same as the bumper-plate palette in api.js);
// any primary not in there (shouldn't happen, but data is hand-edited YAML)
// still shows up, just sorted after the known groups.
const GROUP_ORDER = Object.keys(MUSCLE_COLORS)

// Same idea as Routines: every exercise is a button; tapping one opens a
// preview/edit dialog for just that entry's YAML (no id key -- the id is
// fixed once created, since routines/logged sets reference it). Exercises
// are grouped into collapsible sections by primary muscle, mirroring
// Routines' program sections.
export default function Library({ menuBtn, workoutClock }) {
  const [exercises, setExercises] = useState([])
  const [expanded, setExpanded] = useState(new Set())
  const [initialized, setInitialized] = useState(false)
  const [dialog, setDialog] = useState(null) // {id, title, yaml, isNew}
  const [err, setErr] = useState('')

  const load = () => get('/exercises').then((list) => {
    setExercises(list)
    if (!initialized) { setExpanded(new Set(list.map((e) => e.primary))); setInitialized(true) }
  })
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const byGroup = {}
    for (const ex of exercises) (byGroup[ex.primary] ||= []).push(ex)
    for (const list of Object.values(byGroup)) list.sort((a, b) => a.name.localeCompare(b.name))
    const rest = Object.keys(byGroup).filter((g) => !GROUP_ORDER.includes(g)).sort()
    return [...GROUP_ORDER, ...rest].filter((g) => byGroup[g]).map((g) => [g, byGroup[g]])
  }, [exercises])

  function toggle(group) {
    setExpanded((s) => {
      const next = new Set(s)
      next.has(group) ? next.delete(group) : next.add(group)
      return next
    })
  }

  async function openExercise(ex) {
    setErr('')
    try {
      const r = await get(`/exercises/${encodeURIComponent(ex.id)}/raw`)
      setDialog({ id: ex.id, title: ex.name, yaml: r.yaml, isNew: false })
    } catch (e) { setErr(e.message) }
  }

  function openNew() {
    setErr('')
    setDialog({ id: null, title: 'New exercise', yaml: NEW_EXERCISE_TEMPLATE, isNew: true })
  }

  async function saveExercise(text) {
    if (dialog.isNew) await post('/exercises/raw', { text })
    else await put(`/exercises/${encodeURIComponent(dialog.id)}/raw`, { text })
    await load()
  }

  return (
    <>
      <div className="pagehead">{menuBtn}<h1>Library</h1>{workoutClock}</div>
      {err && <p className="error">{err}</p>}
      <div className="card">
        <button className="big primary" onClick={openNew}>+ Add Exercise</button>
      </div>
      {groups.map(([group, list]) => (
        <div className="card" key={group}>
          <button className="section-toggle" aria-expanded={expanded.has(group)} onClick={() => toggle(group)}>
            <span className={`chev ${expanded.has(group) ? 'open' : ''}`}>▸</span>
            <span className="exdot" style={{ background: exColor(group) }} />
            {group}
            <span className="count-hint muted">· {list.length}</span>
          </button>
          {expanded.has(group) && (
            <div style={{ marginTop: 10 }}>
              {list.map((ex) => (
                <button className="big" key={ex.id} style={{ marginBottom: 8 }}
                  onClick={() => openExercise(ex)}>{ex.name}</button>
              ))}
            </div>
          )}
        </div>
      ))}
      {!exercises.length && <p className="muted">No exercises yet. Add one above.</p>}

      <YamlItemDialog open={dialog != null} title={dialog?.title} yaml={dialog?.yaml} isNew={dialog?.isNew}
        onSave={saveExercise} onClose={() => setDialog(null)} />
    </>
  )
}
