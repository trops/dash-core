/**
 * CreatePlanStep — planning a dashboard with the Planner (create-entry
 * CRE-003 AC1/AC5, CRE-012 AC1/AC2; phase 4a).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  CreatePlanStep,
  withoutPlan,
  isTypeItOption,
  pieceMeta,
} from "./CreatePlanStep";

// The Providers screen (Connect, phase 4b) pulls in the whole app.
jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: (props) => (
    <div data-testid="providers-section">
      {String(props.initialProviderType)}
    </div>
  ),
}));

const team = [
  {
    id: "b_planner",
    role: "planner",
    name: "Planner",
    runsOn: "claude-opus-4-8",
    providerId: "claude-code",
  },
  {
    id: "b_builder",
    role: "builder",
    name: "Builder",
    runsOn: "claude-sonnet-4-6",
    providerId: "claude-code",
  },
  {
    id: "b_checker",
    role: "checker",
    name: "Checker",
    runsOn: "claude-sonnet-4-6",
    providerId: "claude-code",
  },
];

const askFirst = {
  status: "completed",
  model: "claude-opus-4-8",
  usage: { inputTokens: 5000, outputTokens: 1000 },
  cost: { usd: 0, includedInPlan: true, estimated: false },
  output: `A couple of questions first.
<plan>{"summary":"An Algolia search widget","questions":[{"question":"Which index?","options":["products","docs"]}],"pieces":[],"estimate":{"build":"?"}}</plan>`,
};
const thePlan = {
  status: "completed",
  model: "claude-opus-4-8",
  usage: { inputTokens: 2000, outputTokens: 300 },
  cost: { usd: 0, includedInPlan: true, estimated: false },
  output: `Here's the plan.
<plan>{"summary":"Install Algolia Search","pieces":[{"kind":"widget","name":"Algolia Search","source":"registry","package":"@trops/algolia","providers":["algolia"]},{"kind":"widget","name":"Hits chart","source":"new"},{"kind":"bot","name":"Digest","source":"new","providers":["gmail"],"instructions":"Email me a digest of new hits."}],"beforeBuilding":[{"kind":"install","what":"@trops/algolia"},{"kind":"connect","what":"Gmail"}],"checks":["Search returns results"],"access":["Bots can read Gmail","None can send email"],"estimate":{"build":"small","running":"about $0.04 per run"}}</plan>`,
};

function setup(records, props = {}) {
  const queue = [...records];
  const listeners = [];
  window.mainApi = {
    bots: {
      listDashTeam: jest.fn().mockResolvedValue(team),
      onStream: jest.fn((cb) => {
        listeners.push(cb);
        return listeners.length;
      }),
      removeListener: jest.fn(),
      run: jest.fn(async (botId) => {
        // A hand-off shows up as a tool call on the Planner's stream.
        listeners.forEach((cb) =>
          cb({
            botId,
            event: {
              type: "tool_call",
              name: "mcp__bot-mcp__ask_role",
              input: { role: "scout" },
            },
          }),
        );
        return queue.shift();
      }),
    },
  };
  render(<CreatePlanStep prompt="an Algolia search widget" {...props} />);
  return window.mainApi.bots;
}

afterEach(() => {
  delete window.mainApi;
});

test("the Planner's questions become buttons; an answer continues its session", async () => {
  const api = setup([askFirst, thePlan]);
  expect(await screen.findByTestId("plan-questions")).toBeInTheDocument();
  expect(api.run).toHaveBeenCalledWith(
    "b_planner",
    "an Algolia search widget",
    false,
  );
  expect(
    screen.getByText("Planner asked the Scout…", { exact: false }),
  ).toBeInTheDocument();
  expect(screen.getByText("A couple of questions first.")).toBeInTheDocument();
  fireEvent.click(screen.getByText("products"));
  await screen.findByTestId("plan-card");
  expect(api.run).toHaveBeenLastCalledWith(
    "b_planner",
    "Which index? — products",
    true,
  );
});

test("the plan card: pieces by group and source, before building, access, estimate", async () => {
  setup([thePlan]);
  const card = await screen.findByTestId("plan-card");
  expect(card).toHaveTextContent("Install Algolia Search");
  // Source is a coloured pill above each name (design guide rule 12).
  expect(screen.getByText("From the registry")).toHaveAttribute(
    "data-state",
    "info",
  );
  // "New" says what it makes.
  expect(screen.getByText("New widget")).toHaveAttribute(
    "data-state",
    "closed",
  );
  expect(screen.getByText("New bot")).toHaveAttribute("data-state", "closed");
  // Titled section cards (design guide rule 3).
  expect(screen.getByTestId("plan-pieces")).toHaveTextContent("What it makes");
  expect(screen.getByTestId("plan-expect")).toHaveTextContent("What to expect");
  expect(screen.getByText("Bots")).toBeInTheDocument();
  expect(screen.getByTestId("plan-before")).toHaveTextContent(
    "Install Algolia Search@trops/algolia",
  );
  expect(screen.getByTestId("plan-before")).toHaveTextContent("Connect Gmail");
  expect(screen.getByTestId("plan-access")).toHaveTextContent(
    "None can send email",
  );
  const est = screen.getByTestId("plan-estimate");
  // new widget 20k+6k, registry 4k (checker), bot 4k → builder 24k, checker 10k
  expect(est).toHaveTextContent("Builder (Sonnet) ~24.0k");
  expect(est).toHaveTextContent("Checker (Sonnet) ~10.0k");
  expect(est).toHaveTextContent("planning so far 2.3k");
  expect(est).toHaveTextContent("included in your plan");
  expect(est).toHaveTextContent("To run: about $0.04 per run");
  expect(card).toHaveTextContent(
    "Saved · nothing has been built or installed yet.",
  );
});

test("a paused Planner says so", async () => {
  window.mainApi = {
    bots: {
      listDashTeam: jest.fn().mockResolvedValue([{ ...team[0], paused: true }]),
      onStream: jest.fn(() => 1),
      removeListener: jest.fn(),
      run: jest.fn(),
    },
  };
  render(<CreatePlanStep prompt="x" />);
  expect(
    await screen.findByText(
      /The Planner is paused\. Turn it on in the Bots page › Dash team/,
    ),
  ).toBeInTheDocument();
  expect(window.mainApi.bots.run).not.toHaveBeenCalled();
  expect(screen.queryByTestId("planner-busy")).toBeNull();
});

test("a busy Planner says it's busy — never 'turn it on' — and can be stopped", async () => {
  const stop = jest.fn().mockResolvedValue({});
  window.mainApi = {
    bots: {
      listDashTeam: jest.fn().mockResolvedValue([team[0]]),
      onStream: jest.fn(() => 1),
      removeListener: jest.fn(),
      run: jest.fn().mockResolvedValue({
        skipped: true,
        reason: "a run is already in progress",
      }),
      stop,
    },
  };
  render(<CreatePlanStep prompt="x" />);
  expect(
    await screen.findByText(
      /The Planner is still working on an earlier request — it may be waiting/,
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Turn the Planner on/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Stop the Planner" }));
  await waitFor(() => expect(stop).toHaveBeenCalledWith(team[0].id));
  await waitFor(() => expect(screen.queryByTestId("planner-busy")).toBeNull());
});

test("Enter sends a typed reply", async () => {
  const api = setup([askFirst, thePlan]);
  await screen.findByTestId("plan-questions");
  const box = screen.getByRole("textbox", { name: "Reply to the Planner" });
  fireEvent.change(box, { target: { value: "Use the docs index" } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() =>
    expect(api.run).toHaveBeenLastCalledWith(
      "b_planner",
      "Use the docs index",
      true,
    ),
  );
});

test("withoutPlan strips the plan block", () => {
  expect(withoutPlan('Hi <plan>{"a":1}</plan>')).toBe("Hi");
});

test("several questions: taps mark answers, Send answers sends them together", async () => {
  const two = {
    ...askFirst,
    output:
      'Two questions.<plan>{"summary":"s","questions":[{"question":"Which dashboard?","options":["Mail","New"]},{"question":"Which widget?","options":["Search","Direct"]}],"pieces":[],"estimate":{"build":"?"}}</plan>',
  };
  const api = setup([two, thePlan]);
  await screen.findByTestId("plan-questions");
  fireEvent.click(screen.getByText("Mail"));
  expect(api.run).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Direct"));
  expect(screen.getByText(/2 of 2 answered/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Send answers"));
  await screen.findByTestId("plan-card");
  expect(api.run).toHaveBeenLastCalledWith(
    "b_planner",
    "Which dashboard? — Mail\nWhich widget? — Direct",
    true,
  );
  // "Install @trops/algolia" isn't repeated as "Install Install …".
  expect(screen.getByTestId("plan-before")).not.toHaveTextContent(
    "Install Install",
  );
});

// Screen audit (October 2026), 2b: question cards take a typed answer, and an
// "I'll type it" option puts the cursor there instead of answering.
const repoQuestion = (options) => ({
  ...askFirst,
  output: `One question.<plan>{"summary":"s","questions":[{"question":"Which repository?","options":${JSON.stringify(options)}}],"pieces":[],"estimate":{"build":"?"}}</plan>`,
});

test("a question without options is answered by typing; Enter sends it", async () => {
  const api = setup([repoQuestion([]), thePlan]);
  await screen.findByTestId("plan-questions");
  const field = screen.getByLabelText("Your answer: Which repository?");
  expect(field).toHaveAttribute("placeholder", "Type an answer…");
  fireEvent.change(field, { target: { value: "acme/api" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await screen.findByTestId("plan-card");
  expect(api.run).toHaveBeenLastCalledWith(
    "b_planner",
    "Which repository? — acme/api",
    true,
  );
});

test('an "I\'ll type it" option focuses the field instead of answering', async () => {
  const api = setup([repoQuestion(["acme/web", "I'll type it"]), thePlan]);
  await screen.findByTestId("plan-questions");
  fireEvent.click(screen.getByText("I'll type it"));
  expect(api.run).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(
    screen.getByLabelText("Your answer: Which repository?"),
  );
});

test("several questions: the tapped option shows as chosen; typed answers count and are sent", async () => {
  const two = {
    ...askFirst,
    output:
      'Two.<plan>{"summary":"s","questions":[{"question":"Which repo?","options":["acme/web"]},{"question":"When?","options":["9:00","10:00"]}],"pieces":[],"estimate":{"build":"?"}}</plan>',
  };
  const api = setup([two, thePlan]);
  await screen.findByTestId("plan-questions");
  const nine = screen.getByText("9:00");
  fireEvent.click(nine);
  expect(nine).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("10:00")).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByText(/1 of 2 answered/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Your answer: Which repo?"), {
    target: { value: "acme/api" },
  });
  expect(screen.getByText(/2 of 2 answered/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Send answers"));
  await screen.findByTestId("plan-card");
  expect(api.run).toHaveBeenLastCalledWith(
    "b_planner",
    "Which repo? — acme/api\nWhen? — 9:00",
    true,
  );
});

test("isTypeItOption and pieceMeta", () => {
  for (const o of [
    "I'll type it",
    "Let me type it",
    "Other",
    "Something else",
    "I'll write my own",
  ])
    expect(isTypeItOption(o)).toBe(true);
  for (const o of ["acme/web", "Every weekday", "Typescript", "9:00"])
    expect(isTypeItOption(o)).toBe(false);
  expect(pieceMeta({ kind: "layout", name: "PR Review", source: "new" })).toBe(
    "New dashboard layout",
  );
  expect(
    pieceMeta({
      kind: "widget",
      package: "@trops/git-hub",
      notes: "From the starter",
    }),
  ).toBe("@trops/git-hub · From the starter");
});

test("Build waits until the Planner's questions are answered (Create build fixes 2)", async () => {
  const both = {
    ...thePlan,
    output:
      'Almost.<plan>{"summary":"s","questions":[{"question":"Which index?","options":["products"]}],"pieces":[{"kind":"widget","name":"Rules","source":"yours","package":"@trops/algolia"}],"estimate":{"build":"small"}}</plan>',
  };
  setup([both]);
  const note = await screen.findByTestId("plan-ready");
  expect(note).toHaveTextContent("Answer the Planner's questions first.");
  expect(note.parentElement.querySelector("button")).toBeDisabled();
});

test("with no questions left, Build is ready", async () => {
  setup([thePlan]);
  const note = await screen.findByTestId("plan-ready");
  expect(note.parentElement.querySelector("button")).not.toBeDisabled();
});

// Phase 1b: a plan with errors can't be built — they're shown, not grey.
test("a plan with errors can't be built; the errors are shown", async () => {
  const broken = {
    ...thePlan,
    output:
      'Here.<plan>{"summary":"s","pieces":[{"kind":"widget","name":"Rules","source":"yours"}],"estimate":{"build":"small"}}</plan>',
  };
  setup([broken]);
  const note = await screen.findByTestId("plan-ready");
  expect(note.parentElement.querySelector("button")).toBeDisabled();
  expect(note).toHaveTextContent("Ask the Planner to fix the plan first.");
  const errors = screen.getByTestId("plan-errors");
  expect(errors).toHaveTextContent(/must say which package/);
  expect(errors).toHaveClass("text-red-500");
});

test("Ask the Planner to fix it sends it the plan's errors", async () => {
  const broken = {
    ...thePlan,
    output:
      'Here.<plan>{"summary":"s","pieces":[{"kind":"widget","name":"Rules","source":"yours"}],"estimate":{"build":"small"}}</plan>',
  };
  const api = setup([broken, thePlan]);
  fireEvent.click(
    await screen.findByRole("button", { name: "Ask the Planner to fix it" }),
  );
  await waitFor(() =>
    expect(api.run).toHaveBeenLastCalledWith(
      "b_planner",
      expect.stringMatching(/fix these problems[\s\S]*must say which package/),
      true,
    ),
  );
});

test("a plan the app refuses to build shows why, in red", async () => {
  const simple = {
    ...thePlan,
    output:
      'Here.<plan>{"summary":"s","pieces":[{"kind":"widget","name":"Rules","source":"yours","package":"@trops/algolia"}],"estimate":{"build":"small"}}</plan>',
  };
  const api = setup([simple]);
  api.startPlanBuild = jest.fn().mockResolvedValue({
    error:
      "The plan can't be built yet: The \"Sales\" dashboard isn't there any more.",
  });
  const note = await screen.findByTestId("plan-ready");
  fireEvent.click(note.parentElement.querySelector("button"));
  await waitFor(() =>
    expect(screen.getByTestId("plan-ready")).toHaveTextContent(
      /isn't there any more/,
    ),
  );
  expect(screen.getByTestId("plan-ready")).toHaveClass("text-red-500");
});

describe("plan on the left, chat on the right (Create build fixes 2)", () => {
  const both = {
    ...thePlan,
    output:
      'Almost.<plan>{"summary":"s","questions":[{"question":"Which index?","options":["products"]}],"pieces":[{"kind":"widget","name":"Rules","source":"yours","package":"@trops/algolia"}],"estimate":{"build":"small"}}</plan>',
  };

  test("once there's a plan, it has its own column beside the chat", async () => {
    setup([thePlan]);
    const planCol = await screen.findByTestId("plan-column");
    const chatCol = screen.getByTestId("chat-column");
    expect(planCol).toContainElement(screen.getByTestId("plan-card"));
    expect(chatCol).toContainElement(screen.getByTestId("planner-message"));
    expect(chatCol).toContainElement(
      screen.getByRole("textbox", { name: "Reply to the Planner" }),
    );
    expect(planCol).not.toContainElement(screen.getByTestId("planner-message"));
  });

  test("before a plan, the chat is one column", async () => {
    setup([askFirst]);
    await screen.findByTestId("plan-questions");
    expect(screen.queryByTestId("plan-column")).toBeNull();
  });

  test("the Planner's questions end the chat's one scroll area, above the reply box", async () => {
    setup([both]);
    const qs = await screen.findByTestId("plan-questions");
    const foot = screen.getByTestId("chat-foot");
    const scroller = screen.getByTestId("chat-scroll");
    expect(screen.getByTestId("chat-column")).toContainElement(scroller);
    expect(scroller).toContainElement(qs);
    expect(scroller.textContent.trim().endsWith(qs.textContent.trim())).toBe(
      true,
    );
    expect(foot).not.toContainElement(qs);
    expect(foot).toContainElement(
      screen.getByRole("textbox", { name: "Reply to the Planner" }),
    );
    expect(screen.getByTestId("plan-column")).not.toContainElement(qs);
  });

  test("the plan and the chat get equal widths", async () => {
    setup([thePlan]);
    const planCol = await screen.findByTestId("plan-column");
    const chatCol = screen.getByTestId("chat-column");
    for (const col of [planCol, chatCol]) {
      expect(col).toHaveClass("flex-1");
      expect(col).toHaveClass("min-w-0");
      expect(col.style.width).toBe("");
    }
  });

  test("in the dock, the chat opens on its newest message", async () => {
    const set = jest.spyOn(Element.prototype, "scrollTop", "set");
    const tall = jest
      .spyOn(Element.prototype, "scrollHeight", "get")
      .mockReturnValue(900);
    try {
      setup([both], { compact: true });
      await screen.findByTestId("chat-foot");
      const scroller = screen.getByTestId("chat-scroll");
      expect(
        set.mock.contexts.some((el) => el === scroller) &&
          set.mock.calls.some(([v]) => v === 900),
      ).toBe(true);
    } finally {
      set.mockRestore();
      tall.mockRestore();
    }
  });

  test("the dock stays one column, one scroll area, the questions at its end", async () => {
    setup([both], { compact: true });
    const qs = await screen.findByTestId("plan-questions");
    const foot = screen.getByTestId("chat-foot");
    const scroller = screen.getByTestId("chat-scroll");
    expect(screen.queryByTestId("plan-column")).toBeNull();
    expect(scroller).toContainElement(qs);
    expect(scroller).toContainElement(screen.getByTestId("plan-card"));
    expect(scroller.textContent.trim().endsWith(qs.textContent.trim())).toBe(
      true,
    );
    expect(foot).not.toContainElement(qs);
  });
});
