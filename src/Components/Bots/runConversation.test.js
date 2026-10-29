/**
 * runConversation (lead-workspace release 5): each run links to the
 * conversation it came from.
 */
import { runConversation } from "./runConversation";

const names = { lead_7: "Kitchen Sink Lead" };
const nameOf = (id) => names[id] || id;
const inbox = { id: "inbox", name: "Inbox Watch", workspaceId: 7 };
const lead = { id: "lead_7", name: "Kitchen Sink Lead", role: "lead" };

test("a run its lead asked for opens that exact conversation", () => {
  expect(
    runConversation(
      { via: "lead:lead_7", conversationId: "q_42" },
      inbox,
      nameOf,
    ),
  ).toEqual({
    label: "Asked by Kitchen Sink Lead",
    open: { key: "lead:lead_7", recentId: "q_42" },
  });
});

test("an older run (no conversation recorded) opens the lead's conversations", () => {
  expect(runConversation({ via: "lead:lead_7" }, inbox, nameOf)).toEqual({
    label: "Asked by Kitchen Sink Lead",
    open: { key: "lead:lead_7" },
  });
  // A lead that's gone: still a link, no stray id.
  expect(runConversation({ via: "lead:gone" }, inbox, nameOf).label).toBe(
    "Asked by its lead",
  );
});

test("a lead's own answer opens the conversation it answered in", () => {
  expect(
    runConversation({ via: "create", conversationId: "q_9" }, lead, nameOf),
  ).toEqual({
    label: "Your conversation",
    open: { key: "lead:lead_7", recentId: "q_9" },
  });
});

test("scheduled and event runs have no conversation", () => {
  expect(runConversation({ trigger: "schedule" }, inbox, nameOf)).toBeNull();
  expect(runConversation({ via: "assistant" }, inbox, nameOf)).toBeNull();
  expect(runConversation({ via: "create" }, inbox, nameOf)).toBeNull();
});
