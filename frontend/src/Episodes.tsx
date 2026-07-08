import { useEffect, useState } from 'react'
import { api, type Episode } from './api'
import Player from './Player'

function fmtDuration(s: number) {
  return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '—:——'
}

const STAGES: [string, string][] = [
  ['news', 'GATHERING NEWS'],
  ['script', 'WRITING SCRIPT'],
  ['qa', 'QA REVIEW'],
  ['tts', 'RECORDING VOICES'],
]

const FORMATS = [
  { value: 'deep_dive', label: 'DEEP DIVE', hint: 'two hosts, full conversation' },
  { value: 'brief', label: 'BRIEF', hint: 'one voice, ~2 min takeaways' },
  { value: 'debate', label: 'DEBATE', hint: 'hosts argue opposing sides' },
]

function AskHosts({ episodeId }: { episodeId: number }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<{ answer: string; audio_url: string } | null>(null)
  const [err, setErr] = useState('')

  const ask = async () => {
    if (q.trim().length < 3 || busy) return
    setBusy(true)
    setErr('')
    setReply(null)
    try {
      setReply(await api.askHosts(episodeId, q.trim()))
    } catch (e) {
      setErr((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="askhosts">
      <h4 className="mono">ASK THE HOSTS</h4>
      <div className="row">
        <input value={q} placeholder="Ask about anything in this episode…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()} style={{ flex: 1 }} />
        <button className="primary mono" onClick={ask} disabled={busy}>
          {busy ? 'THINKING…' : 'ASK'}
        </button>
      </div>
      {err && <p className="error small mono">{err}</p>}
      {reply && (
        <div className="ask-reply">
          <p className="small">{reply.answer}</p>
          <audio controls src={reply.audio_url} style={{ width: '100%' }} />
        </div>
      )}
    </div>
  )
}

export default function Episodes({ dev }: { dev: boolean }) {
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [expanded, setExpanded] = useState<Episode | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  // soft-deleted episodes linger here for the undo window
  const [ghosts, setGhosts] = useState<{ ep: Episode; until: number }[]>([])
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (ghosts.length === 0) return
    const t = setInterval(() => {
      setNow(Date.now())
      setGhosts((g) => g.filter((x) => x.until > Date.now()))
    }, 1000)
    return () => clearInterval(t)
  }, [ghosts.length])

  const remove = async (ep: Episode) => {
    await api.deleteEpisode(ep.id)
    setGhosts((g) => [...g, { ep, until: Date.now() + 30_000 }])
    refresh()
  }

  const undo = async (ep: Episode) => {
    await api.restoreEpisode(ep.id)
    setGhosts((g) => g.filter((x) => x.ep.id !== ep.id))
    refresh()
  }

  const copyFeed = async () => {
    await navigator.clipboard.writeText(`${location.origin}/api/feed.xml`)
    setCopied(true)
    setTimeout(() => setCopied(false), 4000)
  }

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

  const [recordOpen, setRecordOpen] = useState(false)
  const [focus, setFocus] = useState('')
  const [format, setFormat] = useState('deep_dive')

  const generate = async () => {
    setError('')
    try {
      await api.generateEpisode(focus, format)
      setRecordOpen(false)
      setFocus('')
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
      <div className="section-head">
        <h2>On the <em>record</em></h2>
        <div className="row">
          <button className="ghost mono" onClick={copyFeed}
            title="Copies your private podcast feed URL — paste it into any podcast app">
            {copied ? 'LINK COPIED ✓' : 'SUBSCRIBE'}
          </button>
          <button className="primary mono" onClick={() => (recordOpen ? generate() : setRecordOpen(true))}>
            ▸ RECORD NEW EPISODE
          </button>
        </div>
      </div>
      {recordOpen && (
        <div className="card record-form">
          <div className="tone-row">
            {FORMATS.map((f) => (
              <button key={f.value} className={`tone ${format === f.value ? 'active' : ''}`}
                onClick={() => setFormat(f.value)}>
                <strong className="mono small">{f.label}</strong>
                <span className="small muted">{f.hint}</span>
              </button>
            ))}
          </div>
          <input value={focus} maxLength={500}
            placeholder="Steer this episode (optional) — e.g. 'go deep on Formula 1, skip celebrity news'"
            onChange={(e) => setFocus(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && generate()} />
          <div className="row">
            <button className="primary mono" onClick={generate}>START RECORDING</button>
            <button className="ghost mono" onClick={() => setRecordOpen(false)}>CANCEL</button>
          </div>
        </div>
      )}
      {copied && (
        <p className="mono small muted">
          FEED URL COPIED — Apple Podcasts: ⋯ → Follow a Show by URL · Overcast / Pocket Casts: + → Add URL. New episodes appear there automatically.
        </p>
      )}
      {error && <p className="error mono small">{error}</p>}
      {ghosts.map(({ ep, until }) => (
        <div key={`ghost-${ep.id}`} className="card ghost-card">
          <span className="mono small">
            "{ep.title || `Episode #${ep.id}`}" DELETED — GONE FOR GOOD IN {Math.max(0, Math.ceil((until - now) / 1000))}S
          </span>
          <button className="primary mono" onClick={() => undo(ep)}>UNDO</button>
        </div>
      ))}
      {episodes.length === 0 && ghosts.length === 0 && (
        <div className="empty card">
          <p className="mono">NO EPISODES ON THE REEL.</p>
          <p className="muted">Set your interests in Settings, then hit record.</p>
        </div>
      )}
      {episodes.map((e, i) => (
        <article key={e.id} className={`episode card ${e.status}`}>
          <div className="ep-head">
            <span className="ep-num mono">{String(episodes.length - i).padStart(2, '0')}</span>
            <div className="ep-title">
              <h3>{e.title || 'Untitled — on the press'}</h3>
              <p className="mono small muted">
                {new Date(e.created_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).toUpperCase()}
                {e.trigger === 'scheduled' && ' · ⏰ AUTO'}
                {e.format === 'brief' && ' · BRIEF'}
                {e.format === 'debate' && ' · DEBATE'}
                {' · '}{fmtDuration(e.duration_seconds)}
                {e.interests?.length > 0 && ` · ${e.interests.join(' / ').toUpperCase()}`}
              </p>
            </div>
            <span className="badges">
              {dev && e.status === 'ready' && e.qa_score > 0 && (
                <span className="badge mono qa" title="AI quality review: grounding, format, structure, tone">
                  QA {e.qa_score.toFixed(1)}
                </span>
              )}
              <span className={`badge mono ${e.status}`}
                title={e.status === 'ready' ? 'Ready to listen' : e.status === 'generating' ? 'Being generated now' : 'Generation failed'}>
                {dev
                  ? e.status === 'generating' ? '● REC' : e.status === 'ready' ? 'AIRED' : 'DEAD AIR'
                  : e.status === 'generating' ? '● RECORDING…' : e.status === 'ready' ? '✓ READY' : 'FAILED'}
              </span>
            </span>
          </div>
          {e.status === 'failed' && (
            <p className="error mono small">
              {dev ? e.error : "This episode didn't make it to air — hit RECORD to try again."}
            </p>
          )}
          {e.status === 'generating' && (
            <div className="recording mono small">
              <span className="vu" aria-hidden><i /><i /><i /><i /><i /></span>
              <ol className="stages">
                {STAGES.map(([key, label]) => {
                  const idx = STAGES.findIndex(([k]) => k === e.stage)
                  const mine = STAGES.findIndex(([k]) => k === key)
                  return (
                    <li key={key} className={mine < idx ? 'done' : mine === idx ? 'now' : ''}>
                      {mine < idx ? '✓ ' : ''}{label}
                    </li>
                  )
                })}
              </ol>
            </div>
          )}
          {e.audio_url && <Player src={e.audio_url} title={e.title} />}
          <div className="row spread">
            {e.status === 'ready' ? (
              <button className="linklike mono small" onClick={() => toggleDetails(e)}>
                {expanded?.id === e.id ? '− HIDE' : '+ SHOW'} TRANSCRIPT &amp; SOURCES
              </button>
            ) : <span />}
            {e.status !== 'generating' && (
              <button className="linklike mono small delete" onClick={() => remove(e)}>✕ DELETE</button>
            )}
          </div>
          {expanded?.id === e.id && (
            <div className="details">
              {dev && expanded.qa_notes && (
                <>
                  <h4 className="mono">QA REVIEWER NOTES</h4>
                  <p className="small muted">{expanded.qa_notes}</p>
                </>
              )}
              <h4 className="mono">TRANSCRIPT</h4>
              {expanded.script?.map((line, j) => (
                <p key={j} className={`line h${line.host}`}>
                  <span className="mono small speaker">{line.host === 1 ? 'H1' : 'H2'}</span>
                  {line.text}
                </p>
              ))}
              <h4 className="mono">SOURCES</h4>
              <ul className="sources">
                {expanded.sources?.map((s, j) => (
                  <li key={j}>
                    <a href={s.link} target="_blank" rel="noreferrer">{s.title}</a>
                    <span className="mono small muted"> — {s.source}</span>
                  </li>
                ))}
              </ul>
              <AskHosts episodeId={e.id} />
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
