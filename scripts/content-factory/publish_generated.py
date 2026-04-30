import html
import json
import re
from difflib import SequenceMatcher
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional


SITE_URL = "https://wangguowen8888.github.io"
KEEP_RECENT_POSTS = 20
AUTOGEN_PREFIX = "cf-"


@dataclass
class PublishedArticle:
    slug: str
    title: str
    description: str
    summary: str
    content: str
    source: str
    source_url: str
    original_url: str
    published_at: str
    image_url: Optional[str]
    category: str
    category_label: str
    category_href: str
    translation_target: str


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def strip_tags(text: str) -> str:
    text = html.unescape(str(text or ""))
    return re.sub(r"<[^>]+>", "", text)


def normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def clean_text(text: str) -> str:
    return normalize_ws(strip_tags(text))


def cleanup_summary(text: str) -> str:
    raw = str(text or "")
    if not raw:
        return ""
    text = raw.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n").replace("</p>", "\n")
    text = strip_tags(text)
    lines = []
    for line in re.split(r"[\r\n]+", text):
        clean = normalize_ws(line)
        if not clean:
            continue
        if re.match(r"^(Article URL|Comments URL|Points|# Comments)\s*:", clean, flags=re.I):
            continue
        if re.fullmatch(r"https?://\S+", clean):
            continue
        lines.append(clean)
    return normalize_ws(" ".join(lines))


def looks_like_metadata_summary(text: str) -> bool:
    if not text:
        return True
    indicators = ["Article URL", "Comments URL", "Points:", "# Comments", "rel=\"nofollow\"", "<a href="]
    return any(token in text for token in indicators)


def contains_cjk(text: str) -> bool:
    return bool(re.search(r"[\u4e00-\u9fff]", str(text or "")))


def summarize_from_body(text: str, limit: int = 160) -> str:
    clean = clean_text(text)
    if not clean:
        return ""
    first = re.split(r"(?<=[。！？.!?])\s+", clean)[0]
    first = normalize_ws(first)
    if len(first) >= 40:
        return first[:limit]
    return clean[:limit]


def slugify(text: str) -> str:
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    text = re.sub(r"[\s_]+", "-", text.strip().lower())
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text or "post"


def escape(text: str) -> str:
    return html.escape(str(text or ""), quote=True)


def paragraphize(text: str) -> List[str]:
    # Split into prose-ish chunks, while keeping short code-ish lines intact.
    chunks: List[str] = []
    for raw in re.split(r"\n{2,}|(?<=[。！？.!?])\s+", str(text or "")):
        clean = normalize_ws(raw)
        if clean:
            chunks.append(clean)
    return chunks[:16]


def is_codeish_text(text: str) -> bool:
    t = str(text or "")
    if not t:
        return False
    stripped = t.strip()
    # Only treat text as code when it really looks like a code/CLI line.
    code_starts = (
        "//",
        "# ",
        "$ ",
        "let ",
        "let mut ",
        "fn ",
        "if ",
        "match ",
        "for ",
        "while ",
        "use ",
        "impl ",
        "return ",
    )
    if stripped.startswith(code_starts):
        return True
    if stripped.startswith(("rm ", "cp ", "mv ", "chmod ", "chown ")):
        return True
    # Compact code statements often contain several operators/terminators.
    if len(stripped) <= 260 and stripped.count(";") >= 1 and any(token in stripped for token in ("::", "->", "{", "}", "&&", "||", "?")):
        return True
    return False


def guess_category(text: str) -> str:
    content = text.lower()
    if any(word in content for word in ["赚钱", "副业", "affiliate", "monetiz", "收入", "增长"]):
        return "side-hustle"
    if any(word in content for word in ["writing", "write", "文案", "写作", "blog", "notion", "document"]):
        return "ai-writing"
    return "ai-chat"


def category_meta(category: str) -> Dict[str, str]:
    mapping = {
        "ai-chat": {"label": "AI 聊天", "href": "ai-chat/"},
        "ai-writing": {"label": "AI 写作", "href": "ai-writing/"},
        "side-hustle": {"label": "副业赚钱", "href": "side-hustle/"},
    }
    return mapping.get(category, mapping["ai-chat"])


def build_slug(item: dict, rank: int) -> str:
    date_part = str(item.get("dateKey", "")).replace("-", "")
    title_part = slugify(item.get("title", ""))[:60]
    return f"{AUTOGEN_PREFIX}{date_part}-{rank:02d}-{title_part}".strip("-")


