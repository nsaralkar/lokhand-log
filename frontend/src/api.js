// Thin fetch wrapper. All logic lives in the backend; this just passes JSON
// through. Storage is native imperial (lb, in, mi) — there is no unit conversion.
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

// ---- units (native imperial; no conversion) ----
export const WEIGHT_UNIT = 'lb'
export const LEN_UNIT = 'in'

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

// The dot color that subtly tags an exercise in any list, keyed by its primary
// muscle so the same movement reads the same everywhere. Unknown -> neutral.
export const exColor = (primary) => MUSCLE_COLORS[primary] || '#7e8894'
