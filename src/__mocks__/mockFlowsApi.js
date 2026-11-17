/**
 * mockFlowsApi — a window.mainApi.flows for tests (flows PRD): one flow
 * (a newsletter with a gap) whose steps can be added, changed and removed;
 * starters, previews and make; every change tells "flows:changed".
 */
const listeners = [];

function newsletter() {
  return {
    id: "flow_news01",
    workspaceId: "ws1",
    name: "Weekly newsletter",
    brief: "weekly, from your notes",
    line: "3 steps · weekly, from your notes",
    version: 1,
    maxRounds: 3,
    steps: [
      {
        id: "step_notes",
        kind: "source",
        name: "Notes reader",
        note: "Daily · notes tagged newsletter",
        botId: "bot_n",
        outputs: [],
      },
      {
        id: "step_writer",
        kind: "bot",
        name: "Writer",
        note: "Writes the week's newsletter",
        botId: "bot_w",
        outputs: [
          { name: "text", kind: "text", required: true },
          { name: "links", kind: "links", required: true },
        ],
      },
      {
        id: "step_sender",
        kind: "bot",
        name: "Sender",
        note: "Sends to the list",
        botId: "bot_s",
        outputs: [],
      },
    ],
    edges: [
      { from: "step_notes", to: "step_writer", kind: "next", label: "notes" },
      { from: "step_writer", to: "step_sender", kind: "next", label: "draft" },
    ],
    order: ["step_notes", "step_writer", "step_sender"],
    where: {
      counts: {
        step_writer: {
          goals: 1,
          rounds: [2],
          ready: 0,
          stopped: 0,
          waiting: [],
        },
      },
      total: 1,
      running: 1,
    },
    warnings: [
      {
        id: "unchecked:step_writer",
        stepId: "step_writer",
        title: "Nothing checks Writer's work",
        body: "Sender takes whatever Writer makes.",
        fix: {
          type: "add-check",
          label: "Add a check",
          from: "step_writer",
          to: "step_sender",
        },
      },
      {
        id: "unanchored:step_sender",
        stepId: "step_sender",
        title: "Sender has nothing it can't argue with",
        body: "What it does reaches outside Dash.",
        fix: {
          type: "add-you",
          label: "Ask me before it acts",
          from: "step_writer",
          to: "step_sender",
        },
      },
    ],
    good: [],
    botNames: { bot_n: "Notes reader", bot_w: "Writer", bot_s: "Sender" },
  };
}

