import React, { useState, useEffect } from "react";
import { Modal, Button } from "@trops/dash-react";

/**
 * GrantManuallyModal
 *
 * Free-form grant entry for widgets that did not declare their MCP needs
 * AND were not discoverable by the install-time scanner. The user types
 * server name + comma-separated tools + read/write paths (one per line).
 * Submits via window.mainApi.widgetMcp.setGrant with grantOrigin: "manual".
 *
 * Visually distinct from the install-time consent modal: there's no
 * developer declaration to anchor the user's trust, so the framing makes
 * the "you're improvising" reality explicit.
 */
export const GrantManuallyModal = ({
  isOpen,
  setIsOpen,
  widgetId,
  knownServerNames = [],
  onGranted,
}) => {
  const [serverName, setServerName] = useState("");
  const [toolsText, setToolsText] = useState("");
  const [readPathsText, setReadPathsText] = useState("");
  const [writePathsText, setWritePathsText] = useState("");
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setServerName("");
      setToolsText("");
      setReadPathsText("");
      setWritePathsText("");
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const splitLines = (s) =>
    s
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

  const splitCsv = (s) =>
    s
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

  const handleGrant = async () => {
    setError(null);
    if (!serverName.trim()) {
      setError("Server name is required.");
      return;
    }
    const tools = splitCsv(toolsText);
    if (tools.length === 0) {
      setError("At least one tool name is required.");
      return;
    }
    const perms = {
      grantOrigin: "manual",
      servers: {
        [serverName.trim()]: {
          tools,
          readPaths: splitLines(readPathsText),
          writePaths: splitLines(writePathsText),
        },
      },
    };
    setIsSubmitting(true);
    try {
      const ok = await (typeof window !== "undefined"
        ? window.mainApi?.widgetMcp?.setGrant?.(widgetId, perms)
        : null);
      if (ok === false) {
        setError("Could not save grant.");
        setIsSubmitting(false);
        return;
      }
      if (typeof onGranted === "function") onGranted();
      setIsOpen(false);
    } catch (e) {
      setError(e?.message || String(e));
      setIsSubmitting(false);
    }
  };

  if (!widgetId) return null;

  return (
    <Modal isOpen={isOpen} setIsOpen={setIsOpen}>
      <div className="flex flex-col w-full max-w-xl ring-2 ring-amber-500">
        <div className="px-5 py-4 border-b border-gray-700">
          <div className="text-base font-semibold">
            Grant manually: {widgetId}
          </div>
          <div className="text-xs opacity-60 mt-1">
            This widget did not declare its MCP needs and the install-time
            scanner found nothing. You are granting access based on your own
            judgment — be conservative. Revoke any time.
          </div>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4 max-h-96 overflow-y-auto">
          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wider opacity-60">
              Server name
            </label>
            <input
              type="text"
              list="known-mcp-servers"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              placeholder="e.g. filesystem, github, slack"
              className="text-xs px-2 py-1.5 rounded bg-gray-800 border border-gray-700"
            />
            <datalist id="known-mcp-servers">
              {knownServerNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wider opacity-60">
              Tools (comma-separated)
            </label>
            <input
              type="text"
              value={toolsText}
              onChange={(e) => setToolsText(e.target.value)}
              placeholder="e.g. read_file, list_directory"
              className="text-xs px-2 py-1.5 rounded bg-gray-800 border border-gray-700 font-mono"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wider opacity-60">
              Read paths (one per line, optional)
            </label>
            <textarea
              value={readPathsText}
              onChange={(e) => setReadPathsText(e.target.value)}
              placeholder="/Users/jane/Documents&#10;/tmp/notes"
              rows={3}
              className="text-xs px-2 py-1.5 rounded bg-gray-800 border border-gray-700 font-mono"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs uppercase tracking-wider opacity-60">
              Write paths (one per line, optional)
            </label>
            <textarea
              value={writePathsText}
              onChange={(e) => setWritePathsText(e.target.value)}
              placeholder="/tmp/output"
              rows={3}
              className="text-xs px-2 py-1.5 rounded bg-gray-800 border border-gray-700 font-mono"
            />
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-900 bg-opacity-20 border border-red-700 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-700">
          <Button
            title="Cancel"
            onClick={() => setIsOpen(false)}
            disabled={isSubmitting}
          />
          <Button title="Grant" onClick={handleGrant} disabled={isSubmitting} />
        </div>
      </div>
    </Modal>
  );
};

export default GrantManuallyModal;
