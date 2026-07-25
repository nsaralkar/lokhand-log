// Look-before-you-start confirmation: shows the picked day's raw YAML (as
// stored in the routine file) before committing to /sessions/start.
export default function RoutinePreview({ preview, onStart, onClose }) {
  if (!preview) return null
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal card preview" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{preview.name}</h3>
        <pre className="yaml-preview">{preview.yaml}</pre>
        <div className="row">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={onStart}>Start</button>
        </div>
      </div>
    </div>
  )
}
