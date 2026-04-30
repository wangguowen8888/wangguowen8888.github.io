#!/usr/bin/env node
const { execSync } = require("node:child_process");

function getStagedPatch() {
  try {
    return execSync("git diff --cached --unified=0 --no-color", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return (error && error.stdout ? String(error.stdout) : "") || "";
  }
}

const patch = getStagedPatch();
if (!patch.trim()) {
  process.exit(0);
}

const patterns = [
  { name: "OpenAI key", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Anthropic-like key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Generic API key assign", regex: /\b(api[_-]?key|access[_-]?token|secret)\b\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/gi },
  { name: "Bearer token", regex: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi },
];

const lines = patch
  .split("\n")
  .filter((line) => line.startsWith("+") && !line.startsWith("+++"));

const offenders = [];
for (const line of lines) {
  for (const p of patterns) {
    if (p.regex.test(line)) {
      offenders.push({ rule: p.name, line });
    }
    p.regex.lastIndex = 0;
  }
}

if (offenders.length) {
  console.error("\n[secret-scan] Commit blocked: possible secret detected in staged changes.\n");
  for (const item of offenders.slice(0, 8)) {
    console.error(`- ${item.rule}: ${item.line.slice(0, 180)}`);
  }
  console.error("\nRemove secret values and use environment variables or GitHub Secrets.\n");
  process.exit(1);
}

console.log("[secret-scan] OK");
