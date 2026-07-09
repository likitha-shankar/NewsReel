"""All API endpoints. Input validation happens here (pydantic models with
length caps and enum patterns) — nothing user-typed reaches the pipeline
or the LLM prompts unvalidated."""
import json
import os
import time
from datetime import datetime, timezone
from typing import Annotated

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from dotenv import find_dotenv, set_key

from .db import get_db
from .generate import ADVANCED_DEFAULTS, MEDIA_DIR, run_pipeline
from .metrics import get_metrics
from .models import Episode, Preferences
from .scheduler import apply_schedule

router = APIRouter(prefix="/api")


class AdvancedIn(BaseModel):
    llm_model: str = Field(default="gpt-4o", max_length=60)
    llm_temperature: float = Field(default=1.0, ge=0, le=2)
    qa_model: str = Field(default="gemini-2.5-flash", max_length=60)
    tts_model: str = Field(default="eleven_turbo_v2_5", max_length=60)
    per_topic: int = Field(default=5, ge=1, le=10)
    voice_stability: float = Field(default=0.5, ge=0, le=1)
    voice_similarity: float = Field(default=0.75, ge=0, le=1)
    words_per_minute: int = Field(default=150, ge=100, le=200)


class PreferencesIn(BaseModel):
    podcast_name: str = Field(min_length=1, max_length=120)
    interests: list[Annotated[str, StringConstraints(max_length=80)]] = Field(max_length=10)
    episode_minutes: int = Field(ge=2, le=30)
    tone: str = Field(pattern="^(casual|analytical|energetic)$")
    depth: str = Field(default="balanced", pattern="^(basic|balanced|expert)$")
    language: str = Field(default="en", pattern="^(en|es|fr|de|hi)$")
    host_mode: str = Field(default="duo", pattern="^(duo|solo)$")
    host1_name: str = Field(min_length=1, max_length=60)
    host2_name: str = Field(min_length=1, max_length=60)
    host1_voice: str = Field(max_length=60)
    host2_voice: str = Field(max_length=60)
    schedule_enabled: bool
    schedule_frequency: str = Field(pattern="^(daily|weekly)$")
    schedule_weekday: int = Field(ge=0, le=6)
    schedule_hour: int = Field(ge=0, le=23)
    schedule_minute: int = Field(ge=0, le=59)
    advanced: AdvancedIn = AdvancedIn()


def _prefs(db: Session) -> Preferences:
    prefs = db.get(Preferences, 1)
    if not prefs:
        prefs = Preferences(id=1)
        db.add(prefs)
        db.commit()
    return prefs


def _episode_dict(e: Episode, full: bool = False) -> dict:
    d = {
        "id": e.id,
        "title": e.title,
        "status": e.status,
        "stage": e.stage,
        "trigger": e.trigger,
        "format": e.format,
        "qa_score": e.qa_score,
        "error": e.error,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "interests": e.interests,
        "audio_url": f"/audio/{e.audio_file}" if e.audio_file else None,
        "duration_seconds": e.duration_seconds,
    }
    if full:
        from .generate import segments_dir

        d["script"] = e.script
        d["sources"] = e.sources
        d["qa_notes"] = e.qa_notes
        d["questions"] = e.questions or []
        d["editable"] = segments_dir(e.id).is_dir()  # per-line segments kept -> lines can be re-voiced
    return d


@router.get("/preferences")
def get_preferences(db: Session = Depends(get_db)):
    p = _prefs(db)
    return {c.name: getattr(p, c.name) for c in Preferences.__table__.columns}


@router.put("/preferences")
def put_preferences(body: PreferencesIn, db: Session = Depends(get_db)):
    prefs = _prefs(db)
    for key, value in body.model_dump().items():
        setattr(prefs, key, [i.strip() for i in value if i.strip()] if key == "interests" else value)
    db.commit()
    apply_schedule(prefs)
    return {"ok": True}


@router.get("/voices/{voice_id}/preview")
def voice_preview(voice_id: str):
    """Short TTS sample so the user can hear a voice before picking it. Cached on disk."""
    if not voice_id.isalnum():
        raise HTTPException(400, "Bad voice id")
    previews = MEDIA_DIR / "previews"
    previews.mkdir(exist_ok=True)
    path = previews / f"{voice_id}.mp3"
    if not path.exists():
        resp = httpx.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128",
            headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
            json={
                "text": "Hey there! This is how your podcast host will sound. Pretty good, right?",
                "model_id": "eleven_turbo_v2_5",
            },
            timeout=60,
        )
        if resp.status_code != 200:
            raise HTTPException(502, "Voice preview failed — check the ElevenLabs key")
        path.write_bytes(resp.content)
    return Response(content=path.read_bytes(), media_type="audio/mpeg")


