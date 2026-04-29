const { escapeHtml } = require("./utils");

function renderDailyIndex({ entries }) {
  const list = entries.map((entry) => `
    <a href="./${escapeHtml(entry.dateKey)}/">
      <div>
        <div class="title">${escapeHtml(entry.dateKey)} AI 日报</div>
        <div class="desc">${escapeHtml(entry.summary)}</div>
      </div>
      <time datetime="${escapeHtml(entry.dateKey)}">${escapeHtml(entry.dateKey)}</time>
    </a>
  `).join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI 日报｜AI 工具导航</title>
    <meta name="description" content="每日自动聚合 AI 社区、论文、工具与产品动态。" />
    <meta name="theme-color" content="#0b1020" />
    <link rel="stylesheet" href="../assets/css/style.css" />
    <script defer src="../assets/js/site-config.js"></script>
    <script defer src="../assets/js/main.js"></script>
  </head>
  <body data-root=".." data-page-kind="page" data-footer-kind="default" data-breadcrumb-current="AI 日报">
    <div data-site-topbar></div>
    <main class="post">
      <div class="container">
        <header>
          <div data-site-breadcrumb></div>
          <h1>AI 日报</h1>
          <p class="subtitle">每天自动整理 AI 圈最值得关注的讨论、论文、产品与工具。</p>
        </header>
        <section class="prose">
          <div class="list">${list || "<p>暂无日报。</p>"}</div>
        </section>
      </div>
    </main>
    <div data-site-footer></div>
  </body>
</html>`;
}

module.exports = { renderDailyIndex };
