import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import scheduler
from .db import Base, SessionLocal, engine
from .generate import MEDIA_DIR
from .models import Preferences
from .routes import router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    # ponytail: poor-man's migrations for columns added post-launch; Alembic if schema keeps moving
    with engine.begin() as conn:
        conn.exec_driver_sql("ALTER TABLE preferences ADD COLUMN IF NOT EXISTS advanced JSON DEFAULT '{}'")
        conn.exec_driver_sql("ALTER TABLE episodes ADD COLUMN IF NOT EXISTS stage VARCHAR(20) DEFAULT 'queued'")
        conn.exec_driver_sql("ALTER TABLE episodes ADD COLUMN IF NOT EXISTS qa_score FLOAT DEFAULT 0")
        conn.exec_driver_sql("ALTER TABLE episodes ADD COLUMN IF NOT EXISTS qa_notes TEXT DEFAULT ''")
        conn.exec_driver_sql("ALTER TABLE preferences ADD COLUMN IF NOT EXISTS depth VARCHAR(20) DEFAULT 'balanced'")
        conn.exec_driver_sql("ALTER TABLE preferences ADD COLUMN IF NOT EXISTS language VARCHAR(10) DEFAULT 'en'")
        conn.exec_driver_sql('ALTER TABLE episodes ADD COLUMN IF NOT EXISTS "trigger" VARCHAR(10) DEFAULT \'manual\'')
        conn.exec_driver_sql("ALTER TABLE episodes ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE")
        conn.exec_driver_sql("ALTER TABLE episodes ADD COLUMN IF NOT EXISTS format VARCHAR(12) DEFAULT 'deep_dive'")
        conn.exec_driver_sql("ALTER TABLE episodes ADD COLUMN IF NOT EXISTS focus TEXT DEFAULT ''")
    db = SessionLocal()
    try:
        prefs = db.get(Preferences, 1)
        if not prefs:
            prefs = Preferences(id=1)
            db.add(prefs)
            db.commit()
        scheduler.start(prefs)
    finally:
        db.close()
    yield
    scheduler.scheduler.shutdown(wait=False)


app = FastAPI(title="Prosper Podcast Generator", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.mount("/audio", StaticFiles(directory=MEDIA_DIR), name="audio")
