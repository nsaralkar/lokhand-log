import { useMemo, useState } from 'react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'
import { scoreFmt, scoreLabel, volumeLabel } from '../api'

const axis = { stroke: '#8a94a2', fontSize: 12 }
const tip = { contentStyle: { background: '#262c36', border: '1px solid #3d4653', borderRadius: 8, color: '#edeff2' } }

// One exercise's session-by-session trend, shared by the workout tab's History
// subtab and the Stats page. Total volume is the default read — it's the number
// that moves when the work does — with e1RM one tap away for the strength view.
// Nothing renders below two sessions: a single point isn't a trend.
export default function ExerciseTrend({ sessions, metric }) {
  const [series, setSeries] = useState('volume')
  const data = useMemo(() => sessions.map((s) => ({
    date: s.date, value: series === 'volume' ? s.volume_lb : s.e1rm_lb })), [sessions, series])

  if (data.length < 2) return null
  return (
    <>
      <div className="seg">
        <button className={series === 'volume' ? 'on' : ''}
          onClick={() => setSeries('volume')}>{volumeLabel(metric)}</button>
        <button className={series === 'e1rm' ? 'on' : ''}
          onClick={() => setSeries('e1rm')}>{scoreLabel(metric)}</button>
      </div>
      <div style={{ height: 200, margin: '4px 0 10px' }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <XAxis dataKey="date" {...axis} /><YAxis {...axis} width={48} domain={['auto', 'auto']} />
            <Tooltip {...tip} formatter={(v) => scoreFmt(v, metric)} />
            <Line type="monotone" dataKey="value" strokeWidth={2}
              stroke={series === 'volume' ? '#ffb020' : '#3b7dd8'} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}
