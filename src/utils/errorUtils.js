/**
 * Strip the Electron IPC error prefix from error messages.
 *
 * Raw IPC errors look like:
 *   "Error invoking remote method 'widget:install': Error: Failed to fetch: Unauthorized"
 *
 * This extracts just the meaningful part after the last "Error: " prefix.
 *
 * @param {string} message - Raw error message
 * @returns {string} Cleaned error message
 */
export function cleanIpcError(message) {
  if (!message || typeof message !== "string") return message;
  const match = message.match(
    /Error invoking remote method '[^']+': (?:Error: )?(.*)/,
  );
  return match ? match[1] : message;
}
