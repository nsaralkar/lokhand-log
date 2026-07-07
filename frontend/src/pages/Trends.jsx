import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, Legend,
} from 'recharts'
import { get, toDisplay, unitLabel, MUSCLE_COLORS } from '../api'

const axis = { stroke: '#7e8894', fontSize: 12 }
const tip = { contentStyle: { background: '#1d222a', border: '1px solid #313a46', borderRadius: 8, color: '#edeff2' } }

export default function Trends({ user, menuBtn }) {
  const units = user.units
  const [volume, setVolume] = useState([])
  const [muscle, setMuscle] = useState({ muscle_groups: [], data: [] })
  const [prs, setPrs] = useState([])
  const [exercises, setExercises] = useState([])
  const [exId, setExId] = useState('')
  const [prog, setProg] = useState([])

  useEffect(() => {
    get('/analytics/volume').then((v) =>
      setVolume(v.map((d) => ({ ...d, volume: toDisplay(d.volume_kg, units) }))))
    get('/analytics/muscle-volume').then((m) =>
      setMuscle({ ...m, data: m.data.map((row) => {
        const out = { bucket: row.bucket }
        for (const g of m.muscle_groups) if (row[g]) out[g] = toDisplay(row[g], units)
        return out
      })}))
    get('/analytics/prs').then(setPrs)
    get('/exercises').then(setExercises)
  }, [units])

  useEffect(() => {
    if (!exId) return setProg([])
    get(`/analytics/exercises/${exId}/progression`).then((p) =>
      setProg(p.sessions.map((s) => ({ date: s.date, e1rm: toDisplay(s.e1rm_kg, units) }))))
  }, [exId, units])

  return (
    <>
      <div className="pagehead">{menuBtn}<h1>Trends</h1></div>

      <h2>Weekly volume ({unitLabel(units)})</h2>
      <div className="card" style={{ height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={volume}>
            <XAxis dataKey="bucket" {...axis} /><YAxis {...axis} width={48} />
            <Tooltip {...tip} />
            <Line type="monotone" dataKey="volume" stroke="#ffb020" strokeWidth={2} dot={false} />
          </LineChart>
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

      <h2>Exercise progression (e1RM, {unitLabel(units)})</h2>
      <div className="card">
        <select value={exId} onChange={(e) => setExId(e.target.value)}>
          <option value="">choose exercise…</option>
          {exercises.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {prog.length > 0 && (
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
      </div>

      <h2>PRs</h2>
      <div className="card">
        <table>
          <thead><tr><th>Exercise</th><th>Best set</th><th>e1RM</th><th>Date</th></tr></thead>
          <tbody>
            {prs.map((p) => (
              <tr key={p.exercise_id}>
                <td>{exercises.find((e) => e.id === p.exercise_id)?.name || p.exercise_id}</td>
                <td>{toDisplay(p.load_kg, units)}×{p.reps}</td>
                <td>{toDisplay(p.e1rm_kg, units)}</td>
                <td className="muted">{p.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
