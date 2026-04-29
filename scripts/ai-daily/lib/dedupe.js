function normalizeKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/(www\.)?/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeItems(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = `${normalizeKey(item.title)}|${normalizeKey(item.url)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

module.exports = { dedupeItems };
