import { useEffect, useState } from 'react'
import { api, type Episode } from './api'

function fmtDuration(s: number) {
  return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : ''
}

export default function Episodes() {
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [expanded, setExpanded] = useState<Episode | null>(null)
  const [error, setError] = useState('')

  const refresh = () => api.listEpisodes().then(setEpisodes).catch(() => {})

  useEffect(() => {
    refresh()
  }, [])

  // poll while anything is generating
  useEffect(() => {
    if (!episodes.some((e) => e.status === 'generating')) return
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
  }, [episodes])

  const generate = async () => {
    setError('')
    try {
      await api.generateEpisode()
      refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const toggleDetails = async (e: Episode) => {
    if (expanded?.id === e.id) return setExpanded(null)
    setExpanded(await api.getEpisode(e.id))
  }

  return (
    <div>
      <div className="row spread">
        <h2>Episodes</h2>
        <button className="primary" onClick={generate}>⚡ Generate now</button>
      </div>
      {error && <p className="error">{error}</p>}
      {episodes.length === 0 && <p className="muted">No episodes yet. Set your interests, then hit Generate.</p>}
      {episodes.map((e) => (
        <div key={e.id} className="card episode">
          <div className="row spread">
            <div>
              <strong>{e.title || `Episode #${e.id}`}</strong>
              <div className="muted small">
                {new Date(e.created_at).toLocaleString()} · {e.interests?.join(', ')}
                {e.duration_seconds > 0 && ` · ${fmtDuration(e.duration_seconds)}`}
              </div>
            </div>
            <span className={`badge ${e.status}`}>{e.status}</span>
          </div>
          {e.status === 'failed' && <p className="error small">{e.error}</p>}
          {e.audio_url && <audio controls src={e.audio_url} style={{ width: '100%', marginTop: 8 }} />}
          {e.status === 'ready' && (
            <button className="ghost small" onClick={() => toggleDetails(e)}>
              {expanded?.id === e.id ? 'Hide' : 'Show'} transcript & sources
            </button>
          )}
          {expanded?.id === e.id && (
            <div className="details">
              <h4>Transcript</h4>
              {expanded.script?.map((line, i) => (
                <p key={i} className="small">
                  <strong>Host {line.host}:</strong> {line.text}
                </p>
              ))}
              <h4>Sources</h4>
              <ul>
                {expanded.sources?.map((s, i) => (
                  <li key={i} className="small">
                    <a href={s.link} target="_blank" rel="noreferrer">{s.title}</a>
                    {s.source && <span className="muted"> — {s.source}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
