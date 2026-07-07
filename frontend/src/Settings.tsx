import { useEffect, useState } from 'react'
import { api, type Preferences, type Voice } from './api'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const SUGGESTED = ['AI & machine learning', 'Tech industry', 'Finance & markets', 'Climate', 'Science', 'Sports', 'World news']

export default function Settings() {
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [voices, setVoices] = useState<Voice[]>([])
  const [interestInput, setInterestInput] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    api.getPreferences().then(setPrefs)
    api.getVoices().then(setVoices).catch(() => setVoices([]))
  }, [])

  if (!prefs) return <p className="muted">Loading…</p>

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
      setStatus('Saved ✓')
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`)
    }
    setTimeout(() => setStatus(''), 2500)
  }

  return (
    <div className="settings">
      <section className="card">
        <h2>Interests</h2>
        <p className="muted">Topics your podcast will cover. Add anything — news is pulled per topic.</p>
        <div className="chips">
          {prefs.interests.map((i) => (
            <span key={i} className="chip">
              {i}
              <button onClick={() => set({ interests: prefs.interests.filter((x) => x !== i) })}>×</button>
            </span>
          ))}
        </div>
        <div className="row">
          <input
            value={interestInput}
            placeholder="Add an interest and press Enter"
            onChange={(e) => setInterestInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addInterest(interestInput)}
          />
        </div>
        <div className="chips suggested">
          {SUGGESTED.filter((s) => !prefs.interests.includes(s)).map((s) => (
            <button key={s} className="chip ghost" onClick={() => addInterest(s)}>
              + {s}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Podcast</h2>
        <div className="grid2">
          <label>
            Name
            <input value={prefs.podcast_name} onChange={(e) => set({ podcast_name: e.target.value })} />
          </label>
          <label>
            Tone
            <select value={prefs.tone} onChange={(e) => set({ tone: e.target.value })}>
              <option value="casual">Casual</option>
              <option value="analytical">Analytical</option>
              <option value="energetic">Energetic</option>
            </select>
          </label>
          <label>
            Length: {prefs.episode_minutes} min
            <input
              type="range"
              min={2}
              max={15}
              value={prefs.episode_minutes}
              onChange={(e) => set({ episode_minutes: +e.target.value })}
            />
          </label>
        </div>
        <div className="grid2">
          <label>
            Host 1 name
            <input value={prefs.host1_name} onChange={(e) => set({ host1_name: e.target.value })} />
          </label>
          <label>
            Host 1 voice
            <select value={prefs.host1_voice} onChange={(e) => set({ host1_voice: e.target.value })}>
              {voices.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>{v.name}</option>
              ))}
            </select>
          </label>
          <label>
            Host 2 name
            <input value={prefs.host2_name} onChange={(e) => set({ host2_name: e.target.value })} />
          </label>
          <label>
            Host 2 voice
            <select value={prefs.host2_voice} onChange={(e) => set({ host2_voice: e.target.value })}>
              {voices.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>{v.name}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Schedule</h2>
        <label className="row">
          <input
            type="checkbox"
            checked={prefs.schedule_enabled}
            onChange={(e) => set({ schedule_enabled: e.target.checked })}
          />
          Generate episodes automatically
        </label>
        {prefs.schedule_enabled && (
          <div className="row">
            <select value={prefs.schedule_frequency} onChange={(e) => set({ schedule_frequency: e.target.value })}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            {prefs.schedule_frequency === 'weekly' && (
              <select value={prefs.schedule_weekday} onChange={(e) => set({ schedule_weekday: +e.target.value })}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            )}
            <input
              type="time"
              value={`${String(prefs.schedule_hour).padStart(2, '0')}:${String(prefs.schedule_minute).padStart(2, '0')}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':')
                set({ schedule_hour: +h, schedule_minute: +m })
              }}
            />
          </div>
        )}
      </section>

      <div className="row">
        <button className="primary" onClick={save}>Save settings</button>
        <span className="muted">{status}</span>
      </div>
    </div>
  )
}
