const { fetchText, stripHtml } = require("../lib/utils");

module.exports = async function fetchProductHunt(source) {
  // Prefer RSS feed (stable without JS rendering).
  const xml = await fetchText("https://www.producthunt.com/feed", { timeoutMs: 20000 });
  const items = xml.split("<item>").slice(1, (source.limit || 6) + 1);
  return items
    .map((item) => {
      const get = (tag) => {
        const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return match ? stripHtml(match[1]) : "";
      };
      const title = get("title");
      const url = get("link");
      const description = get("description");
      return {
        title,
        url,
        publishedAt: get("pubDate") || new Date().toISOString(),
        author: "Product Hunt",
        summary: description,
        tags: ["producthunt"],
        score: 0,
        contentType: "product",
        rawMeta: {}
      };
    })
    .filter((entry) => entry.title && /ai|artificial intelligence|llm|agent|gpt/i.test(`${entry.title} ${entry.summary}`));
};
