// Typed API client — the single place the frontend talks to the backend.
export interface Advanced {
  llm_model: string
  llm_temperature: number
  qa_model: string
  tts_model: string
  per_topic: number
  voice_stability: number
  voice_similarity: number
  words_per_minute: number
}

export const ADVANCED_DEFAULTS: Advanced = {
  llm_model: 'gpt-4o',
  llm_temperature: 1.0,
  qa_model: 'gemini-2.5-flash',
  tts_model: 'eleven_turbo_v2_5',
  per_topic: 5,
  voice_stability: 0.5,
  voice_similarity: 0.75,
  words_per_minute: 150,
}

export interface Preferences {
  podcast_name: string
  interests: string[]
  episode_minutes: number
  tone: string
  depth: string
  language: string
  host_mode: string
  host1_name: string
  host2_name: string
  host1_voice: string
  host2_voice: string
  schedule_enabled: boolean
  schedule_frequency: string
  schedule_weekday: number
  schedule_hour: number
  schedule_minute: number
  advanced: Advanced
}

export interface Episode {
  id: number
  title: string
  status: 'generating' | 'ready' | 'failed'
  stage: 'queued' | 'news' | 'script' | 'qa' | 'tts'
  trigger: 'manual' | 'scheduled'
  format: 'deep_dive' | 'brief' | 'debate'
  qa_score: number
  qa_notes?: string
  error: string
  created_at: string
  interests: string[]
  audio_url: string | null
  duration_seconds: number
  script?: { host: number; text: string }[]
  sources?: { title: string; source: string; link: string }[]
  questions?: HostAnswer[]
  editable?: boolean
}

export interface HostAnswer {
  q: string
  a: string
  audio_url: string
  covered: boolean
  at: string
}

export interface Voice {
  voice_id: string
  name: string
}

export interface Metrics {
  summary: {
    active_users: number
    episodes_generated_30d: number
    listen_rate: number
    avg_completion: number
    schedule_enabled_pct: number
    qa_pass_rate: number
    avg_cost_per_episode_usd: number
  }
  daily: {
    date: string
    active_users: number
    episodes_generated: number
    episodes_listened: number
  }[]
  completion_by_length: { bucket: string; completion_rate: number }[]
  top_interests: { interest: string; users: number }[]
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ?? `${res.status} ${res.statusText}`)
  }
  return res.json()
}

export const api = {
  getPreferences: () => request<Preferences & { id: number }>('/api/preferences'),
  savePreferences: (p: Preferences) =>
    request('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }),
  getVoices: () => request<Voice[]>('/api/voices'),
  generateEpisode: (focus = '', format = 'deep_dive', minutes = 0, source_url = '') =>
    request<Episode>('/api/episodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ focus, format, minutes, source_url }),
    }),
  editLine: (id: number, lineIdx: number, text: string) =>
    request<Episode>(`/api/episodes/${id}/lines/${lineIdx}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
  askHosts: (id: number, question: string) =>
    request<HostAnswer>(`/api/episodes/${id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    }),
  listEpisodes: () => request<Episode[]>('/api/episodes'),
  getEpisode: (id: number) => request<Episode>(`/api/episodes/${id}`),
  deleteEpisode: (id: number) => request<{ ok: boolean }>(`/api/episodes/${id}`, { method: 'DELETE' }),
  restoreEpisode: (id: number) => request<Episode>(`/api/episodes/${id}/restore`, { method: 'POST' }),
  getMetrics: () => request<Metrics>('/api/metrics'),
  getKeys: () => request<{ openai: string; elevenlabs: string }>('/api/dev/keys'),
  validateModels: (llm_model: string, qa_model: string, tts_model: string) =>
    request<{ ok: boolean; errors: Record<string, string> }>('/api/dev/validate-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llm_model, qa_model, tts_model }),
    }),
  putKeys: (openai: string, elevenlabs: string) =>
    request<{ openai: string; elevenlabs: string }>('/api/dev/keys', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openai, elevenlabs }),
    }),
}

export const voicePreviewUrl = (voiceId: string) => `/api/voices/${voiceId}/preview`
