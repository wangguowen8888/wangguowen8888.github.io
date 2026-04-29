function classifyItem(item) {
  const text = `${item.title} ${item.summary} ${(item.tags || []).join(" ")}`.toLowerCase();
  if (/(arxiv|paper|论文|research|dataset|benchmark)/.test(text)) return { ...item, contentType: "paper" };
  if (/(product hunt|launch|发布|产品|app)/.test(text)) return { ...item, contentType: "product" };
  if (/(github|repo|开源|model|agent|tool|工具)/.test(text)) return { ...item, contentType: "tool" };
  if (/(reddit|discussion|论坛|问答|show hn|ask hn|linux.do)/.test(text)) return { ...item, contentType: "discussion" };
  return { ...item, contentType: item.contentType || "news" };
}

function classifyItems(items) {
  return items.map(classifyItem);
}

module.exports = { classifyItems };
