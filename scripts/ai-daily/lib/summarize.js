const { summarizeFallback, summarizeDailyFallback } = require("./fallback-summary");

async function callOpenAI(prompt, config) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: config.model,
      input: prompt
    })
  });
  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }
  const data = await response.json();
  return data.output_text?.trim() || "";
}

async function summarizeItems(items, config) {
  const output = [];
  for (const item of items) {
    if (!config.enabled || !item.title) {
      output.push({ ...item, aiSummary: summarizeFallback(item) });
      continue;
    }
    try {
      const prompt = `请用简体中文为下面这条 AI 动态写一段 40-80 字摘要，只输出摘要正文。\n标题：${item.title}\n来源：${item.source}\n简介：${item.summary || "无"}`;
      const aiSummary = await callOpenAI(prompt, config);
      output.push({ ...item, aiSummary: aiSummary || summarizeFallback(item) });
    } catch {
      output.push({ ...item, aiSummary: summarizeFallback(item) });
    }
  }
  return output;
}

async function summarizeDaily(items, config) {
  if (!config.enabled || items.length === 0) {
    return summarizeDailyFallback(items);
  }
  const sample = items
    .slice(0, 12)
    .map((item, index) => `${index + 1}. [${item.source}] ${item.title} - ${item.aiSummary || item.summary || ""}`)
    .join("\n");
  try {
    const prompt = `请基于下面的 AI 动态列表，用简体中文写一段 120-180 字的“今日 AI 看点总结”，风格简洁、像日报导语，不要分点。\n${sample}`;
    const summary = await callOpenAI(prompt, config);
    return summary || summarizeDailyFallback(items);
  } catch {
    return summarizeDailyFallback(items);
  }
}

module.exports = {
  summarizeItems,
  summarizeDaily
};
