"""Episode pipeline: news -> GPT dialogue script -> QA review -> ElevenLabs TTS -> mp3."""
import html
import json
import logging
import os
import time
from pathlib import Path

import httpx

from .db import SessionLocal
from .models import Episode, Preferences
from .news import fetch_news

log = logging.getLogger("prosper")

MEDIA_DIR = Path(__file__).resolve().parent.parent / "media"
MEDIA_DIR.mkdir(exist_ok=True)

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
ELEVEN_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"

# dev-mode tunables; prefs.advanced overrides these
ADVANCED_DEFAULTS = {
    "llm_model": "gpt-4o-mini",
    "llm_temperature": 1.0,
    "qa_model": "gemini-2.5-flash",  # judge from a DIFFERENT provider than the writer — no self-grading
    "tts_model": "eleven_turbo_v2_5",
    "per_topic": 5,
    "voice_stability": 0.5,
    "voice_similarity": 0.75,
    "words_per_minute": 150,
}

TONE_DIRECTIVES = {
    "casual": "Casual: contractions, light humor, hosts tease each other a little, short sentences, everyday vocabulary.",
    "analytical": "Analytical: measured pace, hosts ask 'why does this matter' and answer it, compare to precedents, no hype words, allow brief silence-fillers like 'let's unpack that'.",
    "energetic": "Energetic: fast momentum, exclamations, hosts interrupt each other with enthusiasm, punchy short lines, big transitions like 'okay okay okay, NEXT'.",
}

LANGUAGES = {"en": "English", "es": "Spanish", "fr": "French", "de": "German", "hi": "Hindi"}

FORMAT_DIRECTIVES = {
    "deep_dive": "",  # the default two-host conversation the base prompt already describes
    "brief": (
        "FORMAT OVERRIDE — BRIEF: a single narrator (host 1 only, every line host 1). "
        "Rapid key-takeaways bulletin: the 4-6 stories that matter, one or two sentences of context each, "
        "no banter, no questions, total about 300 words. Keep the greeting and sign-off to one short line each."
    ),
    "debate": (
        "FORMAT OVERRIDE — DEBATE: host 1 and host 2 take genuinely OPPOSING positions on the biggest story/theme "
        "(e.g. 'overhyped vs breakthrough'). Formal but lively back-and-forth: claim, rebuttal, evidence from the "
        "news items, concession where honest. Both hosts argue in good faith; end with each giving a one-line closing statement."
    ),
}

DEPTH_DIRECTIVES = {
    "basic": "Listener knowledge: BEGINNER. Explain every technical term in plain words the moment it appears. Use everyday analogies. Never assume prior knowledge of the field.",
    "balanced": "Listener knowledge: INFORMED GENERALIST. Brief gloss for niche jargon, skip explanations of mainstream concepts.",
    "expert": "Listener knowledge: EXPERT. Skip all basic explanations, use precise technical terminology, focus on implications, second-order effects, and what practitioners should watch.",
}


def adv_settings(prefs: Preferences) -> dict:
    return {**ADVANCED_DEFAULTS, **(prefs.advanced or {})}


RETRYABLE = {429, 500, 502, 503, 504}


def post_with_retry(url: str, *, headers: dict, json_body: dict, timeout: int,
                    client: httpx.Client | None = None, attempts: int = 3) -> httpx.Response:
    """POST with exponential backoff on transient failures — one flaky 429 must not kill an episode."""
    poster = client.post if client else httpx.post
    for i in range(attempts):
        try:
            resp = poster(url, headers=headers, json=json_body, timeout=timeout)
            if resp.status_code in RETRYABLE and i < attempts - 1:
                log.warning("Retryable %s from %s (attempt %d)", resp.status_code, url.split("?")[0], i + 1)
                time.sleep(2**i)
                continue
            resp.raise_for_status()
            return resp
        except httpx.TransportError:
            if i == attempts - 1:
                raise
            time.sleep(2**i)
    raise RuntimeError("unreachable")

RULES_COMMON = """\
- Hosts alternate naturally: react, ask each other questions, add context. Never 3+ consecutive lines by one host. No monologues.
- {tone_directive}
- {depth_directive}
- Mention outlet names occasionally ("according to Reuters...").
- Spoken language only: no markdown, no stage directions, no emojis, never read URLs aloud.
- Every fact must come from the news items given. Do not invent numbers, events, or details."""

