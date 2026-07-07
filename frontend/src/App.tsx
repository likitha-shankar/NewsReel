import { useState } from 'react'
import Settings from './Settings'
import Episodes from './Episodes'
import Dashboard from './Dashboard'

const TABS = ['Episodes', 'Settings', 'Dashboard'] as const

export default function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Episodes')
  return (
    <div className="app">
      <header>
        <h1>🎙️ Prosper Pod</h1>
        <nav>
          {TABS.map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'Episodes' && <Episodes />}
        {tab === 'Settings' && <Settings />}
        {tab === 'Dashboard' && <Dashboard />}
      </main>
    </div>
  )
}
