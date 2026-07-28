import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, Legend,
} from 'recharts'
import { get, WEIGHT_UNIT, MUSCLE_COLORS, exColor, fmtSet, scoreLabel, scoreFmt } from '../api'

const axis = { stroke: '#8a94a2', fontSize: 12 }
const tip = { contentStyle: { background: '#262c36', border: '1px solid #3d4653', borderRadius: 8, color: '#edeff2' } }

export default function Trends({ menuBtn, workoutClock }) {
  const [volume, setVolume] = useState([])
  const [sessVol, setSessVol] = useState([])
  const [muscle, setMuscle] = useState({ muscle_groups: [], data: [] })
  const [prs, setPrs] = useState([])
  const [exercises, setExercises] = useState([])
  const [exId, setExId] = useState('')
  const [prog, setProg] = useState([])
  const [progSessions, setProgSessions] = useState([])
  const selEx = exercises.find((e) => e.id === exId)

  useEffect(() => {
    get('/analytics/volume').then((v) =>
      setVolume(v.map((d) => ({ ...d, volume: d.volume_lb }))))
    get('/analytics/session-volume').then((v) =>
      setSessVol(v.map((d) => ({ ...d, volume: d.volume_lb }))))
    get('/analytics/muscle-volume').then((m) =>
      setMuscle({ ...m, data: m.data.map((row) => {
        const out = { bucket: row.bucket }
        for (const g of m.muscle_groups) if (row[g]) out[g] = row[g]
        return out
      })}))
    get('/analytics/prs').then(setPrs)
    get('/exercises').then(setExercises)
  }, [])

  useEffect(() => {
    if (!exId) { setProg([]); setProgSessions([]); return }
    get(`/analytics/exercises/${exId}/progression`).then((p) => {
      setProg(p.sessions.map((s) => ({ date: s.date, e1rm: s.e1rm_lb })))
      setProgSessions([...p.sessions].reverse())  // most recent first
    })
  }, [exId])

  return (
    <>
      <div className="pagehead">{menuBtn}<h1>Trends</h1>{workoutClock}</div>

      <h2>Weekly volume ({WEIGHT_UNIT})</h2>
      <div className="card" style={{ height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={volume}>
            <XAxis dataKey="bucket" {...axis} /><YAxis {...axis} width={48} />
            <Tooltip {...tip} />
            <Line type="monotone" dataKey="volume" stroke="#ffb020" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h2>Workout volume ({WEIGHT_UNIT}/session)</h2>
      <div className="card" style={{ height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={sessVol}>
            <XAxis dataKey="date" {...axis} /><YAxis {...axis} width={48} />
            <Tooltip {...tip} />
            <Bar dataKey="volume" fill="#ffb020" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h2>By muscle group</h2>
      <div className="card" style={{ height: 260 }}>
        <ResponsiveContainer>
          <BarChart data={muscle.data}>
            <XAxis dataKey="bucket" {...axis} /><YAxis {...axis} width={48} />
            <Tooltip {...tip} /><Legend />
            {muscle.muscle_groups.map((g) => (
              <Bar key={g} dataKey={g} stackId="v" fill={MUSCLE_COLORS[g] || '#7e8894'} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <h2>Exercise progression</h2>
      <div className="card">
        <select value={exId} onChange={(e) => setExId(e.target.value)}>
          <option value="">choose exercise…</option>
          {exercises.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {prog.length > 1 && (
          <div style={{ height: 200, marginTop: 12 }}>
            <ResponsiveContainer>
              <LineChart data={prog}>
                <XAxis dataKey="date" {...axis} /><YAxis {...axis} width={48} domain={['auto', 'auto']} />
                <Tooltip {...tip} />
                <Line type="monotone" dataKey="e1rm" stroke="#3b7dd8" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {progSessions.map((s) => (
          <div className="entry" key={s.session_id}>
            <div>
              <div className="main">{s.date}</div>
              <div className="meta">{s.sets.map((x) => fmtSet(x)).join('  ')}</div>
            </div>
            <div className="load">{scoreFmt(s.e1rm_lb, selEx?.metric)} <span className="pill">{scoreLabel(selEx?.metric)}</span></div>
          </div>
        ))}
        {exId && !progSessions.length && <p className="muted">No history yet.</p>}
      </div>

      <h2>PRs</h2>
      <div className="card">
        <table>
          <thead><tr><th>Exercise</th><th>Best set</th><th>Best</th><th>Date</th></tr></thead>
          <tbody>
            {prs.map((p) => {
              const ex = exercises.find((e) => e.id === p.exercise_id)
              return (
              <tr key={p.exercise_id}>
                <td><span className="exdot" style={{ background: exColor(ex?.primary) }} />{ex?.name || p.exercise_id}</td>
                <td>{fmtSet(p)}</td>
                <td>{scoreFmt(p.e1rm_lb, ex?.metric)}</td>
                <td className="muted">{p.date}</td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
