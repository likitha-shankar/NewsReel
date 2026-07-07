import { useEffect, useState } from 'react'
import { api, type Metrics } from './api'

// Internal usage dashboard. Data is mocked server-side (see backend/app/metrics.py).
const W = 640
const H = 220
const PAD = { top: 12, right: 12, bottom: 24, left: 40 }

function LineChart({ data }: { data: Metrics['daily'] }) {
  const max = Math.max(...data.map((d) => d.episodes_generated)) * 1.1
  const x = (i: number) => PAD.left + (i / (data.length - 1)) * (W - PAD.left - PAD.right)
  const y = (v: number) => H - PAD.bottom - (v / max) * (H - PAD.top - PAD.bottom)
  const path = (key: 'episodes_generated' | 'episodes_listened') =>
    data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('')
  const gridVals = [0, Math.round(max / 2), Math.round(max)]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Episodes generated and listened per day, last 30 days">
      {gridVals.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="grid" />
          <text x={PAD.left - 6} y={y(v) + 4} className="tick" textAnchor="end">{v}</text>
        </g>
      ))}
      <path d={path('episodes_generated')} fill="none" stroke="var(--series-1)" strokeWidth={2} />
      <path d={path('episodes_listened')} fill="none" stroke="var(--series-2)" strokeWidth={2} />
      {data.map((d, i) => (
        <g key={d.date}>
          <circle cx={x(i)} cy={y(d.episodes_generated)} r={8} fill="transparent">
            <title>{`${d.date} — generated: ${d.episodes_generated}`}</title>
          </circle>
          <circle cx={x(i)} cy={y(d.episodes_listened)} r={8} fill="transparent">
            <title>{`${d.date} — listened: ${d.episodes_listened}`}</title>
          </circle>
        </g>
      ))}
      <text x={W - PAD.right} y={y(data[data.length - 1].episodes_generated) - 8} className="direct" textAnchor="end">
        generated
      </text>
      <text x={W - PAD.right} y={y(data[data.length - 1].episodes_listened) + 16} className="direct" textAnchor="end">
        listened
      </text>
      <text x={PAD.left} y={H - 6} className="tick">{data[0].date}</text>
      <text x={W - PAD.right} y={H - 6} className="tick" textAnchor="end">{data[data.length - 1].date}</text>
    </svg>
  )
}

function Bars({ items }: { items: { label: string; value: number; display: string }[] }) {
  const max = Math.max(...items.map((i) => i.value))
  const rowH = 30
  const labelW = 130
  const h = items.length * rowH
  return (
    <svg viewBox={`0 0 ${W} ${h}`} role="img">
      {items.map((it, i) => {
        const w = (it.value / max) * (W - labelW - 70)
        return (
          <g key={it.label} transform={`translate(0,${i * rowH})`}>
            <text x={labelW - 8} y={rowH / 2 + 4} className="tick" textAnchor="end">{it.label}</text>
            <rect x={labelW} y={rowH / 2 - 8} width={w} height={16} rx={4} fill="var(--series-1)">
              <title>{`${it.label}: ${it.display}`}</title>
            </rect>
            <text x={labelW + w + 8} y={rowH / 2 + 4} className="direct">{it.display}</text>
          </g>
        )
      })}
    </svg>
  )
}

export default function Dashboard() {
  const [m, setM] = useState<Metrics | null>(null)
  useEffect(() => {
    api.getMetrics().then(setM)
  }, [])
  if (!m) return <p className="muted">Loading…</p>

  const tiles = [
    { label: 'Active users', value: String(m.summary.active_users) },
    { label: 'Episodes (30d)', value: String(m.summary.episodes_generated_30d) },
    { label: 'Listen rate', value: `${Math.round(m.summary.listen_rate * 100)}%` },
    { label: 'Avg completion', value: `${Math.round(m.summary.avg_completion * 100)}%` },
    { label: 'On a schedule', value: `${Math.round(m.summary.schedule_enabled_pct * 100)}%` },
    { label: 'Cost / episode', value: `$${m.summary.avg_cost_per_episode_usd.toFixed(2)}` },
  ]

  return (
    <div className="viz-root">
      <h2>Usage dashboard</h2>
      <p className="muted small">Internal metrics — mocked data for product-success tracking.</p>
      <div className="tiles">
        {tiles.map((t) => (
          <div key={t.label} className="tile">
            <div className="tile-value">{t.value}</div>
            <div className="tile-label">{t.label}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Episodes per day — last 30 days</h3>
        <div className="legend">
          <span><i className="swatch" style={{ background: 'var(--series-1)' }} /> Generated</span>
          <span><i className="swatch" style={{ background: 'var(--series-2)' }} /> Listened</span>
        </div>
        <LineChart data={m.daily} />
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Completion rate by episode length</h3>
          <Bars
            items={m.completion_by_length.map((b) => ({
              label: b.bucket,
              value: b.completion_rate,
              display: `${Math.round(b.completion_rate * 100)}%`,
            }))}
          />
        </div>
        <div className="card">
          <h3>Top interests by users</h3>
          <Bars
            items={m.top_interests.map((t) => ({
              label: t.interest,
              value: t.users,
              display: String(t.users),
            }))}
          />
        </div>
      </div>
    </div>
  )
}
