/**
 * grantSummary
 *
 * Pure helpers that produce plain-English copy describing what's
 * about to be wiped when the user clicks a destructive button. Used
 * inside WidgetGrantRow's inline confirmation banners; extracted so
 * the wording can be unit-tested without rendering React.
 *
 * Tone: factual and specific. The user's last question — "what does
 * Revoke server vs Revoke all do?" — drove this; the goal is that
 * the confirmation copy answers that question on the spot.
 */
"use strict";

export function describeServerGrant(grant) {
  if (!grant) return "this server's grants";
  const parts = [];
  const toolCount = (grant.tools || []).length;
  const readCount = (grant.readPaths || []).length;
  const writeCount = (grant.writePaths || []).length;
  if (toolCount > 0)
    parts.push(`${toolCount} tool grant${toolCount === 1 ? "" : "s"}`);
  if (readCount > 0)
    parts.push(`${readCount} read path${readCount === 1 ? "" : "s"}`);
  if (writeCount > 0)
    parts.push(`${writeCount} write path${writeCount === 1 ? "" : "s"}`);
  if (parts.length === 0) return "this server's grants";
  return joinWithAnd(parts);
}

export function describeWidgetGrant(grantedServers) {
  let totalTools = 0;
  let totalReadPaths = 0;
  let totalWritePaths = 0;
  const serverNames = Object.keys(grantedServers || {});
  for (const name of serverNames) {
    const s = grantedServers[name] || {};
    totalTools += (s.tools || []).length;
    totalReadPaths += (s.readPaths || []).length;
    totalWritePaths += (s.writePaths || []).length;
  }
  const parts = [];
  if (totalTools > 0)
    parts.push(`${totalTools} tool grant${totalTools === 1 ? "" : "s"}`);
  if (totalReadPaths > 0)
    parts.push(`${totalReadPaths} read path${totalReadPaths === 1 ? "" : "s"}`);
  if (totalWritePaths > 0)
    parts.push(
      `${totalWritePaths} write path${totalWritePaths === 1 ? "" : "s"}`,
    );
  const serverPart =
    serverNames.length > 0
      ? ` across ${serverNames.length} server${serverNames.length === 1 ? "" : "s"}`
      : "";
  if (parts.length === 0) return `this widget's grants${serverPart}`;
  return `${joinWithAnd(parts)}${serverPart}`;
}

function joinWithAnd(parts) {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return parts.join(" and ");
  return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
}
