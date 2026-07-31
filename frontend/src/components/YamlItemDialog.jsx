import { useEffect, useState } from 'react'

// Tap-to-inspect dialog shared by Library (exercises) and Routines (days):
// shows one item's YAML, with an Edit button that turns the preview into an
// editable textarea in place. `isNew` skips straight to editing a blank
// template (Add Exercise / Add Routine) with no preview step. `onStart`,
// when given, adds a Start action (Routines only).
export default function YamlItemDialog({ open, title, yaml, isNew, onSave, onStart, onClose }) {
  const [editing, setEditing] = useState(!!isNew)
  const [draft, setDraft] = useState(yaml || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    setEditing(!!isNew); setDraft(yaml || ''); setErr(''); setBusy(false)
  }, [open, isNew, yaml])

  if (!open) return null

  function cancelEdit() {
    if (isNew) { onClose(); return }
    setEditing(false); setDraft(yaml || '')
  }

  async function save() {
    setBusy(true); setErr('')
    try { await onSave(draft); onClose() }
    catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function start() {
    setBusy(true); setErr('')
    try { await onStart() }
    catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal card preview" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {err && <p className="error">{err}</p>}
        {editing
          ? (
            <textarea className="yaml-editor no-autoselect" spellCheck={false}
              autoCapitalize="none" autoCorrect="off" autoFocus
              value={draft} onChange={(e) => setDraft(e.target.value)} />
          )
          : <pre className="yaml-preview">{yaml}</pre>}
        <div className="row">
          {editing ? (
            <>
              <button className="ghost" disabled={busy} onClick={cancelEdit}>Cancel</button>
              <button className="primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : isNew ? 'Create' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <button className="ghost" onClick={onClose}>Close</button>
              {onStart && (
                <button className="ghost" disabled={busy} onClick={start}>
                  {busy ? 'Starting…' : 'Start'}
                </button>
              )}
              <button className="primary" onClick={() => setEditing(true)}>Edit</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
