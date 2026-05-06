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
const ALLOWED_MODEL_FALLBACK_ORDER = ["gpt-5.2", "gpt-5.3-codex", "gpt-5.4", "gpt-5.5"];
const UPSTREAM_BASE_URL = "https://code.newcli.com/codex/v1";
const UPSTREAM_RESPONSES_URL = `${UPSTREAM_BASE_URL}/responses`;

const toIsoNow = () => new Date().toISOString();
const isDebugEnabled = (env, body) => {
  const envFlag = String(env?.CHAT_DEBUG ?? "").trim().toLowerCase();
  const bodyFlag = String(body?.debug ?? "").trim().toLowerCase();
  return envFlag === "1" || envFlag === "true" || bodyFlag === "1" || bodyFlag === "true";
};

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

function pickNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function textFromContentPart(part) {
  if (!part || typeof part !== "object") return "";
  // Responses variants may use: text, text.value, content, content[...].text, value.
  return pickNonEmptyString(
    part.text,
    part?.text?.value,
    part?.text?.content,
    part.value,
    part?.content?.text,
    part?.content?.value,
    part?.content?.content,
  );
}

function textFromMessageContent(content) {
  if (typeof content === "string") return content.trim();
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return pickNonEmptyString(
      content.text,
      content?.text?.value,
      content.value,
      content?.content?.text,
      content?.content?.value,
    );
  }
  if (!Array.isArray(content)) return "";
  for (const part of content) {
    const text = textFromContentPart(part);
    if (text) return text;
  }
  return "";
}

function extractOutputText(upstream) {
  // Best-effort extraction for OpenAI Responses API and compatible wrappers.
  if (!upstream || typeof upstream !== "object") return "";

  const direct = pickNonEmptyString(
    upstream.output_text,
    upstream.text,
    upstream?.text?.value,
    upstream.reply,
    upstream.completion,
  );
  if (direct) return direct;

  // Some upstreams nest the canonical response under `response`.
  if (upstream.response && typeof upstream.response === "object") {
    const nested = extractOutputText(upstream.response);
    if (nested) return nested;
  }
  if (upstream.data && typeof upstream.data === "object") {
    const nested = extractOutputText(upstream.data);
    if (nested) return nested;
  }

  const output = upstream.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        const text = textFromContentPart(part);
        if (text) return text;
      }
    }
  }

  // Some providers expose chat-completions-like response shape.
  const choices = upstream.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const text = pickNonEmptyString(
        choice?.message?.content,
        choice?.message?.content?.text,
        choice?.message?.content?.value,
        textFromContentPart(choice?.message?.content),
        textFromMessageContent(choice?.message?.content),
        choice?.delta?.content,
        choice?.delta?.content?.text,
        choice?.delta?.content?.value,
        textFromContentPart(choice?.delta?.content),
        textFromMessageContent(choice?.delta?.content),
        choice?.text,
      );
      if (text) return text;
    }
  }

  // Some wrappers return generated content under generic keys.
  const wrapped = pickNonEmptyString(
    upstream?.result?.output_text,
    upstream?.result?.text,
    upstream?.data?.output_text,
    upstream?.data?.text,
    upstream?.message,
    upstream?.content,
  );
  if (wrapped) return wrapped;

  // Deep fallback: walk nested payload and prioritize assistant/text-like fields.
  const deepText = extractTextDeep(upstream);
  if (deepText) return deepText;

  return "";
}