SCRIPT_PROMPT = """\
You write scripts for "{podcast_name}", a two-host news podcast.
Hosts: {host1} (host 1) and {host2} (host 2).
Target length: about {words} words total (~{minutes} minutes spoken).

Write an engaging episode covering the news items below. Rules:
- Open with a quick, natural cold-open/greeting mentioning the podcast name.
- Cover the most interesting stories, grouped by topic. Skip duplicates and weak items.
- The "Front pages" bucket is scraped outlet headlines: weave one in ONLY if it clearly fits the listener's interests; otherwise ignore it.
{rules}
- Close with a short sign-off.

Return JSON: {{"title": "<catchy episode title>", "lines": [{{"host": 1, "text": "..."}}, {{"host": 2, "text": "..."}}]}}

News items by topic:
{news_json}
"""

SEGMENT_PROMPT = """\
You write one SEGMENT of an episode of "{podcast_name}", a two-host news podcast.
Hosts: {host1} (host 1) and {host2} (host 2).
This segment covers the topic "{topic}" and must be about {words} words (do not stop early — hit the word target by going deeper on the best stories: background, reactions, what happens next).

{position_rule}
{rules}

The previous segment ended with these lines (continue the conversation naturally from them, with a smooth transition into "{topic}"):
{tail_json}

Return JSON: {{"lines": [{{"host": 1, "text": "..."}}, {{"host": 2, "text": "..."}}]}}

News items for this segment:
{news_json}
"""

TITLE_PROMPT = """Give a catchy podcast episode title (max 10 words) for an episode covering: {topics}. Return JSON: {{"title": "..."}}"""

# above this word target, one LLM call reliably under-delivers — switch to per-topic segments
SEGMENT_THRESHOLD_WORDS = 900


def _chat_json(adv: dict, prompt: str, temperature: float | None = None, model: str | None = None,
               max_tokens: int | None = None) -> dict:
    body = {
        "model": model or adv["llm_model"],
        "temperature": adv["llm_temperature"] if temperature is None else temperature,
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
    }
    if max_tokens:
        body["max_tokens"] = max_tokens
    resp = post_with_retry(
        OPENAI_URL,
        headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
        json_body=body,
        timeout=120,
    )
    return json.loads(resp.json()["choices"][0]["message"]["content"])


def _rules(prefs: Preferences, fmt: str = "deep_dive", focus: str = "") -> str:
    rules = RULES_COMMON.format(
        tone_directive=TONE_DIRECTIVES.get(prefs.tone, TONE_DIRECTIVES["casual"]),
        depth_directive=DEPTH_DIRECTIVES.get(prefs.depth, DEPTH_DIRECTIVES["balanced"]),
    )
    lang = LANGUAGES.get(prefs.language, "English")
    if lang != "English":
        rules += (
            f"\n- Write the ENTIRE script in {lang} — natural spoken {lang}, not translated-sounding."
            " Keep outlet and proper names as-is. The news items are in English; report them in "
            f"{lang}."
        )
    if FORMAT_DIRECTIVES.get(fmt):
        rules += f"\n- {FORMAT_DIRECTIVES[fmt]}"
    if focus.strip():
        rules += (
            f"\n- LISTENER STEERING for this episode (obey it over the default balance): {focus.strip()[:500]}"
        )
    return rules


def _write_script_single(prefs: Preferences, news: dict, words: int, feedback: str = "",
                         fmt: str = "deep_dive", focus: str = "") -> dict:
    adv = adv_settings(prefs)
    prompt = SCRIPT_PROMPT.format(
        podcast_name=prefs.podcast_name,
        host1=prefs.host1_name,
        host2=prefs.host2_name,
        minutes=prefs.episode_minutes,
        words=words,
        rules=_rules(prefs, fmt, focus),
        news_json=json.dumps(news, indent=1),
    )
    if feedback:
        prompt += f"\nA quality reviewer rejected the previous draft. Fix these issues:\n{feedback}\n"
    return _chat_json(adv, prompt)


