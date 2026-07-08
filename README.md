# 🎙️ NewsReel — Personal Podcast Generator

Set your interests → it gathers fresh news on your schedule → generates a two-host podcast episode with AI voices, QA-reviewed by a second model before it airs.

**▶️ Hear it: [`sample.mp3`](sample.mp3)**

See [`solution.md`](solution.md) for architecture and decisions.

## Quick start

Requires Docker, Python 3.11+, Node 20+.

```bash
docker compose up -d                 # Postgres

cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp ../.env.example ../.env           # add OpenAI + ElevenLabs (+ optional Gemini) keys
.venv/bin/uvicorn app.main:app --port 8001

cd ../frontend
npm install && npm run dev           # open http://localhost:5173
```

Settings → add interests → save → Episodes → ▸ RECORD NEW EPISODE (~40s for a 4-min episode).
Flip the **DEV** toggle (top right) for the internal dashboard and pipeline console.
