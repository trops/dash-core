/**
 * dashTeamWiring.test.js — the controller applies the Dash team rules
 * (create-entry CRE-011). Source checks: botController needs Electron.
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ctrl = fs.readFileSync(
  path.join(__dirname, "..", "controller", "botController.js"),
  "utf8",
);
const api = fs.readFileSync(
  path.join(__dirname, "..", "api", "botApi.js"),
  "utf8",
);

describe("botController — Dash team (CRE-011)", () => {
  it("creates the team at startup, before it's ready", () => {
    assert.match(ctrl, /this\.ensureDashTeam\(\);\s*this\._ready = true;/);
  });

  it("refuses to delete a team bot", () => {
    assert.match(
      ctrl,
      /delete\(botId\) \{\s*const bot = this\._store\.get\(botId\);\s*if \(isDashTeam\(bot\)\) \{\s*throw new Error/,
    );
  });

  it("list() leaves the team out; listDashTeam() is its own channel", () => {
    assert.match(
      ctrl,
      /list\(\) \{\s*return this\._store\.list\(\)\.filter\(\(b\) => !isDashTeam\(b\)\);/,
    );
    assert.match(ctrl, /listDashTeam\(\) \{/);
    assert.match(
      api,
      /listDashTeam: \(\) => ipcRenderer\.invoke\(BOTS_LIST_DASH_TEAM\)/,
    );
  });

  it("pause is saved and a paused bot doesn't start", () => {
    assert.match(ctrl, /new PauseController\(\{\s*persistence: \{/);
    assert.match(
      ctrl,
      // …except a test run the user started (Phase 1d).
      /startBlocker: \(botId\) => \{[\s\S]{0,400}if \(this\._pause\.isPaused\(botId\) && !testRun\)\s*return "this bot is paused";/,
    );
  });

  it("team bots run on their role's model; leads default to the fast tier", () => {
    assert.match(
      ctrl,
      /modelForRole\(bot, providerId, this\._store\.getSettings\(\)\)/,
    );
    assert.match(
      ctrl,
      /else if \(isLead\(bot\)\) \{\s*model = tierModel\(providerId, "fast"\) \|\| getDefaultModel\(providerId\);/,
    );
  });

  it("built-ins per role come from the run profile", () => {
    assert.match(ctrl, /isDashTeam\(bot\)\s*\? builtinToolsFor\(bot\)/);
  });

  it("settings take dashTeam model picks", () => {
    assert.match(ctrl, /next\.dashTeam = mergeDashTeamSettings\(/);
  });

  it("a saved team bot keeps its identity and no triggers", () => {
    assert.match(
      ctrl,
      /system: existing\.system,\s*role: existing\.role,\s*workspaceId: null,[\s\S]{0,80}schedules: \[\],\s*subscriptions: \[\],/,
    );
  });
});

describe("botController — role tools (CRE-011, slice 3a)", () => {
  it("team bots get only their role's tools, on an auto-allowed server", () => {
    assert.match(
      ctrl,
      /const tools = \[\.\.\.roleToolsFor\(bot\.role\), \.\.\.memory\];/,
    );
    assert.match(ctrl, /RESULTS_SERVER,\s*ROLE_SERVER,\s*\]/);
  });

  it("role tool calls re-check that the caller is on the team", () => {
    assert.match(
      ctrl,
      /if \(serverName === ROLE_SERVER \|\| serverName === ROLE_BUILD_SERVER\) \{\s*const caller = this\._store\.get\(opts\.botId\);\s*if \(!isDashTeam\(caller\)\)/,
    );
    assert.match(ctrl, /\{ botId: caller\.id, role: caller\.role \}/);
  });

  it("ask_role is capped per run, refuses a busy role and runs it as an ask", () => {
    assert.match(ctrl, /this\._handoffs = new HandoffCap\(\)/);
    assert.match(ctrl, /if \(!this\._handoffs\.take\(callerId, runKey\)\)/);
    assert.match(ctrl, /if \(this\._runner\.isRunning\(target\.id\)\)/);
    assert.match(ctrl, /trigger: "ask",\s*via: \`dash-team:/);
  });

  it("team runs stay off the event bus", () => {
    assert.match(
      ctrl,
      /!isLead\(this\._store\.get\(botId\)\) &&\s*!isDashTeam\(this\._store\.get\(botId\)\)/,
    );
  });
});

describe("botController — list_providers covers every provider (3a)", () => {
  it("credential providers are included, marked", () => {
    assert.match(ctrl, /p\.providerClass !== "mcp"/);
    assert.match(ctrl, /return \[\.\.\.mcp, \.\.\.credentials\];/);
  });
});

describe("botController — build and check (CRE-011, slice 3b-1)", () => {
  it("takes the host's widget tools at init", () => {
    assert.match(
      ctrl,
      /widgetTools = null,\s*\} = deps;\s*this\._widgetTools = widgetTools;/,
    );
  });

  it("build_widget is served from the server the gate asks about, never the auto-allowed one", () => {
    assert.match(ctrl, /if \(serverForTool\(toolName\) !== serverName\)/);
    assert.match(ctrl, /\? serverForTool\(toolName\)/);
    // ROLE_BUILD_SERVER is not in internalServers.
    const internal = /internalServers: \[([\s\S]*?)\]/.exec(ctrl)[1];
    assert.ok(!internal.includes("ROLE_BUILD_SERVER"));
  });

  it("the Builder's provider type becomes the user's { type, providerClass }", () => {
    assert.match(ctrl, /provider: this\._providerPick\(req\.provider\)/);
  });
});

describe("botController — the build server is configured for the Builder's runs (3b-1)", () => {
  it("_resolveTools lists it so the gate asks instead of refusing", () => {
    assert.match(
      ctrl,
      /servers: tools\.some\(\(t\) => serverForTool\(t\.name\) === ROLE_BUILD_SERVER\)/,
    );
  });
});

describe("botController — no bot drafts (Phase 2c-2)", () => {
  it("the Dash team and leads draft nothing", () => {
    assert.doesNotMatch(
      ctrl,
      /_teamDraftBot|_proposeBot|DraftStore|listDrafts/,
    );
  });
});

describe("botController — place_widget (3c)", () => {
  it("resolves the widget, places it with placeWidget and saves", () => {
    // Not while a cell build runs (Phase 2b): the editor places that one.
    assert.match(
      ctrl,
      /placeWidget: \(req\) =>\s*this\._cellBuildRunning\(\)\s*\?[\s\S]{0,200}: this\._teamPlaceWidget\(req\)/,
    );
    assert.match(ctrl, /resolveWidgetComponent\(\s+widget,\s+component,/);
    assert.match(
      ctrl,
      /const saved = this\._saveWorkspace\(placed\.workspace\);/,
    );
  });
});

describe("botController — building a plan (phase 4d-1)", () => {
  it("builds with createPlanBuild and broadcasts progress", () => {
    assert.match(ctrl, /const build = createPlanBuild\(/);
    assert.match(
      ctrl,
      /this\._broadcast\(BOT_PLAN_BUILD_PROGRESS, \{ buildId, state \}\)/,
    );
  });
  it("the team's runs in a build don't ask (the plan was the consent); other runs unchanged", () => {
    assert.match(ctrl, /via: "plan-build",\s*approvalPolicy: "allow",/);
    assert.match(ctrl, /approvalPolicy: opts\.approvalPolicy \|\| undefined,/);
  });
});

describe("botController — bots and wiring in a build (phase 4d-2)", () => {
  it("saves planned bots (not drafts) and wires both ways", () => {
    assert.match(ctrl, /saveBot: \(req\) => this\._planSaveBot\(req\)/);
    assert.match(ctrl, /const definition = planBotDefinition\(piece,/);
    assert.match(ctrl, /const saved = this\.save\(\s*existing\s*\?/);
    assert.match(
      ctrl,
      /this\.addBotWidget\(dashboardId, \{\s*kind: "results",/,
    );
    assert.match(ctrl, /const sub = triggerSubscription\(/);
    assert.match(
      ctrl,
      /addWidgetListener\(\s*ws,\s*widgetId,\s*handler,\s*botEventType\(bot, \`result\.\$\{result\}\`\)/,
    );
  });
  it("refuses wiring a widget doesn't declare", () => {
    assert.match(ctrl, /the widget doesn't send/);
    assert.match(ctrl, /the widget has no handler/);
    assert.match(ctrl, /with api\.publishEvent, which bots can't hear/);
    assert.match(ctrl, /widgetWiring\(src\.configCode, src\.componentCode\)/);
  });
});

describe("botController — after a build (phase 4d-3)", () => {
  const events = fs.readFileSync(
    path.join(__dirname, "..", "events", "botEvents.js"),
    "utf8",
  );
  const api = fs.readFileSync(
    path.join(__dirname, "..", "api", "botApi.js"),
    "utf8",
  );
  it("fix, retry, resume and remove are wired end to end", () => {
    for (const [ev, method] of [
      ["BOTS_FIX_PLAN_BUILD", "fixPlanBuild"],
      ["BOTS_RETRY_PLAN_BUILD", "retryPlanBuild"],
      ["BOTS_RESUME_PLAN_BUILD", "resumePlanBuild"],
      ["BOTS_REMOVE_PLAN_BUILD", "removePlanBuild"],
    ]) {
      assert.match(events, new RegExp(`const ${ev} = "`));
      assert.match(api, new RegExp(`${method}: \\(buildId`));
      assert.match(api, new RegExp(`ipcRenderer\\.invoke\\(${ev},`));
      assert.match(ctrl, new RegExp(`^  ${method}\\(buildId`, "m"));
    }
  });
  it("only a finished build can be fixed, retried, resumed or removed", () => {
    assert.match(
      ctrl,
      /if \(isBuildBusy\(entry\.state\)\)\s*return \{ error: "The build is still running\." \}/,
    );
  });
  it("Edit plan reuses the earlier build's work", () => {
    assert.match(
      ctrl,
      /resume = \{ plan: earlier\.plan, state: earlier\.state \};/,
    );
    assert.match(
      ctrl,
      /dashboardName,\s*resume,\s*autoFix: true,\s*cell: !!cell,\s*bot: !!bot,\s*edit: editTarget,/,
    );
  });
  it("Remove deletes the dashboard, its bots and lead, and new widgets — not installs", () => {
    assert.match(ctrl, /leadOf\(this\._store\.list\(\), dashboardId\)/);
    assert.match(ctrl, /for \(const pkg of built\.widgets \|\| \[\]\)/);
    assert.match(ctrl, /deleteWorkspaceForApplication\(/);
    assert.doesNotMatch(ctrl, /for \(const pkg of built\.installs/);
  });
});

describe("botController — plans that change a dashboard you have (5e-2b)", () => {
  it("the build uses the dashboard and applies saved themes", () => {
    assert.match(ctrl, /useDashboard: \(id\) => this\._planUseDashboard\(id\)/);
    assert.match(ctrl, /applyTheme: \(req\) => this\._planApplyTheme\(req\)/);
    assert.match(ctrl, /themeKey: hit\.key,\s*theme: hit\.key,/);
  });
  it("Remove never deletes a dashboard the user had, its lead or its notes", () => {
    assert.match(
      ctrl,
      /const targeted = !!\(built\.dashboard && built\.dashboard\.targeted\);/,
    );
    assert.match(ctrl, /dashboardId && !targeted\s*\? leadOf\(/);
    assert.match(
      ctrl,
      /if \(dashboardId && targeted\) \{\s*this\._undoOnDashboard\(built, removed, problems\);\s*\} else if \(dashboardId\) \{/,
    );
    assert.match(ctrl, /!state\.dashboard\.targeted &&/);
  });
  it("an edited plan can't move the work to another dashboard", () => {
    assert.match(ctrl, /This plan now changes a different dashboard/);
  });
  it("the Planner can list the user's themes", () => {
    assert.match(ctrl, /listThemes: \(\) => this\._themeNames\(\)/);
  });
});

describe("botController — Create build outcomes (Create build fixes, PR 1)", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../controller/botController.js"),
    "utf8",
  );
  it("notes each build_widget result for the plan build", () => {
    assert.match(
      src,
      /const result = await handleRoleTool\([\s\S]{0,200}\);\s+if \(toolName === "build_widget"\) this\._noteBuild\(caller\.id, result\);\s+return result;/,
    );
    assert.match(src, /record\.builds = this\._takeBuilds\(bot\.id\);/);
  });
  it("placing passes the piece's component and name", () => {
    assert.match(src, /placeWidget: \(req\) => this\._planPlaceWidget\(req\)/);
    assert.match(
      src,
      /resolveWidgetComponent\(\s+full \? component : widget,\s+full \? null : component \|\| null,\s+\(\) =>[\s\S]{0,120}\{ name \},?\s+\);/,
    );
  });
});

describe("botController — pages, connections and automatic fixes (Create build fixes 2)", () => {
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "../controller/botController.js"),
    "utf8",
  );
  it("a new dashboard gets the planned pages", () => {
    assert.match(
      src,
      /createDashboard: \(name, count, pages\) =>\s+this\._planCreateDashboard\(name, count, pages\)/,
    );
    assert.match(
      src,
      /blankDashboard\(\{ id: Date\.now\(\), name, count, pages \}\)/,
    );
  });
  it("a widget is placed on its page with the connection and settings that check out", () => {
    assert.match(
      src,
      /placeChoices\(\s+\{ provider, settings \},\s+\{ connections, settingKeys: keys \},?\s+\)/,
    );
    assert.match(
      src,
      /settings: choices\.userPrefs,\s+selectedProviders: choices\.selectedProviders,/,
    );
    assert.match(src, /return \{ \.\.\.res, dropped: choices\.dropped \};/);
    assert.match(src, /userPrefs: settings \|\| \{\},\s+selectedProviders,/);
  });
});

// Phase 1b: plan builds install only what the Checker passed.
describe("botController — checked plan builds (Phase 1b)", () => {
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "..", "controller", "botController.js"),
    "utf8",
  );
  const body = (name) => {
    const at = src.indexOf(name);
    return src.slice(at, src.indexOf("\n  },\n", at));
  };
  it("build_widget's draft is noted for the build step", () => {
    assert.match(body("  _noteBuild("), /draft:/);
  });
  it("every Checker run records its verdict on the draft it checked", () => {
    assert.match(body("  async _planAskRole("), /_reviewedRun\(/);
    assert.match(body("  async _askRole("), /_reviewedRun\(/);
    assert.match(body("  _reviewedRun("), /reviewRun\(/);
  });
  it("the Install step installs the checked draft", () => {
    assert.match(src, /installBuilt: \(draft\) =>[\s\S]{0,200}installDraft\(/);
  });
  it("place_widget can install a draft that passed", () => {
    assert.match(body("  _roleToolDeps("), /installDraft:/);
  });
  it("a plan with errors doesn't start — checked against the user's dashboards and themes", () => {
    const start = body("  startPlanBuild(");
    assert.match(
      start,
      /validatePlan\(plan, \{[\s\S]{0,200}dashboards[\s\S]{0,200}themes/,
    );
    assert.match(start, /The plan can't be built yet/);
  });
});

// Consolidation Phase 2b: a widget for one cell — built, previewed by the
// user, installed; nothing placed or installed behind the user's edit.
describe("botController — cell builds (Phase 2b)", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "controller", "botController.js"),
    "utf8",
  );
  it("checks a cell plan as one widget and builds in cell mode", () => {
    assert.match(
      src,
      /cell: !!cell,\s*bot: !!bot,\s*edit: editTarget[\s\S]{0,160}?\}\);/,
    );
    assert.match(
      src,
      /autoFix: true,\s*cell: !!cell,\s*bot: !!bot,\s*edit: editTarget,/,
    );
  });
  it("Looks good / Change something only on a waiting preview", () => {
    assert.match(src, /approvePlanStep\(buildId, stepId, inputs = \{\}\) \{/);
    assert.match(src, /revisePlanStep\(buildId, stepId, note\) \{/);
    assert.match(
      src,
      /step\.kind !== "preview" \|\| step\.status !== "needs-you"/,
    );
  });
  it("the Builder can't install or place during a cell build", () => {
    assert.match(
      src,
      /installDraft: \(req\) =>[\s\S]{0,120}this\._cellBuildRunning\(\)/,
    );
    // Only while the cell build's own roles run.
    assert.match(
      src,
      /this\._cellRoleRuns = \(this\._cellRoleRuns \|\| 0\) \+ 1;/,
    );
    assert.match(src, /return \(this\._cellRoleRuns \|\| 0\) > 0;/);
  });
  it("its preview inputs come from the config source, parsed not run", () => {
    assert.match(src, /previewConfig: async \(\{ draft, component \}\) =>/);
    assert.match(src, /this\._widgetTools\.previewDraft\(\{ name: draft \}\)/);
  });
});

// Found live (Phase 2b): a plan's registry install was kept under the bare
// package name ("clock"), so nothing found "@trops/clock" until a restart.
describe("botController — a plan's registry install is kept under its scoped id", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "controller", "botController.js"),
    "utf8",
  );
  it("installs and announces @scope/name", () => {
    assert.match(
      src,
      /const installAs = pkg\.scope \? `@\$\{pkg\.scope\}\/\$\{pkg\.name\}` : pkg\.name;/,
    );
    assert.match(
      src,
      /registry\.downloadWidget\(installAs, pkg\.downloadUrl\)/,
    );
  });
});
