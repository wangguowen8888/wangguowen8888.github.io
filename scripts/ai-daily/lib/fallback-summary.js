const CONTENT_TYPE_LABELS = {
  news: "资讯",
  paper: "论文",
  tool: "工具",
  product: "产品",
  discussion: "讨论"
};

function toContentTypeLabel(type) {
  const key = String(type || "").toLowerCase();
  return CONTENT_TYPE_LABELS[key] || key;
}

function summarizeFallback(item) {
  const bits = [];
  if (item.source) bits.push(`来源：${item.source}`);
  if (item.contentType) bits.push(`类型：${toContentTypeLabel(item.contentType)}`);
  if (item.summary) bits.push(item.summary.slice(0, 120));
  else bits.push(item.title);
  return bits.join("，");
}

function summarizeDailyFallback(items) {
  const byType = items.reduce((acc, item) => {
    acc[item.contentType] = (acc[item.contentType] || 0) + 1;
    return acc;
  }, {});
  const parts = Object.entries(byType).map(([type, count]) => `${toContentTypeLabel(type)}${count}条`);
  return `今天共整理 ${items.length} 条 AI 动态，主要涵盖 ${parts.join("、")}。`;
}

module.exports = {
  summarizeFallback,
  summarizeDailyFallback
};
