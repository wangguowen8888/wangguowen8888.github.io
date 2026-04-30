const { escapeHtml } = require("./utils");
const CONTENT_TYPE_LABELS = {
  news: "资讯",
  paper: "论文",
  tool: "工具",
  product: "产品",
  discussion: "讨论"
};

function toContentTypeLabel(type) {
  const key = String(type || "news").toLowerCase();
  return CONTENT_TYPE_LABELS[key] || key;
}

function groupByType(items) {
  return items.reduce((acc, item) => {
    const key = item.contentType || "news";
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});
}

function renderCards(items) {
  return items.map((item) => `
    <article class="card" style="grid-column: span 12">
      <h3><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3>
      <p class="meta">${escapeHtml(item.source)} · ${escapeHtml(item.author || "未知")} · ${escapeHtml(item.publishedAt.slice(0, 10))}</p>
      <p>${escapeHtml(item.aiSummary || item.summary || "")}</p>
    </article>
  `).join("");
}

function renderDayPage({ dateKey, summary, items }) {
  const grouped = groupByType(items);
  const ctaSection = `
    <section class="section" id="daily-cta">
      <div class="container">
        <div class="section-title"><h2>今日推荐入口</h2></div>
        <div class="grid">
          <article class="card" style="grid-column: span 4">
            <h3>热门推荐工具</h3>
            <p class="meta">优先看高转化入口</p>
            <p><a class="btn primary" href="../../tools/">查看工具合集</a></p>
            <div class="tagrow">
              <span class="tag">Kimi</span>
              <span class="tag">DeepSeek</span>
              <span class="tag">Notion AI</span>
            </div>
          </article>
          <article class="card" style="grid-column: span 4">
            <h3>高转化分类</h3>
            <p class="meta">从资讯直接进入可落地场景</p>
            <p><a class="btn" href="../../ai-chat/">AI 聊天工具</a></p>
            <p><a class="btn" href="../../ai-writing/">AI 写作工具</a></p>
            <p><a class="btn" href="../../side-hustle/">副业赚钱工具</a></p>
          </article>
          <article class="card" style="grid-column: span 4">
            <h3>查看更多对比评测</h3>
            <p class="meta">持续更新：推荐 / 对比 / 教程</p>
            <p>把日报热点和长期可搜索内容打通，便于后续转化。</p>
            <p><a class="btn primary" href="../../money/">进入赚钱专题</a></p>
          </article>
        </div>
      </div>
    </section>
  `;
  const sections = Object.entries(grouped).map(([type, typeItems]) => `
    <section class="section">
      <div class="container">
        <div class="section-title"><h2>${escapeHtml(toContentTypeLabel(type))}</h2></div>
        <div class="grid">${renderCards(typeItems)}</div>
      </div>
    </section>
  `).join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(dateKey)} AI 日报｜AI 工具导航</title>
    <meta name="description" content="${escapeHtml(summary)}" />
    <meta name="theme-color" content="#0b1020" />
    <link rel="stylesheet" href="../../assets/css/style.css" />
    <script defer src="../../assets/js/site-config.js"></script>
    <script defer src="../../assets/js/main.js"></script>
  </head>
  <body data-root="../.." data-page-kind="page" data-footer-kind="default" data-breadcrumb-parent-label="AI 日报" data-breadcrumb-parent-href="daily/" data-breadcrumb-current="${escapeHtml(dateKey)}">
    <div data-site-topbar></div>
    <main class="post">
      <div class="container">
        <header>
          <div data-site-breadcrumb></div>
          <h1>${escapeHtml(dateKey)} AI 日报</h1>
          <p class="subtitle">${escapeHtml(summary)}</p>
          <div class="byline"><span>${items.length} 条动态</span></div>
        </header>
      </div>
      ${ctaSection}
      ${sections}
    </main>
    <div data-site-footer></div>
  </body>
</html>`;
}

module.exports = { renderDayPage };
