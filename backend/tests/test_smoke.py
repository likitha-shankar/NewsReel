"""Smallest checks that fail if core logic breaks. Run: .venv/bin/python -m pytest tests/ or python tests/test_smoke.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.metrics import get_metrics
from app.news import _clean, fetch_news


def test_clean_strips_html():
    assert _clean("<b>AI &amp; ML</b> news") == "AI & ML news"


def test_metrics_shape():
    m = get_metrics()
    assert len(m["daily"]) == 30
    assert 0 < m["summary"]["listen_rate"] <= 1
    assert m == get_metrics()  # deterministic


def test_fetch_news_live():
    news = fetch_news(["technology"], per_topic=2)
    assert news["technology"], "Google News RSS returned no items"
    assert news["technology"][0]["title"]


if __name__ == "__main__":
    test_clean_strips_html()
    test_metrics_shape()
    test_fetch_news_live()
    print("all smoke tests pass")
