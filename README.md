## 静态站模板（可直接上线）

这是一套纯静态（无后端）的 SEO 内容站模板，包含：
- 首页 + 分类页 + 工具合集页
- 文章页模板（含广告位 + CTA 联盟按钮）
- About / 隐私政策
- 基础样式与少量 JS（站内搜索/复制链接）

### 目录结构

```
/
├── index.html
├── about.html
├── privacy.html
├── robots.txt
├── sitemap.xml
├── assets/
│   ├── css/style.css
│   └── js/main.js
├── ai-chat/
│   └── index.html
├── ai-writing/
│   └── index.html
├── side-hustle/
│   └── index.html
├── tools/
│   └── index.html
└── post/
    ├── template.html
    └── free-ai-chat-no-signup.html
```

### 你需要改的地方（上线前 5 分钟）

- `sitemap.xml` 里的 `https://example.com` 改成你的域名
- 每个页面 `<head>` 里的 `og:url` / `canonical` 改成真实 URL
- `post/` 里的示例文章内容换成你的关键词内容
- 广告：在页面里搜 `ADSENSE_SNIPPET_HERE`，替换为你的 AdSense 脚本
- 联盟：在页面里搜 `AFF_LINK_HERE`，替换为你的联盟链接

### 本地预览

任意静态服务器都行，例如 VSCode Live Server，或：

```bash
npx serve .
```