def load_generated_articles(base_dir: Path) -> List[PublishedArticle]:
    output_root = base_dir / "daily-crawler"
    articles: List[PublishedArticle] = []
    for day_dir in sorted(output_root.glob("20??-??-??"), reverse=True):
        for json_path in sorted(day_dir.glob("*.json")):
            item = read_json(json_path)
            text_for_category = " ".join(
                [
                    item.get("title", ""),
                    item.get("summary", ""),
                    item.get("content", ""),
                    item.get("translatedContent", ""),
                ]
            )
            category = guess_category(text_for_category)
            meta = category_meta(category)
            rank = int(item.get("rank", 0) or 0)
            slug = build_slug(item, rank)
            translated = clean_text(item.get("translatedContent", ""))
            original = clean_text(item.get("content", ""))
            body = translated or original
            raw_summary = str(item.get("summary", ""))
            translation_target = normalize_ws(item.get("translationTarget", ""))
            summary = cleanup_summary(raw_summary)
            if not summary or looks_like_metadata_summary(raw_summary):
                summary = summarize_from_body(body)
            if translation_target.lower().startswith("zh") and translated and not contains_cjk(summary):
                summary = summarize_from_body(translated)
            description = summary[:120]
            images = item.get("images") or []
            articles.append(
                PublishedArticle(
                    slug=slug,
                    title=normalize_ws(item.get("title", "Untitled")),
                    description=description,
                    summary=summary,
                    content=body,
                    source=normalize_ws(item.get("sourceName", "")),
                    source_url=normalize_ws(item.get("sourceName", "")),
                    original_url=normalize_ws(item.get("url", "")),
                    published_at=str(item.get("publishedAt", ""))[:10],
                    image_url=images[0] if images else None,
                    category=category,
                    category_label=meta["label"],
                    category_href=meta["href"],
                    translation_target=translation_target,
                )
            )
    deduped = {}
    for article in articles:
        deduped[article.slug] = article
    return list(deduped.values())[:KEEP_RECENT_POSTS]


