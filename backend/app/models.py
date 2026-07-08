from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow():
    return datetime.now(timezone.utc)


class Preferences(Base):
    """Single-row table: the user's interests + podcast customization."""

    __tablename__ = "preferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    podcast_name: Mapped[str] = mapped_column(String(120), default="My Daily Brief")
    interests: Mapped[list] = mapped_column(JSON, default=list)  # ["AI", "climate", ...]
    episode_minutes: Mapped[int] = mapped_column(Integer, default=5)
    tone: Mapped[str] = mapped_column(String(40), default="casual")  # casual|analytical|energetic
    depth: Mapped[str] = mapped_column(String(20), default="balanced")  # basic|balanced|expert
    language: Mapped[str] = mapped_column(String(10), default="en")  # en|es|fr|de|hi
    host1_name: Mapped[str] = mapped_column(String(60), default="Alex")
    host2_name: Mapped[str] = mapped_column(String(60), default="Sam")
    host1_voice: Mapped[str] = mapped_column(String(60), default="21m00Tcm4TlvDq8ikWAM")  # Rachel
    host2_voice: Mapped[str] = mapped_column(String(60), default="pNInz6obpgDQGcFmaJgB")  # Adam
    schedule_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    schedule_frequency: Mapped[str] = mapped_column(String(10), default="daily")  # daily|weekly
    schedule_weekday: Mapped[int] = mapped_column(Integer, default=0)  # 0=Mon, weekly only
    schedule_hour: Mapped[int] = mapped_column(Integer, default=8)
    schedule_minute: Mapped[int] = mapped_column(Integer, default=0)
    advanced: Mapped[dict] = mapped_column(JSON, default=dict)  # dev-mode tuning overrides


class Episode(Base):
    __tablename__ = "episodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), default="generating")  # generating|ready|failed
    stage: Mapped[str] = mapped_column(String(20), default="queued")  # queued|news|script|qa|tts
    trigger: Mapped[str] = mapped_column(String(10), default="manual")  # manual|scheduled
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    format: Mapped[str] = mapped_column(String(12), default="deep_dive")  # deep_dive|brief|debate
    focus: Mapped[str] = mapped_column(Text, default="")  # listener steering prompt for this episode
    qa_score: Mapped[float] = mapped_column(Float, default=0.0)  # 0–10 from the QA reviewer pass
    qa_notes: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    interests: Mapped[list] = mapped_column(JSON, default=list)
    script: Mapped[list] = mapped_column(JSON, default=list)  # [{"host": 1, "text": "..."}]
    sources: Mapped[list] = mapped_column(JSON, default=list)  # [{"title","source","link"}]
    audio_file: Mapped[str] = mapped_column(String(200), default="")
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