def _mask(key: str) -> str:
    return f"{key[:8]}…{key[-4:]}" if len(key) > 14 else "not set"


@router.get("/dev/keys")
def get_keys():
    return {
        "openai": _mask(os.environ.get("OPENAI_API_KEY", "")),
        "elevenlabs": _mask(os.environ.get("ELEVENLABS_API_KEY", "")),
    }


class KeysIn(BaseModel):
    openai: str = Field(default="", max_length=300)
    elevenlabs: str = Field(default="", max_length=300)


class ModelsIn(BaseModel):
    llm_model: str = Field(max_length=60)
    qa_model: str = Field(default="", max_length=60)
    tts_model: str = Field(max_length=60)


# TTS-only ElevenLabs keys can't list models; validate against the documented set instead
KNOWN_TTS_MODELS = {
    "eleven_turbo_v2_5", "eleven_turbo_v2", "eleven_flash_v2_5", "eleven_flash_v2",
    "eleven_multilingual_v2", "eleven_monolingual_v1", "eleven_v3",
}


def _provider(model_id: str) -> str:
    return "google" if model_id.startswith("gemini") else "openai"


@router.post("/dev/validate-models")
def validate_models(body: ModelsIn):
    """Check model ids against the providers before they can break a generation run."""
    errors: dict[str, str] = {}
    # writer and judge from the same provider = self-grading; the whole point of the QA gate is independence
    if body.qa_model and _provider(body.llm_model) == _provider(body.qa_model):
        errors["qa_model"] = (
            f"Judge ({body.qa_model}) and writer ({body.llm_model}) are the same provider — "
            "cross-provider judging is required to avoid self-grading bias"
        )
    headers = {"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"}
    for field, model_id in (("llm_model", body.llm_model), ("qa_model", body.qa_model)):
        if not model_id:
            continue
        if model_id.startswith("gemini"):
            key = os.environ.get("GEMINI_API_KEY", "")
            if not key:
                errors[field] = "Gemini model set but GEMINI_API_KEY missing from .env"
                continue
            try:
                resp = httpx.get(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}",
                    headers={"x-goog-api-key": key}, timeout=15,
                )
                if resp.status_code == 404:
                    errors[field] = f"'{model_id}' is not a valid Gemini model id"
                elif resp.status_code >= 400:
                    errors[field] = f"Gemini check failed (HTTP {resp.status_code})"
            except httpx.HTTPError:
                errors[field] = "Could not reach Gemini to verify"
            continue
        try:
            resp = httpx.get(f"https://api.openai.com/v1/models/{model_id}", headers=headers, timeout=15)
            if resp.status_code == 404:
                errors[field] = f"'{model_id}' is not a valid OpenAI model id"
            elif resp.status_code >= 400:
                errors[field] = f"OpenAI check failed (HTTP {resp.status_code})"
        except httpx.HTTPError:
            errors[field] = "Could not reach OpenAI to verify"
    try:
        resp = httpx.get(
            "https://api.elevenlabs.io/v1/models",
            headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]}, timeout=15,
        )
        if resp.status_code == 200:
            ids = {m["model_id"] for m in resp.json()}
            if body.tts_model not in ids:
                errors["tts_model"] = f"'{body.tts_model}' is not a valid ElevenLabs model id"
        elif body.tts_model not in KNOWN_TTS_MODELS:
            errors["tts_model"] = f"'{body.tts_model}' is not a known ElevenLabs model id"
    except httpx.HTTPError:
        if body.tts_model not in KNOWN_TTS_MODELS:
            errors["tts_model"] = f"'{body.tts_model}' is not a known ElevenLabs model id"
    return {"ok": not errors, "errors": errors}


@router.put("/dev/keys")
def put_keys(body: KeysIn):
    """Update API keys: process env now, .env for next boot. Blank field = keep current."""
    updates = {"OPENAI_API_KEY": body.openai.strip(), "ELEVENLABS_API_KEY": body.elevenlabs.strip()}
    env_file = find_dotenv(usecwd=True)
    for name, value in updates.items():
        if value:
            os.environ[name] = value
            if env_file:
                set_key(env_file, name, value)
    return get_keys()


# ElevenLabs premade voices — fallback when the API key lacks voices_read
FALLBACK_VOICES = [
    {"voice_id": "21m00Tcm4TlvDq8ikWAM", "name": "Rachel"},
    {"voice_id": "pNInz6obpgDQGcFmaJgB", "name": "Adam"},
    {"voice_id": "EXAVITQu4vr4xnSDxMaL", "name": "Sarah"},
    {"voice_id": "JBFqnCBsd6RMkjVDRZzb", "name": "George"},
    {"voice_id": "XB0fDUnXU5powFXDhCwa", "name": "Charlotte"},
    {"voice_id": "TX3LPaxmHKxFdv7VOQHJ", "name": "Liam"},
]


