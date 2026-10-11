/**
 * Which AI Dash uses to build things: the Claude Code CLI or the Anthropic
 * API (an Anthropic credential provider). Shared by Settings › AI Assistant
 * and the Create screen's AI picker so both agree on what will actually run.
 */

export const AI_BACKENDS = [
  { value: "claude-code", label: "Claude Code" },
  { value: "anthropic", label: "Anthropic API" },
];

/** The configured Anthropic credential provider as [name, provider], or null. */
export function findAnthropicProvider(providers = {}) {
  return (
    Object.entries(providers || {}).find(
      ([, p]) =>
        p &&
        p.type === "anthropic" &&
        (p.providerClass || "credential") === "credential",
    ) || null
  );
}

/**
 * The backend that will run: the preferred one if it's available, else
 * whichever is, else null (no AI set up).
 */
export function effectiveAiBackend({
  preferred = "claude-code",
  cliAvailable = false,
  hasAnthropic = false,
} = {}) {
  if (preferred === "claude-code" && cliAvailable) return "claude-code";
  if (preferred === "anthropic" && hasAnthropic) return "anthropic";
  if (cliAvailable) return "claude-code";
  if (hasAnthropic) return "anthropic";
  return null;
}

/**
 * Options for an AI picker: each backend, disabled with a hint when it isn't
 * set up. `cliAvailable` null = still checking.
 */
export function aiBackendOptions({
  cliAvailable = null,
  hasAnthropic = false,
}) {
  return AI_BACKENDS.map((b) => {
    if (b.value === "claude-code") {
      return cliAvailable
        ? b
        : {
            ...b,
            disabled: true,
            hint:
              cliAvailable === null
                ? "Checking for the Claude Code CLI…"
                : "Claude Code CLI not found on this computer",
          };
    }
    return hasAnthropic
      ? b
      : {
          ...b,
          disabled: true,
          hint: "Add an Anthropic API key in Settings › AI Assistant",
        };
  });
}
