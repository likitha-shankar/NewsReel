"""Mocked usage metrics for the internal dashboard.

Deterministic pseudo-random so the dashboard looks stable across reloads.
Real implementation would aggregate from an events table (see solution.md).
"""
import random
from datetime import date, timedelta


def get_metrics() -> dict:
    rng = random.Random(42)
    days = 30
    today = date.today()
    daily = []
    users = 180
    for i in range(days):
        d = today - timedelta(days=days - 1 - i)
        users = max(50, users + rng.randint(-6, 14))  # gentle upward trend
        generated = int(users * rng.uniform(0.35, 0.55))
        listened = int(generated * rng.uniform(0.55, 0.8))
        daily.append(
            {
                "date": d.isoformat(),
                "active_users": users,
                "episodes_generated": generated,
                "episodes_listened": listened,
            }
        )

    completion_by_length = [
        {"bucket": "≤3 min", "completion_rate": 0.86},
        {"bucket": "4–6 min", "completion_rate": 0.74},
        {"bucket": "7–10 min", "completion_rate": 0.58},
        {"bucket": ">10 min", "completion_rate": 0.41},
    ]
    top_interests = [
        {"interest": "AI & ML", "users": 342},
        {"interest": "Tech industry", "users": 297},
        {"interest": "Finance & markets", "users": 214},
        {"interest": "Climate", "users": 156},
        {"interest": "Sports", "users": 133},
        {"interest": "Science", "users": 98},
    ]
    total_generated = sum(d["episodes_generated"] for d in daily)
    total_listened = sum(d["episodes_listened"] for d in daily)
    return {
        "summary": {
            "active_users": daily[-1]["active_users"],
            "episodes_generated_30d": total_generated,
            "listen_rate": round(total_listened / total_generated, 2),
            "avg_completion": 0.67,
            "schedule_enabled_pct": 0.62,
            "qa_pass_rate": 0.984,  # episodes passing QA review first try
            "gen_success_rate": 0.971,  # audio produced vs pipeline failures (timeouts, dead sources)
            "avg_gen_latency_s": 43,  # queued -> ready, mostly TTS-bound
            "avg_cost_per_episode_usd": 0.19,  # ~750 words TTS + one GPT call
        },
        "daily": daily,
        "completion_by_length": completion_by_length,
        "top_interests": top_interests,
    }
