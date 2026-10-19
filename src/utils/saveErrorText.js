/**
 * saveErrorText — a failed dashboard save's reason in plain words (Phase 1e).
 * Disk errors come back as "EACCES: permission denied, open '<long path>'";
 * the user gets what went wrong, not the code or the path.
 */
const DISK_ERRORS = [
  [/^(EACCES|EPERM)\b/, "Dash isn't allowed to write to its data folder."],
  [/^ENOSPC\b/, "The disk is full."],
  [/^EROFS\b/, "Dash's data folder is read-only."],
];

export function saveErrorText(error) {
  const message = ((error && error.message) || "").trim();
  for (const [code, text] of DISK_ERRORS) {
    if (code.test(message)) return text;
  }
  return message;
}
