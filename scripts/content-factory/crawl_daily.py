import argparse
import html
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from string import Template
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import feedparser
import requests
import trafilatura
from bs4 import BeautifulSoup
from dateutil import parser as dtparser


MAX_PER_DAY_DEFAULT = 20
RETENTION_DAYS_DEFAULT = 7
TIMEOUT_SECONDS = 20
LOCAL_TIMEZONE = "Asia/Shanghai"
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


def build_markdown(tpl: Template, article: Article) -> str:
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


def write_index_html(output_root: Path, date_key: str, articles: List[Article]) -> None:
    index_html = output_root / "index.html"
    item_lines: List[str] = []
    for idx, article in enumerate(articles, start=1):
        rel_md = f"./{date_key}/{idx:02d}-{article.source_id}.md"
        desc = safe_text(article.summary or article.content)[:180]
        item_lines.append(
            (
                f'            <a href="{rel_md}">\n'
                f"              <div>\n"
                f'                <div class="title">{html.escape(article.title)}</div>\n'
                f'                <div class="desc">{html.escape(article.source_name)} · {html.escape(desc)}</div>\n'
                f"              </div>\n"
                f'              <time datetime="{date_key}">{date_key}</time>\n'
                f"            </a>"
            )
        )
    if not item_lines:
        item_lines.append(
            "            <div><div class=\"title\">No articles generated today</div></div>"
        )

    html_text = f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>内容工厂｜每日抓取文章</title>
    <meta name="description" content="每日抓取文章列表。" />
    <meta name="theme-color" content="#0b1020" />
    <link rel="stylesheet" href="../assets/css/style.css" />
    <script defer src="../assets/js/site-config.js"></script>
    <script defer src="../assets/js/main.js"></script>
  </head>
  <body data-root=".." data-page-kind="page" data-footer-kind="default" data-breadcrumb-current="内容工厂">
    <div data-site-topbar></div>
    <main class="post">
      <div class="container">
        <header>
          <div data-site-breadcrumb></div>
          <h1>内容工厂</h1>
          <p class="subtitle">最近抓取文章（按当天输出）</p>
        </header>
        <section class="prose">
          <div class="list">
{chr(10).join(item_lines)}
          </div>
        </section>
      </div>
    </main>
    <div data-site-footer></div>
  </body>
</html>
"""
    index_html.write_text(html_text, encoding="utf-8")


def run(
    base_dir: Path,
    max_per_day: int,
    per_source_limit: int,
    retention_days: int,
) -> None:
    load_dotenv(base_dir)
    date_key = datetime.now(ZoneInfo(LOCAL_TIMEZONE)).strftime("%Y-%m-%d")
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
        md = build_markdown(template, article)
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
    write_index_html(dirs["output_root"], date_key, articles)
    prune_old(dirs["data_root"], dirs["output_root"], keep_days=retention_days)
    print(f"[content-factory] done: {len(articles)} articles @ {date_key}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily AI content crawler (fetch only)")
    parser.add_argument("--max-per-day", type=int, default=MAX_PER_DAY_DEFAULT)
    parser.add_argument("--per-source-limit", type=int, default=12)
    parser.add_argument("--retention-days", type=int, default=RETENTION_DAYS_DEFAULT)
    args = parser.parse_args()

    base_dir = Path.cwd()
    run(
        base_dir=base_dir,
        max_per_day=args.max_per_day,
        per_source_limit=args.per_source_limit,
        retention_days=args.retention_days,
    )


if __name__ == "__main__":
    main()
