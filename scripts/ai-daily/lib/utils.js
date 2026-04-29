const fs = require("fs/promises");
const path = require("path");

const USER_AGENT = "AIProjectDailyBot/1.0 (+https://wangguowen8888.github.io)";
const DEFAULT_TIMEOUT_MS = 15000;

async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, {
    ...options,
    redirect: "follow",
    signal: controller.signal,
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/json,application/xml,text/xml,*/*",
      ...(options.headers || {})
    }
  });
  clearTimeout(timer);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.text();
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, {
    ...options,
    headers: {
      accept: "application/json,text/plain,*/*",
      ...(options.headers || {})
    }
  });
  return JSON.parse(text);
}

function stripHtml(input) {
  return String(input || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function ensureAbsoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function isoDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

function formatDateParts(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return {
    year: String(year),
    month,
    day,
    dateKey: `${year}-${month}-${day}`
  };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeFileSafe(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

module.exports = {
  USER_AGENT,
  fetchJson,
  fetchText,
  stripHtml,
  escapeHtml,
  slugify,
  ensureAbsoluteUrl,
  isoDate,
  formatDateParts,
  ensureDir,
  writeFileSafe
};
