import argparse
import html
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from string import Template
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import feedparser
import requests
import trafilatura
from bs4 import BeautifulSoup
from dateutil import parser as dtparser
from deep_translator import GoogleTranslator


MAX_PER_DAY_DEFAULT = 20
RETENTION_DAYS_DEFAULT = 7
TIMEOUT_SECONDS = 20
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


@dataclass
class Article:
    source_id: str
    source_name: str
    source_url: str
    title: str
    url: str
    published_at: datetime
    summary: str
    content: str
    images: List[str]
    language: str
    score: float


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def safe_text(value: Any) -> str:
    return re.sub(r"\s+", " ", html.unescape(str(value or ""))).strip()


def strip_html_tags(text: str) -> str:
    # Remove leftover HTML from feed extracts / LLM outputs.
    text = html.unescape(str(text or ""))
    return re.sub(r"<[^>]*>", "", text)


def normalize_translated_output(text: str) -> str:
    # Keep translated output as "plain text" for markdown rendering.
    cleaned = strip_html_tags(text)
    return safe_text(cleaned)


def clean_html_summary(value: Any) -> str:
    raw = str(value or "")
    if not raw:
        return ""
    text = BeautifulSoup(raw, "html.parser").get_text("\n", strip=True)
    lines = []
    for line in re.split(r"[\r\n]+", text):
        clean = safe_text(line)
        if not clean:
            continue
        if re.match(r"^(Article URL|Comments URL|Points|# Comments)\s*:", clean, flags=re.I):
            continue
        if re.fullmatch(r"https?://\S+", clean):
            continue
        lines.append(clean)
    return safe_text(" ".join(lines))


def load_dotenv(base_dir: Path) -> None:
    env_path = base_dir / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def parse_dt(value: Optional[str]) -> datetime:
    if not value:
        return now_utc()
    try:
        dt = dtparser.parse(value)
        if not dt.tzinfo:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return now_utc()


def load_sources(path: Path) -> List[Dict[str, Any]]:
    with path.open("r", encoding="utf-8") as f:
        raw = json.load(f)
    return [s for s in raw if s.get("enabled", True)]


def fetch_feed_entries(source: Dict[str, Any], per_source_limit: int) -> List[Dict[str, Any]]:
    feed = feedparser.parse(source["url"])
    entries = []
    for entry in feed.entries[:per_source_limit]:
        title = safe_text(entry.get("title"))
        url = safe_text(entry.get("link"))
        if not title or not url:
            continue
        published = (
            entry.get("published")
            or entry.get("updated")
            or entry.get("created")
            or ""
        )
        entries.append(
            {
                "source_id": source["id"],
                "source_name": source["name"],
                "source_url": source["url"],
                "title": title,
                "url": url,
                "published_at": parse_dt(published),
                "summary": clean_html_summary(entry.get("summary") or entry.get("description") or ""),
                "weight": float(source.get("weight", 1)),
            }
        )
    return entries


def extract_images(soup: BeautifulSoup, page_url: str) -> List[str]:
    image_urls: List[str] = []
    meta_candidates = [
        ("meta", {"property": "og:image"}),
        ("meta", {"name": "twitter:image"}),
    ]
    for tag_name, attrs in meta_candidates:
        node = soup.find(tag_name, attrs=attrs)
        if node and node.get("content"):
            image_urls.append(urljoin(page_url, node["content"]))
    for img in soup.select("article img, main img, .post img, .entry-content img, body img"):
        src = img.get("src") or img.get("data-src")
        if not src:
            continue
        image_urls.append(urljoin(page_url, src))
        if len(image_urls) >= 5:
            break
    uniq: List[str] = []
    for u in image_urls:
        if u and u not in uniq:
            uniq.append(u)
    return uniq[:5]


def extract_article(url: str) -> Dict[str, Any]:
    headers = {"User-Agent": USER_AGENT}
    resp = requests.get(url, headers=headers, timeout=TIMEOUT_SECONDS)
    resp.raise_for_status()
    html = resp.text
    downloaded = trafilatura.extract(
        html,
        include_comments=False,
        include_tables=False,
        output_format="txt",
    )
    soup = BeautifulSoup(html, "html.parser")
    images = extract_images(soup, url)
    title = safe_text(soup.title.text if soup.title else "")
    lang = safe_text(soup.html.get("lang") if soup.html else "")[:10] or "unknown"
    text = safe_text(downloaded)
    if not text:
        text = safe_text(soup.get_text(" ", strip=True))
    return {"content": text, "images": images, "page_title": title, "language": lang}


def score_entry(entry: Dict[str, Any], now: datetime) -> float:
    age_hours = max((now - entry["published_at"]).total_seconds() / 3600, 0)
    freshness = max(0, 120 - age_hours) / 120
    return entry["weight"] * 10 + freshness * 5


