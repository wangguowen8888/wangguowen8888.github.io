function rankItems(items) {
  return [...items].sort((a, b) => {
    const scoreGap = (b.score + b.weight) - (a.score + a.weight);
    if (scoreGap !== 0) return scoreGap;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
}

module.exports = { rankItems };
