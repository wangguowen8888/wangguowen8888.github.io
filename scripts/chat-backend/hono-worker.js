/**
 * Cloudflare Worker (Hono + D1) for the static `ai-chat/` page.
 *
 * API:
 *  - POST /api/chat  { prompt: string, model?: string }
 *  - GET  /api/health
 *
 * Rate limiting + chat logging:
 *  - If D1 binding `DB` is configured, we store usage counts and chat logs.
 *  - If D1 is not configured, we still forward the request (no server-side limit/log).
 *
 * Secrets expected:
 *  - OPENAI_API_KEY (used for Codex provider auth)
 *
 * Vars (set via wrangler.toml / CF dashboard):
 *  - CHAT_ALLOWED_ORIGINS: comma-separated list, default "*"
 *  - DAILY_LIMIT: default 5
 *  - MAX_PROMPT_CHARS: default 2000
 *  - MAX_REPLY_CHARS: default 4000
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

const FIXED_MODEL = "gpt-5.2";
const UPSTREAM_BASE_URL = "https://code.newcli.com/codex/v1";
const UPSTREAM_CHAT_COMPLETIONS_URL = `${UPSTREAM_BASE_URL}/chat/completions`;

const toIsoNow = () => new Date().toISOString();

function getClientIp(req) {
  return (
    req.headers.get("CF-Connecting-IP") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim() ||
    req.headers.get("Client-IP") ||
    "unknown"
  );
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function callUpstreamRaw(prompt, apiKey) {
  const upstreamResp = await fetch(UPSTREAM_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: FIXED_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.2,
    }),
  });
  const upstreamJson = await upstreamResp.json().catch(() => ({}));
  return { status: upstreamResp.status, body: upstreamJson };
}

const app = new Hono();

app.use(
  "/api/*",
  cors({
    origin: (origin, c) => {
      const allowedRaw = String(c.env?.CHAT_ALLOWED_ORIGINS ?? "*").trim();
      const allowed = allowedRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (allowed.length === 0) return "null";
      if (allowed.includes("*")) return "*";
      if (!origin) return "null";
      return allowed.includes(origin) ? origin : "null";
    },
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
    credentials: false,
  }),
);

app.get("/api/health", (c) => {
  return c.json({ ok: true, model: FIXED_MODEL });
});

app.post("/api/chat", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const promptRaw = String(body?.prompt ?? "").trim();
  const model = body?.model;

  if (!promptRaw) return c.json({ error: "Missing 'prompt'." }, 400);
  if (model != null && model !== FIXED_MODEL) return c.json({ error: "Only gpt-5.2 is allowed." }, 400);

  const apiKey = c.env?.OPENAI_API_KEY;
  if (!apiKey) return c.json({ error: "Missing secret OPENAI_API_KEY in Worker." }, 500);

  const dailyLimit = Number(c.env?.DAILY_LIMIT ?? 5);
  const maxPromptChars = Number(c.env?.MAX_PROMPT_CHARS ?? 2000);
  const maxReplyChars = Number(c.env?.MAX_REPLY_CHARS ?? 4000);

  const day = new Date().toISOString().slice(0, 10);
  const now = toIsoNow();

  const db = c.env?.DB; // Cloudflare D1 binding (optional)

  // Best-effort rate limiting based on ip_hash/day.
  // If DB is missing or query fails, we skip the limit.
  let ipHash = "unknown";
  if (db) {
    try {
      const ip = getClientIp(c.req.raw);
      ipHash = await sha256Hex(ip);

      if (dailyLimit > 0) {
        const usageRow = await db
          .prepare("SELECT count FROM chat_usage WHERE ip_hash = ? AND day = ?")
          .bind(ipHash, day)
          .first();
        const used = usageRow?.count ? Number(usageRow.count) : 0;
        if (used >= dailyLimit) {
          return c.json({ error: "Rate limit exceeded. Please retry later." }, 429);
        }
      }
    } catch {
      // Ignore DB/rate-limit errors and continue (still call Codex).
    }
  }

  const prompt = promptRaw.slice(0, maxPromptChars);

  let upstream = null;
  try {
    upstream = await callUpstreamRaw(prompt, apiKey);
  } catch (e) {
    return c.json({ error: e?.message || "Internal error" }, 500);
  }

  // Best-effort persistence (usage + logs).
  if (db) {
    try {
      await db
        .prepare(
          `
          INSERT INTO chat_usage (ip_hash, day, count, updated_at)
          VALUES (?, ?, 1, ?)
          ON CONFLICT(ip_hash, day) DO UPDATE
          SET count = count + 1,
              updated_at = excluded.updated_at
          `,
        )
        .bind(ipHash, day, now)
        .run();

      await db
        .prepare(
          `
          INSERT INTO chat_logs (ip_hash, day, prompt, reply, created_at)
          VALUES (?, ?, ?, ?, ?)
          `,
        )
        .bind(ipHash, day, prompt, JSON.stringify(upstream?.body || {}), now)
        .run();
    } catch {
      // Ignore persistence errors; respond with the reply.
    }
  }

  return c.json(upstream?.body || {}, upstream?.status || 200);
});

export default app;

