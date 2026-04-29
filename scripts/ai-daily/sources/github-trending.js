const { fetchText, stripHtml } = require("../lib/utils");

module.exports = async function fetchGitHubTrending(source) {
  const html = await fetchText("https://github.com/trending?since=daily");
  const blocks = html.split('<article class="Box-row">').slice(1);
  return blocks.map((block) => {
    const repoMatch = block.match(/<h2[\s\S]*?<a[^>]*href="\/([^"]+)"/);
    const descMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const starMatch = block.match(/([\d,]+)<\/span>\s*stars today/i);
    const repo = repoMatch ? repoMatch[1] : "";
    return {
      title: repo,
      url: repo ? `https://github.com/${repo}` : "https://github.com/trending",
      publishedAt: new Date().toISOString(),
      author: repo.split("/")[0] || "GitHub",
      summary: stripHtml(descMatch ? descMatch[1] : ""),
      tags: ["github", "trending"],
      score: Number(String(starMatch?.[1] || "0").replace(/,/g, "")),
      contentType: "tool",
      rawMeta: {}
    };
  })
    .filter((item) => item.title && !/^login|^sponsors\//i.test(item.title))
    .filter((item) => /ai|llm|agent|model|gpt|rag|diffusion|voice|embedding/i.test(item.title + item.summary))
    .slice(0, source.limit || 8);
};
