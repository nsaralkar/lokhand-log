import { useEffect, useState } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'
import { get, post } from '../api'

// Expandable: add a row here (or just log a new metric name via the API) and it
// shows up. All native imperial — body weight in lb, dimensions in in.
const METRICS = [
  { id: 'weight', name: 'Body weight', unit: 'lb' },
  { id: 'waist', name: 'Waist', unit: 'in' },
  { id: 'chest', name: 'Chest', unit: 'in' },
  { id: 'bicep_l', name: 'Bicep (L)', unit: 'in' },
  { id: 'bicep_r', name: 'Bicep (R)', unit: 'in' },
  { id: 'thigh_l', name: 'Thigh (L)', unit: 'in' },
  { id: 'hips', name: 'Hips', unit: 'in' },
]

export default function Metrics({ menuBtn }) {
  const [metric, setMetric] = useState(METRICS[0])
  const [value, setValue] = useState('')
  const [series, setSeries] = useState([])

  const label = metric.unit

  const load = () =>
    get(`/metrics/${metric.id}`).then((s) =>
      setSeries(s.map((p) => ({ date: p.date, value: p.value }))))
  useEffect(() => { load() }, [metric])

  async function log() {
    await post('/metrics', { metric: metric.id, value: Number(value), unit: metric.unit })
    setValue(''); load()
  }

  return (
    <>
      <div className="pagehead">{menuBtn}<h1>Body</h1></div>
      <div className="card">
        <label>Metric</label>
        <select value={metric.id}
          onChange={(e) => setMetric(METRICS.find((m) => m.id === e.target.value))}>
          {METRICS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <label>Value ({label})</label>
        <div className="row">
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          <button className="primary" onClick={log} disabled={!value}>Log</button>
        </div>
      </div>

      <div className="card" style={{ height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={series}>
            <XAxis dataKey="date" stroke="#8a94a2" fontSize={12} />
            <YAxis stroke="#8a94a2" fontSize={12} width={48} domain={['auto', 'auto']} />
            <Tooltip contentStyle={{ background: '#262c36', border: '1px solid #3d4653', borderRadius: 8, color: '#edeff2' }} />
            <Line type="monotone" dataKey="value" stroke="#3fa66a" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {series.length > 0 && (
        <p className="muted">
          Latest: {series[series.length - 1].value} {label} on {series[series.length - 1].date}
        </p>
      )}
    </>
  )
}
