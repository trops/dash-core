/**
 * The Activity list's Open conversation: the conversation the run belongs
 * to — never an empty one.
 */
import { activityLog } from "./activityLog";

const lead = { id: "lead_w", name: "Woodworking Projects Lead", role: "lead" };
const row = (run) =>
  activityLog({
    runs: [
      {
        botId: "lead_w",
        workspaceId: "7",
        run: { status: "completed", endedAt: "2026-11-20T08:57:00Z", ...run },
      },
    ],
    bots: [lead],
    current: "7",
  })[0];

describe("Open conversation in Activity", () => {
  test("a run with its conversation opens that one", () => {
    expect(
      row({ via: "mcp-task:claude", conversationId: "plan_1" }).open,
    ).toEqual({
      key: "lead:lead_w",
      recentId: "plan_1",
    });
  });
  test("a quick question over MCP has no conversation here: no link", () => {
    expect(row({ via: "mcp" }).open).toBeNull();
  });
  test("a lead's own run without one opens the lead, as before", () => {
    expect(row({ via: null }).open).toEqual({ key: "lead:lead_w" });
  });
});
