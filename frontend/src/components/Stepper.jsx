// Big-numeral stepper: +/- buttons sized for thumbs; the value is still a real
// input so a keyboard entry is one tap away.
export default function Stepper({ value, onChange, step = 1, min = 0, suffix }) {
  const set = (v) => onChange(Math.max(min, Math.round(v * 100) / 100))
  return (
    <div className="stepper">
      <button aria-label="decrease" onClick={() => set((value || 0) - step)}>−</button>
      <div className="value">
        <input
          inputMode="decimal"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
        {suffix && <span className="muted" style={{ fontSize: 16, paddingRight: 10 }}>{suffix}</span>}
      </div>
      <button aria-label="increase" onClick={() => set((value || 0) + step)}>+</button>
    </div>
  )
}
