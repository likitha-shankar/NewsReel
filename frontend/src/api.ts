export interface Preferences {
  podcast_name: string
  interests: string[]
  episode_minutes: number
  tone: string
  host1_name: string
  host2_name: string
  host1_voice: string
  host2_voice: string
  schedule_enabled: boolean
  schedule_frequency: string
  schedule_weekday: number
  schedule_hour: number
  schedule_minute: number
}

export interface Episode {
  id: number
  title: string
  status: 'generating' | 'ready' | 'failed'
  error: string
  created_at: string
  interests: string[]
  audio_url: string | null
  duration_seconds: number
  script?: { host: number; text: string }[]
  sources?: { title: string; source: string; link: string }[]
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
  generateEpisode: () => request<Episode>('/api/episodes', { method: 'POST' }),
  listEpisodes: () => request<Episode[]>('/api/episodes'),
  getEpisode: (id: number) => request<Episode>(`/api/episodes/${id}`),
  getMetrics: () => request<Metrics>('/api/metrics'),
}