function extractTextDeep(root) {
  const visited = new WeakSet();
  const candidates = [];
  const queue = [{ node: root, path: "root", depth: 0 }];
  const maxDepth = 8;
  const maxNodes = 1200;
  let scanned = 0;

  const isLikelyNoiseText = (text) => {
    const value = String(text || "").trim().toLowerCase();
    if (!value) return true;
    if (value.length <= 4 && /^(auto|none|null|true|false|n\/a|ok)$/i.test(value)) return true;
    return false;
  };

  const scorePath = (path) => {
    let score = 0;
    if (/tool_choice|finish_reason|mode|format|status|type$/i.test(path)) score -= 10;
    if (/assistant/i.test(path)) score += 8;
    if (/message/i.test(path)) score += 6;
    if (/choice/i.test(path)) score += 5;
    if (/output/i.test(path)) score += 5;
    if (/content/i.test(path)) score += 4;
    if (/text/i.test(path)) score += 4;
    if (/delta/i.test(path)) score += 2;
    return score;
  };

  while (queue.length && scanned < maxNodes) {
    const item = queue.shift();
    scanned += 1;
    const { node, path, depth } = item;
    if (node == null) continue;

    if (typeof node === "string") {
      const text = node.trim();
      if (
        text &&
        !/^(assistant|user|system|tool|chat\.completion|response)$/i.test(text) &&
        !isLikelyNoiseText(text)
      ) {
        const baseScore = scorePath(path);
        const lengthBonus = Math.min(Math.floor(text.length / 24), 6);
        candidates.push({ text, score: baseScore + lengthBonus, path });
      }
      continue;
    }

    if (depth >= maxDepth) continue;
    if (typeof node !== "object") continue;
    if (visited.has(node)) continue;
    visited.add(node);

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        queue.push({ node: node[i], path: `${path}[${i}]`, depth: depth + 1 });
      }
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      queue.push({ node: value, path: `${path}.${key}`, depth: depth + 1 });
    }
  }

  if (!candidates.length) return "";
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.text.length - a.text.length;
  });
  const best = candidates[0]?.text || "";
  return isLikelyNoiseText(best) ? "" : best;
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

async function callUpstreamWithBody(apiKey, requestBody, endpoint = UPSTREAM_RESPONSES_URL) {
  const controller = new AbortController();
  const timeoutMs = 12000;
  const timer = setTimeout(() => controller.abort("upstream-timeout"), timeoutMs);
  let upstreamResp;
  try {
    upstreamResp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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
      endpoint: UPSTREAM_RESPONSES_URL,
      body: {
        model,
        max_output_tokens: 512,
        text: { format: { type: "text" } },
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
      },
    },
    {
      tag: `${model}:responses_message_plain_content`,
      endpoint: UPSTREAM_RESPONSES_URL,
      body: {
        model,
        max_output_tokens: 512,
        text: { format: { type: "text" } },
        input: [{ type: "message", role: "user", content: prompt }],
      },
    },
    {
      tag: `${model}:responses_plain_input`,
      endpoint: UPSTREAM_RESPONSES_URL,
      body: { model, input: prompt, max_output_tokens: 512, text: { format: { type: "text" } } },
    },
  ];
}

async function callUpstreamAcrossModels(prompt, apiKey, preferredModel) {
  const firstModel = preferredModel || FIXED_MODEL;
  const modelOrder = [
    firstModel,
    ...ALLOWED_MODEL_FALLBACK_ORDER.filter((m) => m !== firstModel),
  ];
  const attempts = [];
  let lastResult = null;

  for (const model of modelOrder) {
    const modelAttempts = buildAttemptsForModel(prompt, model);
    for (const attempt of modelAttempts) {
      const result = withAttemptTag(
        await callUpstreamWithBody(apiKey, attempt.body, attempt.endpoint),
        attempt.tag,
      );
      lastResult = result;
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
  return { result: lastResult, attempts };
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
  const debug = isDebugEnabled(c.env, body);

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

  const reply = extractOutputText(upstream?.body || {});
  if (!reply) {
    const upstreamObject = String(upstream?.body?.object || "").trim().toLowerCase();
    const protocolHint = upstreamObject === "chat.completion"
      ? "Upstream protocol mismatch: expected responses payload but received chat.completion."
      : "Upstream returned empty output.";
    const baseError = {
      error: protocolHint,
      upstream_status: upstream?.status,
      upstream_content_type: upstream?.content_type,
      upstream_attempt: upstream?.attempt,
      upstream_attempts: attempts,
    };
    if (debug) {
      baseError.upstream = upstream?.body || {};
      baseError.upstream_raw_preview = String(upstream?.raw_text || "").slice(0, 1200);
    }
    return c.json(
      baseError,
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

  // Keep response stable for frontend: always return reply+model.
  const payload = {
    reply: reply.slice(0, maxReplyChars),
    model: FIXED_MODEL,
    protocol: "responses",
  };
  // Optional debug metadata to inspect upstream behavior without affecting UI contract.
  if (debug) {
    payload.model_used = FIXED_MODEL;
    payload.upstream_id = upstream?.body?.id;
    payload.upstream_object = upstream?.body?.object;
    payload.usage = upstream?.body?.usage;
    payload.upstream_attempt = upstream?.attempt;
    payload.upstream_attempts = attempts;
  }
  return c.json(payload, upstream?.status || 200);
});

export default app;

