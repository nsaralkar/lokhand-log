// In-app confirmation modal — replaces the browser confirm() so destructive
// actions get a styled "are you sure" step. Controlled: render when `open`.
export default function Confirm({ open, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  if (!open) return null
  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div className="modal card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p style={{ margin: '4px 0 14px' }}>{message}</p>
        <div className="row">
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
