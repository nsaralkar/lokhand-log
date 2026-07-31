import { useEffect, useState } from 'react'
import { get, put } from '../api'

// Raw-YAML editor for the shared exercise library. No form UI yet -- the file
// is small and hand-edited already, so a validated textarea covers add/view/edit
// in one shot (a new entry is just another block of YAML at the end).
export default function Library({ menuBtn, workoutClock }) {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    get('/exercises/raw').then((r) => { setText(r.text); setSaved(r.text); setLoaded(true) })
      .catch((e) => setErr(e.message))
  }, [])

  async function save() {
    setBusy(true); setErr('')
    try {
      const r = await put('/exercises/raw', { text })
      setText(r.text); setSaved(r.text)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const dirty = text !== saved

  return (
    <>
      <div className="pagehead">{menuBtn}<h1>Library</h1>{workoutClock}</div>
      <p className="muted">
        <code>shared/exercises.yaml</code> — one entry per exercise. Add a new one by
        typing its <code>id:</code> block below.
      </p>
      {err && <p className="error">{err}</p>}
      {!loaded
        ? <p className="muted">Loading…</p>
        : (
          <>
            <textarea className="yaml-editor no-autoselect" spellCheck={false}
              autoCapitalize="none" autoCorrect="off"
              value={text} onChange={(e) => setText(e.target.value)} />
            <button className="big primary" disabled={!dirty || busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
    </>
  )
}
