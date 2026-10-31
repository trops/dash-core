/**
 * Plan → build, end to end (the plan card's next step): the real workspace
 * and conversation, with a scripted Dash team behind window.mainApi. Each
 * scenario plays a conversation the way a person would and checks that the
 * right column always offers a way on — the plan never leaves you stuck.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

jest.mock("@trops/dash-react", () => {
  const actual = jest.requireActual("@trops/dash-react");
  return {
    ...actual,
    Modal: ({ children }) => <div data-testid="modal">{children}</div>,
  };
});
jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => <div data-testid="providers-section" />,
}));
jest.mock("../Bots/BotChat", () => ({
  BotChat: () => <div data-testid="bot-chat" />,
}));
const TEAM = [
  { id: "d_p", role: "planner", name: "Planner" },
  { id: "d_s", role: "scout", name: "Scout" },
  { id: "d_l", role: "dashlead", name: "Dash Lead" },
  { id: "d_b", role: "builder", name: "Builder" },
  { id: "d_c", role: "checker", name: "Checker" },
];
jest.mock("../AppPages/useAllBots", () => ({
  useAllBots: () => ({
    approvals: [],
    bots: [],
    dashTeam: [
      { id: "d_p", role: "planner", name: "Planner" },
      { id: "d_s", role: "scout", name: "Scout" },
      { id: "d_l", role: "dashlead", name: "Dash Lead" },
      { id: "d_b", role: "builder", name: "Builder" },
      { id: "d_c", role: "checker", name: "Checker" },
    ],
    statusOf: () => "Idle",
  }),
}));
jest.mock("../AiAssistant/components/RecipientPicker", () => ({
  useTeamLeads: () => ({ loaded: true, leads: [] }),
}));
jest.mock("./useWidgetTarget", () => ({
  useWidgetTarget: () => ({
    status: "none",
    target: null,
    mode: null,
    usedOn: [],
  }),
}));

import { ThemeContext } from "@trops/dash-react";
import { LeadWorkspace } from "./LeadWorkspace";

// ── The scripted team ──────────────────────────────────────────────────

const HALLOWEEN = {
  kind: "theme",
  name: "Halloween",
  source: "new",
  colors: {
    primary: "#f97316",
    secondary: "#7c3aed",
    tertiary: "#84cc16",
    neutral: "#57534e",
  },
};
const ASKS_WHERE = {
  summary: "A new Halloween theme.",
  questions: [
    {
      question: "Should Halloween go on a dashboard, or just be saved?",
      options: ["Just save the theme", "My Calendar"],
    },
  ],
  pieces: [HALLOWEEN],
};
const READY = { summary: "A new Halloween theme.", pieces: [HALLOWEEN] };
const planned = (plan, words = "Here's the plan.") =>
  `${words}\n<plan>${JSON.stringify(plan)}</plan>`;

let listeners;
let runs; // [{ botId, prompt }]
let script; // { [botId]: [(prompt) => reply] } — taken in order
let buildListeners;
let saved; // every save, in order

/** A lead answer that asked a role: its hand-off events, then its words. */
const leadAsked = (role, roleOutput, words) => ({
  events: [
    {
      type: "tool_call",
      id: `c${Math.random()}`,
      name: "ask_role",
      input: { role, request: "…" },
    },
  ],
  roleOutput,
  output: words,
});

function emit(botId, event) {
  for (const cb of [...listeners.values()]) cb({ botId, event });
}

