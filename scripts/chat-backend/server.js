/**
 * Local chat backend for the static `ai-chat/` page.
 *
 * Goals:
 *  - Never expose OpenAI API key in the browser.
 *  - Always use Codex with a fixed model: gpt-5.2
 *  - Forbid other model names (server-side enforcement).
 */

const http = require("http");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3001);
const FIXED_MODEL = "gpt-5.2";
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const VERBOSE = String(process.env.CHAT_BACKEND_VERBOSE || "").trim() === "1";

let active = false;
let codexInvocation = null;
const POWERSHELL_EXE = (() => {
  const windir = process.env.WINDIR || process.env.SystemRoot;
  if (!windir) return "powershell.exe";
  return path.join(
    windir,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
})();

function resolveCodexInvocation() {
  // 1) Allow override from env
  //    - CODEX_SOURCE can be a full path to codex.ps1/codex.exe/codex.cmd
  //  - CODEX_IS_POWERSHELL_SCRIPT marks ps1 invocation.
  if (process.env.CODEX_SOURCE) {
    return {
      kind: process.env.CODEX_IS_POWERSHELL_SCRIPT === "true" ? "ps1" : "direct",
      source: process.env.CODEX_SOURCE,
    };
  }

  // 2) Ask PowerShell where "codex" resolves to on this machine.
  try {
    const source = execSync(
      'powershell -NoProfile -Command "(Get-Command codex -ErrorAction SilentlyContinue).Source"',
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (!source) return null;

    if (/\.ps1$/i.test(source)) return { kind: "ps1", source };
    // codex might be a cmd/exe or something else
    return { kind: "direct", source };
  } catch {
    return null;
  }
}

codexInvocation = resolveCodexInvocation();
if (VERBOSE) {
  // Debug info to ensure we invoke codex correctly on Windows.
  // (We only print paths/types; no secrets.)
  // eslint-disable-next-line no-console
  console.log("[chat-backend] codexInvocation:", codexInvocation);
  // eslint-disable-next-line no-console
  console.log("[chat-backend] POWERSHELL_EXE:", POWERSHELL_EXE);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

async function runCodex(prompt) {
  // Use Codex CLI in non-interactive mode.
  // We rely on --output-last-message (-o) to avoid parsing stdout.
  const tmpFile = path.join(
    os.tmpdir(),
    `codex-last-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
  );

  const fullPrompt =
    "Reply with only the assistant message text. Do not add preambles, titles, or JSON.\n\n" +
    `User message:\n${prompt}\n`;

  const codexArgs = [
    "exec",
    "-C",
    PROJECT_ROOT,
    "--ephemeral",
    "-s",
    "read-only",
    "-c",
    `model=${FIXED_MODEL}`,
    "-c",
    'approval_policy="never"',
    "-o",
    tmpFile,
    "-",
  ];

  return await new Promise((resolve, reject) => {
    const spawnCommon = {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "ignore", "pipe"],
      env: process.env,
      windowsHide: true,
    };

    let child = null;
    if (codexInvocation?.kind === "ps1") {
      // codex.ps1 is a thin wrapper. On Windows it ultimately runs:
      //   node.exe node_modules/@openai/codex/bin/codex.js <args...>
      // Calling the wrapper via PowerShell -File can be brittle for our stdin/prompt usage,
      // so we run codex.js directly.
      const basedir = path.dirname(codexInvocation.source);
      const nodeExe = path.join(basedir, "node.exe");
      const codexJs = path.join(basedir, "node_modules", "@openai", "codex", "bin", "codex.js");
      child = spawn(nodeExe, [codexJs, ...codexArgs], spawnCommon);
    } else if (codexInvocation?.kind === "direct") {
      child = spawn(codexInvocation.source, codexArgs, spawnCommon);
    } else {
      // Final fallback: hope PATH has codex.
      child = spawn("codex", codexArgs, spawnCommon);
    }

    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();

    const timeoutMs = Number(process.env.CODEX_TIMEOUT_MS || 120000);
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(t);
      const out = readFileSafe(tmpFile).trim();
      if (out) return resolve(out);
      reject(
        new Error(
          `Codex failed (exit code ${code}). ${
            stderr.trim() ? `stderr: ${stderr.trim()}` : ""
          }`,
        ),
      );
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return json(res, 404, { error: "Not found" });
    const u = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") return json(res, 200, { ok: true });

    if (u.pathname !== "/api/chat") {
      return json(res, 404, { error: "Not found" });
    }

    if (req.method !== "POST") {
      return json(res, 405, { error: "Method not allowed" });
    }

    if (active) {
      return json(res, 429, { error: "Server busy, please retry." });
    }
    active = true;

    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", async () => {
      try {
        const body = raw ? JSON.parse(raw) : {};
        const prompt = String(body?.prompt || "").trim();
        const model = body?.model;

        if (!prompt) return json(res, 400, { error: "Missing 'prompt'." });
        if (model != null && model !== FIXED_MODEL) {
          return json(res, 400, { error: "Only gpt-5.2 is allowed." });
        }

        const reply = await runCodex(prompt);
        return json(res, 200, { reply, model: FIXED_MODEL });
      } catch (e) {
        return json(res, 500, { error: e?.message || "Internal error" });
      } finally {
        active = false;
      }
    });
  } catch (e) {
    active = false;
    json(res, 500, { error: e?.message || "Internal error" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  if (!VERBOSE) return;
  // eslint-disable-next-line no-console
  console.log(`[chat-backend] listening at http://127.0.0.1:${PORT}/api/chat`);
  // eslint-disable-next-line no-console
  console.log(`[chat-backend] fixed model: ${FIXED_MODEL}`);
  // eslint-disable-next-line no-console
  console.log(`[chat-backend] project root: ${PROJECT_ROOT}`);
});

