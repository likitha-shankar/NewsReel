// Episode list: record (format + focus steering), live pipeline stages, custom player,
// transcript/sources/QA notes, Ask-the-Hosts, soft delete with 30s undo, podcast feed popover.
import { useEffect, useState } from 'react'
import { api, type Episode, type HostAnswer } from './api'
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

// Browser-native speech-to-text (Chrome/Edge/Safari); no dependency.
// TS's dom lib types SpeechRecognitionEvent but not the (webkit-prefixed) constructor — declare the minimum.
interface SpeechRecLike {
  lang: string
  interimResults: boolean
  onresult: ((ev: SpeechRecognitionEvent) => void) | null
  onerror: ((ev: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
}
// ponytail: en-US only — wire prefs.language in if non-English dictation matters.
const SpeechRec: (new () => SpeechRecLike) | undefined =
  (window as never as Record<string, new () => SpeechRecLike>).SpeechRecognition ??
  (window as never as Record<string, new () => SpeechRecLike>).webkitSpeechRecognition

function AskHosts({ episode, onFollowUp, autoFocus }: {
  episode: Episode; onFollowUp: (topic: string) => void; autoFocus?: boolean
}) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  // history persisted server-side; seed from the episode, append as we ask
  const [history, setHistory] = useState<HostAnswer[]>(episode.questions ?? [])
  const [err, setErr] = useState('')

  const dictate = () => {
    if (!SpeechRec || listening) return
    const rec = new SpeechRec()
    rec.lang = 'en-US'
    rec.interimResults = true
    setListening(true)
    setErr('')
    rec.onresult = (ev: SpeechRecognitionEvent) => {
      setQ(Array.from(ev.results).map((r) => r[0].transcript).join(''))
    }
    rec.onerror = (ev: { error: string }) => {
      setListening(false)
      if (ev.error === 'not-allowed') setErr('Microphone blocked — allow mic access or type instead')
    }
    rec.onend = () => setListening(false)
    rec.start()
  }

  const ask = async () => {
    if (q.trim().length < 3 || busy) return
    setBusy(true)
    setErr('')
    try {
      const reply = await api.askHosts(episode.id, q.trim())
      setHistory((h) => [...h, reply])
      setQ('')
    } catch (e) {
      setErr((e as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="askhosts">
      <h4 className="mono">ASK THE HOSTS</h4>
      {history.map((r, i) => (
        <div key={i} className="ask-reply">
          <p className="small mono muted">YOU: {r.q}</p>
          <p className="small">{r.a}</p>
          <audio controls src={r.audio_url} style={{ width: '100%' }} />
          {!r.covered && (
            <button className="primary mono small-btn" onClick={() => onFollowUp(r.q)}>
              ▸ RECORD AN EPISODE ABOUT THIS
            </button>
          )}
        </div>
      ))}
      <div className="row">
        <input value={q} autoFocus={autoFocus}
          placeholder={listening ? 'Listening… speak your question' : 'Ask about anything in this episode…'}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()} style={{ flex: 1 }} />
        {SpeechRec && (
          <button className={`pctl mic ${listening ? 'live' : ''}`} onClick={dictate}
            aria-label="Speak your question" title="Speak your question instead of typing">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
            </svg>
          </button>
        )}
        <button className="primary mono" onClick={ask} disabled={busy}>
          {busy ? 'THINKING…' : 'ASK'}
        </button>
      </div>
      {err && <p className="error small mono">{err}</p>}
    </div>
  )
}

export default function Episodes({ dev }: { dev: boolean }) {
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [expanded, setExpanded] = useState<Episode | null>(null)
  const [error, setError] = useState('')
  const [subOpen, setSubOpen] = useState(false)
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

  // when set, the expanded panel opens with the ask input focused (mic button path)
  const [askFocus, setAskFocus] = useState(false)

  const toggleDetails = async (e: Episode) => {
    setAskFocus(false)
    if (expanded?.id === e.id) return setExpanded(null)
    setExpanded(await api.getEpisode(e.id))
  }

  const openAsk = async (e: Episode) => {
    setAskFocus(true)
    if (expanded?.id !== e.id) setExpanded(await api.getEpisode(e.id))
  }

  return (
    <div>
      <div className="section-head">
        <h2>On the <em>record</em></h2>
        <div className="row">
          {/* popover explains what subscribing means before anything is copied */}
          <span className="sub-pop">
            <button className="ghost mono" onClick={() => setSubOpen(!subOpen)}>
              📻 LISTEN IN YOUR PODCAST APP
            </button>
            {subOpen && (
              <span className="sub-card">
                <p className="small">
                  Your station has a private podcast feed. Copy the link, paste it into your podcast
                  app, and new episodes appear there automatically — no need to open this site.
                </p>
                <p className="small muted">
                  Apple Podcasts: ⋯ → Follow a Show by URL<br />
                  Overcast / Pocket Casts: + → Add URL
                </p>
                <button className="primary mono" onClick={copyFeed}>
                  {copied ? 'LINK COPIED ✓' : 'COPY FEED LINK'}
                </button>
              </span>
            )}
          </span>
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
          {e.audio_url && <Player src={e.audio_url} title={e.title} onAsk={() => openAsk(e)} />}
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
              {/* interactive first: ask sits above the read-only transcript/sources */}
              {/* keyed: without it React reuses the component across episodes and shows stale Q&A history */}
              <AskHosts key={expanded.id} episode={expanded} autoFocus={askFocus} onFollowUp={(topic) => {
                // pre-fill the record form with the unanswered question as focus
                setFormat('deep_dive')
                setFocus(`Focus on answering: ${topic}`)
                setRecordOpen(true)
                setExpanded(null)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }} />
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
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
