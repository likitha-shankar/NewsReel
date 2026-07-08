// Station settings: interests, show identity (name/language/tone/knowledge/length),
// hosts (duo/solo, voices with audition previews), and the generation schedule.
import { useEffect, useRef, useState } from 'react'
import { api, voicePreviewUrl, type Preferences, type Voice } from './api'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const SUGGESTED = ['AI & machine learning', 'Tech industry', 'Finance & markets', 'Climate', 'Science', 'Sports', 'World news']
const TONES = [
  { value: 'casual', label: 'Casual', hint: 'two friends over coffee' },
  { value: 'analytical', label: 'Analytical', hint: 'measured, why-it-matters' },
  { value: 'energetic', label: 'Energetic', hint: 'morning-zoo energy' },
]
const DEPTHS = [
  { value: 'basic', label: 'Basic', hint: 'every term explained, analogies' },
  { value: 'balanced', label: 'Balanced', hint: 'informed generalist' },
  { value: 'expert', label: 'Expert', hint: 'jargon on, implications only' },
]

function VoicePicker({ label, voices, value, onChange }: {
  label: string; voices: Voice[]; value: string; onChange: (v: string) => void
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle')

  const preview = () => {
    if (state === 'playing') {
      audioRef.current?.pause()
      setState('idle')
      return
    }
    audioRef.current?.pause()
    const a = new Audio(voicePreviewUrl(value))
    audioRef.current = a
    setState('loading')
    a.oncanplaythrough = () => {
      setState('playing')
      a.play()
    }
    a.onended = () => setState('idle')
    a.onerror = () => setState('idle')
    a.load()
  }

  useEffect(() => () => audioRef.current?.pause(), [])
  useEffect(() => {
    audioRef.current?.pause()
    setState('idle')
  }, [value])

  return (
    <label>
      <span className="mono small">{label}</span>
      <div className="voice-row">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {voices.map((v) => (
            <option key={v.voice_id} value={v.voice_id}>{v.name}</option>
          ))}
        </select>
        <button type="button" className="pctl preview-btn" onClick={preview}
          aria-label="Preview voice" title="Hear this voice">
          {state === 'loading' ? '…' : state === 'playing' ? (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
              <rect x="5" y="4" width="5" height="16" /><rect x="14" y="4" width="5" height="16" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
              <path d="M7 4l14 8-14 8z" />
            </svg>
          )}
        </button>
      </div>
    </label>
  )
}

export default function Settings() {
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [voices, setVoices] = useState<Voice[]>([])
  const [interestInput, setInterestInput] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    api.getPreferences().then(setPrefs)
    api.getVoices().then(setVoices).catch(() => setVoices([]))
  }, [])

  if (!prefs) return <p className="mono muted blink">TUNING IN…</p>

  const set = (patch: Partial<Preferences>) => setPrefs({ ...prefs, ...patch })

  const addInterest = (value: string) => {
    const v = value.trim()
    if (!v || prefs.interests.includes(v) || prefs.interests.length >= 10) return
    set({ interests: [...prefs.interests, v] })
    setInterestInput('')
  }

  const save = async () => {
    setStatus('Saving…')
    try {
      await api.savePreferences(prefs)
      window.dispatchEvent(new Event('prefs-saved'))
      setStatus('Saved ✓ — next episode uses these settings')
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`)
    }
    setTimeout(() => setStatus(''), 3000)
  }

  return (
    <div className="settings">
      <div className="section-head">
        <h2>Your <em>station</em></h2>
        <span className="mono muted small">WHAT PLAYS, WHO SAYS IT, WHEN IT AIRS</span>
      </div>

      <section className="card">
        <h3 className="mono">① BEAT SHEET — what you care about</h3>
        <div className="chips">
          {prefs.interests.map((i) => (
            <span key={i} className="chip">
              {i}
              <button onClick={() => set({ interests: prefs.interests.filter((x) => x !== i) })}
                aria-label={`Remove ${i}`}>×</button>
            </span>
          ))}
        </div>
        <input
          className="interest-input"
          value={interestInput}
          placeholder="Type any topic, press Enter — quantum computing, F1, urbanism…"
          onChange={(e) => setInterestInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addInterest(interestInput)}
        />
        <div className="chips">
          {SUGGESTED.filter((s) => !prefs.interests.includes(s)).map((s) => (
            <button key={s} className="chip ghost" onClick={() => addInterest(s)}>+ {s}</button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3 className="mono">② THE SHOW — name, tone, length</h3>
        <div className="grid2">
          <label>
            <span className="mono small">SHOW NAME</span>
            <input value={prefs.podcast_name} onChange={(e) => set({ podcast_name: e.target.value })} />
          </label>
          <label>
            <span className="mono small">LANGUAGE</span>
            <select value={prefs.language} onChange={(e) => set({ language: e.target.value })}>
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="hi">हिन्दी</option>
            </select>
          </label>
          <label>
            <span className="mono small">
              LENGTH — {prefs.episode_minutes} MIN
              {prefs.episode_minutes > 8 && ' · LONG-FORM: SLOWER + PRICIER TO GENERATE'}
            </span>
            <input type="range" min={2} max={30} value={prefs.episode_minutes}
              onChange={(e) => set({ episode_minutes: +e.target.value })} />
          </label>
        </div>
        <span className="mono small muted">TONE</span>
        <div className="tone-row" role="radiogroup" aria-label="Tone">
          {TONES.map((t) => (
            <button key={t.value} role="radio" aria-checked={prefs.tone === t.value}
              className={`tone ${prefs.tone === t.value ? 'active' : ''}`}
              onClick={() => set({ tone: t.value })}>
              <strong>{t.label}</strong>
              <span className="small muted">{t.hint}</span>
            </button>
          ))}
        </div>
        <span className="mono small muted">LISTENER KNOWLEDGE</span>
        <div className="tone-row" role="radiogroup" aria-label="Listener knowledge level">
          {DEPTHS.map((d) => (
            <button key={d.value} role="radio" aria-checked={prefs.depth === d.value}
              className={`tone ${prefs.depth === d.value ? 'active' : ''}`}
              onClick={() => set({ depth: d.value })}>
              <strong>{d.label}</strong>
              <span className="small muted">{d.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3 className="mono">③ THE HOSTS — hit ▸ to audition a voice</h3>
        {/* solo = single narrator for every format except debate (which needs two voices) */}
        <div className="tone-row" role="radiogroup" aria-label="Host mode" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button role="radio" aria-checked={prefs.host_mode === 'duo'}
            className={`tone ${prefs.host_mode === 'duo' ? 'active' : ''}`}
            onClick={() => set({ host_mode: 'duo' })}>
            <strong>Two hosts</strong>
            <span className="small muted">conversation, banter, debate</span>
          </button>
          <button role="radio" aria-checked={prefs.host_mode === 'solo'}
            className={`tone ${prefs.host_mode === 'solo' ? 'active' : ''}`}
            onClick={() => set({ host_mode: 'solo' })}>
            <strong>Solo narrator</strong>
            <span className="small muted">one voice, radio-bulletin style</span>
          </button>
        </div>
        <div className="grid2">
          <label>
            <span className="mono small">{prefs.host_mode === 'solo' ? 'HOST NAME' : 'HOST 1 NAME'}</span>
            <input value={prefs.host1_name} onChange={(e) => set({ host1_name: e.target.value })} />
          </label>
          <VoicePicker label={prefs.host_mode === 'solo' ? 'HOST VOICE' : 'HOST 1 VOICE'} voices={voices}
            value={prefs.host1_voice} onChange={(v) => set({ host1_voice: v })} />
          {prefs.host_mode === 'duo' && (
            <>
              <label>
                <span className="mono small">HOST 2 NAME</span>
                <input value={prefs.host2_name} onChange={(e) => set({ host2_name: e.target.value })} />
              </label>
              <VoicePicker label="HOST 2 VOICE" voices={voices} value={prefs.host2_voice}
                onChange={(v) => set({ host2_voice: v })} />
            </>
          )}
        </div>
      </section>

      <section className="card">
        <h3 className="mono">④ AIR TIME — when new episodes drop</h3>
        <label className="check-row">
          <input type="checkbox" checked={prefs.schedule_enabled}
            onChange={(e) => set({ schedule_enabled: e.target.checked })} />
          <span>Generate automatically</span>
        </label>
        {prefs.schedule_enabled && (
          <div className="row">
            <select value={prefs.schedule_frequency} onChange={(e) => set({ schedule_frequency: e.target.value })}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            {prefs.schedule_frequency === 'weekly' && (
              <select value={prefs.schedule_weekday} onChange={(e) => set({ schedule_weekday: +e.target.value })}>
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            )}
            <input type="time"
              value={`${String(prefs.schedule_hour).padStart(2, '0')}:${String(prefs.schedule_minute).padStart(2, '0')}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':')
                set({ schedule_hour: +h, schedule_minute: +m })
              }} />
          </div>
        )}
      </section>

      <div className="row save-row">
        <button className="primary mono" onClick={save}>SAVE STATION SETTINGS</button>
        <span className="mono small status">{status}</span>
      </div>
    </div>
  )
}
