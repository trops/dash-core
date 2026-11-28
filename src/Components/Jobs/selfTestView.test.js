/**
 * selfTestView (DASH-121): a self-test job's skipped outward actions in
 * plain words, its summary, per-step lines, and placeholder PR links.
 */
import {
  NO_PR_TEXT,
  commandWords,
  describeCommand,
  describeSkip,
  describeTool,
  isPlaceholderPr,
  readArgs,
  selfTestSummary,
  skippedList,
  stepSkips,
  stepSkipsText,
  testCard,
  toolTarget,
  toolWords,
  withoutPlaceholderPrs,
} from "./selfTestView";

describe("describeCommand", () => {
  it("says a blocked command as what it would have done", () => {
    expect(
      describeCommand(
        'gh pr create --base main --head fix/DASH-97 --title "Fix it"',
      ),
    ).toBe("Open a PR (fix/DASH-97 → main)");
    expect(describeCommand("gh pr create --base=main --head=x")).toBe(
      "Open a PR (x → main)",
    );
    expect(
      describeCommand("gh pr create --fill", {
        workspace: { branch: "fix/DASH-1" },
      }),
    ).toBe("Open a PR (fix/DASH-1)");
    expect(describeCommand("gh pr create --fill")).toBe("Open a PR");
    expect(describeCommand("git push -u origin feat/DASH-1")).toBe(
      "Push feat/DASH-1",
    );
    expect(describeCommand("git push", { workspace: { branch: "b" } })).toBe(
      "Push b",
    );
    expect(describeCommand("git push")).toBe("Push the branch");
    expect(describeCommand("gh pr merge 12 --squash")).toBe("Merge PR #12");
    expect(describeCommand('gh pr comment 3 --body "hi"')).toBe(
      "Comment on PR #3",
    );
    expect(describeCommand("gh pr comment --body x")).toBe("Comment on the PR");
    expect(describeCommand("gh pr close 4")).toBe("Close PR #4");
    expect(describeCommand("gh pr review --approve")).toBe("Review the PR");
    expect(describeCommand('gh issue create --title "x"')).toBe(
      "Create a GitHub issue",
    );
    expect(describeCommand("gh issue comment 5 -b hi")).toBe(
      "Comment on GitHub issue #5",
    );
    expect(describeCommand("gh api -X POST repos/o/r/issues")).toBe(
      "Call the GitHub API (POST repos/o/r/issues)",
    );
    expect(describeCommand("gh release create v1.2")).toBe(
      "Make a GitHub release (v1.2)",
    );
    expect(describeCommand("npm publish --access public")).toBe(
      "Publish to npm",
    );
    expect(describeCommand("GH_TOKEN=x gh pr merge")).toBe("Merge the PR");
    expect(describeCommand("rsync a b")).toBe("Run `rsync a b`");
    expect(describeCommand("")).toBe("Run a command");
  });

  it("keeps quoted words together", () => {
    expect(commandWords(`a "b c" 'd e' f`)).toEqual(["a", "b c", "d e", "f"]);
  });
});

