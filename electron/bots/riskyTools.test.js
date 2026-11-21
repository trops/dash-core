/**
 * riskyTools.test.js — which provider tools delete or send (DASH-29).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { deletesOrSends, nameWords } = require("./riskyTools");

describe("deletesOrSends", () => {
  it("goes by the tool's own name when its provider marks nothing", () => {
    for (const name of [
      "delete_model",
      "sendMessage",
      "mcp__claude_ai_Gmail__send_message",
      "slack_post_message",
      "slack_schedule_message",
      "addCommentToJiraIssue",
      "respond_to_event",
      "merge_pull_request",
      "execute_sql",
      "run_query",
      "upload_file",
      "sendmail",
      "deleteAll",
      "HTTPPost",
    ]) {
      assert.equal(deletesOrSends(name), true, name);
    }
    for (const name of [
      "save_model",
      "read_model",
      "list_sent_posts",
      "get_comments",
      "create_issue",
      "search_threads",
    ]) {
      assert.equal(deletesOrSends(name), false, name);
    }
  });

  it("a provider's marks: read-only never; otherwise destructive unless marked not, or open-world", () => {
    const tools = new Map([
      ["reset_board", { annotations: { destructiveHint: true } }],
      ["get_post", { annotations: { readOnlyHint: true } }],
      ["save_model", { annotations: { readOnlyHint: false } }],
      ["tidy", { annotations: { destructiveHint: false } }],
      [
        "ping_team",
        { annotations: { destructiveHint: false, openWorldHint: true } },
      ],
      ["delete_draft", { annotations: { destructiveHint: false } }],
    ]);
    assert.equal(deletesOrSends("reset_board", tools), true);
    assert.equal(deletesOrSends("get_post", tools), false);
    assert.equal(deletesOrSends("get_post"), true);
    // The MCP spec: destructive unless it says it isn't.
    assert.equal(deletesOrSends("save_model", tools), true);
    assert.equal(deletesOrSends("tidy", tools), false);
    assert.equal(deletesOrSends("ping_team", tools), true);
    // Its name still counts.
    assert.equal(deletesOrSends("delete_draft", tools), true);
  });

  it("splits names into words", () => {
    assert.deepEqual(nameWords("mcp__x__deleteFileNow"), [
      "delete",
      "file",
      "now",
    ]);
    assert.deepEqual(nameWords("save-model.v2"), ["save", "model", "v2"]);
    assert.deepEqual(nameWords("HTTPPost"), ["http", "post"]);
  });
});
