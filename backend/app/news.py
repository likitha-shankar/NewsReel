"""News gathering from three source types, per the brief ("APIs or scraping outlets' websites"):

1. Google News RSS       — per-interest search, any topic string works
2. Hacker News Algolia   — real JSON API, per-interest search
3. Outlet scrapers       — BeautifulSoup over The Verge + BBC News homepages

RSS/API results are per-topic; scraped headlines are a general bucket the
script-writer LLM weaves in only where relevant.
"""
import html
import logging
import re
import urllib.parse
from datetime import datetime, timedelta, timezone

import feedparser
import httpx
from bs4 import BeautifulSoup

log = logging.getLogger("prosper")
_TAG_RE = re.compile(r"<[^>]+>")
UA = {"User-Agent": "Mozilla/5.0 (personal podcast generator; contact: local)"}


def _clean(text: str) -> str:
    return html.unescape(_TAG_RE.sub("", text or "")).strip()


def _rss_topic(client: httpx.Client, topic: str, per_topic: int) -> list[dict]:
    q = urllib.parse.quote(f"{topic} when:2d")
    url = f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
    feed = feedparser.parse(client.get(url).content)
    return [
        {
            "title": _clean(e.get("title", "")),
            "source": _clean(e.get("source", {}).get("title", "")) or "Google News",
            "summary": _clean(e.get("summary", ""))[:500],
            "link": e.get("link", ""),
            "via": "rss",
        }
        for e in feed.entries[:per_topic]
    ]


def _hn_topic(client: httpx.Client, topic: str, per_topic: int) -> list[dict]:
    since = int((datetime.now(timezone.utc) - timedelta(days=2)).timestamp())
    resp = client.get(
        "https://hn.algolia.com/api/v1/search",
        params={"query": topic, "tags": "story", "numericFilters": f"created_at_i>{since}", "hitsPerPage": per_topic},
    )
    return [
        {
            "title": _clean(h.get("title", "")),
            "source": "Hacker News",
            "summary": f"{h.get('points', 0)} points, {h.get('num_comments', 0)} comments",
            "link": h.get("url") or f"https://news.ycombinator.com/item?id={h.get('objectID')}",
            "via": "hn-api",
        }
        for h in resp.json().get("hits", [])
        if h.get("title")
    ]


def _scrape_verge(client: httpx.Client, limit: int = 8) -> list[dict]:
    soup = BeautifulSoup(client.get("https://www.theverge.com/").text, "html.parser")
    items = []
    for a in soup.select("a[href]"):
        title = _clean(a.get_text())
        href = a["href"]
        # story links look like /<section>/<id>/<slug>; keep substantial titles only
        if len(title) > 40 and re.match(r"^/[a-z-]+/\d+/", href):
            items.append(
                {"title": title, "source": "The Verge", "summary": "", "link": f"https://www.theverge.com{href}", "via": "scrape"}
            )
    seen, out = set(), []
    for it in items:
        if it["link"] not in seen:
            seen.add(it["link"])
            out.append(it)
    return out[:limit]


def _scrape_bbc(client: httpx.Client, limit: int = 8) -> list[dict]:
    soup = BeautifulSoup(client.get("https://www.bbc.com/news").text, "html.parser")
    items = []
    for a in soup.select('a[href*="/news/articles/"]'):
        title = _clean(a.get_text())
        if len(title) > 25:
            href = a["href"]
            link = href if href.startswith("http") else f"https://www.bbc.com{href}"
            items.append({"title": title, "source": "BBC News", "summary": "", "link": link, "via": "scrape"})
    seen, out = set(), []
    for it in items:
        if it["link"] not in seen:
            seen.add(it["link"])
            out.append(it)
    return out[:limit]


def fetch_url_article(url: str) -> dict | None:
    """Fetch a listener-supplied link and extract title + readable text for the script writer."""
    try:
        with httpx.Client(timeout=20, follow_redirects=True, headers=UA) as client:
            soup = BeautifulSoup(client.get(url).text, "html.parser")
        for tag in soup(["script", "style", "nav", "header", "footer", "aside"]):
            tag.decompose()
        title = _clean(soup.title.get_text() if soup.title else url)
        # paragraphs beat soup.get_text(): skips menus/cookie banners that survive tag stripping
        text = " ".join(_clean(p.get_text()) for p in soup.find_all("p"))
        if len(text) < 200:  # paywall/JS-rendered page — not enough to summarize honestly
            return None
        return {"title": title[:200], "source": "Listener link", "summary": text[:4000], "link": url, "via": "user-url"}
    except Exception as exc:  # noqa: BLE001 — a bad link must not kill the episode
        log.warning("fetch_url_article failed for %r: %s", url, exc)
        return None


def fetch_news(interests: list[str], per_topic: int = 5) -> dict[str, list[dict]]:
    """Return {interest: [items]} plus a "Front pages" bucket of scraped outlet headlines."""
    result: dict[str, list[dict]] = {}
    with httpx.Client(timeout=20, follow_redirects=True, headers=UA) as client:
        for topic in interests:
            items: list[dict] = []
            for fetcher in (_rss_topic, _hn_topic):
                try:
                    items += fetcher(client, topic, per_topic)
                except Exception as exc:  # noqa: BLE001 — one dead source must not kill the episode
                    log.warning("%s failed for %r: %s", fetcher.__name__, topic, exc)
            result[topic] = items

        front_pages: list[dict] = []
        for scraper in (_scrape_verge, _scrape_bbc):
            try:
                front_pages += scraper(client)
            except Exception as exc:  # noqa: BLE001
                log.warning("%s failed: %s", scraper.__name__, exc)
        if front_pages:
            result["Front pages (The Verge, BBC)"] = front_pages
    return result