def render_article(article: PublishedArticle) -> str:
    paragraphs = paragraphize(article.content)

    def first_sentence(text: str, max_chars: int = 140) -> str:
        t = normalize_ws(text)
        if not t:
            return ""
        # Try to stop at the first sentence-ending punctuation.
        m = re.search(r"[。！？.!?]", t)
        if m:
            out = t[: m.end()]
        else:
            out = t
        return out[:max_chars].strip()

    def fingerprint(text: str) -> str:
        # Used for quick similarity/duplicate checks; keep it cheap.
        t = normalize_ws(text)
        if not t:
            return ""
        return re.sub(r"[\s\.,!?:;；，。！？、]+", "", t)

    # 1) Avoid summary->body duplication when body starts with (or contains) the same summary prefix.
    summary_norm = normalize_ws(article.summary)
    if paragraphs and summary_norm and len(summary_norm) >= 40:
        if paragraphs[0].startswith(summary_norm):
            remainder = paragraphs[0][len(summary_norm) :].lstrip("，。；:：,.!? ")
            paragraphs = [remainder] + paragraphs[1:] if remainder else paragraphs[1:]

    # 2) Remove consecutive duplicate/near-duplicate paragraphs (helps when translation output repeats).
    deduped: List[str] = []
    last_fp = ""
    last_norm = ""
    for p in paragraphs:
        p_norm = normalize_ws(p)
        if not p_norm:
            continue
        p_fp = fingerprint(p)
        if deduped:
            if p_norm == last_norm:
                continue
            if last_fp and p_fp:
                # Only attempt fuzzy dedupe for sufficiently long paragraphs.
                if min(len(last_fp), len(p_fp)) >= 60:
                    ratio = SequenceMatcher(None, last_fp, p_fp).ratio()
                    if ratio >= 0.97:
                        continue
        deduped.append(p_norm)
        last_fp = p_fp
        last_norm = p_norm
    paragraphs = deduped

    prose_blocks = []
    if article.image_url:
        prose_blocks.append(
            f'<p><img src="{escape(article.image_url)}" alt="{escape(article.title)}" '
            'style="width:100%;border-radius:14px;border:1px solid var(--border);object-fit:cover" /></p>'
        )
    prose_blocks.append(
        f'<div class="callout"><p style="margin:0"><strong>先看结论：</strong>{escape(first_sentence(article.summary) or article.summary)}</p></div>'
    )
    code_buffer: List[str] = []
    non_code_count = 0
    core_inserted = False

    def flush_code() -> None:
        nonlocal code_buffer
        if not code_buffer:
            return
        code_text = "\n".join(code_buffer).strip()
        if code_text:
            prose_blocks.append(f"<pre><code>{escape(code_text)}</code></pre>")
        code_buffer = []

    for para in paragraphs:
        if is_codeish_text(para):
            code_buffer.append(para)
            continue

        flush_code()

        if not core_inserted and non_code_count == 1:
            prose_blocks.append("<h2>核心内容</h2>")
            core_inserted = True

        prose_blocks.append(f"<p>{escape(para)}</p>")
        non_code_count += 1

    flush_code()
    if not core_inserted and paragraphs:
        # Fallback: if the article is extremely code-heavy.
        prose_blocks.insert(1, "<h2>核心内容</h2>")
    prose_blocks.append(
        '<div class="callout">'
        '<p style="margin:0"><strong>延伸阅读：</strong>如果你想继续找可转化的工具入口，可以去工具合集和赚钱专题继续看。</p>'
        '<p style="margin:10px 0 0">'
        '<a class="btn primary" href="../tools/">进入 AI 工具导航页</a> '
        f'<a class="btn" href="../{escape(article.category_href)}">查看更多 {escape(article.category_label)}</a>'
        "</p></div>"
    )
    canonical = f"{SITE_URL}/post/{article.slug}.html"
    return f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{escape(article.title)}</title>
    <meta name="description" content="{escape(article.description)}" />
    <link rel="canonical" href="{canonical}" />
    <meta property="og:title" content="{escape(article.title)}" />
    <meta property="og:description" content="{escape(article.summary)}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="{canonical}" />
    <meta name="theme-color" content="#0b1020" />
    <link rel="stylesheet" href="../assets/css/style.css" />
    <script defer src="../assets/js/site-config.js"></script>
    <script defer src="../assets/js/main.js"></script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1025508631552415"
     crossorigin="anonymous"></script>
    <script type="application/ld+json">
      {{
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": {json.dumps(article.title, ensure_ascii=False)},
        "datePublished": {json.dumps(article.published_at)},
        "dateModified": {json.dumps(article.published_at)},
        "author": {{ "@type": "Person", "name": "站长" }},
        "publisher": {{ "@type": "Organization", "name": "AI 工具导航" }},
        "mainEntityOfPage": {json.dumps(canonical)}
      }}
    </script>
  </head>
  <body data-root=".." data-page-kind="post" data-footer-kind="default" data-breadcrumb-parent-label="{escape(article.category_label)}" data-breadcrumb-parent-href="{escape(article.category_href)}" data-breadcrumb-current="{escape(article.title)}">
    <div data-site-topbar></div>
    <main class="post">
      <div class="container">
        <header>
          <div data-site-breadcrumb></div>
          <h1>{escape(article.title)}</h1>
          <p class="subtitle">{escape(article.description or article.summary)}</p>
          <div class="byline">
            <span>分类：<a href="../{escape(article.category_href)}">{escape(article.category_label)}</a></span>
            <span>·</span>
            <span>更新：{escape(article.published_at)}</span>
            <span>·</span>
            <a href="{escape(article.original_url)}" target="_blank" rel="noopener noreferrer">原文来源：{escape(article.source)}</a>
          </div>
        </header>
        <article class="prose">
          {"".join(prose_blocks)}
        </article>
      </div>
    </main>
    <div data-site-footer></div>
  </body>
