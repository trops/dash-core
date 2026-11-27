/**
 * teamTables.test.js — a team setting that's a table (DASH-84): one row per
 * repo, and each job uses the row it picked ({repo.url}, {repo.validateCmd}).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  mergeTeamValues,
  withTeamValues,
  rowsText,
  missingMessage,
  pickFrom,
  namesUsed,
} = require("./teamValues");

const REPO = {
  name: "repo",
  label: "Repos",
  type: "table",
  columns: [
    { name: "url", label: "Repository", type: "url" },
    { name: "baseBranch", label: "Base branch", type: "text" },
    { name: "validateCmd", label: "Validate command", type: "command" },
    { name: "checkout", label: "Checkout folder", type: "folder" },
  ],
};
const ROWS = [
  {
    key: "dash-core",
    url: "https://github.com/trops/dash-core",
    baseBranch: "master",
    validateCmd: "./scripts/ci.sh",
  },
  {
    key: "dash-electron",
    url: "https://github.com/trops/dash-electron",
    baseBranch: "master",
    validateCmd: "./scripts/ci.sh",
    checkout: "~/Factory/electron",
  },
];

function team(extra = {}) {
  const r = mergeTeamValues(null, {
    declare: [
      REPO,
      { name: "workRoot", type: "folder", default: "~/DashFactory" },
    ],
    values: { repo: ROWS, ...extra },
  });
  assert.deepEqual(r.errors, []);
  return { declared: r.declared, values: r.values };
}

const answer = (j) => `Here it is.\n\n\`\`\`json\n${JSON.stringify(j)}\n\`\`\``;

describe("team settings: tables (DASH-84)", () => {
  it("a table is declared with its columns, and its rows are checked", () => {
    const t = team();
    const d = t.declared.find((x) => x.name === "repo");
    assert.equal(d.type, "table");
    assert.deepEqual(
      d.columns.map((c) => c.name),
      ["url", "baseBranch", "validateCmd", "checkout"],
    );
    assert.equal(t.values.repo.length, 2);
    assert.equal(t.values.repo[0].key, "dash-core");
  });

  it("refuses a table with no columns, a 'key' column, or a bad row", () => {
    const bad = (declare, values) =>
      mergeTeamValues(null, { declare, values }).errors.join(" ");
    assert.match(bad([{ name: "repo", type: "table" }]), /needs its columns/);
    assert.match(
      bad([{ name: "repo", type: "table", columns: [{ name: "key" }] }]),
      /row's own key/,
    );
    assert.match(bad([REPO], { repo: [{ url: "x" }] }), /its key must be/);
    assert.match(bad([REPO], { repo: [{ key: "a" }, { key: "a" }] }), /twice/);
    assert.match(
      bad([REPO], { repo: [{ key: "a", nope: "1" }] }),
      /isn't one of its columns/,
    );
    assert.match(
      bad([REPO], { repo: [{ key: "a", checkout: "relative/dir" }] }),
      /whole path/,
    );
    assert.match(bad([REPO], { repo: "not rows" }), /list of rows/);
  });

  it("rows can come as JSON text (a form or an MCP client), and [] clears them", () => {
    const t = team();
    const r = mergeTeamValues(t, {
      values: { repo: JSON.stringify([{ key: "solo", url: "https://x/y" }]) },
    });
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.values.repo, [{ key: "solo", url: "https://x/y" }]);
    const cleared = mergeTeamValues(t, { values: { repo: [] } });
    assert.equal(cleared.values.repo, undefined);
  });

  it("pickFrom reads the row a bot's answer names, and only names", () => {
    const t = team();
    assert.deepEqual(
      pickFrom(answer({ key: "DASH-9", repo: "dash-core" }), t),
      {
        repo: "dash-core",
      },
    );
    // The last json block counts; text that isn't JSON picks nothing.
    assert.deepEqual(
      pickFrom(
        `${answer({ repo: "dash-core" })}\nthen\n${answer({ repo: "dash-electron" })}`,
        t,
      ),
      { repo: "dash-electron" },
    );
    assert.deepEqual(pickFrom("no json here", t), {});
    assert.deepEqual(pickFrom(answer({ repo: "rm -rf /; x" }), t), {});
    assert.deepEqual(pickFrom(answer({ repo: 7 }), t), {});
  });

  it("a table's `pick` names the answer's field", () => {
    const r = mergeTeamValues(null, {
      declare: [{ ...REPO, pick: "repository" }],
      values: { repo: ROWS },
    });
    assert.deepEqual(pickFrom(answer({ repository: "dash-electron" }), r), {
      repo: "dash-electron",
    });
  });

  it("a run fills {repo.*} from the picked row, everywhere a setting works", () => {
    const bot = {
      instructions: "Clone {repo.url} ({repo.key}) into {workRoot}.",
      projects: ["{repo.checkout}"],
      checks: {
        steps: [
          {
            kind: "check",
            check: {
              kind: "command",
              command:
                'cd "$dir" && {repo.validateCmd} && git diff origin/{repo.baseBranch}',
            },
          },
        ],
      },
    };
    const { bot: out, missing } = withTeamValues(bot, team(), {
      home: "/Users/me",
      picks: { repo: "dash-electron" },
    });
    assert.deepEqual(missing, []);
    assert.equal(
      out.instructions,
      "Clone https://github.com/trops/dash-electron (dash-electron) into /Users/me/DashFactory.",
    );
    assert.deepEqual(out.projects, ["/Users/me/Factory/electron"]);
    assert.equal(
      out.checks.steps[0].check.command,
      'cd "$dir" && ./scripts/ci.sh && git diff origin/master',
    );
    // The bot itself keeps its {names}.
    assert.equal(bot.projects[0], "{repo.checkout}");
  });

  it("someone else's ${x.y} (a check script's template) is left alone", () => {
    const bot = { instructions: "return `${j.key}: {repo.key}`;" };
    const { bot: out, missing } = withTeamValues(bot, team(), {
      picks: { repo: "dash-core" },
    });
    assert.deepEqual(missing, []);
    assert.equal(out.instructions, "return `${j.key}: dash-core`;");
  });

  it("no pick yet: the run can't start, and says how to pick", () => {
    const bot = { instructions: "Clone {repo.url}." };
    const { missing } = withTeamValues(bot, team(), { picks: {} });
    assert.equal(missing.length, 1);
    assert.equal(missing[0].reason, "unpicked");
    const msg = missingMessage(missing);
    assert.match(msg, /No row of Repos/);
    assert.match(msg, /"repo": one of "dash-core", "dash-electron"/);
  });

  it("a pick that isn't a row, an empty cell, and a table with no rows each say so", () => {
    const bot = { instructions: "Clone {repo.url} into {repo.checkout}." };
    const unknown = withTeamValues(bot, team(), {
      picks: { repo: "dash-web" },
    });
    assert.match(
      missingMessage(unknown.missing),
      /picked "dash-web" from Repos .* no such row \(it has "dash-core", "dash-electron"\)/,
    );
    const empty = withTeamValues(bot, team(), { picks: { repo: "dash-core" } });
    assert.equal(empty.missing.length, 1);
    assert.match(
      missingMessage(empty.missing),
      /row "dash-core" has no Checkout folder \(\{repo\.checkout\}\)/,
    );
    const none = mergeTeamValues(null, { declare: [REPO] });
    const noRows = withTeamValues(bot, none, { picks: { repo: "dash-core" } });
    assert.match(missingMessage(noRows.missing), /has no rows/);
  });

  it("a bot that doesn't use the table runs without a pick", () => {
    const { missing } = withTeamValues(
      { instructions: "Find the next ticket in {workRoot}." },
      team(),
      { picks: {} },
    );
    assert.deepEqual(missing, []);
  });

  it("namesUsed counts a table its bot uses (Team settings › Used by)", () => {
    const used = namesUsed({ instructions: "Push to {repo.url}." });
    assert.ok(used.includes("repo"));
  });
});

describe("a job remembers its picks (DASH-84)", () => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const { createJobStore } = require("../jobs/jobStore");
  const { createJobTracker } = require("../jobs/jobTracker");

  it("setPicks keeps them on the job, and picksOf gives them back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-picks-"));
    try {
      const t = createJobTracker({
        store: createJobStore({ root: dir }),
        settleMs: 1,
      });
      const job = t.startJob({ workspaceId: "ws1", title: "DASH-9" });
      assert.deepEqual(t.picksOf(job.id), {});
      t.setPicks(job.id, { repo: "dash-core" });
      assert.deepEqual(t.picksOf(job.id), { repo: "dash-core" });
      t.setPicks(job.id, { repo: "dash-electron" });
      assert.deepEqual(t.get(job.id).picks, { repo: "dash-electron" });
      assert.deepEqual(t.picksOf("job_nope"), {});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("every row of a table: {repo.rows} (DASH-104)", () => {
  it("lists each row's key and address, with no row picked", () => {
    const bot = { instructions: "Pick one of these repos:\n{repo.rows}" };
    const { bot: out, missing } = withTeamValues(bot, team(), { picks: {} });
    assert.deepEqual(missing, []);
    const lines = out.instructions.split("\n").slice(1);
    assert.equal(lines.length, ROWS.length);
    assert.equal(lines[0], `- ${ROWS[0].key}: ${ROWS[0].url}`);
  });

  it("still fills with a row picked, next to that row's cells", () => {
    const bot = { instructions: "{repo.rows}\nYou have {repo.key}." };
    const { bot: out, missing } = withTeamValues(bot, team(), {
      picks: { repo: ROWS[0].key },
    });
    assert.deepEqual(missing, []);
    assert.match(out.instructions, new RegExp(`You have ${ROWS[0].key}\\.$`));
  });

  it("a cell next to it still needs a pick", () => {
    const bot = { instructions: "{repo.rows} then {repo.url}" };
    const { missing } = withTeamValues(bot, team(), { picks: {} });
    assert.equal(missing[0].reason, "unpicked");
  });

  it("an empty table can't be listed", () => {
    const bot = { instructions: "{repo.rows}" };
    const { missing } = withTeamValues(bot, team({ repo: [] }), { picks: {} });
    assert.equal(missing.length, 1);
    assert.equal(missing[0].reason, "no-rows");
  });

  it("rowsText takes the first url column, else the first text one", () => {
    const setting = {
      columns: [
        { name: "on", type: "boolean" },
        { name: "label", type: "text" },
      ],
    };
    assert.equal(
      rowsText(setting, [{ key: "a", label: "First" }, { key: "b" }]),
      "- a: First\n- b",
    );
  });

  it("rows can't be a column's name", () => {
    const r = mergeTeamValues(null, {
      declare: [
        {
          name: "repo",
          type: "table",
          columns: [{ name: "rows", type: "text" }],
        },
      ],
    });
    assert.match(r.errors.join(" "), /"rows" is every row/);
  });
});
