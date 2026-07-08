// Custom audio player: waveform-tick seek bar, speed cycle (1x-2x), mute, download —
// all controls always visible (native <audio> hides download/speed behind a menu).
import { useEffect, useRef, useState } from 'react'

const SPEEDS = [1, 1.25, 1.5, 2]

function fmt(s: number) {
  if (!isFinite(s)) return '0:00'
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export default function Player({ src, title, onAsk }: { src: string; title: string; onAsk?: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => setTime(a.currentTime)
    const onMeta = () => setDuration(a.duration)
    // sync from element events so an external pause (another player starting) updates the button
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('ended', onPause)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onMeta)
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
      a.removeEventListener('ended', onPause)
    }
  }, [])

  const toggle = () => {
    const a = audioRef.current!
    if (a.paused) {
      // one station at a time: stop every other audio on the page (players + ask replies)
      document.querySelectorAll('audio').forEach((other) => other !== a && other.pause())
      a.play()
    } else {
      a.pause()
    }
  }

  const seek = (e: React.MouseEvent) => {
    const rect = barRef.current!.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    audioRef.current!.currentTime = frac * duration
  }

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    setSpeed(next)
    audioRef.current!.playbackRate = next
  }

  const toggleMute = () => {
    const a = audioRef.current!
    a.muted = !a.muted
    setMuted(a.muted)
  }

  const pct = duration ? (time / duration) * 100 : 0

  return (
    <div className="player">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button className="play-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
            <rect x="5" y="4" width="5" height="16" /><rect x="14" y="4" width="5" height="16" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
            <path d="M7 4l14 8-14 8z" />
          </svg>
        )}
      </button>
      <span className="ptime mono">{fmt(time)}</span>
      <div className={`pbar ${playing ? 'live' : ''}`} ref={barRef} onClick={seek} role="slider"
        aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.floor(duration)} aria-valuenow={Math.floor(time)}>
        <div className="pbar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="ptime mono">{fmt(duration)}</span>
      <button className="pctl mono" onClick={cycleSpeed} aria-label="Playback speed" title="Playback speed">
        {speed}×
      </button>
      <button className="pctl" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title="Mute">
        {muted ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.6 3l3.7-3.7-1.4-1.4-3.7 3.7-3.7-3.7-1.4 1.4L13.8 12l-3.7 3.7 1.4 1.4 3.7-3.7 3.7 3.7 1.4-1.4L16.6 12z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4zM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8s-3-7.9-7-8.8z" />
          </svg>
        )}
      </button>
      <a className="pctl" href={src} download={`${title.replace(/[^\w ]+/g, '').trim() || 'episode'}.mp3`}
        aria-label="Download episode" title="Download MP3">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
          <path d="M12 3v10.6l3.3-3.3 1.4 1.4L12 17.4l-4.7-5.7 1.4-1.4 2.3 2.3V3h2zM5 19h14v2H5z" />
        </svg>
      </a>
      {onAsk && (
        <button className="pctl ask" onClick={onAsk} aria-label="Ask the hosts"
          title="Ask the hosts — question anything in this episode, they answer in their own voice">
          {/* speech bubble with ? — "ask a question", not "record audio" */}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
            <path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4V5a2 2 0 0 1 2-2h-2zm8 3.2c-1.8 0-3.1 1-3.2 2.7h1.9c.05-.7.5-1.1 1.25-1.1.7 0 1.15.4 1.15 1 0 .55-.25.85-1 1.3-.85.5-1.2 1-1.15 1.9v.4h1.9v-.3c0-.6.2-.9 1-1.35.9-.55 1.4-1.2 1.4-2.1 0-1.5-1.3-2.45-3.25-2.45zM11 14.5v1.9h2v-1.9h-2z" />
          </svg>
        </button>
      )}
    </div>
  )
}
