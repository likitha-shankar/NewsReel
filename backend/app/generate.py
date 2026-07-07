"""Episode pipeline: news -> GPT dialogue script -> ElevenLabs TTS -> mp3."""
import json
import logging
import os
from pathlib import Path

import httpx

from .db import SessionLocal
from .models import Episode, Preferences
from .news import fetch_news

log = logging.getLogger("prosper")

MEDIA_DIR = Path(__file__).resolve().parent.parent / "media"
MEDIA_DIR.mkdir(exist_ok=True)

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
ELEVEN_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"

SCRIPT_PROMPT = """\
You write scripts for "{podcast_name}", a short two-host news podcast.
Hosts: {host1} (host 1) and {host2} (host 2). Tone: {tone}.
Target length: about {words} words total (~{minutes} minutes spoken).

Write an engaging episode covering the news items below. Rules:
- Open with a quick, natural cold-open/greeting mentioning the podcast name.
- Hosts alternate naturally: react, ask each other questions, add context. No monologues.
- Cover the most interesting stories, grouped by topic. Skip duplicates and weak items.
- Mention outlet names occasionally ("according to Reuters...").
- Spoken language only: no markdown, no stage directions, no emojis.
- Close with a short sign-off.

Return JSON: {{"title": "<catchy episode title>", "lines": [{{"host": 1, "text": "..."}}, {{"host": 2, "text": "..."}}]}}

News items by topic:
{news_json}
"""


def _write_script(prefs: Preferences, news: dict) -> dict:
    prompt = SCRIPT_PROMPT.format(
        podcast_name=prefs.podcast_name,
        host1=prefs.host1_name,
        host2=prefs.host2_name,
        tone=prefs.tone,
        minutes=prefs.episode_minutes,
        words=prefs.episode_minutes * 150,
        news_json=json.dumps(news, indent=1),
    )
    resp = httpx.post(
        OPENAI_URL,
        headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
        json={
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
        },
        timeout=120,
    )
    resp.raise_for_status()
    return json.loads(resp.json()["choices"][0]["message"]["content"])


def _tts_line(client: httpx.Client, text: str, voice_id: str, prev: str, nxt: str) -> bytes:
    resp = client.post(
        ELEVEN_TTS_URL.format(voice_id=voice_id),
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
        json={
            "text": text,
            "model_id": "eleven_turbo_v2_5",
            # context for natural prosody across the cut between speakers
            "previous_text": prev or None,
            "next_text": nxt or None,
        },
        timeout=120,
    )
    resp.raise_for_status()
    return resp.content


def _synthesize(prefs: Preferences, lines: list[dict], out_path: Path) -> int:
    """TTS each line with its host's voice, byte-concat the mp3 segments.

    ponytail: mp3 frame concatenation instead of ffmpeg/pydub — same codec
    settings on every segment, players handle it fine. Swap in pydub if we
    ever need crossfades or loudness normalization.
    """
    voices = {1: prefs.host1_voice, 2: prefs.host2_voice}
    audio = b""
    with httpx.Client() as client:
        for i, line in enumerate(lines):
            prev = lines[i - 1]["text"] if i > 0 else ""
            nxt = lines[i + 1]["text"] if i < len(lines) - 1 else ""
            audio += _tts_line(client, line["text"], voices.get(line["host"], prefs.host1_voice), prev, nxt)
    out_path.write_bytes(audio)
    return int(len(audio) / (128_000 / 8))  # 128kbps CBR -> duration estimate


def run_pipeline(episode_id: int) -> None:
    """Full generation for an existing Episode row. Safe to run in a thread."""
    db = SessionLocal()
    try:
        episode = db.get(Episode, episode_id)
        prefs = db.get(Preferences, 1)
        if not episode or not prefs or not prefs.interests:
            if episode:
                episode.status = "failed"
                episode.error = "No interests configured"
                db.commit()
            return

        news = fetch_news(prefs.interests)
        episode.sources = [item for items in news.values() for item in items]
        episode.interests = list(prefs.interests)
        db.commit()

        script = _write_script(prefs, news)
        episode.title = script.get("title", "Untitled episode")
        episode.script = script["lines"]
        db.commit()

        filename = f"episode_{episode.id}.mp3"
        episode.duration_seconds = _synthesize(prefs, script["lines"], MEDIA_DIR / filename)
        episode.audio_file = filename
        episode.status = "ready"
        db.commit()
        log.info("Episode %s ready: %s", episode.id, episode.title)
    except Exception as exc:  # noqa: BLE001 — background job must record any failure
        log.exception("Episode %s failed", episode_id)
        db.rollback()
        episode = db.get(Episode, episode_id)
        if episode:
            episode.status = "failed"
            episode.error = str(exc)[:2000]
            db.commit()
    finally:
        db.close()
