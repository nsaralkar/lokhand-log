import { useMemo, useState } from 'react'
import { exColor } from '../api'

// Full-list exercise picker, replacing <input list=...> — Android Chrome never
// shows the native datalist dropdown on tap, only text selection. This modal
// scrolls the whole exercise list by default; the search box filters it.
export default function ExercisePicker({ open, exercises, value, onSelect, onClose }) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? exercises.filter((e) => e.name.toLowerCase().includes(needle)) : exercises
  }, [exercises, q])

  if (!open) return null
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal card expicker" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="search exercises…" />
        <div className="expicker-list">
          {filtered.map((e) => (
            <button key={e.id} className={`expicker-row ${e.name === value ? 'on' : ''}`}
              onClick={() => onSelect(e.name)}>
              <span className="exdot" style={{ background: exColor(e.primary) }} />
              {e.name}
            </button>
          ))}
          {!filtered.length && <p className="muted" style={{ padding: '10px 4px' }}>No matches.</p>}
        </div>
      </div>
    </div>
  )
}