def _write_script_segmented(prefs: Preferences, news: dict, words: int,
                            fmt: str = "deep_dive", focus: str = "") -> dict:
    """Long episodes: one LLM call per topic. A single call reliably under-delivers past ~900 words."""
    adv = adv_settings(prefs)
    topics = [t for t in news if news[t]]
    per_segment = max(250, words // max(1, len(topics)))
    lines: list[dict] = []
    for i, topic in enumerate(topics):
        if i == 0:
            position = "This is the FIRST segment: open with a natural cold-open/greeting mentioning the podcast name."
        elif i == len(topics) - 1:
            position = "This is the LAST segment: end with a short, warm sign-off."
        else:
            position = "This is a MIDDLE segment: no greeting, no sign-off."
        prompt = SEGMENT_PROMPT.format(
            podcast_name=prefs.podcast_name,
            host1=prefs.host1_name,
            host2=prefs.host2_name,
            topic=topic,
            words=per_segment,
            position_rule=position,
            rules=_rules(prefs, fmt, focus),
            tail_json=json.dumps(lines[-2:], indent=1) if lines else "(episode start)",
            news_json=json.dumps({topic: news[topic]}, indent=1),
        )
        segment = _chat_json(adv, prompt)
        lines += [ln for ln in segment.get("lines", []) if ln.get("text")]
    title = _chat_json(adv, TITLE_PROMPT.format(topics=", ".join(topics)))
    return {"title": title.get("title", "Untitled episode"), "lines": lines}


def _write_script(prefs: Preferences, news: dict, feedback: str = "",
                  fmt: str = "deep_dive", focus: str = "") -> dict:
    adv = adv_settings(prefs)
    words = 300 if fmt == "brief" else int(prefs.episode_minutes * adv["words_per_minute"])
    if words > SEGMENT_THRESHOLD_WORDS and not feedback:
        return _write_script_segmented(prefs, news, words, fmt, focus)
    # QA-feedback rewrites always go single-shot: the reviewer's notes apply to the whole script
    return _write_script_single(prefs, news, words, feedback, fmt, focus)


QA_PROMPT = """\
You are the quality reviewer for an AI-generated news podcast. You are known for being hard to please — most scripts have at least one deductible flaw, and you must list every one you find.

Score by DEDUCTION. Start at 10.0 and subtract per issue found:
- ungrounded factual claim (fact/number/event not traceable to the news items below): −3.0 each
- claim that stretches or editorializes beyond what a source says: −1.0 each
- markdown, stage directions like *laughs*, emojis, or URLs read aloud: −1.0 each
- missing greeting with show name, or missing sign-off: −1.0 each
- 3+ consecutive lines by the same host: −1.0
- tone mismatch with "{tone}": −0.5 to −2.0 by severity
{format_note}
- filler line that conveys no information (pure "wow, so interesting!"): −0.5 each

Floor at 0. Report the final score to one decimal. Do NOT round up to whole numbers. A clean script is rare; 10.0 means you found literally nothing to deduct.

The script may be written in any language; grade it the same way and write your issues in English.

Return JSON: {{"score": <number>, "issues": ["<specific deduction with its penalty, e.g. '-1.0: host 2 has 3 consecutive lines (lines 7-9)'>", ...]}}

News items the script must be grounded in:
{news_json}

Script to review:
{script_json}
"""

QA_THRESHOLD = 7.0


def _gemini_json(model: str, prompt: str, max_tokens: int = 800) -> dict:
    resp = post_with_retry(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        headers={"x-goog-api-key": os.environ["GEMINI_API_KEY"]},
        json_body={
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.0,
                "responseMimeType": "application/json",
                "maxOutputTokens": max_tokens,
                # 2.5 models spend "thinking" tokens from the same budget; a judge needs a verdict, not a diary
                "thinkingConfig": {"thinkingBudget": 0},
            },
        },
        timeout=120,
    )
    return json.loads(resp.json()["candidates"][0]["content"]["parts"][0]["text"])


FORMAT_QA_NOTES = {
    "deep_dive": "",
    "brief": "NOTE: this is a BRIEF format — a single narrator is CORRECT; do not deduct for consecutive lines or missing banter.",
    "debate": "NOTE: this is a DEBATE format — opposing host positions and strong opinions are CORRECT; deduct for editorializing only when a host misstates what a source says.",
}


def _qa_review(prefs: Preferences, news: dict, script: dict, fmt: str = "deep_dive") -> tuple[float, list[str]]:
    adv = adv_settings(prefs)
    prompt = QA_PROMPT.format(tone=prefs.tone, news_json=json.dumps(news, indent=1),
                              format_note=FORMAT_QA_NOTES.get(fmt, ""),
                              script_json=json.dumps(script["lines"], indent=1))
    if adv["qa_model"].startswith("gemini") and os.environ.get("GEMINI_API_KEY"):
        result = _gemini_json(adv["qa_model"], prompt)
    else:
        result = _chat_json(
            adv, prompt,
            temperature=0.0,  # reviewer must be deterministic, not creative
            model=adv["qa_model"] if not adv["qa_model"].startswith("gemini") else "gpt-4o",
            max_tokens=800,  # a verdict, not an essay — unbounded JSON mode can run away
        )
    issues = [str(i) for i in result.get("issues", [])][:10]
    return float(result.get("score", 0)), issues