export function installMockFlowsApi({ flows = null } = {}) {
  const state = { flows: flows || [newsletter()], calls: [] };
  const changed = (payload = {}) => {
    for (const fn of listeners) fn({}, { workspaceId: "ws1", ...payload });
  };
  const api = {
    list: jest.fn(async () => state.flows.map((f) => ({ ...f }))),
    get: jest.fn(async (id) => state.flows.find((f) => f.id === id) || null),
    save: jest.fn(async (flowId, next) => {
      const f = state.flows.find((x) => x.id === flowId);
      if (!f) return { error: "No such flow." };
      Object.assign(f, next);
      changed({ flowId });
      return { ok: true, flow: { ...f } };
    }),
    addStep: jest.fn(async (flowId, at) => {
      state.calls.push(["addStep", flowId, at]);
      const f = state.flows.find((x) => x.id === flowId);
      const id = `step_${f.steps.length + 1}`;
      f.steps.push({ id, ...at.step });
      f.edges = f.edges.filter(
        (e) => !(e.kind === "next" && e.from === at.from && e.to === at.to),
      );
      f.edges.push(
        { from: at.from, to: id, kind: "next" },
        { from: id, to: at.to, kind: "next" },
      );
      f.order = null;
      if (at.step.kind === "check")
        f.warnings = f.warnings.filter((w) => w.stepId !== "step_writer");
      f.good = [
        {
          id: "checked:step_writer",
          text: "Writer's work is checked before it goes on",
        },
      ];
      changed({ flowId });
      return { ok: true, stepId: id, flow: f };
    }),
    updateStep: jest.fn(async (flowId, stepId, patch) => {
      state.calls.push(["updateStep", flowId, stepId, patch]);
      const f = state.flows.find((x) => x.id === flowId);
      f.steps = f.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s));
      changed({ flowId });
      return { ok: true, flow: f };
    }),
    removeStep: jest.fn(async (flowId, stepId) => {
      state.calls.push(["removeStep", flowId, stepId]);
      return { ok: true };
    }),
    remove: jest.fn(async (flowId) => {
      state.flows = state.flows.filter((f) => f.id !== flowId);
      changed({ flowId });
      return { ok: true };
    }),
    starters: jest.fn(async () => [
      {
        id: "ticket-to-pr",
        name: "Ticket to PR",
        summary: "Ticket reader → Builder → CI check → Reviewer → You",
      },
      {
        id: "daily-brief",
        name: "Daily brief",
        summary: 'Calendar + email → Writer → "All events in it" check',
      },
    ]),
    preview: jest.fn(async (_ws, id) => ({
      ok: true,
      proposal: {
        name: id === "daily-brief" ? "Daily brief" : "Ticket to PR",
        brief: "daily 7:00",
        steps: [
          {
            key: "source",
            kind: "source",
            name: "Calendar + email",
            note: "Daily 7:00",
            bot: { name: "Calendar + email" },
          },
          {
            key: "writer",
            kind: "bot",
            name: "Brief writer",
            note: "Writes the morning brief",
            bot: { name: "Brief writer" },
          },
          {
            key: "check",
            kind: "check",
            name: "All events in it",
            note: "Compares event ids",
            check: { kind: "rules", rules: [] },
          },
          { key: "you", kind: "you", name: "You", note: "Read it" },
        ],
        edges: [
          { from: "source", to: "writer", kind: "next" },
          { from: "writer", to: "check", kind: "next" },
          { from: "check", to: "you", kind: "next" },
          { from: "check", to: "writer", kind: "fail" },
        ],
        needs: { providers: [], folder: false },
      },
      checked: [
        { ok: true, text: "Every AI step is checked by something" },
        { ok: true, text: "Every check can only read" },
        { ok: true, text: "You approve before anything goes out" },
      ],
      itWill: {
        makeBots: ["Calendar + email", "Brief writer"],
        uses: [
          {
            label: "Your calendar",
            connected: true,
            provider: "Google Calendar",
          },
        ],
        folder: false,
      },
    })),
    make: jest.fn(async (ws, proposal) => {
      const made = {
        ...newsletter(),
        id: "flow_made01",
        name: proposal.name,
        warnings: [],
      };
      state.flows.push(made);
      changed({ flowId: made.id });
      return { ok: true, flow: made, madeBots: ["bot_a", "bot_b"] };
    }),
    undo: jest.fn(async () => ({ ok: true })),
    propose: jest.fn(async () => ({ error: "No lead" })),
    whatItGets: jest.fn(async () => ({
      ok: true,
      real: true,
      from: "Writer",
      input: {
        goal: { title: "Spring newsletter" },
        input: { text: "Hi", links: ["https://a.com"] },
        from: {},
        files: [],
      },
      rows: [
        { path: "goal.title", kind: "text", sample: '"Spring newsletter"' },
        { path: "input.text", kind: "text", sample: '"Hi"' },
        { path: "input.links", kind: "links", sample: "1 item" },
      ],
    })),
    trial: jest.fn(async () => ({
      ok: true,
      tried: true,
      on: "Spring newsletter",
      result: {
        pass: false,
        reason: "1 of 2 passed. 1 link is broken: a.com (404).",
        details: [],
      },
    })),
    suggestFields: jest.fn(async () => ({
      ok: true,
      fields: [],
      from: 0,
      last: null,
    })),
    fieldUsage: jest.fn(async () => ({
      ok: true,
      usage: { text: [{ stepId: "step_sender", name: "Sender" }], links: [] },
    })),
    readOnlyTools: jest.fn(async () => ({ ok: true, servers: [] })),
    ruleTypes: jest.fn(async () => []),
    simpleGraph: jest.fn(async () => ({ ok: true, rows: [] })),
    criterionHelp: jest.fn(async (text) =>
      /fast/i.test(text || "")
        ? {
            vague: true,
            why: "Nothing can check this as written.",
            rewrite: "It opens in under 200 ms",
            rewriteProof: "test",
          }
        : { vague: false },
    ),
    newGoal: jest.fn(async (_ws, goal) => ({
      ok: true,
      goal: { id: "goal_new01", ...goal },
    })),
    startGoal: jest.fn(async () => ({ ok: true })),
    setCriteria: jest.fn(async () => ({ ok: true })),
    files: jest.fn(async () => []),
    pickFolder: jest.fn(async () => ({ path: "/tmp/work" })),
    writeScript: jest.fn(async () => ({
      ok: true,
      script: "function check() { return { pass: true }; }",
    })),
    // Phase 7: publish, install, update.
    publishPreview: jest.fn(async () => ({
      ok: true,
      signedIn: true,
      name: "@trops/ticket-to-pr",
      current: "1.2.0",
      versions: { patch: "1.2.1", minor: "1.3.0", major: "2.0.0" },
      contents: {
        steps: [
          "Ticket reader",
          "Builder",
          "Lint",
          "GitHub CI",
          "Reviewer",
          "You",
        ],
        bots: ["Ticket reader", "Builder", "Reviewer"],
        checks: ["Lint (command)", "GitHub CI (tool)"],
        files: ["scripts/lint-changed.js", "data/protected-paths.txt"],
        outputs: ["Builder: branch, commit, pr"],
        criteria: 3,
      },
      needs: { providers: ["jira", "github"], folder: true },
      leftOut: [
        "6 goals, their runs and proof",
        "What its bots learned (memory)",
        "Keys and passwords",
        "scripts/notify-me.sh (only on this computer)",
      ],
      checks: [
        { ok: true, text: "Every AI step is checked by something" },
        { ok: true, text: "No keys or tokens found in the files" },
        { ok: true, text: "Checks can only read" },
        { ok: true, text: "Scripts run sealed off" },
      ],
      secrets: [],
    })),
    publish: jest.fn(async (flowId, opts) => ({
      ok: true,
      package: opts.name,
      version: opts.version,
    })),
    installPreview: jest.fn(async () => ({
      ok: true,
      previewId: "fp_1",
      package: {
        scope: "trops",
        name: "ticket-to-pr",
        version: "1.3.0",
        author: "trops",
      },
      name: "Ticket to PR",
      steps: 5,
      bots: ["Ticket reader", "Builder", "Reviewer"],
      checks: 2,
      needs: {
        providers: [{ type: "github", options: ["GitHub · trops"] }],
        folder: true,
      },
      scripts: [
        {
          ref: "scripts/lint-changed.js",
          text: "const fs = require('fs');",
          usedBy: ["Lint"],
        },
      ],
    })),
    install: jest.fn(async () => ({
      ok: true,
      flow: { id: "flow_inst", name: "Ticket to PR" },
    })),
    checkUpdate: jest.fn(async () => ({ ok: true, available: false })),
    updatePreview: jest.fn(async () => ({
      ok: true,
      previewId: "fp_2",
      from: "1.2.0",
      to: "1.3.0",
      package: "@trops/ticket-to-pr",
      whatsNew: "Adds a Lint check",
      changes: [
        {
          kind: "add",
          text: "Adds a step: Lint",
          detail: "Code check · command",
        },
        {
          kind: "change",
          text: "Changes scripts/check-pr.js",
          detail: "Shown on the right",
        },
        {
          kind: "same",
          text: "Needs nothing new",
          detail: "Same providers, same folder",
        },
      ],
      conflicts: [
        {
          id: "builder.runLimits",
          role: "builder",
          field: "runLimits",
          text: "You changed this too: Builder's time limit",
          mine: { minutes: 45 },
          theirs: { minutes: 30 },
        },
      ],
      scripts: [
        {
          ref: "scripts/check-pr.js",
          before: "const ok = a;",
          after: "const ok = a && b;",
        },
      ],
      running: 2,
    })),
    update: jest.fn(async () => ({ ok: true, flow: { id: "flow_news01" } })),
    skipVersion: jest.fn(async () => ({ ok: true })),
    search: jest.fn(async () => ({ ok: true, packages: [] })),
  };
  const prev = window.mainApi || {};
  window.mainApi = {
    ...prev,
    flows: api,
    on: (channel, fn) => {
      if (channel === "flows:changed") listeners.push(fn);
      if (prev.on) return prev.on(channel, fn);
      return listeners.length;
    },
    removeListener: () => {},
  };
  return { api, state };
}