</html>
"""


def render_post_links(items: List[PublishedArticle]) -> str:
    blocks = []
    for article in items:
        blocks.append(
            f'''            <a href="./post/{escape(article.slug)}.html" data-search-item data-search-text="{escape(article.title)} {escape(article.category_label)} {escape(article.source)}">
              <div>
                <div class="title">{escape(article.title)}</div>
                <div class="desc">{escape(article.description)}</div>
              </div>
              <time datetime="{escape(article.published_at)}">{escape(article.published_at)}</time>
            </a>'''
        )
    return "\n".join(blocks)


def render_homepage(base_dir: Path, generated: List[PublishedArticle]) -> None:
    latest = generated[:5]
    latest_html = render_post_links(latest)
    content = f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>2026 最全 AI 工具合集｜免费推荐 + 副业赚钱</title>
    <meta name="description" content="收录 2026 最新 AI 聊天、AI 写作与副业工具。每篇文章提供对比、推荐与一键直达链接（含联盟 CTA）。" />
    <link rel="canonical" href="{SITE_URL}/" />
    <meta property="og:title" content="2026 最全 AI 工具合集｜免费推荐 + 副业赚钱" />
    <meta property="og:description" content="AI 聊天、AI 写作与副业工具合集 + 文章对比推荐。" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="{SITE_URL}/" />
    <meta name="theme-color" content="#0b1020" />
    <link rel="stylesheet" href="./assets/css/style.css" />
    <script defer src="./assets/js/site-config.js"></script>
    <script defer src="./assets/js/main.js"></script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1025508631552415"
     crossorigin="anonymous"></script>
  </head>
  <body data-root="." data-page-kind="home" data-footer-kind="home">
    <a class="skip-link" href="#main">跳到正文</a>
    <div data-site-topbar></div>
    <main id="main">
      <section class="hero">
        <div class="container">
          <div class="hero-card">
            <div class="hero-inner">
              <div>
                <p class="kicker">2026 更新 · 免费 / 推荐 / 对比 / 直达</p>
                <h1>最全 AI 工具合集：聊天、写作与副业</h1>
                <p class="lead">你不是在“找工具”，你是在找<strong>更快解决问题</strong>的路径。这里把高点击话题、稳定 SEO 需求与高收益对比页都整理好了。</p>
                <div class="hero-actions">
                  <a class="btn" href="./daily/">查看 AI 日报</a>
                  <a class="btn primary" href="./tools/">进入工具合集</a>
                </div>
              </div>
              <aside class="hero-right">
                <div class="search" role="search" aria-label="站内搜索">
                  <input id="site-search" type="search" placeholder="搜索：免费 AI 聊天 / 写作 / PDF / 赚钱…" autocomplete="off" />
                  <small>即搜即筛</small>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="container">
          <div class="section-title">
            <h2>热门推荐（先做能赚钱的）</h2>
            <a href="./tools/">查看全部工具 →</a>
          </div>
          <div class="grid">
            <a class="card" href="./money/" data-search-item data-search-text="赚钱 变现 ai 专题 高转化">
              <h3>赚钱专题</h3>
              <p class="meta">高收益内容入口，承接教程、对比和联盟链接点击。</p>
              <span class="btn primary">进入专题</span>
              <div class="tagrow">
                <span class="tag">高CPC</span><span class="tag">教程</span><span class="tag">转化</span>
              </div>
            </a>
            <a class="card" href="./daily/" data-search-item data-search-text="日报 新闻 工具 社区 自动更新">
              <h3>AI 日报</h3>
              <p class="meta">自动聚合 AI 社区、论文、工具与产品动态。</p>
              <span class="btn">进入日报</span>
              <div class="tagrow">
                <span class="tag">资讯</span><span class="tag">每日</span><span class="tag">自动化</span>
              </div>
            </a>
            <a class="card" href="./daily-crawler/" data-search-item data-search-text="抓取 工厂 内容 模板 翻译">
              <h3>内容工厂</h3>
              <p class="meta">抓取、翻译、模板化产出，再自动发布到站内内容页。</p>
              <span class="btn">查看索引</span>
              <div class="tagrow">
                <span class="tag">抓取</span><span class="tag">翻译</span><span class="tag">模板</span>
              </div>
            </a>
          </div>
          <div class="ad" aria-label="内容展示区域" style="margin-top:8px"><div class="adbox"></div></div>
        </div>
      </section>
      <section class="section">
        <div class="container">
          <div class="section-title">
            <h2>分类入口（引导点击）</h2>
            <a href="./tools/">工具合集 →</a>
          </div>
          <div class="grid">
            <a class="card" href="./daily/" data-search-item data-search-text="ai 日报 资讯 新闻 社区 论文 工具">
              <h3>AI 日报</h3>
              <p class="meta">每日自动聚合 AI 社区、论文、工具与产品动态</p>
              <span class="btn primary">进入 AI 日报</span>
            </a>
            <a class="card" href="./ai-chat/" data-search-item data-search-text="ai 聊天 陪伴 女友 语音">
              <h3>AI 聊天</h3>
              <p class="meta">免费 / 不用注册 / 陪伴 / 语音</p>
              <span class="btn primary">进入 AI 聊天</span>
            </a>
            <a class="card" href="./ai-writing/" data-search-item data-search-text="ai 写作 文案 论文 ppt">
              <h3>AI 写作</h3>
              <p class="meta">文案 / 论文 / PPT / 营销素材</p>
              <span class="btn primary">进入 AI 写作</span>
            </a>
            <a class="card" href="./side-hustle/" data-search-item data-search-text="副业 赚钱 教程 自动化">
              <h3>副业赚钱</h3>
              <p class="meta">教程 + 工具 + 平台 · 高转化</p>
              <span class="btn primary">进入副业赚钱</span>
            </a>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="container">
          <div class="section-title"><h2>最新文章（自动更新）</h2></div>
          <div class="list" aria-label="文章列表">
{latest_html}
          </div>
          <div class="ad" aria-label="内容展示区域" style="margin-top:14px"><div class="adbox"></div></div>
        </div>
      </section>
    </main>
    <div data-site-footer></div>
  </body>
</html>
"""
    (base_dir / "index.html").write_text(content, encoding="utf-8")


