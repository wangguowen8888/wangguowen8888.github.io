const { fetchJson, fetchText, stripHtml } = require("../lib/utils");

module.exports = async function fetchLinuxDo(source) {
  // Prefer Discourse JSON API; fallback to RSS if needed.
  try {
    const json = await fetchJson("https://linux.do/latest.json", { timeoutMs: 20000 });
    const topics = (json.topic_list?.topics || []).slice(0, source.limit || 8);
    return topics
      .filter((topic) => /ai|llm|openai|deepseek|模型|人工智能/i.test(`${topic.title} ${(topic.tags || []).join(" ")}`))
      .map((topic) => ({
        title: topic.title,
        url: `https://linux.do/t/${topic.slug}/${topic.id}`,
        publishedAt: topic.last_posted_at || topic.created_at || new Date().toISOString(),
        author: "linux.do",
        summary: "",
        tags: topic.tags || ["linux.do"],
        score: topic.posts_count || 0,
        contentType: "discussion",
        rawMeta: { views: topic.views || 0 }
      }));
  } catch {
    const xml = await fetchText("https://linux.do/latest.rss", { timeoutMs: 20000 });
    const items = xml.split("<item>").slice(1, (source.limit || 8) + 1);
    return items
      .map((item) => {
        const get = (tag) => {
          const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
          return match ? stripHtml(match[1]) : "";
        };
        return {
          title: get("title"),
          url: get("link"),
          publishedAt: get("pubDate") || new Date().toISOString(),
          author: "linux.do",
          summary: get("description"),
          tags: ["linux.do"],
          score: 0,
          contentType: "discussion",
          rawMeta: {}
        };
      })
      .filter((topic) => /ai|llm|openai|deepseek|模型|人工智能/i.test(`${topic.title} ${topic.summary}`));
  }
};
