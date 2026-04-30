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
const UPSTREAM_RESPONSES_URL = `${UPSTREAM_BASE_URL}/responses`;

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

function extractOutputText(upstream) {
  // Best-effort extraction for OpenAI Responses API.
  if (typeof upstream?.output_text === "string" && upstream.output_text.trim()) return upstream.output_text.trim();

  const output = upstream?.output;
  if (!Array.isArray(output)) return "";

  for (const item of output) {
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === "output_text" && typeof c?.text === "string" && c.text.trim()) return c.text.trim();
      if (typeof c?.text === "string" && c.text.trim()) return c.text.trim();
    }
  }
  return "";
}

function tryParseSseResponsesText(text) {
  // Upstream may respond with SSE (text/event-stream). We parse "data: {...}" frames
  // and return the last embedded response object if present.
  // Also best-effort reconstruct output text from delta events.
  const raw = String(text || "");
  if (!raw) return null;

  let lastResponse = null;
  let outputText = "";
  const frames = raw.split(/\n\n+/g);
  for (const frame of frames) {
    const lines = frame.split(/\n/g);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const obj = JSON.parse(payload);
        const type = obj?.type;
        if (type === "response.output_text.delta" && typeof obj?.delta === "string") {
          outputText += obj.delta;
        } else if (type === "response.output_text.done" && typeof obj?.text === "string") {
          outputText += obj.text;
        }
        const response = obj?.response;
        if (response && typeof response === "object") lastResponse = response;
      } catch {
        // ignore
      }
    }
  }
  if (lastResponse && outputText.trim()) {
    // Some proxies never send an updated response object; stitch deltas in.
    if (typeof lastResponse.output_text !== "string") lastResponse.output_text = "";
    lastResponse.output_text = `${lastResponse.output_text}${outputText}`.trim();
  }
  return lastResponse;
}

async function callUpstreamWithBody(apiKey, requestBody) {
  const upstreamResp = await fetch(UPSTREAM_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });
  const upstreamText = await upstreamResp.text().catch(() => "");
  let upstreamJson = {};
  try {
    upstreamJson = upstreamText ? JSON.parse(upstreamText) : {};
  } catch {
    upstreamJson = {};
  }
  const contentType = upstreamResp.headers.get("content-type") || "";
  if (
    (!upstreamJson || Object.keys(upstreamJson).length === 0) &&
    /text\/event-stream/i.test(contentType)
  ) {
    const parsed = tryParseSseResponsesText(upstreamText);
    if (parsed) upstreamJson = parsed;
  }
  return {
    status: upstreamResp.status,
    body: upstreamJson,
    raw_text: upstreamText,
    content_type: contentType,
  };
}

function withAttemptTag(result, tag) {
  return {
    ...result,
    attempt: tag,
  };
}

function buildAttemptsForModel(prompt, model) {
  return [
    {
      tag: `${model}:responses_message_input_text`,
      body: {
        model,
        text: { format: { type: "text" } },
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
      },
    },
    {
      tag: `${model}:responses_message_plain_content`,
      body: {
        model,
        text: { format: { type: "text" } },
        input: [{ role: "user", content: prompt }],
      },
    },
    {
      tag: `${model}:responses_plain_input`,
      body: { model, input: prompt, text: { format: { type: "text" } } },
    },
  ];
}

async function callUpstreamAcrossModels(prompt, apiKey, preferredModel) {
  const modelOrder = [preferredModel || FIXED_MODEL];
  const attempts = [];

  for (const model of modelOrder) {
    const modelAttempts = buildAttemptsForModel(prompt, model);
    for (const attempt of modelAttempts) {
      const result = withAttemptTag(await callUpstreamWithBody(apiKey, attempt.body), attempt.tag);
      const hasText = Boolean(extractOutputText(result?.body || {}));
      attempts.push({
        tag: attempt.tag,
        status: result?.status,
        content_type: result?.content_type,
        has_text: hasText,
      });
      if (hasText) {
        return { result, attempts };
      }
    }
  }
  return { result: null, attempts };
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
  return c.json({ ok: true, model: FIXED_MODEL, protocol: "responses" });
});

app.post("/api/chat", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const promptRaw = String(body?.prompt ?? "").trim();
  const model = String(body?.model ?? "").trim();

  if (!promptRaw) return c.json({ error: "Missing 'prompt'." }, 400);
  if (model && model !== FIXED_MODEL) {
    return c.json({ error: `Model is fixed to ${FIXED_MODEL}.` }, 400);
  }

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
  let attempts = [];
  try {
    const run = await callUpstreamAcrossModels(prompt, apiKey, FIXED_MODEL);
    upstream = run.result;
    attempts = run.attempts;
  } catch (e) {
    return c.json({ error: e?.message || "Internal error" }, 500);
  }

  if (!upstream) {
    return c.json(
      {
        error: "Upstream returned empty output.",
        upstream_attempts: attempts,
      },
      502,
    );
  }

  const reply = extractOutputText(upstream?.body || {});
  if (!reply) {
    return c.json(
      {
        error: "Upstream returned empty output.",
        upstream_status: upstream?.status,
        upstream_content_type: upstream?.content_type,
        upstream_attempt: upstream?.attempt,
        upstream_attempts: attempts,
        upstream: upstream?.body || {},
        upstream_raw_preview: String(upstream?.raw_text || "").slice(0, 1200),
      },
      upstream?.status || 502,
    );
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
        .bind(ipHash, day, prompt, reply.slice(0, maxReplyChars), now)
        .run();
    } catch {
      // Ignore persistence errors; respond with the reply.
    }
  }

  // Keep response small/stable for frontend: reply + model, plus upstream metadata for debugging.
  return c.json(
    {
      reply: reply.slice(0, maxReplyChars),
      model: FIXED_MODEL,
      model_used: FIXED_MODEL,
      protocol: "responses",
      upstream_id: upstream?.body?.id,
      upstream_object: upstream?.body?.object,
      usage: upstream?.body?.usage,
      upstream_attempt: upstream?.attempt,
      upstream_attempts: attempts,
    },
    upstream?.status || 200,
  );
});

export default app;

