// Landing hub: the app title plus a button per page. Kept deliberately spare —
// it's a launcher, not a dashboard.
const LINKS = [
  ['workout', 'Workout'],
  ['history', 'History'],
  ['trends', 'Trends'],
  ['body', 'Body'],
]

export default function Home({ navigate, menuBtn }) {
  return (
    <>
      <div className="pagehead">{menuBtn}<h1>Lokhand Log</h1></div>
      <div className="card home-links">
        {LINKS.map(([tab, label]) => (
          <button key={tab} className="big" onClick={() => navigate(tab)}>{label}</button>
        ))}
      </div>
    </>
  )
}