def render_category_page(
    title: str,
    subtitle: str,
    page_name: str,
    items: List[PublishedArticle],
    extra_html: str = "",
) -> str:
    links = []
    for article in items[:8]:
        links.append(
            f'''            <a href="../post/{escape(article.slug)}.html">
              <div>
                <div class="title">{escape(article.title)}</div>
                <div class="desc">{escape(article.description)}</div>
              </div>
              <time datetime="{escape(article.published_at)}">{escape(article.published_at)}</time>
            </a>'''
        )
    links_html = "\n".join(links) if links else '            <p style="color:var(--muted)">暂无自动生成内容。</p>'
    return f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{escape(title)}</title>
    <meta name="description" content="{escape(subtitle)}" />
    <link rel="canonical" href="{SITE_URL}/{page_name}/" />
    <meta name="theme-color" content="#0b1020" />
    <link rel="stylesheet" href="../assets/css/style.css" />
    <script defer src="../assets/js/site-config.js"></script>
    <script defer src="../assets/js/main.js"></script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1025508631552415"
     crossorigin="anonymous"></script>
  </head>
  <body data-root=".." data-page-kind="category" data-footer-kind="default" data-breadcrumb-current="{escape(title.split('（')[0])}">
    <div data-site-topbar></div>
    <main class="post">
      <div class="container">
        <header>
          <div data-site-breadcrumb></div>
          <h1>{escape(title)}</h1>
          <p class="subtitle">{escape(subtitle)}</p>
          <div class="byline">
            <span>自动更新内容页</span>
            <span>·</span>
            <a href="../tools/">工具合集</a>
          </div>
        </header>
        <section class="prose">
          <h2>精选文章</h2>
          <div class="list">
{links_html}
          </div>
        </section>
        {extra_html}
      </div>
    </main>
    <div data-site-footer></div>
  </body>