def _tts_line(client: httpx.Client, text: str, voice_id: str, prev: str, nxt: str, adv: dict) -> bytes:
    resp = post_with_retry(
        ELEVEN_TTS_URL.format(voice_id=voice_id),
        headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
        json_body={
            "text": text,
            "model_id": adv["tts_model"],
            "voice_settings": {"stability": adv["voice_stability"], "similarity_boost": adv["voice_similarity"]},
            # context for natural prosody across the cut between speakers
            "previous_text": prev or None,
            "next_text": nxt or None,
        },
        timeout=120,
        client=client,
    )
    return resp.content


def _synthesize(prefs: Preferences, lines: list[dict], out_path: Path) -> int:
    """TTS each line with its host's voice, byte-concat the mp3 segments.

    ponytail: mp3 frame concatenation instead of ffmpeg/pydub — same codec
    settings on every segment, players handle it fine. Swap in pydub if we
    ever need crossfades or loudness normalization.
    """
    adv = adv_settings(prefs)
    voices = {1: prefs.host1_voice, 2: prefs.host2_voice}
    audio = b""
    with httpx.Client() as client:
        for i, line in enumerate(lines):
            prev = lines[i - 1]["text"] if i > 0 else ""
            nxt = lines[i + 1]["text"] if i < len(lines) - 1 else ""
            audio += _tts_line(client, line["text"], voices.get(line["host"], prefs.host1_voice), prev, nxt, adv)
    out_path.write_bytes(audio)
    return int(len(audio) / (128_000 / 8))  # 128kbps CBR -> duration estimate


def run_pipeline(episode_id: int) -> None:
    """Full generation for an existing Episode row. Safe to run in a thread."""
    db = SessionLocal()
    try:
        episode = db.get(Episode, episode_id)
        prefs = db.get(Preferences, 1)
        if not episode or not prefs or not prefs.interests:
            if episode:
                episode.status = "failed"
                episode.error = "No interests configured"
                db.commit()
            return

        def stage(name: str) -> None:
            episode.stage = name
            db.commit()

        stage("news")
        news = fetch_news(prefs.interests, per_topic=adv_settings(prefs)["per_topic"])
        if not any(news.values()):
            raise RuntimeError("No news found for your interests — try broader topics")
        episode.sources = [item for items in news.values() for item in items]
        episode.interests = list(prefs.interests)
        db.commit()

        fmt, focus = episode.format or "deep_dive", episode.focus or ""
        stage("script")
        script = _write_script(prefs, news, fmt=fmt, focus=focus)

        stage("qa")
        # QA is advisory: a broken reviewer must never block an episode that's ready to air
        try:
            score, issues = _qa_review(prefs, news, script, fmt)
            words_target = 300 if fmt == "brief" else int(prefs.episode_minutes * adv_settings(prefs)["words_per_minute"])
            # segmented (long) scripts: keep the score visible but skip the rewrite —
            # a single-shot rewrite would under-deliver the length again
            if score < QA_THRESHOLD and words_target <= SEGMENT_THRESHOLD_WORDS:
                log.warning("QA rejected draft (%.1f): %s — regenerating once", score, issues)
                stage("script")
                retry = _write_script(prefs, news, feedback="\n".join(issues), fmt=fmt, focus=focus)
                stage("qa")
                retry_score, retry_issues = _qa_review(prefs, news, retry, fmt)
                # best-of-two: rewrites fix cited issues but can introduce new ones — never ship the worse draft
                if retry_score > score:
                    script, score, issues = retry, retry_score, retry_issues
                else:
                    log.warning("Rewrite scored %.1f (not better) — keeping original draft", retry_score)
        except Exception as exc:  # noqa: BLE001
            log.exception("QA reviewer errored — shipping unreviewed")
            score, issues = 0.0, [f"QA reviewer errored ({type(exc).__name__}); episode shipped unreviewed"]
        episode.qa_score = score
        episode.qa_notes = "\n".join(issues)
        # LLMs occasionally emit HTML entities ("&amp;") in titles
        episode.title = html.unescape(script.get("title", "Untitled episode"))
        episode.script = script["lines"]
        db.commit()

        stage("tts")
        filename = f"episode_{episode.id}.mp3"
        episode.duration_seconds = _synthesize(prefs, script["lines"], MEDIA_DIR / filename)
        episode.audio_file = filename
        episode.status = "ready"
        db.commit()
        log.info("Episode %s ready: %s", episode.id, episode.title)
    except Exception as exc:  # noqa: BLE001 — background job must record any failure
        log.exception("Episode %s failed", episode_id)
        db.rollback()
        episode = db.get(Episode, episode_id)
        if episode:
            episode.status = "failed"
            episode.error = str(exc)[:2000]
            db.commit()
    finally:
        db.close()