describe("describeTool", () => {
  it("says a skipped tool as what it would have done", () => {
    expect(
      describeTool({
        tool: "addOrEditJiraIssueComment",
        args: '{"issueIdOrKey":"DASH-97","body":"x"}',
      }),
    ).toBe("Comment on DASH-97");
    expect(
      describeTool({
        tool: "transitionJiraIssue",
        args: { issueIdOrKey: "DASH-97", transition: { name: "Done" } },
      }),
    ).toBe("Move DASH-97 to Done");
    expect(
      describeTool({
        tool: "transitionJiraIssue",
        args: { issueIdOrKey: "DASH-97", transition: { id: "31" } },
      }),
    ).toBe("Move DASH-97 along");
    expect(
      describeTool({ tool: "merge_pull_request", args: { pull_number: 7 } }),
    ).toBe("Merge #7");
    expect(describeTool({ tool: "createJiraIssue", args: "{}" })).toBe(
      "Create Jira issue",
    );
    expect(describeTool({ tool: "update_page", args: { pageId: "123" } })).toBe(
      "Update page (123)",
    );
    expect(describeTool({})).toBe("Use a tool");
  });

  it("reads args kept as JSON, even cut off", () => {
    expect(readArgs('{"a":1}')).toEqual({ a: 1 });
    expect(readArgs('{"issueIdOrKey":"DASH-9","body":"long…')).toEqual({
      issueIdOrKey: "DASH-9",
    });
    expect(readArgs("(unreadable)")).toEqual({});
    expect(toolTarget({ issue_number: 4 })).toBe("#4");
    expect(toolTarget({ issue: { key: "K-1" } })).toBe("K-1");
    expect(toolWords("addOrEditJiraIssueComment")).toEqual([
      "add",
      "or",
      "edit",
      "Jira",
      "issue",
      "comment",
    ]);
  });

  it("a skipped check", () => {
    expect(describeSkip({ check: "pr-ci" })).toBe("Wait for CI");
    expect(describeSkip({ check: "lint" })).toBe("Run its lint check");
  });
});

const T0 = "2026-11-27T10:00:00.000Z";
const T1 = "2026-11-27T10:05:00.000Z";
const T2 = "2026-11-27T10:10:00.000Z";

const testJob = (extra = {}) => ({
  id: "j",
  test: true,
  status: "done",
  steps: [
    { id: "s1", botName: "PR Bot", startedAt: T0, endedAt: T1 },
    { id: "s2", botName: "Reporter", startedAt: T1, endedAt: T2 },
    { id: "s3", botName: "PR Bot", startedAt: T2, endedAt: null },
  ],
  skippedInTest: [
    {
      command: "gh pr create --base main --head fix/DASH-97",
      botName: "PR Bot",
      at: "2026-11-27T10:01:00.000Z",
    },
    {
      tool: "addOrEditJiraIssueComment",
      server: "Atlassian",
      args: '{"issueIdOrKey":"DASH-97"}',
      botName: "Reporter",
      at: "2026-11-27T10:06:00.000Z",
    },
    {
      command: "gh pr create --base main --head fix/DASH-97",
      botName: "PR Bot",
      at: "2026-11-27T10:11:00.000Z",
    },
  ],
  ...extra,
});

describe("selfTestSummary", () => {
  it("a passed test: what it skipped, once each, and how to do it for real", () => {
    const v = selfTestSummary(testJob());
    expect(v.passed).toBe(true);
    expect(v.title).toBe("Self-test passed · 2 outward actions were skipped");
    expect(v.items.map((i) => i.text)).toEqual([
      "Open a PR (fix/DASH-97 → main)",
      "Comment on DASH-97",
    ]);
    expect(v.items[1].raw).toBe(
      'addOrEditJiraIssueComment on Atlassian {"issueIdOrKey":"DASH-97"}',
    );
    expect(v.tail).toBe("To do it for real, run the team on a ticket.");
  });

  it("one, or none", () => {
    const one = testJob({ skippedInTest: [{ check: "pr-ci" }] });
    expect(selfTestSummary(one).title).toBe(
      "Self-test passed · 1 outward action was skipped",
    );
    expect(selfTestSummary(testJob({ skippedInTest: [] })).title).toBe(
      "Self-test passed · nothing outward to skip",
    );
  });

  it("a failed test lists what it skipped (its failure header stays)", () => {
    const v = selfTestSummary(testJob({ status: "failed" }));
    expect(v.passed).toBe(false);
    expect(v.title).toBe(
      "Skipped in this test · 2 outward actions were skipped",
    );
  });

  it("never passed while a step of it failed or stopped (DASH-165)", () => {
    const job = testJob();
    for (const status of ["failed", "stopped"]) {
      const v = selfTestSummary({
        ...job,
        steps: [...job.steps, { id: "s4", botName: "Coder", status }],
      });
      expect(v.passed).toBe(false);
      expect(v.title).not.toMatch(/passed/);
    }
  });

  it("reads the job's own status: a failed job never passes", () => {
    expect(selfTestSummary(testJob({ status: "failed" })).passed).toBe(false);
    expect(selfTestSummary(testJob({ status: "stopped" })).passed).toBe(false);
  });

  it("nothing for a running or a real job", () => {
    expect(selfTestSummary(testJob({ status: "running" }))).toBeNull();
    expect(selfTestSummary(testJob({ test: false }))).toBeNull();
    expect(skippedList(testJob({ test: false }))).toEqual([]);
    expect(selfTestSummary(null)).toBeNull();
  });
});

