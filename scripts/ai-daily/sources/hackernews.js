const { fetchJson, stripHtml } = require("../lib/utils");

module.exports = async function fetchHackerNews(source) {
  const json = await fetchJson(`https://hn.algolia.com/api/v1/search_by_date?query=AI&tags=story&hitsPerPage=${source.limit || 8}`);
  return (json.hits || [])
    .filter((item) => item && /ai|llm|openai|anthropic|gpt|agent|model/i.test(`${item.title} ${item.story_text || ""}`))
    .map((item) => ({
      title: item.title,
      url: item.url || `https://news.ycombinator.com/item?id=${item.objectID}`,
      publishedAt: item.created_at,
      author: item.author,
      summary: stripHtml(item.story_text || ""),
      tags: ["hn"],
      score: item.points || 0,
      contentType: "news",
      rawMeta: { comments: item.num_comments || 0 }
    }));
};
