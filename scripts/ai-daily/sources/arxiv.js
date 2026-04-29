const { fetchText, stripHtml } = require("../lib/utils");

function parseEntries(feed) {
  return feed.split("<entry>").slice(1).map((entry) => {
    const get = (tag) => {
      const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return match ? stripHtml(match[1]) : "";
    };
    const linkMatch = entry.match(/<link[^>]*href="([^"]+)"/);
    return {
      title: get("title"),
      url: linkMatch ? linkMatch[1] : "https://arxiv.org/",
      publishedAt: get("published"),
      author: get("name"),
      summary: get("summary"),
      tags: ["arxiv"],
      score: 0,
      contentType: "paper",
      rawMeta: {}
    };
  });
}

module.exports = async function fetchArxiv(source) {
  const url = `https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:stat.ML&sortBy=submittedDate&sortOrder=descending&max_results=${source.limit || 8}`;
  const xml = await fetchText(url);
  return parseEntries(xml).slice(0, source.limit || 8);
};