function fakeBots() {
  let next = 10;
  return {
    listDashTeam: jest.fn(async () => TEAM),
    onStream: jest.fn((cb) => {
      next += 1;
      listeners.set(next, cb);
      return next;
    }),
    removeListener: jest.fn((id) => {
      listeners.delete(id);
      buildListeners.delete(id);
    }),
    run: jest.fn(async (botId, prompt) => {
      runs.push({ botId, prompt });
      const queue = script[botId] || [];
      const make = queue.shift();
      if (!make) return { status: "completed", output: "(nothing scripted)" };
      const reply = make(prompt);
      if (reply.skipped) return reply;
      if (reply.hang) return reply.hang;
      await Promise.resolve();
      for (const e of reply.events || []) {
        emit(botId, e);
        if (e.type === "tool_call") {
          emit(botId, {
            type: "tool_result",
            id: e.id,
            output: reply.roleOutput,
          });
        }
      }
      // The lead still writing after its hand-off came back.
      if (reply.after) await reply.after;
      return { status: reply.status || "completed", output: reply.output };
    }),
    stop: jest.fn(async () => ({ ok: true })),
    listCreateRecent: jest.fn(async () => []),
    onCreateRecent: jest.fn(() => 1),
    saveCreateRecent: jest.fn(async (entry) => {
      saved.push(entry);
      return { id: "conv_1" };
    }),
    getCreateRecent: jest.fn(async () => null),
    listApprovals: jest.fn(async () => []),
    onApprovalsChanged: jest.fn(() => 2),
    getRuns: jest.fn(async () => []),
    onRunActive: jest.fn(() => 3),
    startPlanBuild: jest.fn(async () => ({ buildId: "build_1", state: null })),
    getPlanBuild: jest.fn(async () => null),
    onPlanBuild: jest.fn((cb) => {
      next += 1;
      buildListeners.set(next, cb);
      return next;
    }),
    stopPlanBuild: jest.fn(async () => ({ ok: true })),
    retryPlanBuild: jest.fn(async () => ({ ok: true })),
    fixPlanBuild: jest.fn(async () => ({ ok: true })),
    resumePlanBuild: jest.fn(async () => ({ ok: true })),
    approvePlanStep: jest.fn(async () => ({ ok: true })),
  };
}

/** The build, as the main process would send it. */
function sendBuild(state) {
  act(() => {
    for (const cb of [...buildListeners.values()])
      cb({ buildId: "build_1", state });
  });
}

const THEME_STEP = (status, extra = {}) => ({
  id: "s1",
  kind: "theme",
  label: "Save the Halloween theme",
  status,
  ...extra,
});

beforeEach(() => {
  listeners = new Map();
  buildListeners = new Map();
  runs = [];
  script = {};
  saved = [];
  window.mainApi = { bots: fakeBots() };
});
afterEach(() => {
  delete window.mainApi;
});

// ── Helpers: a person using it ───────────────────────────────────────

async function start(text) {
  const onOpenThemeEditor = jest.fn();
  const changeCurrentTheme = jest.fn();
  render(
    <ThemeContext.Provider
      value={{ currentTheme: {}, rawThemes: {}, changeCurrentTheme }}
    >
      <LeadWorkspace
        request={{ key: "role:dashlead" }}
        onClose={jest.fn()}
        onOpenThemeEditor={onOpenThemeEditor}
      />
    </ThemeContext.Provider>,
  );
  const box = await screen.findByRole("textbox", { name: "Ask Dash Lead" });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(
    within(box.parentElement).getByRole("button", { name: "Ask" }),
  );
  return { onOpenThemeEditor, changeCurrentTheme };
}

const side = () => screen.getByTestId("workspace-side");
const nextBox = () => within(side()).getByTestId("workspace-plan-next");
const nextIs = async (state) =>
  waitFor(() => expect(nextBox()).toHaveAttribute("data-next", state));
const reply = (text) => {
  const box = within(screen.getByTestId("ask-step"))
    .getAllByRole("textbox")
    .pop();
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
};
const plannerRuns = () => runs.filter((r) => r.botId === "d_p");
const leadRuns = () => runs.filter((r) => r.botId === "d_l");

/** The invariant: the plan's card always has a way on. */
function expectAWayOn() {
  const box = nextBox();
  // Stop isn't a way on: something that moves the plan forward.
  const buttons = within(box)
    .queryAllByRole("button")
    .filter((b) => !/^(Stop|Stopping…)$/.test(b.textContent.trim()));
  expect(buttons.length).toBeGreaterThan(0);
}

// ── Scenarios ────────────────────────────────────────────────────────

