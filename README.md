# 🎙️ Personal Podcast Generator

Set your interests → it gathers fresh news on your schedule → generates a two-host podcast episode with AI voices.

**▶️ Hear it: [`sample.mp3`](sample.mp3)**

See [`solution.md`](solution.md) for architecture and decisions.

## Quick start

Requires Docker, Python 3.11+, Node 20+.

```bash
docker compose up -d                 # Postgres

cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp ../.env.example ../.env           # add your OpenAI + ElevenLabs keys
.venv/bin/uvicorn app.main:app --port 8001

cd ../frontend
npm install && npm run dev           # open http://localhost:5173
```

Settings tab → add interests → save → Episodes tab → ⚡ Generate now (~40s).
