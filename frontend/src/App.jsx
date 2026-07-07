import { useEffect, useState } from 'react'
import { get } from './api'
import Login from './pages/Login'
import Session from './pages/Session'
import History from './pages/History'
import Trends from './pages/Trends'
import Metrics from './pages/Metrics'

const TABS = { workout: Session, history: History, trends: Trends, body: Metrics }

export default function App() {
  const [user, setUser] = useState(undefined) // undefined = checking
  const [tab, setTab] = useState('workout')
  const [menu, setMenu] = useState(false)
  const [pendingSession, setPendingSession] = useState(null) // hand-off to History

  useEffect(() => {
    get('/me').then(setUser).catch(() => setUser(null))
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

  const Page = TABS[tab]
  return (
    <>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <nav className={`drawer ${menu ? 'open' : ''}`} aria-hidden={!menu}>
        <div className="drawer-head">Iron Log</div>
        {Object.keys(TABS).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => pick(t)}>{t}</button>
        ))}
      </nav>

      <Page user={user} navigate={navigate} menuBtn={menuBtn}
        openSession={tab === 'history' ? pendingSession : null}
        onOpened={() => setPendingSession(null)} />
    </>
  )
}
