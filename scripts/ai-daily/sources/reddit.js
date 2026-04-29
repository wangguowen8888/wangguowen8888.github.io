const { fetchText, stripHtml } = require("../lib/utils");

module.exports = async function fetchReddit(source) {
  const subreddits = source.subreddits || ["LocalLLaMA"];
  const results = [];
  for (const subreddit of subreddits) {
    const perSub = Math.max(3, Math.ceil((source.limit || 8) / subreddits.length));
    // Prefer the stable RSS endpoint.
    const xml = await fetchText(`https://www.reddit.com/r/${subreddit}/hot.rss?limit=${perSub}`, { timeoutMs: 20000 });
    const entries = xml.split("<entry>").slice(1, perSub + 1);
    for (const entry of entries) {
      const get = (tag) => {
        const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return match ? stripHtml(match[1]) : "";
      };
      const linkMatch = entry.match(/<link[^>]*href="([^"]+)"/);
      results.push({
        title: get("title"),
        url: linkMatch ? linkMatch[1] : get("link"),
        publishedAt: get("updated") || new Date().toISOString(),
        author: subreddit,
        summary: get("content"),
        tags: [subreddit],
        score: 0,
        contentType: "discussion",
        rawMeta: {}
      });
    }
  }
  return results.slice(0, source.limit || 8);
};
