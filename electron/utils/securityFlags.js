/**
 * securityFlags.js
 *
 * Centralized readers for the two boolean security flags that gate the
 * MCP allowlist stack:
 *   - security.enforceWidgetMcpPermissions
 *   - security.enableJitConsent
 *
 * **Default semantics: ON.** A missing settings.json, a missing
 * `security` block, or an undefined field all yield `true`. Only an
 * explicit `false` opts out. This is intentional — the security stack
 * is on by default; users have to actively disable it. The
 * Privacy & Security panel surfaces the toggles + a confirm-on-disable
 * dialog so the disable path is deliberate.
 *
 * The readers are pure functions of a settings object so the
 * default-on semantics are pinned by unit tests without touching the
 * filesystem. The callers in mcpController.js wrap these with
 * settings.json IO.
 */
"use strict";

function readEnforceFlag(settings) {
  return settings?.security?.enforceWidgetMcpPermissions !== false;
}

function readJitFlag(settings) {
  return settings?.security?.enableJitConsent !== false;
}

module.exports = { readEnforceFlag, readJitFlag };
