// Thin fetch wrapper. All logic lives in the backend; this converts units for
// display only (storage is always metric) and passes JSON through.
const LB_PER_KG = 2.2046226218

export async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (res.status === 401) throw Object.assign(new Error('unauthorized'), { auth: true })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText)
  return res.json()
}

export const get = (p) => api(p)
export const post = (p, body) => api(p, { method: 'POST', body })
export const patch = (p, body) => api(p, { method: 'PATCH', body })
export const del = (p) => api(p, { method: 'DELETE' })
export const put = (p, body) => api(p, { method: 'PUT', body })

// ---- units (display only) ----
export const toDisplay = (kg, units) =>
  kg == null ? null : units === 'imperial' ? Math.round(kg * LB_PER_KG * 10) / 10 : kg
export const fromDisplay = (val, units) =>
  val == null ? null : units === 'imperial' ? Math.round((val / LB_PER_KG) * 100) / 100 : val
export const unitLabel = (units) => (units === 'imperial' ? 'lb' : 'kg')
export const lenToDisplay = (cm, units) =>
  cm == null ? null : units === 'imperial' ? Math.round((cm / 2.54) * 10) / 10 : cm
export const lenFromDisplay = (val, units) =>
  val == null ? null : units === 'imperial' ? Math.round(val * 2.54 * 10) / 10 : val
export const lenLabel = (units) => (units === 'imperial' ? 'in' : 'cm')

export const fmtDuration = (s) => {
  if (s == null) return '—'
  const m = Math.floor(s / 60), sec = s % 60
  return m ? `${m}m ${sec}s` : `${sec}s`
}

// Bumper-plate palette for muscle-group chart series.
export const MUSCLE_COLORS = {
  chest: '#d64541', back: '#3b7dd8', shoulders: '#e8b72e', quads: '#3fa66a',
  hamstrings: '#7bc47f', glutes: '#9b59b6', biceps: '#5dade2', triceps: '#ec7063',
  calves: '#48c9b0', core: '#95a5a6',
}
