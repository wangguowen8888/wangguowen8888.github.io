const SOURCE_DEFINITIONS = [
  {
    id: "hackernews",
    name: "Hacker News",
    mode: "json",
    enabled: true,
    limit: 8,
    weight: 10,
    categoryHint: "news",
    summarize: true
  },
  {
    id: "github-trending",
    name: "GitHub Trending",
    mode: "html",
    enabled: true,
    limit: 8,
    weight: 9,
    categoryHint: "repo",
    summarize: true
  },
  {
    id: "arxiv",
    name: "arXiv",
    mode: "rss",
    enabled: true,
    limit: 8,
    weight: 9,
    categoryHint: "paper",
    summarize: true
  },
  {
    id: "reddit",
    name: "Reddit",
    mode: "json",
    enabled: true,
    limit: 8,
    weight: 8,
    categoryHint: "discussion",
    summarize: true,
    subreddits: ["LocalLLaMA", "MachineLearning", "OpenAI"]
  },
  {
    id: "linuxdo",
    name: "Linux.do",
    mode: "json",
    enabled: true,
    limit: 8,
    weight: 8,
    categoryHint: "discussion",
    summarize: true
  },
  {
    id: "producthunt",
    name: "Product Hunt",
    mode: "html",
    enabled: true,
    limit: 6,
    weight: 7,
    categoryHint: "product",
    summarize: true
  },
  { id: "zhihu", name: "知乎", mode: "placeholder", enabled: false, limit: 0, weight: 0, categoryHint: "discussion", summarize: false },
  { id: "juejin", name: "掘金", mode: "placeholder", enabled: false, limit: 0, weight: 0, categoryHint: "tool", summarize: false },
  { id: "csdn", name: "CSDN", mode: "placeholder", enabled: false, limit: 0, weight: 0, categoryHint: "tool", summarize: false },
  { id: "oschina", name: "开源中国", mode: "placeholder", enabled: false, limit: 0, weight: 0, categoryHint: "news", summarize: false },
  { id: "rsshub", name: "RSSHub", mode: "placeholder", enabled: false, limit: 0, weight: 0, categoryHint: "news", summarize: false },
  { id: "devto", name: "Dev.to", mode: "placeholder", enabled: false, limit: 0, weight: 0, categoryHint: "tool", summarize: false },
  { id: "medium", name: "Medium", mode: "placeholder", enabled: false, limit: 0, weight: 0, categoryHint: "news", summarize: false }
];

const SITE_URL = "https://wangguowen8888.github.io";

module.exports = {
  site: {
    name: "AI 工具导航",
    baseUrl: SITE_URL,
    dailyBasePath: "daily",
    dataBasePath: "data/daily"
  },
  generation: {
    timezone: "Asia/Shanghai",
    maxItemsPerSource: 8,
    maxSummaryItems: 12,
    dailyTitle: "AI 日报"
  },
  summary: {
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    enabled: Boolean(process.env.OPENAI_API_KEY)
  },
  sources: SOURCE_DEFINITIONS
};
