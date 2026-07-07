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
