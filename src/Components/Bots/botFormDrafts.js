/**
 * botFormDrafts.js — a new bot's form closed before it was created is kept
 * in Recent (bot-test-run TST-003): there's no bot until a test of it
 * finishes and it's created, so what was typed waits, untested, for the
 * user to pick it up — from Needs you, back in its form.
 */

const api = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.bots) ||
  null;

/** Worth keeping: it has a name or instructions. */
export function worthKeeping(definition) {
  const d = definition || {};
  return !!(String(d.name || "").trim() || String(d.instructions || "").trim());
}

/**
 * Keep the form's definition (again, under the same id when it came from
 * Recent). Resolves to its id, or null.
 */
export async function keepBotForm({
  definition,
  workspaceId = null,
  draftId = null,
}) {
  const b = api();
  if (!b || !b.saveCreateRecent || !worthKeeping(definition)) return null;
  try {
    const res = await b.saveCreateRecent({
      ...(draftId ? { id: draftId } : {}),
      kind: "botform",
      prompt: String(definition.name || "").trim() || "New bot",
      conversation: {
        botForm: {
          definition,
          workspaceId:
            workspaceId === undefined || workspaceId === ""
              ? null
              : workspaceId,
        },
      },
    });
    return (res && res.id) || null;
  } catch (_e) {
    return null;
  }
}

/** The bot was created: its kept form goes. */
export function dropBotForm(draftId) {
  const b = api();
  if (!draftId || !b || !b.removeCreateRecent) return;
  Promise.resolve(b.removeCreateRecent(draftId)).catch(() => {});
}

/** Back to a kept form, as it was left (DashboardStage hears dash:new-bot). */
export async function reopenBotForm(draftId) {
  const b = api();
  if (!draftId || !b || !b.getCreateRecent) return false;
  let entry = null;
  try {
    entry = await b.getCreateRecent(draftId);
  } catch (_e) {
    entry = null;
  }
  const form = entry && entry.conversation && entry.conversation.botForm;
  if (!form || !form.definition) return false;
  window.dispatchEvent(
    new CustomEvent("dash:new-bot", {
      detail: {
        workspaceId: form.workspaceId,
        initial: form.definition,
        note: "Picked up where you left off. Nothing is saved until you test it and create it.",
        draftId,
      },
    }),
  );
  return true;
}
