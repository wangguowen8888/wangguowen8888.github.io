window.siteConfig = {
  siteName: "AI 工具导航",
  faviconPath: "assets/favicon.svg",
  // Optional. Set to real API endpoint to enable server chat.
  // Example: "https://your-domain.com/api/chat"
  chatApiEndpoint: "http://127.0.0.1:3001/api/chat",
  navItems: [
    { href: "daily/", label: "AI 日报" },
    { href: "money/", label: "赚钱专题" },
    { href: "ai-chat/", label: "AI 聊天" },
    { href: "ai-writing/", label: "AI 写作" },
    { href: "side-hustle/", label: "副业赚钱" },
    { href: "tools/", label: "工具合集" }
  ],
  featuredNavItem: {
    href: "post/deepseek.html",
    label: "热门：DeepSeek R1 评测"
  },
  footers: {
    home: {
      text: "AI 工具导航 · 纯静态站",
      links: [
        { href: "daily/", label: "AI 日报" },
        { href: "about.html", label: "About" },
        { href: "privacy.html", label: "隐私政策" }
      ]
    },
    default: {
      text: "AI 工具导航",
      links: [
        { href: "", label: "首页" },
        { href: "daily/", label: "AI 日报" },
        { href: "privacy.html", label: "隐私政策" }
      ]
    },
    page: {
      text: "AI 工具导航",
      links: [
        { href: "", label: "首页" },
        { href: "daily/", label: "AI 日报" },
        { href: "tools/", label: "工具合集" }
      ]
    },
    privacy: {
      text: "AI 工具导航",
      links: [
        { href: "", label: "首页" },
        { href: "daily/", label: "AI 日报" },
        { href: "about.html", label: "About" }
      ]
    }
  }
};
