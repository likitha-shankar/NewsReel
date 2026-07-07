"""Fetch recent news per interest via Google News RSS.

RSS over scraping/paid APIs: free, no keys, no rate limits, works for
arbitrary topics. Titles + snippets are enough signal for a spoken roundup.
"""
import html
import re
import urllib.parse

import feedparser

_TAG_RE = re.compile(r"<[^>]+>")


def _clean(text: str) -> str:
    return html.unescape(_TAG_RE.sub("", text or "")).strip()


def fetch_news(interests: list[str], per_topic: int = 5) -> dict[str, list[dict]]:
    """Return {interest: [{title, source, summary, link, published}]}."""
    result: dict[str, list[dict]] = {}
    for topic in interests:
        q = urllib.parse.quote(f"{topic} when:2d")
        url = f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
        feed = feedparser.parse(url)
        items = []
        for e in feed.entries[:per_topic]:
            items.append(
                {
                    "title": _clean(e.get("title", "")),
                    "source": _clean(e.get("source", {}).get("title", "")),
                    "summary": _clean(e.get("summary", ""))[:500],
                    "link": e.get("link", ""),
                    "published": e.get("published", ""),
                }
            )
        result[topic] = items
    return result
