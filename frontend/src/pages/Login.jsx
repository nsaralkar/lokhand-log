import { useState } from 'react'
import { post } from '../api'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  async function submit() {
    try { onLogin(await post('/login', { username, password })) }
    catch { setErr('Wrong username or password.') }
  }

  return (
    <div style={{ marginTop: '20vh' }}>
      <h1 style={{ textAlign: 'center' }}>Iron Log</h1>
      <div className="card">
        <label>Username</label>
        <input autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()} />
        {err && <p className="error">{err}</p>}
        <button className="big primary" style={{ marginTop: 14 }} onClick={submit}>Log in</button>
      </div>
    </div>
  )
}
