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

// Active-workout state persisted across tab switches/reloads (see Session.jsx).
// Shared here so App.jsx can read it too, for the header clock.
export const RESUME_KEY = 'ironlog.active'

// H:MM:SS (or M:SS under an hour) — the running clock beside the header title.
export const fmtElapsed = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const mm = h ? String(m).padStart(2, '0') : m
  return (h ? `${h}:${mm}` : mm) + ':' + String(sec).padStart(2, '0')
}

// Bumper-plate palette for muscle-group chart series.
export const MUSCLE_COLORS = {
  chest: '#d64541', back: '#3b7dd8', shoulders: '#e8b72e', quads: '#3fa66a',
  hamstrings: '#7bc47f', glutes: '#9b59b6', biceps: '#5dade2', triceps: '#ec7063',
  calves: '#48c9b0', core: '#95a5a6', cardio: '#e67e22',
}

// The dot color that subtly tags an exercise in any list, keyed by its primary
// muscle so the same movement reads the same everywhere. Unknown -> neutral.
export const exColor = (primary) => MUSCLE_COLORS[primary] || '#7e8894'

// Formats one logged/planned set for display regardless of which metric it
// used — reps×load, a duration, or a distance. Accepts either raw entry shape
// (weight_lb/added_weight_lb) or resolved progression-set shape (load_lb).
export const fmtSet = (s) => {
  if (s.duration_s != null) return fmtDuration(s.duration_s)
  if (s.distance_mi != null) return `${s.distance_mi} mi`
  const load = s.load_lb ?? s.weight_lb ?? s.added_weight_lb
  return `${load ?? 'bw'}×${s.reps}`
}

// PR/progression score label + formatting: e1RM for reps-based lifts, the raw
// best duration/distance for holds and carries.
export const scoreLabel = (metric) => (metric && metric !== 'reps' ? 'best' : 'e1RM')
export const scoreFmt = (value, metric) =>
  metric === 'duration' ? fmtDuration(value) : metric === 'distance' ? `${value} mi` : value
