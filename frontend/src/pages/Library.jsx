import { useEffect, useState } from 'react'
import { get, post, put } from '../api'
import YamlItemDialog from '../components/YamlItemDialog'

const NEW_EXERCISE_TEMPLATE = `name: New Exercise
primary: chest
`

// Same idea as Routines: every exercise is a button; tapping one opens a
// preview/edit dialog for just that entry's YAML (no id key -- the id is
// fixed once created, since routines/logged sets reference it).
export default function Library({ menuBtn, workoutClock }) {
  const [exercises, setExercises] = useState([])
  const [dialog, setDialog] = useState(null) // {id, title, yaml, isNew}
  const [err, setErr] = useState('')

  const load = () => get('/exercises').then(setExercises)
  useEffect(() => { load() }, [])

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
      {exercises.map((ex) => (
        <div className="card" key={ex.id}>
          <button className="big" onClick={() => openExercise(ex)}>{ex.name}</button>
        </div>
      ))}
      {!exercises.length && <p className="muted">No exercises yet. Add one above.</p>}

      <YamlItemDialog open={dialog != null} title={dialog?.title} yaml={dialog?.yaml} isNew={dialog?.isNew}
        onSave={saveExercise} onClose={() => setDialog(null)} />
    </>
  )
}
