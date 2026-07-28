import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

// Tapping any text field selects its whole contents, so a value can be replaced
// in one keystroke (weights/reps are edited far more often than appended to).
// Session notes are prose, not a value to replace, so they're opted out via
// the no-autoselect class and just get a plain cursor.
document.addEventListener('focusin', (e) => {
  const el = e.target
  if (el.classList?.contains('no-autoselect')) return
  if (el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLInputElement && !['checkbox', 'radio', 'range'].includes(el.type))) {
    // rAF so it runs after the browser's own click-to-place-caret handling.
    requestAnimationFrame(() => { try { el.select() } catch { /* unsupported input type */ } })
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
)