@router.get("/voices")
def get_voices():
    """Proxy ElevenLabs voice list for the settings UI (cached 1h)."""
    global _voices_cache
    if _voices_cache and time.time() - _voices_cache[0] < 3600:
        return _voices_cache[1]
    try:
        resp = httpx.get(
            "https://api.elevenlabs.io/v1/voices",
            headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
            timeout=30,
        )
        resp.raise_for_status()
        voices = [
            {"voice_id": v["voice_id"], "name": v["name"]}
            for v in resp.json()["voices"]
        ]
    except httpx.HTTPError:
        voices = FALLBACK_VOICES
    _voices_cache = (time.time(), voices)
    return voices


_voices_cache: tuple[float, list] | None = None


class EpisodeIn(BaseModel):
    focus: str = Field(default="", max_length=500)
    format: str = Field(default="deep_dive", pattern="^(deep_dive|brief|debate)$")
    minutes: int = Field(default=0, ge=0, le=30)  # 0 = use the Settings default
    source_url: str = Field(default="", max_length=500)


def _generation_in_flight(db: Session) -> Episode | None:
    """One generation at a time: guards against double-clicks and accidental double scheduler fires
    (idempotency for the expensive TTS path — never pay ElevenLabs twice for one intent)."""
    return db.scalars(select(Episode).where(Episode.status == "generating")).first()


@router.post("/episodes", status_code=202)
def create_episode(background: BackgroundTasks, body: EpisodeIn | None = None, db: Session = Depends(get_db)):
    prefs = _prefs(db)
    if not prefs.interests:
        raise HTTPException(400, "Set at least one interest first")
    existing = _generation_in_flight(db)
    if existing:
        # already recording — return that one instead of minting a duplicate + a second bill
        return _episode_dict(existing)
    body = body or EpisodeIn()
    if body.format == "debate" and prefs.host_mode == "solo":
        raise HTTPException(400, "Debate needs two hosts — switch to duo in Settings first")
    url = body.source_url.strip()
    if url and not url.startswith(("http://", "https://")):
        raise HTTPException(400, "Link must start with http:// or https://")
    episode = Episode(status="generating", focus=body.focus.strip(), format=body.format,
                      minutes=body.minutes, source_url=url)
    db.add(episode)
    db.commit()
    background.add_task(run_pipeline, episode.id)
    return _episode_dict(episode)


class LineEdit(BaseModel):
    text: str = Field(min_length=3, max_length=600)


@router.patch("/episodes/{episode_id}/lines/{line_idx}")
def edit_line(episode_id: int, line_idx: int, body: LineEdit, db: Session = Depends(get_db)):
    """Edit one transcript line: one TTS call for that line, instant re-concat of kept segments."""
    from .generate import resynthesize_line, segments_dir

    episode = db.get(Episode, episode_id)
    if not episode or episode.status != "ready":
        raise HTTPException(404, "Episode not ready")
    if not segments_dir(episode_id).is_dir():
        raise HTTPException(409, "This episode was recorded before line editing existed — regenerate it first")
    lines = list(episode.script or [])
    if not 0 <= line_idx < len(lines):
        raise HTTPException(404, "No such line")
    prefs = _prefs(db)
    lines[line_idx] = {**lines[line_idx], "text": body.text.strip()}
    episode.duration_seconds = resynthesize_line(
        prefs, episode_id, lines, line_idx, MEDIA_DIR / episode.audio_file
    )
    episode.script = lines  # reassign so SQLAlchemy sees the JSON change
    db.commit()
    return _episode_dict(episode, full=True)


class AskIn(BaseModel):
    question: str = Field(min_length=3, max_length=300)