def dedupe(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for e in entries:
        key = e["url"].split("?")[0].strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def clip_text(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "..."


def split_for_translation(text: str, max_chars: int = 2800) -> List[str]:
    clean = safe_text(text)
    if len(clean) <= max_chars:
        return [clean] if clean else []
    pieces: List[str] = []
    current = ""
    for sentence in re.split(r"(?<=[。！？.!?])\s+", clean):
        part = safe_text(sentence)
        if not part:
            continue
        if len(part) > max_chars:
            if current:
                pieces.append(current)
                current = ""
            for idx in range(0, len(part), max_chars):
                pieces.append(part[idx : idx + max_chars])
            continue
        candidate = f"{current} {part}".strip()
        if current and len(candidate) > max_chars:
            pieces.append(current)
            current = part
        else:
            current = candidate
    if current:
        pieces.append(current)
    return pieces


def looks_like_target_language(text: str, target_lang: str) -> bool:
    if not text:
        return False
    if target_lang.lower().startswith("zh"):
        # Cover most CJK ranges.
        return bool(re.search(r"[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]", text))
    return True


def call_openai_translate(text: str, target_lang: str) -> Optional[str]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a professional translator."},
            {
                "role": "user",
                "content": f"Translate the following text to {target_lang}, preserve meaning and keep markdown-friendly plain text.\n\n{text}",
            },
        ],
        "temperature": 0.2,
    }
    try:
        r = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=TIMEOUT_SECONDS,
        )
        r.raise_for_status()
        data = r.json()
        return normalize_translated_output(data["choices"][0]["message"]["content"])
    except Exception:
        return None


def translate_text(text: str, target_lang: str, translation_engine: str = "google") -> str:
    """
    translation_engine:
      - google: prefer GoogleTranslator; fallback to OpenAI only if output looks wrong
      - openai: prefer OpenAI; fallback to GoogleTranslator only if output looks wrong
      - auto: google first then openai (heuristic fallback)
    """
    chunks = split_for_translation(text)
    if not chunks:
        return ""

    translated_chunks: List[str] = []
    for chunk in chunks:
        google_first = translation_engine in ("google", "auto")

        if google_first:
            try:
                google_out = GoogleTranslator(source="auto", target=target_lang).translate(chunk)
            except Exception:
                google_out = None

            if google_out:
                google_out = normalize_translated_output(google_out)
                if looks_like_target_language(google_out, target_lang):
                    translated_chunks.append(google_out)
                    continue

            # Rescue with OpenAI if available/allowed.
            ai_out = call_openai_translate(chunk, target_lang) if translation_engine in ("google", "auto", "openai") else None
            if ai_out and looks_like_target_language(ai_out, target_lang):
                translated_chunks.append(ai_out)
            else:
                translated_chunks.append(normalize_translated_output(chunk))
        else:
            ai_out = call_openai_translate(chunk, target_lang) if translation_engine in ("openai", "auto") else None
            if ai_out and looks_like_target_language(ai_out, target_lang):
                translated_chunks.append(ai_out)
                continue

            try:
                google_out = GoogleTranslator(source="auto", target=target_lang).translate(chunk)
            except Exception:
                google_out = chunk
            translated_chunks.append(normalize_translated_output(google_out))

    merged = normalize_translated_output("\n\n".join(translated_chunks))
    if looks_like_target_language(merged, target_lang):
        return merged
    return merged or text


def ensure_dirs(base_dir: Path, date_key: str) -> Dict[str, Path]:
    data_root = base_dir / "data" / "daily-crawler"
    output_root = base_dir / "daily-crawler"
    day_output = output_root / date_key
    data_root.mkdir(parents=True, exist_ok=True)
    day_output.mkdir(parents=True, exist_ok=True)
    return {"data_root": data_root, "output_root": output_root, "day_output": day_output}


def prune_old(data_root: Path, output_root: Path, keep_days: int) -> None:
    files = sorted(data_root.glob("*.json"), reverse=True)
    stale = files[keep_days:]
    for fp in stale:
        date_key = fp.stem
        try:
            fp.unlink(missing_ok=True)
        except Exception:
            pass
        old_dir = output_root / date_key
        if old_dir.exists():
            for child in old_dir.glob("*"):
                child.unlink(missing_ok=True)
            old_dir.rmdir()


def build_markdown(
    tpl: Template,
    article: Article,
    translated: str,
    translation_target: str,
) -> str:
    return tpl.safe_substitute(
        title=article.title,
        source_name=article.source_name,
        source_url=article.source_url,
        url=article.url,
        published_at=article.published_at.isoformat(),
        language=article.language,
        images_count=str(len(article.images)),
        summary=clip_text(article.summary or article.content, 500),
        content=clip_text(article.content, 8000),
        translation_target=translation_target,
        translated_content=clip_text(translated, 8000),
        monetization_hook=(
            "顺便说一下，这个工具如果你想对比更多替代方案，可以去我们的每日榜单继续看。"
        ),
    )