describe("stepSkips", () => {
  it("a step's own skips: its bot's, made while it ran", () => {
    const job = testJob();
    expect(stepSkips(job, job.steps[0]).map((s) => s.text)).toEqual([
      "Open a PR (fix/DASH-97 → main)",
    ]);
    expect(stepSkipsText(job, job.steps[1])).toBe(
      "Skipped in this test: Comment on DASH-97",
    );
    expect(stepSkips(job, job.steps[2])).toHaveLength(1);
  });

  it("a bot with one step gets its notes whatever their time; a stepId wins", () => {
    const job = {
      test: true,
      steps: [{ id: "a", botName: "Reporter" }],
      skippedInTest: [
        { botName: "Reporter", tool: "addComment", args: '{"key":"K-1"}' },
        { stepId: "b", botName: "Reporter", tool: "x" },
      ],
    };
    expect(stepSkipsText(job, job.steps[0])).toBe(
      "Skipped in this test: Comment on K-1",
    );
    expect(stepSkipsText({ ...job, test: false }, job.steps[0])).toBe("");
  });
});

describe("placeholder PR links", () => {
  it("knows a made-up PR link", () => {
    expect(isPlaceholderPr("https://github.com///pull/0")).toBe(true);
    expect(isPlaceholderPr("https://github.com/o/r/pull/0")).toBe(true);
    expect(isPlaceholderPr("https://github.com/<owner>/<repo>/pull/0")).toBe(
      true,
    );
    expect(isPlaceholderPr("https://github.com//r/pull/5")).toBe(true);
    expect(isPlaceholderPr("https://github.com/trops/dash-core/pull/12")).toBe(
      false,
    );
    expect(isPlaceholderPr("https://example.com/pull/0")).toBe(false);
    expect(isPlaceholderPr("")).toBe(false);
  });

  it("says one in prose as no PR, and keeps a real one", () => {
    expect(
      withoutPlaceholderPrs(
        "The PR is open: [PR](https://github.com///pull/0). See <https://github.com/o/r/pull/0>.",
      ),
    ).toBe(`The PR is open: ${NO_PR_TEXT}. See ${NO_PR_TEXT}.`);
    expect(withoutPlaceholderPrs("Bare https://github.com///pull/0 here")).toBe(
      `Bare ${NO_PR_TEXT} here`,
    );
    const real = "[PR](https://github.com/trops/dash-core/pull/12)";
    expect(withoutPlaceholderPrs(real)).toBe(real);
    expect(withoutPlaceholderPrs(null)).toBe("");
  });

  it("a test job's handoff card says it too; a real job's is left", () => {
    const card = {
      item: { id: "PR", url: "https://github.com///pull/0" },
      summary: "Opened https://github.com///pull/0",
      question: "",
      details: [
        { key: "prUrl", label: "Pr url", text: "https://github.com///pull/0" },
      ],
    };
    const out = testCard(card, { test: true });
    expect(out.item.url).toBeUndefined();
    expect(out.summary).toBe(`Opened ${NO_PR_TEXT}`);
    expect(out.details[0].text).toBe(NO_PR_TEXT);
    expect(testCard(card, { test: false })).toBe(card);
    expect(testCard(null, { test: true })).toBeNull();
  });
});
