// Rest-timer beep. Mobile browsers only let audio play from a running
// AudioContext, and a context created cold starts "suspended". So we keep one
// shared context and resume() it from a user gesture (the Log set tap) via
// unlockAudio(); by the time the timer hits zero the context is already running.
let ctx

function context() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  return ctx
}

export function unlockAudio() {
  try {
    const c = context()
    if (c.state === 'suspended') c.resume().catch(() => {})
  } catch { /* WebAudio unavailable */ }
}

export function beep() {
  try {
    const c = context()
    if (c.state === 'suspended') c.resume()
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.connect(gain); gain.connect(c.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.3, c.currentTime)
    osc.start(); osc.stop(c.currentTime + 0.4)
    navigator.vibrate?.([200, 100, 200])
  } catch { /* audio unavailable; timer color still flips */ }
}