def write_index(output_root: Path, date_key: str, articles: List[Article]) -> None:
    index_path = output_root / "index.md"
    lines = [f"# Daily Crawler Index", "", f"Last update: {date_key}", ""]
    grouped: Dict[str, List[Article]] = {}
    for a in articles:
        grouped.setdefault(a.source_name, []).append(a)
    for source_name, source_articles in grouped.items():
        lines.append(f"## {source_name}")
        for a in source_articles:
            lines.append(f"- [{a.title}]({a.url})")
        lines.append("")
    index_path.write_text("\n".join(lines), encoding="utf-8")


def run(
    base_dir: Path,
    max_per_day: int,
    per_source_limit: int,
    retention_days: int,
    lang_mode: str,
    target_lang: str,
    translation_engine: str,
) -> None:
    load_dotenv(base_dir)
    date_key = datetime.now().strftime("%Y-%m-%d")
    dirs = ensure_dirs(base_dir, date_key)
    sources = load_sources(base_dir / "scripts" / "content-factory" / "sources.json")
    template_text = (base_dir / "scripts" / "content-factory" / "template.md").read_text(
        encoding="utf-8"
    )
    template = Template(template_text)

    candidates: List[Dict[str, Any]] = []
    for source in sources:
        candidates.extend(fetch_feed_entries(source, per_source_limit))
    candidates = dedupe(candidates)
    if not candidates:
        raise RuntimeError("No entries fetched from configured sources.")

    now = now_utc()
    for c in candidates:
        c["score"] = score_entry(c, now)
    candidates.sort(key=lambda x: x["score"], reverse=True)

    selected = candidates[:max_per_day]
    articles: List[Article] = []
    for item in selected:
        try:
            extracted = extract_article(item["url"])
        except Exception:
            continue
        title = item["title"] or extracted["page_title"] or "Untitled"
        content = clip_text(extracted["content"], 12000)
        summary = item["summary"] or clip_text(content, 300)
        article = Article(
            source_id=item["source_id"],
            source_name=item["source_name"],
            source_url=item["source_url"],
            title=title,
            url=item["url"],
            published_at=item["published_at"],
            summary=summary,
            content=content,
            images=extracted["images"],
            language=extracted["language"],
            score=item["score"],
        )
        articles.append(article)

    for idx, article in enumerate(articles, start=1):
        if lang_mode == "none":
            translated = article.content
            translation_target = "none"
        else:
            translated = translate_text(article.content, target_lang=target_lang, translation_engine=translation_engine)
            translation_target = target_lang
        md = build_markdown(template, article, translated, translation_target)
        md_path = dirs["day_output"] / f"{idx:02d}-{article.source_id}.md"
        md_path.write_text(md, encoding="utf-8")

        payload = {
            "dateKey": date_key,
            "rank": idx,
            "sourceId": article.source_id,
            "sourceName": article.source_name,
            "title": article.title,
            "url": article.url,
            "publishedAt": article.published_at.isoformat(),
            "summary": article.summary,
            "content": article.content,
            "translatedContent": translated,
            "translationTarget": translation_target,
            "images": article.images,
            "language": article.language,
            "score": article.score,
        }
        json_path = dirs["day_output"] / f"{idx:02d}-{article.source_id}.json"
        json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    day_json = {
        "dateKey": date_key,
        "count": len(articles),
        "items": [
            {
                "title": a.title,
                "url": a.url,
                "source": a.source_name,
                "publishedAt": a.published_at.isoformat(),
                "images": a.images,
            }
            for a in articles
        ],
    }
    (dirs["data_root"] / f"{date_key}.json").write_text(
        json.dumps(day_json, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    write_index(dirs["output_root"], date_key, articles)
    prune_old(dirs["data_root"], dirs["output_root"], keep_days=retention_days)
    print(f"[content-factory] done: {len(articles)} articles @ {date_key}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily AI content crawler with translation + templates")
    parser.add_argument("--max-per-day", type=int, default=MAX_PER_DAY_DEFAULT)
    parser.add_argument("--per-source-limit", type=int, default=12)
    parser.add_argument("--retention-days", type=int, default=RETENTION_DAYS_DEFAULT)
    parser.add_argument(
        "--lang-mode",
        choices=["none", "translate"],
        default="translate",
        help="none = keep original content only; translate = generate translated block",
    )
    parser.add_argument("--target-lang", choices=["zh-CN", "en"], default="zh-CN")
    parser.add_argument(
        "--translation-engine",
        choices=["google", "openai", "auto"],
        default="google",
        help="google = prefer GoogleTranslator; openai = prefer OpenAI; auto = google first then openai",
    )
    args = parser.parse_args()

    base_dir = Path.cwd()
    run(
        base_dir=base_dir,
        max_per_day=args.max_per_day,
        per_source_limit=args.per_source_limit,
        retention_days=args.retention_days,
        lang_mode=args.lang_mode,
        target_lang=args.target_lang,
        translation_engine=args.translation_engine,
    )


if __name__ == "__main__":
    main()
