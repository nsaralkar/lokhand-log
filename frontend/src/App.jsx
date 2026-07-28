import { useEffect, useState } from 'react'
import { get, RESUME_KEY, fmtElapsed } from './api'
import Login from './pages/Login'
import Home from './pages/Home'
import Session from './pages/Session'
import History from './pages/History'
import Trends from './pages/Trends'
import Metrics from './pages/Metrics'

const TABS = { home: Home, workout: Session, history: History, trends: Trends, body: Metrics }

export default function App() {
  const [user, setUser] = useState(undefined) // undefined = checking
  const [tab, setTab] = useState('home')
  const [menu, setMenu] = useState(false)
  const [pendingSession, setPendingSession] = useState(null) // hand-off to History
  const [elapsedMs, setElapsedMs] = useState(null) // active workout's running time, or null

  useEffect(() => {
    get('/me').then(setUser).catch(() => setUser(null))
  }, [])

  // The workout clock has to survive Session unmounting on every tab switch, so
  // it's read from the same localStorage blob Session persists itself into,
  // rather than lifted state — this is the one place that reads it from outside
  // that page.
  useEffect(() => {
    const tick = () => {
      let startedAt = null
      try { startedAt = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null')?.session?.startedAt } catch { /* corrupt */ }
      setElapsedMs(startedAt ? Date.now() - startedAt : null)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  if (user === undefined) return null
  if (user === null) return <Login onLogin={setUser} />

  // Cross-tab navigation. Pages call navigate('history', { session: sid }) to
  // jump to another tab and (optionally) deep-link into a specific record.
  const navigate = (t, opts = {}) => {
    if (opts.session) setPendingSession(opts.session)
    setTab(t); setMenu(false)
  }
  const pick = (t) => navigate(t)

  // The drawer trigger is owned here but rendered by each page inline (e.g. on
  // the same line as the workout subtabs), so there's no separate top bar.
  const menuBtn = (
    <button className="hamburger" aria-label="Menu" aria-expanded={menu}
      onClick={() => setMenu((m) => !m)}>☰</button>
  )

  // A workout in progress stays visible no matter which tab you wander off to.
  const workoutClock = elapsedMs != null && (
    <span className="pagehead-clock" title="Active workout time">{fmtElapsed(elapsedMs)}</span>
  )

  const Page = TABS[tab]
  return (
    <>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <nav className={`drawer ${menu ? 'open' : ''}`} aria-hidden={!menu}>
        <div className="drawer-head">Lokhand Log</div>
        {Object.keys(TABS).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => pick(t)}>{t}</button>
        ))}
      </nav>

      <Page user={user} navigate={navigate} menuBtn={menuBtn} workoutClock={workoutClock}
        openSession={tab === 'history' ? pendingSession : null}
        onOpened={() => setPendingSession(null)} />
    </>
  )
}
