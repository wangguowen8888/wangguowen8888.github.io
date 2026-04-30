#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = process.cwd();
const hookDir = path.join(repoRoot, ".git", "hooks");
const hookPath = path.join(hookDir, "pre-commit");

if (!fs.existsSync(path.join(repoRoot, ".git"))) {
  console.error("[hook-install] .git directory not found. Run this in repo root.");
  process.exit(1);
}

if (!fs.existsSync(hookDir)) {
  fs.mkdirSync(hookDir, { recursive: true });
}

const hookBody = `#!/usr/bin/env sh
node scripts/security/scan-secrets.js
`;

fs.writeFileSync(hookPath, hookBody, { encoding: "utf8" });
try {
  fs.chmodSync(hookPath, 0o755);
} catch (_) {
  // Windows may ignore chmod.
}

console.log("[hook-install] pre-commit hook installed.");
