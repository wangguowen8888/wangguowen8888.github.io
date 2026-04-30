# Content Factory Crawler

Daily crawler for AI content sources with:

- article text extraction
- image URL extraction
- markdown output using template
- optional translation (OpenAI first, Google fallback)
- daily cap (default 20)
- 7-day retention (same logic as daily pipeline)

## Install

```bash
pip install -r scripts/content-factory/requirements.txt
npm run install-precommit
```

`install-precommit` will install a local git pre-commit hook that blocks commits when staged changes contain likely secrets.

## Run

```bash
python scripts/content-factory/crawl_daily.py --max-per-day 20 --retention-days 7 --lang-mode translate --target-lang zh-CN
```

Then publish generated content into site pages:

```bash
python scripts/content-factory/publish_generated.py
```

Generate English translation output:

```bash
python scripts/content-factory/crawl_daily.py --target-lang en
```

Use original language only:

```bash
python scripts/content-factory/crawl_daily.py --lang-mode none
```

## Output

- `daily-crawler/YYYY-MM-DD/*.md` article markdown from template
- `daily-crawler/YYYY-MM-DD/*.json` structured article data
- `daily-crawler/index.html` latest published index
- `data/daily-crawler/YYYY-MM-DD.json` daily summary
- `post/cf-*.html` generated post pages
- refreshed `index.html`, `money/index.html`, `ai-chat/index.html`, `ai-writing/index.html`, `side-hustle/index.html`, `tools/index.html`, `sitemap.xml`

## Optional OpenAI translation

If these env vars are present, translation uses OpenAI API first:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional, default `gpt-4.1-mini`)

Use `.env.example` as a template for local environment variables. Do not commit `.env`.
