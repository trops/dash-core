/**
 * approvalPreview — what a bot's tool call will actually do, for the card
 * that asks the user: the command it runs, the file it writes, the address
 * it opens, or the values it sends. Without it the user is asked to allow
 * "Bash" with nothing to decide on.
 */

const MAX_LINES = 12;
const MAX_VALUE = 300;

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const text = (v) =>
  typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);

// Built-in tools: the one value that says what they do.
const BUILTIN = {
  Bash: { label: "Command", key: "command" },
  Write: { label: "File it writes", key: "file_path" },
  Edit: { label: "File it changes", key: "file_path" },
  MultiEdit: { label: "File it changes", key: "file_path" },
  NotebookEdit: { label: "Notebook it changes", key: "notebook_path" },
  Read: { label: "File it reads", key: "file_path" },
  WebFetch: { label: "Web address", key: "url" },
  WebSearch: { label: "Search", key: "query" },
  Glob: { label: "Files matching", key: "pattern" },
  Grep: { label: "Searches files for", key: "pattern" },
};

/**
 * @param {{ toolName?: string, input?: object }} request
 * @returns {{ label: string, text: string, note: string|null }|null}
 *   null when the call has nothing to show.
 */
export function approvalPreview(request) {
  const r = request || {};
  const input = r.input && typeof r.input === "object" ? r.input : null;
  if (!input) return null;
  const builtin = BUILTIN[r.toolName];
  if (builtin && input[builtin.key]) {
    const note =
      r.toolName === "Bash" && input.description
        ? text(input.description)
        : null;
    return {
      label: builtin.label,
      text: clip(text(input[builtin.key]), 2000),
      note,
    };
  }
  // Any other tool: the values it sends, one per line.
  const entries = Object.entries(input).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (!entries.length) return null;
  const lines = entries
    .slice(0, MAX_LINES)
    .map(([k, v]) => `${k}: ${clip(text(v), MAX_VALUE)}`);
  if (entries.length > MAX_LINES) {
    lines.push(`…and ${entries.length - MAX_LINES} more`);
  }
  return { label: "With", text: lines.join("\n"), note: null };
}
