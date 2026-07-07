import { useEffect, useState } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'
import {
  get, post, toDisplay, fromDisplay, unitLabel,
  lenToDisplay, lenFromDisplay, lenLabel,
} from '../api'

// Expandable: add a row here (or just log a new metric name via the API) and it
// shows up. Weight is kg-canonical; dimensions are cm-canonical.
const METRICS = [
  { id: 'weight', name: 'Body weight', unit: 'kg' },
  { id: 'waist', name: 'Waist', unit: 'cm' },
  { id: 'chest', name: 'Chest', unit: 'cm' },
  { id: 'bicep_l', name: 'Bicep (L)', unit: 'cm' },
  { id: 'bicep_r', name: 'Bicep (R)', unit: 'cm' },
  { id: 'thigh_l', name: 'Thigh (L)', unit: 'cm' },
  { id: 'hips', name: 'Hips', unit: 'cm' },
]

export default function Metrics({ user, menuBtn }) {
  const units = user.units
  const [metric, setMetric] = useState(METRICS[0])
  const [value, setValue] = useState('')
  const [series, setSeries] = useState([])

  const isWeight = metric.unit === 'kg'
  const disp = (v) => (isWeight ? toDisplay(v, units) : lenToDisplay(v, units))
  const label = isWeight ? unitLabel(units) : lenLabel(units)

  const load = () =>
    get(`/metrics/${metric.id}`).then((s) =>
      setSeries(s.map((p) => ({ date: p.date, value: disp(p.value) }))))
  useEffect(() => { load() }, [metric, units])

  async function log() {
    const canonical = isWeight
      ? fromDisplay(Number(value), units)
      : lenFromDisplay(Number(value), units)
    await post('/metrics', { metric: metric.id, value: canonical, unit: metric.unit })
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
            <XAxis dataKey="date" stroke="#7e8894" fontSize={12} />
            <YAxis stroke="#7e8894" fontSize={12} width={48} domain={['auto', 'auto']} />
            <Tooltip contentStyle={{ background: '#1d222a', border: '1px solid #313a46', borderRadius: 8, color: '#edeff2' }} />
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
