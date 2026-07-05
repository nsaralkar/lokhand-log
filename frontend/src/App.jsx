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

  useEffect(() => {
    get('/me').then(setUser).catch(() => setUser(null))
  }, [])

  if (user === undefined) return null
  if (user === null) return <Login onLogin={setUser} />

  const Page = TABS[tab]
  return (
    <>
      <Page user={user} />
      <nav className="tabs">
        {Object.keys(TABS).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>
    </>
  )
}
