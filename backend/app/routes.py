import os
import time

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .generate import run_pipeline
from .metrics import get_metrics
from .models import Episode, Preferences
from .scheduler import apply_schedule

router = APIRouter(prefix="/api")


class PreferencesIn(BaseModel):
    podcast_name: str = Field(min_length=1, max_length=120)
    interests: list[str] = Field(max_length=10)
    episode_minutes: int = Field(ge=2, le=15)
    tone: str = Field(pattern="^(casual|analytical|energetic)$")
    host1_name: str = Field(min_length=1, max_length=60)
    host2_name: str = Field(min_length=1, max_length=60)
    host1_voice: str = Field(max_length=60)
    host2_voice: str = Field(max_length=60)
    schedule_enabled: bool
    schedule_frequency: str = Field(pattern="^(daily|weekly)$")
    schedule_weekday: int = Field(ge=0, le=6)
    schedule_hour: int = Field(ge=0, le=23)
    schedule_minute: int = Field(ge=0, le=59)


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
        "error": e.error,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "interests": e.interests,
        "audio_url": f"/audio/{e.audio_file}" if e.audio_file else None,
        "duration_seconds": e.duration_seconds,
    }
    if full:
        d["script"] = e.script
        d["sources"] = e.sources
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


@router.post("/episodes", status_code=202)
def create_episode(background: BackgroundTasks, db: Session = Depends(get_db)):
    prefs = _prefs(db)
    if not prefs.interests:
        raise HTTPException(400, "Set at least one interest first")
    episode = Episode(status="generating")
    db.add(episode)
    db.commit()
    background.add_task(run_pipeline, episode.id)
    return _episode_dict(episode)


@router.get("/episodes")
def list_episodes(db: Session = Depends(get_db)):
    episodes = db.scalars(select(Episode).order_by(Episode.created_at.desc())).all()
    return [_episode_dict(e) for e in episodes]


@router.get("/episodes/{episode_id}")
def get_episode(episode_id: int, db: Session = Depends(get_db)):
    episode = db.get(Episode, episode_id)
    if not episode:
        raise HTTPException(404, "Episode not found")
    return _episode_dict(episode, full=True)


@router.get("/metrics")
def metrics():
    return get_metrics()
