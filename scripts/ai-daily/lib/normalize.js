const { ensureAbsoluteUrl, isoDate, stripHtml } = require("./utils");

function normalizeItem(item, source) {
  const title = stripHtml(item.title || "").trim();
  if (!title || !item.url) return null;
  return {
    source: source.name,
    sourceId: source.id,
    title,
    url: ensureAbsoluteUrl(item.url, item.url),
    publishedAt: isoDate(item.publishedAt),
    author: item.author || source.name,
    summary: stripHtml(item.summary || ""),
    tags: Array.isArray(item.tags) ? item.tags.filter(Boolean) : [],
    score: Number(item.score || 0),
    contentType: item.contentType || source.categoryHint || "news",
    rawMeta: item.rawMeta || {},
    weight: source.weight || 0
  };
}

function normalizeItems(items, source) {
  return items
    .map((item) => normalizeItem(item, source))
    .filter(Boolean);
}

module.exports = { normalizeItems };
