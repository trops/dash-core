/**
 * Export ZIP's status line (create-entry phase 5a).
 */

/** "Exported with 2 bots." · "…; not included: …" · the error. */
export function exportedText(result) {
  if (!result || !result.success) {
    return (result && result.error) || "Export failed.";
  }
  const n = result.bots || 0;
  const base = n ? `Exported with ${n} bot${n === 1 ? "" : "s"}.` : "Exported.";
  const left = (result.notIncluded || []).filter(Boolean);
  return left.length ? `${base} Not included: ${left.join("; ")}.` : base;
}
