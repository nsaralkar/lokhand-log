import { useEffect, useState } from 'react'
import { get, post, put } from '../api'

const BLANK = `name: New Routine
days:
  - name: Day 1
    blocks:
      - exercises: [exercise_id]
        rounds: 3
`

// Raw-YAML editor for shared/routines/*.yaml, one file per routine. Same idea
// as Library: view/add/edit are all just a validated textarea, no day/block UI.
export default function Routines({ menuBtn, workoutClock }) {
  const [routines, setRoutines] = useState({})
  const [slug, setSlug] = useState(null)      // routine being edited, or null for the list
  const [creating, setCreating] = useState(false)
  const [newSlug, setNewSlug] = useState('')
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => get('/routines').then(setRoutines)
  useEffect(() => { load() }, [])

  async function open(s) {
    setErr(''); setCreating(false)
    const r = await get(`/routines/${encodeURIComponent(s)}/raw`)
    setSlug(s); setText(r.text); setSaved(r.text)
  }

  function startCreate() {
    setErr(''); setSlug(null); setCreating(true)
    setNewSlug(''); setText(BLANK); setSaved(null)
  }

  async function save() {
    setBusy(true); setErr('')
    try {
      if (creating) {
        const r = await post('/routines/raw', { slug: newSlug.trim() || undefined, text })
        await load()
        setCreating(false); setSlug(r.slug); setText(r.text); setSaved(r.text)
      } else {
        const r = await put(`/routines/${encodeURIComponent(slug)}/raw`, { text })
        setText(r.text); setSaved(r.text)
        await load()
      }
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  function back() {
    setSlug(null); setCreating(false); setErr('')
  }

  const dirty = creating || text !== saved

  if (slug != null || creating) {
    return (
      <>
        <div className="pagehead">{menuBtn}<h1>Routines</h1>{workoutClock}</div>
        <button className="ghost" onClick={back}>‹ All routines</button>
        {creating && (
          <>
            <label>Filename slug (optional — derived from the routine's name if left blank)</label>
            <input value={newSlug} onChange={(e) => setNewSlug(e.target.value)}
              placeholder="push_day" />
          </>
        )}
        {!creating && <h2>{routines[slug]?.name || slug}</h2>}
        {err && <p className="error">{err}</p>}
        <textarea className="yaml-editor no-autoselect" spellCheck={false}
          autoCapitalize="none" autoCorrect="off"
          value={text} onChange={(e) => setText(e.target.value)} />
        <button className="big primary" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Saving…' : creating ? 'Create routine' : 'Save'}
        </button>
      </>
    )
  }

  const routineList = Object.entries(routines)
  return (
    <>
      <div className="pagehead">{menuBtn}<h1>Routines</h1>{workoutClock}</div>
      <div className="card">
        <button className="big primary" onClick={startCreate}>+ New routine</button>
      </div>
      {routineList.map(([s, r]) => (
        <div className="card" key={s}>
          <button className="big" onClick={() => open(s)}>{r.name || s}</button>
        </div>
      ))}
      {!routineList.length && (
        <p className="muted">No routines yet. Add one above, or drop a routine YAML in your data repo's <code>shared/routines/</code>.</p>
      )}
    </>
  )
}
