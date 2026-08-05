// Edit a single Plan row: swap its exercise (via the universal picker) or
// drop it from the in-session plan. Replaces the old inline swap/remove
// buttons on the row itself, which crowded the plan list.
export default function PlanRowEdit({ open, name, color, onPick, onDelete, onClose }) {
  if (!open) return null
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="expicker-trigger" onClick={onPick}>
          <span className="exdot" style={{ background: color }} />
          {name || <span className="muted">choose exercise…</span>}
        </button>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="ghost danger" onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  )
}
