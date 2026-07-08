// Dev-only console: pipeline tuning (models verified against providers before save,
// temperature/voice dials) and API key rotation (masked, applied live, persisted to .env).
import { useEffect, useState } from 'react'
import { ADVANCED_DEFAULTS, api, type Advanced, type Preferences } from './api'

export default function DevPanel() {
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [adv, setAdv] = useState<Advanced>(ADVANCED_DEFAULTS)
  const [keys, setKeys] = useState({ openai: '…', elevenlabs: '…' })
  const [newKeys, setNewKeys] = useState({ openai: '', elevenlabs: '' })
  const [status, setStatus] = useState('')
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    api.getPreferences().then((p) => {
      setPrefs(p)
      setAdv({ ...ADVANCED_DEFAULTS, ...p.advanced })
    })
    api.getKeys().then(setKeys).catch(() => {})
  }, [])

  const set = (patch: Partial<Advanced>) => setAdv({ ...adv, ...patch })

  const saveTuning = async () => {
    if (!prefs) return
    setStatus('Verifying model ids with providers…')
    try {
      const v = await api.validateModels(adv.llm_model, adv.qa_model, adv.tts_model)
      setModelErrors(v.errors)
      if (!v.ok) {
        setStatus('Fix the model ids marked below — saving would break the next episode.')
        setTimeout(() => setStatus(''), 4000)
        return
      }
      setStatus('Saving…')
      await api.savePreferences({ ...prefs, advanced: adv })
      setStatus('Tuning saved ✓ — model ids verified with OpenAI/ElevenLabs')
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`)
    }
    setTimeout(() => setStatus(''), 4000)
  }

  const saveKeys = async () => {
    if (!newKeys.openai && !newKeys.elevenlabs) {
      setStatus('Type a new key into either field first — blank fields keep the current key.')
      setTimeout(() => setStatus(''), 3500)
      return
    }
    setStatus('Updating keys…')
    try {
      setKeys(await api.putKeys(newKeys.openai, newKeys.elevenlabs))
      setNewKeys({ openai: '', elevenlabs: '' })
      setStatus('Keys updated ✓')
    } catch (e) {
      setStatus(`Error: ${(e as Error).message}`)
    }
    setTimeout(() => setStatus(''), 2500)
  }

  if (!prefs) return <p className="mono muted blink">LOADING CONSOLE…</p>

  return (
    <div>
      <div className="section-head">
        <h2>The <em>console</em></h2>
        <span className="mono muted small">ENGINE ROOM — SETTINGS THE LISTENER NEVER SEES</span>
      </div>

      <section className="card">
        <h3 className="mono">◈ PIPELINE TUNING</h3>
        <div className="grid3">
          <label>
            <span className="mono small">WRITER MODEL</span>
            <input value={adv.llm_model} onChange={(e) => set({ llm_model: e.target.value })}
              className={modelErrors.llm_model ? 'invalid' : ''} />
            {modelErrors.llm_model && <span className="error small">{modelErrors.llm_model}</span>}
          </label>
          <label>
            <span className="mono small">QA JUDGE MODEL</span>
            <input value={adv.qa_model} onChange={(e) => set({ qa_model: e.target.value })}
              className={modelErrors.qa_model ? 'invalid' : ''} />
            {modelErrors.qa_model && <span className="error small">{modelErrors.qa_model}</span>}
          </label>
          <label>
            <span className="mono small">TTS MODEL</span>
            <input value={adv.tts_model} onChange={(e) => set({ tts_model: e.target.value })}
              className={modelErrors.tts_model ? 'invalid' : ''} />
            {modelErrors.tts_model && <span className="error small">{modelErrors.tts_model}</span>}
          </label>
        </div>
        <div className="dials">
          {([
            ['TEMP', adv.llm_temperature.toFixed(2), 0, 2, 0.05, adv.llm_temperature, (v: number) => set({ llm_temperature: v })],
            ['ARTICLES', String(adv.per_topic), 1, 10, 1, adv.per_topic, (v: number) => set({ per_topic: v })],
            ['STABILITY', adv.voice_stability.toFixed(2), 0, 1, 0.05, adv.voice_stability, (v: number) => set({ voice_stability: v })],
            ['SIMILARITY', adv.voice_similarity.toFixed(2), 0, 1, 0.05, adv.voice_similarity, (v: number) => set({ voice_similarity: v })],
            ['WPM', String(adv.words_per_minute), 100, 200, 5, adv.words_per_minute, (v: number) => set({ words_per_minute: v })],
          ] as [string, string, number, number, number, number, (v: number) => void][]).map(
            ([name, shown, min, max, step, value, onChange]) => (
              <label key={name} className="dial">
                <span className="mono small">{name}<b>{shown}</b></span>
                <input type="range" min={min} max={max} step={step} value={value}
                  onChange={(e) => onChange(+e.target.value)} />
              </label>
            ),
          )}
        </div>
        <div className="row">
          <button className="primary mono" onClick={saveTuning}>SAVE TUNING</button>
          <button className="ghost mono" onClick={() => setAdv(ADVANCED_DEFAULTS)}>RESET DEFAULTS</button>
        </div>
      </section>

      <section className="card">
        <h3 className="mono">◈ API KEYS</h3>
        <div className="grid2">
          <label>
            <span className="mono small">OPENAI — CURRENT: {keys.openai}</span>
            <input type="password" placeholder="sk-… (leave blank to keep)" value={newKeys.openai}
              onChange={(e) => setNewKeys({ ...newKeys, openai: e.target.value })} />
          </label>
          <label>
            <span className="mono small">ELEVENLABS — CURRENT: {keys.elevenlabs}</span>
            <input type="password" placeholder="sk_… (leave blank to keep)" value={newKeys.elevenlabs}
              onChange={(e) => setNewKeys({ ...newKeys, elevenlabs: e.target.value })} />
          </label>
        </div>
        <div className="row">
          <button className="primary mono" onClick={saveKeys}>UPDATE KEYS</button>
          <span className="mono small muted">Type a new key (fields start empty), blank = keep current. Applied immediately; persisted to .env.</span>
        </div>
      </section>
      <p className="mono small status">{status}</p>
    </div>
  )
}