</html>
"""


def render_tools_page(base_dir: Path, items: List[PublishedArticle]) -> None:
    cards = []
    for article in items[:12]:
        cards.append(
            f'''            <div class="tool-card" data-search-item data-search-text="{escape(article.title)} {escape(article.category_label)} {escape(article.source)}" style="background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 15px;">
              <h3 style="color: #3b82f6; font-size: 18px;">{escape(article.title)}</h3>
              <p style="color: #94a3b8; font-size: 14px;">来源：{escape(article.source)} · 分类：{escape(article.category_label)}</p>
              <p style="color: #cbd5e1; font-size: 13px; margin: 8px 0;">{escape(article.description)}</p>
              <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
                <a class="btn primary" href="../post/{escape(article.slug)}.html">查看解析</a>
                <a class="btn" href="{escape(article.original_url)}" target="_blank" rel="noopener noreferrer nofollow sponsored">原文链接</a>
              </div>
              <p style="color: #94a3b8; font-size: 12px; margin: 10px 0 0;">更新：{escape(article.published_at)}</p>
            </div>'''
        )
    content = f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>工具合集｜AI 聊天 / 写作 / 副业（可搜索）</title>
    <meta name="description" content="可搜索的工具合集页：AI 聊天、AI 写作、副业自动化与常用效率工具。每个工具带 CTA 按钮（可放联盟链接）。" />
    <link rel="canonical" href="{SITE_URL}/tools/" />
    <meta name="theme-color" content="#0b1020" />
    <link rel="stylesheet" href="../assets/css/style.css" />
    <script defer src="../assets/js/site-config.js"></script>
    <script defer src="../assets/js/main.js"></script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1025508631552415"
     crossorigin="anonymous"></script>
  </head>
  <body data-root=".." data-page-kind="category" data-footer-kind="default" data-breadcrumb-current="工具合集">
    <div data-site-topbar></div>
    <main class="post">
      <div class="container">
        <header>
          <div data-site-breadcrumb></div>
          <h1>工具合集（自动更新）</h1>
          <p class="subtitle">把“推荐 / 对比 / 原文来源”做成一个可搜索列表，承接日报与内容工厂流量。</p>
          <div class="byline">
            <span>精选常用 AI 工具与评测，持续更新。</span>
            <span>·</span>
            <a href="../money/">查看赚钱专题</a>
          </div>
        </header>
        <section class="prose">
          <div class="search" role="search" aria-label="工具搜索" style="margin-bottom:12px">
            <input id="site-search" type="search" placeholder="搜索：ChatGPT / Claude / 写作 / 副业 / Product Hunt…" autocomplete="off" />
            <small>即搜即筛</small>
          </div>
          <p id="search-empty" style="display:none;color:var(--muted);margin:0">没有匹配结果，换个关键词试试。</p>
          <h2>最新解析与来源</h2>
          <div class="tool-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; padding: 20px 0;">
{''.join(cards)}
          </div>
        </section>
      </div>
    </main>
    <div data-site-footer></div>
  </body>
</html>
"""
    (base_dir / "tools" / "index.html").write_text(content, encoding="utf-8")


def render_factory_index(base_dir: Path, items: List[PublishedArticle]) -> None:
    rows = []
    for article in items:
        rows.append(
            f'''            <a href="../post/{escape(article.slug)}.html">
              <div>
                <div class="title">{escape(article.title)}</div>
                <div class="desc">{escape(article.source)} · {escape(article.category_label)} · {escape(article.description)}</div>
              </div>
              <time datetime="{escape(article.published_at)}">{escape(article.published_at)}</time>
            </a>'''
        )
    content = f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>内容工厂｜每日抓取与自动发布</title>
    <meta name="description" content="展示内容工厂最近抓取、翻译并自动发布到站内的文章。" />
    <link rel="canonical" href="{SITE_URL}/daily-crawler/" />
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
          <p class="subtitle">抓取、翻译、模板化，再自动发布到首页、分类页和专题页。</p>
        </header>
        <section class="prose">
          <div class="list">
{chr(10).join(rows)}
          </div>
        </section>
      </div>
    </main>
    <div data-site-footer></div>
  </body>
