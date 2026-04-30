/**
 * Cloudflare Worker for the static `ai-chat/` page.
 *
 * - Frontend calls POST /api/chat with JSON: { "prompt": "..." }
 * - Worker forwards request to https://code.newcli.com/codex/v1/responses
 * - Fixed model only: gpt-5.2
 * - Rejects any attempt to use other models (server-side enforcement)
 *
 * Secrets expected:
 *  - OPENAI_API_KEY (used for Codex provider auth; see your local .codex/config.toml)
 *
 * Env vars can be configured via Wrangler (wrangler.toml) or the CF dashboard.
 */

const FIXED_MODEL = "gpt-5.2";
const UPSTREAM_BASE_URL = "https://code.newcli.com/codex/v1";
const UPSTREAM_URL = `${UPSTREAM_BASE_URL}/responses`;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function extractOutputText(upstream) {
  // Best-effort extraction: prefer `output_text`, else scan `output[]`.
  if (typeof upstream?.output_text === "string" && upstream.output_text.trim()) return upstream.output_text.trim();

  const output = upstream?.output;
  if (!Array.isArray(output)) return "";

  for (const item of output) {
    const content = item?.content;
    if (!Array.isArray(content)) continue;

    for (const c of content) {
      // OpenAI Responses API usually has: { type: "output_text", text: "..." }
      if (c?.type === "output_text" && typeof c?.text === "string" && c.text.trim()) return c.text.trim();
      if (typeof c?.text === "string" && c.text.trim()) return c.text.trim();
    }
  }
  return "";
}

async function forwardToCodex(prompt) {
  const apiKey = typeof OPENAI_API_KEY !== "undefined" ? OPENAI_API_KEY : null;
  if (!apiKey) throw new Error("Missing secret OPENAI_API_KEY in Worker.");

  const reqBody = {
    model: FIXED_MODEL,
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: prompt }],
      },
    ],
  };

  const upstreamResp = await fetch(UPSTREAM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Codex provider requires OpenAI auth (your local `.codex/config.toml` has `requires_openai_auth = true`).
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(reqBody),
  });

  const upstreamJson = await upstreamResp.json().catch(() => ({}));
  if (!upstreamResp.ok) {
    const msg = upstreamJson?.error?.message || upstreamJson?.message || `HTTP ${upstreamResp.status}`;
    throw new Error(`Upstream Codex failed: ${msg}`);
  }

  const reply = extractOutputText(upstreamJson);
  if (!reply) throw new Error("Codex returned empty output.");
  return reply;
}

export default {
  async fetch(request, env, ctx) {
    // Bind secret to global var used above (Cloudflare passes secrets via `env`).
    // eslint-disable-next-line no-global-assign
    // @ts-ignore
    globalThis.OPENAI_API_KEY = env?.OPENAI_API_KEY;

    if (request.method === "OPTIONS") return jsonResponse(200, { ok: true });

    const url = new URL(request.url);
    if (url.pathname !== "/api/chat") return jsonResponse(404, { error: "Not found" });
    if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    const prompt = String(body?.prompt || "").trim();
    const model = body?.model;

    if (!prompt) return jsonResponse(400, { error: "Missing 'prompt'." });
    if (model != null && model !== FIXED_MODEL) {
      return jsonResponse(400, { error: "Only gpt-5.2 is allowed." });
    }

    try {
      const reply = await forwardToCodex(prompt);
      return jsonResponse(200, { reply, model: FIXED_MODEL });
    } catch (e) {
      return jsonResponse(500, { error: e?.message || "Internal error" });
    }
  },
};

