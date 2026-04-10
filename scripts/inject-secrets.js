#!/usr/bin/env node
/**
 * Replace secret placeholders in dist/ with values from environment variables.
 * Run after build:electron copies MCP servers to dist/.
 *
 * Loads .env from the project root if present (gitignored).
 *
 * Env vars:
 *   GDRIVE_CLIENT_SECRET — Google Drive OAuth client_secret
 */
const fs = require("fs");
const path = require("path");

// Load .env file if present (no external dependencies)
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
    }
}

const target = path.join(
    __dirname,
    "..",
    "dist",
    "mcp",
    "servers",
    "google-drive.js",
);

const replacements = [
    { placeholder: "__GDRIVE_CLIENT_SECRET__", envVar: "GDRIVE_CLIENT_SECRET" },
];

if (!fs.existsSync(target)) {
    console.log("[inject-secrets] No dist file found, skipping.");
    process.exit(0);
}

let content = fs.readFileSync(target, "utf8");
let injected = 0;

for (const { placeholder, envVar } of replacements) {
    const value = process.env[envVar];
    if (value && content.includes(placeholder)) {
        content = content.replace(placeholder, value);
        injected++;
        console.log(`[inject-secrets] Injected ${envVar}`);
    }
}

if (injected > 0) {
    fs.writeFileSync(target, content);
}

console.log(
    `[inject-secrets] Done. ${injected} secret(s) injected into dist/.`,
);