describe("a theme plan with a question (the Halloween bug)", () => {
  test("answer on the card → straight to the Planner → Yes, make it → made", async () => {
    script.d_l = [
      () =>
        leadAsked(
          "planner",
          planned(ASKS_WHERE),
          "The Planner planned Halloween. It has one question.",
        ),
    ];
    script.d_p = [() => ({ output: planned(READY, "Saved to your themes.") })];
    const { changeCurrentTheme, onOpenThemeEditor } = await start(
      "Make me a Halloween theme",
    );

    // The question is on the card, with its options and Decide for me.
    await nextIs("question");
    expectAWayOn();
    expect(nextBox()).toHaveTextContent(
      "Should Halloween go on a dashboard, or just be saved?",
    );
    expect(
      within(nextBox()).getByRole("button", {
        name: "Decide for me and finish the plan",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(nextBox()).getByRole("button", { name: "Just save the theme" }),
    );
    // Straight to the Planner — the lead isn't asked again.
    await nextIs("ready");
    expect(leadRuns()).toHaveLength(1);
    expect(plannerRuns()).toHaveLength(1);
    expect(plannerRuns()[0].prompt).toContain("Just save the theme");
    expect(plannerRuns()[0].prompt).toContain('"name":"Halloween"');
    // The chat shows the answer as yours, and the hand-off as a step.
    const chat = screen.getByTestId("ask-step");
    expect(chat).toHaveTextContent("Just save the theme");
    expect(chat).toHaveTextContent("Sent your answer to the Planner");

    expectAWayOn();
    fireEvent.click(within(nextBox()).getByRole("button", { name: /^Yes/ }));
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalledWith(
        READY,
        expect.anything(),
      ),
    );
    await nextIs("build");

    sendBuild({ status: "running", steps: [THEME_STEP("running")] });
    await waitFor(() =>
      expect(
        within(nextBox()).getByRole("button", { name: "Stop" }),
      ).toBeInTheDocument(),
    );
    sendBuild({
      status: "done",
      steps: [THEME_STEP("done")],
      madeTheme: { key: "halloween", name: "Halloween" },
    });
    await waitFor(() =>
      expect(
        within(nextBox()).getByRole("button", { name: "Use it for the app" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      within(nextBox()).getByRole("button", { name: "Use it for the app" }),
    );
    expect(changeCurrentTheme).toHaveBeenCalledWith("halloween");
    fireEvent.click(
      within(nextBox()).getByRole("button", {
        name: "Open in the theme editor",
      }),
    );
    expect(onOpenThemeEditor).toHaveBeenCalledWith("halloween");
  });

  test("a typed answer while the plan asks goes to the Planner, not the lead", async () => {
    script.d_l = [
      () => leadAsked("planner", planned(ASKS_WHERE), "One question first."),
    ];
    script.d_p = [() => ({ output: planned(READY) })];
    await start("Make me a Halloween theme");
    await nextIs("question");
    reply("just save it");
    await nextIs("ready");
    expect(leadRuns()).toHaveLength(1);
    expect(plannerRuns()[0].prompt).toContain("just save it");
  });

  test("Decide for me: the Planner picks, and the plan can be built", async () => {
    script.d_l = [
      () => leadAsked("planner", planned(ASKS_WHERE), "One question first."),
    ];
    script.d_p = [
      () => ({ output: planned(READY, "I picked: just save it.") }),
    ];
    await start("Make me a Halloween theme");
    await nextIs("question");
    fireEvent.click(
      within(nextBox()).getByRole("button", {
        name: "Decide for me and finish the plan",
      }),
    );
    await nextIs("ready");
    expect(plannerRuns()[0].prompt).toMatch(/decide for them/);
    expect(screen.getByTestId("ask-step")).toHaveTextContent(
      "Asked the Planner to decide and finish the plan",
    );
  });

  test("the chat's taps go to the Planner too", async () => {
    script.d_l = [
      () => leadAsked("planner", planned(ASKS_WHERE), "One question first."),
    ];
    script.d_p = [() => ({ output: planned(READY) })];
    await start("Make me a Halloween theme");
    await nextIs("question");
    const taps = await screen.findByTestId("workspace-plan-questions");
    fireEvent.click(
      within(taps).getByRole("button", { name: "Just save the theme" }),
    );
    await nextIs("ready");
    expect(leadRuns()).toHaveLength(1);
    // Ready: Yes is in the chat as well.
    expect(
      within(screen.getByTestId("ask-step")).getByTestId(
        "workspace-plan-choices",
      ),
    ).toBeInTheDocument();
  });
});

describe("when the Planner doesn't move it on", () => {
  test("no new plan: never silence — Ask again, Decide for me, Start over", async () => {
    script.d_l = [
      () => leadAsked("planner", planned(ASKS_WHERE), "One question first."),
    ];
    script.d_p = [
      () => ({ output: "Sure, I'll keep it in mind." }),
      (prompt) => ({ output: planned(READY), prompt }),
    ];
    await start("Make me a Halloween theme");
    await nextIs("question");
    fireEvent.click(
      within(nextBox()).getByRole("button", { name: "Just save the theme" }),
    );
    await nextIs("nothing");
    expectAWayOn();
    expect(nextBox()).toHaveTextContent("It still asks");
    fireEvent.click(
      within(nextBox()).getByRole("button", { name: "Ask again" }),
    );
    await nextIs("ready");
    // The same request, again.
    expect(plannerRuns()[1].prompt).toBe(plannerRuns()[0].prompt);
  });

  test("the Planner is paused: it says so, and offers a way on", async () => {
    script.d_l = [
      () => leadAsked("planner", planned(ASKS_WHERE), "One question first."),
    ];
    script.d_p = [() => ({ skipped: true, reason: "the Planner is paused" })];
    await start("Make me a Halloween theme");
    await nextIs("question");
    fireEvent.click(
      within(nextBox()).getByRole("button", { name: "Just save the theme" }),
    );
    await nextIs("nothing");
    expectAWayOn();
  });

  test("Start the plan over asks the Planner from your first words", async () => {
    script.d_l = [
      () => leadAsked("planner", planned(ASKS_WHERE), "One question first."),
    ];
    script.d_p = [
      () => ({ output: "Hmm." }),
      () => ({ output: planned(READY) }),
    ];
    await start("Make me a Halloween theme");
    await nextIs("question");
    fireEvent.click(
      within(nextBox()).getByRole("button", { name: "Just save the theme" }),
    );
    await nextIs("nothing");
    fireEvent.click(
      within(nextBox()).getByRole("button", { name: "Start the plan over" }),
    );
    await nextIs("ready");
    expect(plannerRuns()[1].prompt).toContain("Make me a Halloween theme");
    expect(plannerRuns()[1].prompt).toMatch(/from the start/);
  });

  test("several questions: pick each, then Send answers", async () => {
    const two = {
      ...ASKS_WHERE,
      questions: [
        { question: "Which mood?", options: ["Spooky", "Cute"] },
        { question: "Where?", options: ["Just save it", "My Calendar"] },
      ],
    };
    script.d_l = [() => leadAsked("planner", planned(two), "Two questions.")];
    script.d_p = [() => ({ output: planned(READY) })];
    await start("Make me a Halloween theme");
    await nextIs("question");
    const send = within(nextBox()).getByRole("button", {
      name: "Send answers",
    });
    expect(send).toBeDisabled();
    fireEvent.click(within(nextBox()).getByRole("button", { name: "Spooky" }));
    fireEvent.click(
      within(nextBox()).getByRole("button", { name: "Just save it" }),
    );
    fireEvent.click(send);
    await nextIs("ready");
    expect(plannerRuns()[0].prompt).toContain("Which mood? — Spooky");
    expect(plannerRuns()[0].prompt).toContain("Where? — Just save it");
  });
});

describe("saying yes", () => {
  test('a typed "yes build it" builds a ready plan', async () => {
    script.d_l = [() => leadAsked("planner", planned(READY), "Make it?")];
    await start("Make me a Halloween theme");
    await nextIs("ready");
    reply("yes build it");
    await waitFor(() =>
      expect(window.mainApi.bots.startPlanBuild).toHaveBeenCalled(),
    );
    expect(leadRuns()).toHaveLength(1);
  });

  test('"yes but make it purple" is a change: it goes to the lead', async () => {
    script.d_l = [
      () => leadAsked("planner", planned(READY), "Make it?"),
      () => leadAsked("planner", planned(READY), "Purple it is."),
    ];
    await start("Make me a Halloween theme");
    await nextIs("ready");
    reply("yes but make it purple");
    await waitFor(() => expect(leadRuns()).toHaveLength(2));
    expect(window.mainApi.bots.startPlanBuild).not.toHaveBeenCalled();
    expect(leadRuns()[1].prompt).toContain("yes but make it purple");
  });

  test("a step that failed: Try again from the card", async () => {
    script.d_l = [() => leadAsked("planner", planned(READY), "Make it?")];
    await start("Make me a Halloween theme");
    await nextIs("ready");
    fireEvent.click(within(nextBox()).getByRole("button", { name: /^Yes/ }));
    await nextIs("build");
    sendBuild({
      status: "finished-with-problems",
      steps: [
        THEME_STEP("failed", {
          error: "couldn't write your themes file",
          canRetry: true,
        }),
      ],
    });
    const retry = await within(nextBox()).findByRole("button", {
      name: "Try again",
    });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(window.mainApi.bots.retryPlanBuild).toHaveBeenCalledWith(
        "build_1",
        "s1",
      ),
    );
    expect(
      within(nextBox()).getByRole("button", { name: "Leave it off" }),
    ).toBeInTheDocument();
  });
});

describe("the lead goes off script", () => {
  test("the lead asks the Builder, which made nothing: not an output; the plan still has its way on", async () => {
    script.d_l = [
      () => leadAsked("planner", planned(READY), "Make it?"),
      () =>
        leadAsked(
          "builder",
          "I haven't created anything. I can't save themes from here.",
          "The Builder didn't make it.",
        ),
    ];
    await start("Make me a Halloween theme");
    await nextIs("ready");
    reply("can the builder do it?");
    await waitFor(() => expect(leadRuns()).toHaveLength(2));
    await nextIs("ready");
    expect(within(side()).queryAllByTestId("workspace-output")).toHaveLength(0);
    expectAWayOn();
  });

  test("the lead answers without asking the Planner: the plan is kept, Yes still there", async () => {
    script.d_l = [
      () => leadAsked("planner", planned(READY), "Make it?"),
      () => ({ output: "Say the word and I'll build it." }),
    ];
    await start("Make me a Halloween theme");
    await nextIs("ready");
    reply("what colors are in it?");
    await waitFor(() => expect(leadRuns()).toHaveLength(2));
    await nextIs("ready");
    expectAWayOn();
  });
});

test("the conversation is saved with the app's hand-off and its plan", async () => {
  script.d_l = [
    () => leadAsked("planner", planned(ASKS_WHERE), "One question first."),
  ];
  script.d_p = [() => ({ output: planned(READY) })];
  await start("Make me a Halloween theme");
  await nextIs("question");
  fireEvent.click(
    within(nextBox()).getByRole("button", { name: "Just save the theme" }),
  );
  await nextIs("ready");
  await waitFor(() => {
    const last = saved
      .filter((e) => e.conversation && e.conversation.messages)
      .pop();
    const steps = (last ? last.conversation.messages : []).filter(
      (m) => m.who === "step",
    );
    expect(steps.some((s) => s.direct && s.plan)).toBe(true);
  });
});

describe("stopping and coming back", () => {
  test("Stop while the Planner finishes the plan: it stops, and the card offers a way on", async () => {
    let release = null;
    script.d_l = [
      () => leadAsked("planner", planned(ASKS_WHERE), "One question first."),
    ];
    script.d_p = [
      () => ({
        hang: new Promise((resolve) => {
          release = () => resolve({ status: "stopped", output: "" });
        }),
      }),
    ];
    window.mainApi.bots.stop = jest.fn(async (id) => {
      if (id === "d_p" && release) release();
      return { ok: true };
    });
    await start("Make me a Halloween theme");
    await nextIs("question");
    fireEvent.click(
      within(nextBox()).getByRole("button", { name: "Just save the theme" }),
    );
    await nextIs("waiting");
    fireEvent.click(within(nextBox()).getByRole("button", { name: "Stop" }));
    await nextIs("nothing");
    expect(window.mainApi.bots.stop).toHaveBeenCalledWith("d_p");
    expectAWayOn();
  });

  test("a conversation saved stuck on its question (as Halloween was) reopens with a way on", async () => {
    window.mainApi.bots.listCreateRecent = jest.fn(async () => [
      {
        id: "conv_h",
        kind: "question",
        title: "Make me a Halloween theme",
        with: "role:dashlead",
        updatedAt: "2026-10-31T09:00:00Z",
      },
    ]);
    window.mainApi.bots.getCreateRecent = jest.fn(async () => ({
      id: "conv_h",
      prompt: "Make me a Halloween theme",
      conversation: {
        recipient: { role: "dashlead", roleName: "Dash Lead" },
        messages: [
          { who: "you", text: "Make me a Halloween theme" },
          {
            who: "step",
            id: "1:t1",
            bot: "the Planner",
            label: "Asked the Planner",
            status: "done",
            answer: "Here's the plan.",
            result: "Here's the plan.",
            plan: ASKS_WHERE,
          },
          { who: "role", by: "Dash Lead", text: "One question first." },
          { who: "you", text: "yes build it" },
          {
            who: "role",
            by: "Dash Lead",
            text: "Press Build on the plan to save it.",
          },
        ],
      },
    }));
    script.d_p = [() => ({ output: planned(READY) })];
    render(
      <LeadWorkspace request={{ key: "role:dashlead" }} onClose={jest.fn()} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Make me a Halloween theme/ }),
    );
    await nextIs("question");
    expectAWayOn();
    fireEvent.click(
      within(nextBox()).getByRole("button", { name: "Just save the theme" }),
    );
    await nextIs("ready");
    expect(leadRuns()).toHaveLength(0);
  });
});

test("a dashboard plan that needs a provider: Yes is there, and Before it builds says what to connect", async () => {
  const dash = {
    summary: "A home dashboard",
    pieces: [
      {
        kind: "widget",
        name: "Lights panel",
        source: "new",
        providers: ["homeassistant"],
      },
      { kind: "layout", name: "Home", source: "new" },
    ],
    beforeBuilding: [{ kind: "connect", what: "Home Assistant" }],
  };
  script.d_l = [() => leadAsked("planner", planned(dash), "Build it?")];
  await start("A dashboard for my smart home");
  await nextIs("ready");
  expectAWayOn();
  expect(within(side()).getByTestId("workspace-before")).toHaveTextContent(
    /Connect Homeassistant/i,
  );
});

describe("review fixes", () => {
  test("reopened with the Planner's hand-off still marked working (after a restart): stopped, never spinning", async () => {
    window.mainApi.bots.listCreateRecent = jest.fn(async () => [
      {
        id: "conv_r",
        kind: "question",
        title: "Make me a Halloween theme",
        with: "role:dashlead",
        updatedAt: "2026-10-31T09:00:00Z",
      },
    ]);
    window.mainApi.bots.getCreateRecent = jest.fn(async () => ({
      id: "conv_r",
      prompt: "Make me a Halloween theme",
      conversation: {
        recipient: { role: "dashlead", roleName: "Dash Lead" },
        messages: [
          { who: "you", text: "Make me a Halloween theme" },
          {
            who: "step",
            id: "1:t1",
            bot: "the Planner",
            label: "Asked the Planner",
            status: "done",
            answer: "Here's the plan.",
            plan: ASKS_WHERE,
          },
          { who: "role", by: "Dash Lead", text: "One question first." },
          { who: "you", text: "Just save the theme" },
          {
            who: "step",
            id: "2:planner",
            bot: "the Planner",
            label: "Sent your answer to the Planner",
            request: "The user answered…",
            status: "asking",
            direct: true,
          },
        ],
      },
    }));
    script.d_p = [() => ({ output: planned(READY) })];
    render(
      <LeadWorkspace request={{ key: "role:dashlead" }} onClose={jest.fn()} />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Make me a Halloween theme/ }),
    );
    await nextIs("nothing");
    expectAWayOn();
    // Ask again sends the same answer.
    fireEvent.click(
      within(nextBox()).getByRole("button", { name: "Ask again" }),
    );
    await nextIs("ready");
    expect(plannerRuns()[0].prompt).toBe("The user answered…");
  });

  test("switched away while the Planner answers, and back: its answer still arrives", async () => {
    let release = null;
    window.mainApi.bots.listCreateRecent = jest.fn(async () => [
      {
        id: "conv_1",
        kind: "question",
        title: "Make me a Halloween theme",
        with: "role:dashlead",
        updatedAt: "2026-10-31T09:00:00Z",
      },
    ]);
    script.d_l = [
      () => leadAsked("planner", planned(ASKS_WHERE), "One question first."),
    ];
    script.d_p = [
      () => ({
        hang: new Promise((resolve) => {
          release = () =>
            resolve({ status: "completed", output: planned(READY) });
        }),
      }),
    ];
    await start("Make me a Halloween theme");
    await nextIs("question");
    fireEvent.click(
      within(nextBox()).getByRole("button", { name: "Just save the theme" }),
    );
    await nextIs("waiting");
    // What was saved while it ran is what a reopened copy loads.
    await waitFor(() =>
      expect(
        saved.some(
          (e) =>
            e.conversation &&
            (e.conversation.messages || []).some((m) => m.direct),
        ),
      ).toBe(true),
    );
    const last = saved
      .filter((e) => e.conversation && e.conversation.messages)
      .pop();
    window.mainApi.bots.getCreateRecent = jest.fn(async () => ({
      id: "conv_1",
      prompt: "Make me a Halloween theme",
      conversation: {
        recipient: { role: "dashlead", roleName: "Dash Lead" },
        messages: last.conversation.messages,
      },
    }));
    // Away (a new conversation), then back.
    fireEvent.click(screen.getByRole("button", { name: "+ New conversation" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Make me a Halloween theme/ }),
    );
    await nextIs("waiting");
    await act(async () => {
      release();
    });
    await nextIs("ready");
  });

  test("the plan has gaps: Ask the Planner to fix it, from the card", async () => {
    const broken = { summary: "x", pieces: [{ kind: "widget" }] };
    script.d_l = [() => leadAsked("planner", planned(broken), "A plan.")];
    script.d_p = [() => ({ output: planned(READY) })];
    await start("Make me a Halloween theme");
    await nextIs("gaps");
    expectAWayOn();
    fireEvent.click(
      within(nextBox()).getByRole("button", {
        name: "Ask the Planner to fix it",
      }),
    );
    await nextIs("ready");
    expect(plannerRuns()[0].prompt).toMatch(/What's missing:/);
  });
});

test("the plan arrives while the lead is still writing: the card waits — no taps that can't go through", async () => {
  let finish = null;
  script.d_l = [
    () => ({
      ...leadAsked("planner", planned(ASKS_WHERE), "One question first."),
      after: new Promise((resolve) => {
        finish = resolve;
      }),
    }),
  ];
  script.d_p = [() => ({ output: planned(READY) })];
  await start("Make me a Halloween theme");
  await nextIs("answering");
  expect(
    within(nextBox()).queryByRole("button", { name: "Just save the theme" }),
  ).toBeNull();
  expect(nextBox()).toHaveTextContent("is answering");
  await act(async () => {
    finish();
  });
  await nextIs("question");
  fireEvent.click(
    within(nextBox()).getByRole("button", { name: "Just save the theme" }),
  );
  await nextIs("ready");
  expect(plannerRuns()).toHaveLength(1);
});
