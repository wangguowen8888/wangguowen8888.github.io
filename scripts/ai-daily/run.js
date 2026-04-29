const path = require("path");
const fs = require("fs/promises");
const config = require("./config");
const { normalizeItems } = require("./lib/normalize");
const { dedupeItems } = require("./lib/dedupe");
const { classifyItems } = require("./lib/classify");
const { rankItems } = require("./lib/rank");
const { summarizeItems, summarizeDaily } = require("./lib/summarize");
const { renderDayPage } = require("./lib/render-day");
const { renderDailyIndex } = require("./lib/render-index");
const { formatDateParts, writeFileSafe } = require("./lib/utils");

const sourceModules = {
  "hackernews": require("./sources/hackernews"),
  "github-trending": require("./sources/github-trending"),
  "arxiv": require("./sources/arxiv"),
  "reddit": require("./sources/reddit"),
  "linuxdo": require("./sources/linuxdo"),
  "producthunt": require("./sources/producthunt")
};
const DAILY_RETENTION_DAYS = 7;
const WEEK_MARKER_FILE = ".week-marker.json";

function getWeekKey(date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

async function clearDailyHistory({ dataDir, dailyRootDir }) {
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(dailyRootDir, { recursive: true, force: true });
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(dailyRootDir, { recursive: true });
}

async function resetIfNewWeek({ dataDir, dailyRootDir, now }) {
  const markerPath = path.join(dataDir, WEEK_MARKER_FILE);
  const weekKey = getWeekKey(now);
  let previousWeekKey = null;
  try {
    const raw = await fs.readFile(markerPath, "utf8");
    previousWeekKey = JSON.parse(raw)?.weekKey || null;
  } catch {
    previousWeekKey = null;
  }
  if (previousWeekKey && previousWeekKey !== weekKey) {
    console.log(`[ai-daily] new week detected (${previousWeekKey} -> ${weekKey}), clearing all daily history`);
    await clearDailyHistory({ dataDir, dailyRootDir });
  }
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(markerPath, JSON.stringify({ weekKey }, null, 2), "utf8");
}

async function pruneOldDaily({ dataDir, dailyRootDir, keepDays }) {
  let files = [];
  try {
    files = await fs.readdir(dataDir);
  } catch {
    return;
  }
  const dailyJsonFiles = files.filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort((a, b) => b.localeCompare(a));
  const stale = dailyJsonFiles.slice(keepDays);
  for (const file of stale) {
    const dateKey = file.replace(/\.json$/i, "");
    await fs.rm(path.join(dataDir, file), { force: true });
    await fs.rm(path.join(dailyRootDir, dateKey), { recursive: true, force: true });
  }
}

async function collectSource(source) {
  if (!source.enabled || source.mode === "placeholder") {
    return [];
  }
  const runner = sourceModules[source.id];
  if (!runner) {
    return [];
  }
  try {
    const items = await runner(source);
    return normalizeItems(items, source);
  } catch (error) {
    console.warn(`[ai-daily] source failed: ${source.id}`, error.message);
    return [];
  }
}

async function main() {
  const now = new Date();
  const { dateKey } = formatDateParts(now);
  const dataDir = path.join(process.cwd(), "data", "daily");
  const dailyRootDir = path.join(process.cwd(), "daily");
  await resetIfNewWeek({ dataDir, dailyRootDir, now });
  const collected = (await Promise.all(config.sources.map(collectSource))).flat();
  if (collected.length === 0) {
    throw new Error("No sources produced any items.");
  }

  const deduped = dedupeItems(collected);
  const classified = classifyItems(deduped);
  const ranked = rankItems(classified);
  const summarizedItems = await summarizeItems(
    ranked.slice(0, config.generation.maxSummaryItems),
    config.summary
  );
  const remaining = ranked.slice(config.generation.maxSummaryItems);
  const items = [...summarizedItems, ...remaining];
  const dailySummary = await summarizeDaily(items, config.summary);

  const dayPage = renderDayPage({ dateKey, summary: dailySummary, items });
  const dailyDir = path.join(process.cwd(), "daily", dateKey, "index.html");
  const dataPath = path.join(dataDir, `${dateKey}.json`);
  await writeFileSafe(dailyDir, dayPage);
  await writeFileSafe(dataPath, JSON.stringify({ dateKey, summary: dailySummary, items }, null, 2));
  await pruneOldDaily({ dataDir, dailyRootDir, keepDays: DAILY_RETENTION_DAYS });

  let entries = [{ dateKey, summary: dailySummary }];
  try {
    const files = await fs.readdir(dataDir);
    const historical = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const raw = await fs.readFile(path.join(dataDir, file), "utf8");
      const json = JSON.parse(raw);
      if (json.dateKey && json.summary) {
        historical.push({ dateKey: json.dateKey, summary: json.summary });
      }
    }
    entries = historical
      .filter((entry, index, array) => array.findIndex((item) => item.dateKey === entry.dateKey) === index)
      .sort((a, b) => String(b.dateKey).localeCompare(String(a.dateKey)));
  } catch {
    entries = [{ dateKey, summary: dailySummary }];
  }
  const indexPath = path.join(process.cwd(), "daily", "index.html");
  await writeFileSafe(indexPath, renderDailyIndex({ entries }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
