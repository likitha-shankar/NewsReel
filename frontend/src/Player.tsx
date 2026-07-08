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
    const onEnd = () => setPlaying(false)
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('ended', onEnd)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onMeta)
      a.removeEventListener('ended', onEnd)
    }
  }, [])

  const toggle = () => {
    const a = audioRef.current!
    if (a.paused) {
      a.play()
      setPlaying(true)
    } else {
      a.pause()
      setPlaying(false)
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
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
            <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
          </svg>
        </button>
      )}
    </div>
  )
}