</html>
"""
    (base_dir / "daily-crawler" / "index.html").write_text(content, encoding="utf-8")


def render_sitemap(base_dir: Path, items: List[PublishedArticle]) -> None:
    static_urls = [
        ("", "weekly", "1.0"),
        ("tools/", "daily", "0.9"),
        ("daily/", "daily", "0.9"),
        ("daily-crawler/", "daily", "0.8"),
        ("money/", "daily", "0.9"),
        ("ai-chat/", "daily", "0.8"),
        ("ai-writing/", "daily", "0.8"),
        ("side-hustle/", "daily", "0.8"),
        ("about.html", "yearly", "0.2"),
        ("privacy.html", "yearly", "0.2"),
    ]
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for path, freq, priority in static_urls:
        lines.extend(
            [
                "  <url>",
                f"    <loc>{SITE_URL}/{path}</loc>",
                f"    <changefreq>{freq}</changefreq>",
                f"    <priority>{priority}</priority>",
                "  </url>",
            ]
        )
    for article in items:
        lines.extend(
            [
                "  <url>",
                f"    <loc>{SITE_URL}/post/{article.slug}.html</loc>",
                "    <changefreq>weekly</changefreq>",
                "    <priority>0.8</priority>",
                "  </url>",
            ]
        )
    lines.append("</urlset>")
    (base_dir / "sitemap.xml").write_text("\n".join(lines) + "\n", encoding="utf-8")


def cleanup_old_generated_posts(base_dir: Path, active_slugs: List[str]) -> None:
    post_dir = base_dir / "post"
    active = {f"{slug}.html" for slug in active_slugs}
    for path in post_dir.glob(f"{AUTOGEN_PREFIX}*.html"):
        if path.name not in active:
            path.unlink(missing_ok=True)


def main() -> None:
    base_dir = Path.cwd()
    articles = load_generated_articles(base_dir)
    if not articles:
        raise RuntimeError("No generated crawler articles found in daily-crawler.")

    for article in articles:
        (base_dir / "post" / f"{article.slug}.html").write_text(render_article(article), encoding="utf-8")

    cleanup_old_generated_posts(base_dir, [a.slug for a in articles])
    render_homepage(base_dir, articles)
    render_tools_page(base_dir, articles)
    render_factory_index(base_dir, articles)

    by_category = {
        "ai-chat": [a for a in articles if a.category == "ai-chat"],
        "ai-writing": [a for a in articles if a.category == "ai-writing"],
        "side-hustle": [a for a in articles if a.category == "side-hustle"],
    }
    (base_dir / "money" / "index.html").write_text(
        render_category_page("赚钱专题（自动更新）", "把 AI 流量导向转化：推荐清单、对比评测与副业教程。", "money", articles),
        encoding="utf-8",
    )
    chat_tester_html = """
        <section class="prose" id="chat-tester">
          <h2>AI 聊天测试（限流版）</h2>
          <p>用于测试用户体验和成本控制。支持两种限制方式：每日 5 次 或 单次字数上限。</p>
          <div class="callout">
            <p style="margin:0"><strong>连接方式：</strong>可直接在页面填写 API Key 连模型（仅保存在本机浏览器），或配置 <code>chatApiEndpoint</code> 走你自己的接口。</p>
          </div>
          <div class="chat-conn-grid">
            <div>
              <label>连接模式</label>
              <select id="chat-conn-mode">
                <option value="direct">直连模型（浏览器）</option>
                <option value="backend">后端接口（chatApiEndpoint）</option>
              </select>
            </div>
            <div>
              <label>模型</label>
              <input id="chat-model" type="text" value="gpt-4.1-mini" />
            </div>
          </div>
          <div class="chat-conn-grid">
            <div style="grid-column: span 2;">
              <label>API Key（仅本地）</label>
              <input id="chat-api-key" type="password" placeholder="sk-..." autocomplete="off" />
              <p class="meta">不会写入仓库，仅保存在你当前浏览器 localStorage。</p>
            </div>
          </div>
          <div class="chat-limiter">
            <label>限制模式</label>
            <select id="chat-limit-mode">
              <option value="daily">每日 5 次</option>
              <option value="chars">单次最多 500 字</option>
            </select>
            <p id="chat-limit-hint" class="meta">今日剩余 5/5 次</p>
          </div>
          <div id="chat-messages" class="chat-messages" aria-live="polite"></div>
          <div class="chat-input-wrap">
            <textarea id="chat-input" rows="4" placeholder="输入你要测试的问题..."></textarea>
            <div class="chat-actions">
              <small id="chat-char-count">0 / 500</small>
              <button id="chat-send" class="btn primary" type="button">发送测试</button>
            </div>
          </div>
        </section>
    """
    (base_dir / "ai-chat" / "index.html").write_text(
        render_category_page(
            "AI 聊天工具推荐（2026）",
            "覆盖聊天模型、推理工具、对比评测和高点击入口。",
            "ai-chat",
            by_category["ai-chat"],
            extra_html=chat_tester_html,
        ),
        encoding="utf-8",
    )
    (base_dir / "ai-writing" / "index.html").write_text(
        render_category_page("AI 写作工具推荐（2026）", "覆盖写作、文档、知识库和长文本整理场景。", "ai-writing", by_category["ai-writing"]),
        encoding="utf-8",
    )
    (base_dir / "side-hustle" / "index.html").write_text(
        render_category_page("副业赚钱（2026）", "覆盖内容变现、联盟分销、低成本起步和执行路线。", "side-hustle", by_category["side-hustle"]),
        encoding="utf-8",
    )
    render_sitemap(base_dir, articles)
    print(f"[content-factory] published {len(articles)} articles")


if __name__ == "__main__":
    main()
