"""APScheduler: one recurring job that generates an episode per the user's schedule."""
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from .db import SessionLocal
from .generate import run_pipeline
from .models import Episode, Preferences

log = logging.getLogger("prosper")
scheduler = BackgroundScheduler()
JOB_ID = "scheduled_episode"


def _generate_scheduled():
    db = SessionLocal()
    try:
        prefs = db.get(Preferences, 1)
        # no interests -> nothing to make; don't leave a failed episode on the reel every night
        if not prefs or not prefs.interests:
            log.warning("Scheduled generation skipped: no interests configured")
            return
        # idempotency: a double-fired cron must not create a second episode + a second bill
        if db.scalars(select(Episode).where(Episode.status == "generating")).first():
            log.warning("Scheduled generation skipped: another episode is already generating")
            return
        episode = Episode(status="generating", trigger="scheduled")
        db.add(episode)
        db.commit()
        episode_id = episode.id
    finally:
        db.close()
    log.info("Scheduled generation fired, episode %s", episode_id)
    run_pipeline(episode_id)


def apply_schedule(prefs: Preferences) -> None:
    """(Re)register the cron job to match saved preferences."""
    if scheduler.get_job(JOB_ID):
        scheduler.remove_job(JOB_ID)
    if not prefs.schedule_enabled:
        return
    if prefs.schedule_frequency == "weekly":
        trigger = CronTrigger(
            day_of_week=prefs.schedule_weekday, hour=prefs.schedule_hour, minute=prefs.schedule_minute
        )
    else:
        trigger = CronTrigger(hour=prefs.schedule_hour, minute=prefs.schedule_minute)
    scheduler.add_job(_generate_scheduled, trigger, id=JOB_ID)
    log.info("Schedule set: %s", trigger)


def start(prefs: Preferences) -> None:
    scheduler.start()
    apply_schedule(prefs)
