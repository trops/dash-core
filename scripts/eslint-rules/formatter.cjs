/**
 * ESLint formatter for ci.sh (DASH-157): every error, but the baselined
 * no-console warnings only as a count — unless there are more than
 * --max-warnings allows, when it lists them all so the new one can be found.
 */
"use strict";

module.exports = function format(results, context = {}) {
  const exceeded = context.maxWarningsExceeded;
  const lines = [];
  let errors = 0;
  let warnings = 0;
  for (const r of results) {
    const shown = r.messages.filter((m) => m.severity === 2 || exceeded);
    errors += r.errorCount;
    warnings += r.warningCount;
    if (!shown.length) continue;
    lines.push("", r.filePath.replace(`${context.cwd || process.cwd()}/`, ""));
    for (const m of shown) {
      const kind = m.severity === 2 ? "error" : "warning";
      lines.push(
        `  ${m.line}:${m.column}  ${kind}  ${m.message}  ${m.ruleId || ""}`,
      );
    }
  }
  lines.push(
    "",
    `ESLint: ${errors} error(s), ${warnings} warning(s)` +
      (exceeded
        ? ` — more warnings than the ${exceeded.maxWarnings} baselined: remove the console call you added.`
        : " (warnings baselined)."),
  );
  return lines.join("\n");
};