@router.post("/episodes/{episode_id}/ask")
def ask_hosts(episode_id: int, body: AskIn, db: Session = Depends(get_db)):
    """NotebookLM-style 'join the conversation', text edition: grounded answer + host-voice audio."""
    from .generate import LANGUAGES, _chat_json, adv_settings, post_with_retry

    episode = db.get(Episode, episode_id)
    if not episode or episode.status != "ready":
        raise HTTPException(404, "Episode not ready")
    prefs = _prefs(db)
    adv = adv_settings(prefs)
    lang = LANGUAGES.get(prefs.language, "English")
    prompt = (
        f'You are {prefs.host1_name}, a host of the podcast "{prefs.podcast_name}". '
        f'A listener paused the episode to ask: "{body.question}"\n'
        "Answer in at most 90 spoken words, warm and direct, grounded ONLY in the episode transcript "
        "and sources below.\n"
        "If the transcript/sources DON'T cover it: say so in one honest sentence, then offer to make it "
        "happen — e.g. \"want me to put together a whole episode on that? Just hit the button below.\" "
        "Do NOT point the listener at external websites; making episodes is literally our job.\n"
        f"Reply in {lang}. Spoken language only — no markdown, no emojis.\n"
        'Return JSON: {"answer": "...", "covered": true|false}  (covered=false when the episode did not cover the question)\n\n'
        f"Transcript:\n{json.dumps(episode.script)[:8000]}\n\nSources:\n{json.dumps(episode.sources)[:6000]}"
    )
    result = _chat_json(adv, prompt)
    answer = str(result.get("answer", "")).strip()
    covered = bool(result.get("covered", True))
    if not answer:
        raise HTTPException(502, "No answer generated")

    answers_dir = MEDIA_DIR / "answers"
    answers_dir.mkdir(exist_ok=True)
    filename = f"answer_{episode_id}_{int(time.time())}.mp3"
    resp = post_with_retry(
        f"https://api.elevenlabs.io/v1/text-to-speech/{prefs.host1_voice}?output_format=mp3_44100_128",
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
        json_body={"text": answer, "model_id": adv["tts_model"]},
        timeout=120,
    )
    (answers_dir / filename).write_bytes(resp.content)

    entry = {
        "q": body.question,
        "a": answer,
        "audio_url": f"/audio/answers/{filename}",
        "covered": covered,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    # reassign (not mutate) so SQLAlchemy sees the JSON column change
    episode.questions = [*(episode.questions or []), entry]
    db.commit()
    return entry


@router.get("/episodes")
def list_episodes(db: Session = Depends(get_db)):
    episodes = db.scalars(
        select(Episode).where(Episode.deleted.is_(False)).order_by(Episode.created_at.desc())
    ).all()
    return [_episode_dict(e) for e in episodes]


@router.delete("/episodes/{episode_id}")
def delete_episode(episode_id: int, db: Session = Depends(get_db)):
    """Soft delete: row + mp3 kept so the 30s undo in the UI can restore losslessly."""
    episode = db.get(Episode, episode_id)
    if not episode:
        raise HTTPException(404, "Episode not found")
    episode.deleted = True
    db.commit()
    return {"ok": True}


@router.post("/episodes/{episode_id}/restore")
def restore_episode(episode_id: int, db: Session = Depends(get_db)):
    episode = db.get(Episode, episode_id)
    if not episode:
        raise HTTPException(404, "Episode not found")
    episode.deleted = False
    db.commit()
    return _episode_dict(episode)


@router.get("/episodes/{episode_id}")
def get_episode(episode_id: int, db: Session = Depends(get_db)):
    episode = db.get(Episode, episode_id)
    if not episode:
        raise HTTPException(404, "Episode not found")
    return _episode_dict(episode, full=True)


@router.get("/metrics")
def metrics():
    return get_metrics()


@router.get("/health")
def health(db: Session = Depends(get_db)):
    from sqlalchemy import text

    from .scheduler import scheduler as sched

    checks = {
        "database": False,
        "scheduler": sched.running,
        "openai_key": bool(os.environ.get("OPENAI_API_KEY")),
        "elevenlabs_key": bool(os.environ.get("ELEVENLABS_API_KEY")),
    }
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = True
    except Exception:  # noqa: BLE001 — health check reports, never raises
        pass
    ok = all(checks.values())
    return {"status": "ok" if ok else "degraded", "checks": checks}


@router.get("/feed.xml")
def podcast_feed(request: Request, db: Session = Depends(get_db)):
    """RSS 2.0 podcast feed — subscribe from any podcast app on the same network."""
    from xml.sax.saxutils import escape

    prefs = _prefs(db)
    base = str(request.base_url).rstrip("/")
    episodes = db.scalars(
        select(Episode)
        .where(Episode.status == "ready", Episode.deleted.is_(False))
        .order_by(Episode.created_at.desc())
    ).all()
    items = "".join(
        f"""
    <item>
      <title>{escape(e.title)}</title>
      <description>{escape(", ".join(e.interests or []))}</description>
      <pubDate>{e.created_at.strftime("%a, %d %b %Y %H:%M:%S +0000")}</pubDate>
      <guid isPermaLink="false">episode-{e.id}</guid>
      <enclosure url="{base}/audio/{e.audio_file}" type="audio/mpeg" length="{(MEDIA_DIR / e.audio_file).stat().st_size if (MEDIA_DIR / e.audio_file).exists() else 0}"/>
      <itunes:duration>{e.duration_seconds}</itunes:duration>
    </item>"""
        for e in episodes
    )
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>{escape(prefs.podcast_name)}</title>
    <link>{base}</link>
    <language>{prefs.language}</language>
    <description>Personal AI-generated news podcast covering: {escape(", ".join(prefs.interests or []))}</description>{items}
  </channel>
</rss>"""
    return Response(content=xml, media_type="application/rss+xml")
