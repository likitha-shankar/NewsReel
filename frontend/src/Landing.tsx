// Animated landing + about page. Shown on first visit; revisitable via the ABOUT tab.
export default function Landing({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="landing">
      <div className="landing-hero">
        <span className="onair mono landing-fade" style={{ animationDelay: '0.1s' }}>● ON AIR</span>
        <h1 className="landing-title">
          {/* letter-staggered masthead reveal */}
          {'NewsReel'.split('').map((ch, i) => (
            <span key={i} className={`landing-letter ${i >= 4 ? 'accent' : ''}`}
              style={{ animationDelay: `${0.15 + i * 0.07}s` }}>
              {ch}
            </span>
          ))}
        </h1>
        <p className="mono landing-tagline landing-fade" style={{ animationDelay: '0.9s' }}>
          YOUR NEWS · YOUR HOSTS · YOUR SCHEDULE
        </p>
        {/* spinning tape reel, pure CSS */}
        <div className="reel landing-fade" style={{ animationDelay: '1.1s' }} aria-hidden>
          <div className="reel-disc">
            <i /><i /><i />
          </div>
          <div className="reel-disc right">
            <i /><i /><i />
          </div>
        </div>
        <button className="primary mono landing-cta landing-fade" style={{ animationDelay: '1.3s' }} onClick={onEnter}>
          ▸ ENTER THE STUDIO
        </button>
      </div>

      <div className="landing-about">
        <h2>What <em>is</em> this?</h2>
        <p>
          NewsReel is your personal radio station. Tell it what you care about — any topic, from
          quantum computing to MasterChef Australia — and on your schedule it gathers fresh news,
          writes a script, and records an episode with AI hosts you picked yourself.
        </p>
        <div className="landing-steps">
          {[
            ['01', 'PICK YOUR BEATS', 'Any interests, any language, your tone, your knowledge level.'],
            ['02', 'WE HIT RECORD', 'News from feeds, APIs, and front pages — scripted, fact-checked by a second AI, then voiced.'],
            ['03', 'YOU PRESS PLAY', 'In the app or your podcast player. Ask the hosts questions. Every morning, automatically.'],
          ].map(([n, title, body], i) => (
            <div key={n} className="landing-step landing-fade" style={{ animationDelay: `${1.5 + i * 0.15}s` }}>
              <span className="ep-num mono">{n}</span>
              <div>
                <strong className="mono small">{title}</strong>
                <p className="small muted">{body}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mono small muted landing-credits">
          BUILT WITH FASTAPI · POSTGRES · REACT · GPT-4O WRITES · GEMINI FACT-CHECKS · ELEVENLABS SPEAKS
        </p>
      </div>
    </div>
  )
}
