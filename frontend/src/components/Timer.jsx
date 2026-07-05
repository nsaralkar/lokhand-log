import { useEffect, useRef, useState } from 'react'

// Rest timer: counts down from the exercise's default rest (returned by the
// backend when a set is logged). Goes red past zero. Beeps at 0 via WebAudio.
// Known PWA limit: suspended if the phone locks — we request a wake lock while
// a session is active (see Session.jsx); native notifications are the Expo
// path if this ever becomes a dealbreaker.
export default function Timer({ target, startedAt, label, onAdjust }) {
  const [now, setNow] = useState(Date.now())
  const beeped = useRef(false)

  useEffect(() => {
    beeped.current = false
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [startedAt, target])

  if (!startedAt) return null
  const elapsed = Math.floor((now - startedAt) / 1000)
  const remaining = target - elapsed

  if (remaining <= 0 && !beeped.current) {
    beeped.current = true
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      osc.start(); osc.stop(ctx.currentTime + 0.4)
      navigator.vibrate?.([200, 100, 200])
    } catch { /* audio unavailable; timer color still flips */ }
  }

  const abs = Math.abs(remaining)
  const mm = Math.floor(abs / 60), ss = String(abs % 60).padStart(2, '0')
  return (
    <div className="timer card">
      <div className="sub">{remaining >= 0 ? `rest — next: ${label || 'go'}` : 'go'}</div>
      <div className={`clock ${remaining < 0 ? 'over' : ''}`}>
        {remaining < 0 ? '+' : ''}{mm}:{ss}
      </div>
      <div className="controls">
        <button onClick={() => onAdjust(-30)}>-30s</button>
        <button onClick={() => onAdjust(30)}>+30s</button>
        <button onClick={() => onAdjust('skip')}>Skip</button>
      </div>
    </div>
  )
}
