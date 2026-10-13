/**
 * CreateModal — one place to start making things (create-entry PRD CRE-001,
 * CRE-005, CRE-008).
 *
 * Pins: the start screen (heading, prompt with the cursor, Type and AI menus),
 * Send/Enter for a widget (opens the Widget Builder with the prompt) and a bot
 * (the bot form with the prompt as instructions, saved through mainApi.bots),
 * the no-AI row, the no-AI-set-up state, and the AI picker writing the shared
 * setting.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { CreateModal } from "./CreateModal";
import { setWidgetBuilderRenderer } from "../../utils/widgetBuilderRenderer";

// The Providers screen (Connect, phase 4b) pulls in the whole app.
jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: (props) => (
    <div data-testid="providers-section">
      {String(props.initialProviderType)}
    </div>
  ),
}));

jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: () => null },
}));
jest.mock("../Settings/details/BotDetail", () => ({
  BotDetail: ({ bot, defaultWorkspaceId, onSave, onCancel }) => (
    <div data-testid="bot-form">
      <span data-testid="bot-instructions">
        {bot ? bot.instructions : "(blank)"}
      </span>
      <span data-testid="bot-workspace">{String(defaultWorkspaceId)}</span>
      <button onClick={() => onSave({ name: "Inbox bot" })}>Create bot</button>
      <button onClick={onCancel}>Cancel form</button>
    </div>
  ),
}));

const ANTHROPIC = {
  "Anthropic (AI Assistant)": {
    type: "anthropic",
    providerClass: "credential",
  },
};

function setup({
  cli = true,
  drafts = [],
  recent = [],
  providers = {},
  settings = {},
  props = {},
} = {}) {
  window.mainApi = {
    llm: { checkCliAvailable: jest.fn().mockResolvedValue({ available: cli }) },
    drafts: { list: jest.fn().mockResolvedValue(drafts) },
    bots: {
      list: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue({ id: "b1", name: "Inbox bot" }),
      listCreateRecent: jest.fn().mockResolvedValue(recent),
      onCreateRecent: jest.fn(() => 9),
      removeListener: jest.fn(),
      removeCreateRecent: jest.fn().mockResolvedValue({ ok: true }),
      // A plan conversation (Expand from the dock, Fold — 4e-2).
      getCreateRecent: jest.fn().mockResolvedValue({
        id: "plan_9",
        prompt: "A greeter",
        conversation: {
          messages: [
            { who: "you", text: "A greeter" },
            { who: "planner", text: "Here is the plan." },
          ],
          plan: {
            summary: "Greet",
            pieces: [{ kind: "layout", name: "Greet", source: "new" }],
          },
        },
        build: null,
      }),
      saveCreateRecent: jest.fn().mockResolvedValue({ id: "plan_9" }),
    },
  };
  const changeSettings = jest.fn();
  const handlers = {
    setIsOpen: jest.fn(),
    onStartWithoutAi: jest.fn(),
    onBotCreated: jest.fn(),
    onOpenAiSettings: jest.fn(),
  };
  render(
    <ThemeContext.Provider value={{ currentTheme: {} }}>
      <AppContext.Provider value={{ providers, settings, changeSettings }}>
        <CreateModal open {...handlers} {...props} />
      </AppContext.Provider>
    </ThemeContext.Provider>,
  );
  return { ...handlers, changeSettings };
}

const promptBox = () =>
  screen.getByRole("textbox", { name: "What do you want to make?" });
const sendButton = () => screen.getByRole("button", { name: "Send" });

afterEach(() => {
  delete window.mainApi;
});

describe("CreateModal — start screen", () => {
  test("shows the heading, the prompt with the cursor, and Type: Widget", async () => {
    setup();
    expect(
      screen.getByText("What do you want to make?", { selector: "div" }),
    ).toBeInTheDocument();
    expect(promptBox()).toHaveFocus();
    expect(
      screen.getByRole("button", { name: /^Type: Widget/ }),
    ).toHaveAttribute("aria-haspopup", "menu");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^AI: Claude Code/ }),
      ).toBeInTheDocument(),
    );
  });

  test("Send is off until there's a prompt", async () => {
    setup();
    await screen.findByRole("button", { name: /^AI: Claude Code/ });
    expect(sendButton()).toBeDisabled();
    fireEvent.change(promptBox(), { target: { value: "Show my open PRs" } });
    expect(sendButton()).not.toBeDisabled();
  });

  test("Enter on a widget prompt opens the Widget Builder with it and closes", async () => {
    const { setIsOpen } = setup();
    await screen.findByRole("button", { name: /^AI: Claude Code/ });
    const onOpen = jest.fn();
    window.addEventListener("dash:open-widget-builder", onOpen);
    fireEvent.change(promptBox(), { target: { value: "  Show my open PRs " } });
    fireEvent.keyDown(promptBox(), { key: "Enter" });
    window.removeEventListener("dash:open-widget-builder", onOpen);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].detail).toEqual({
      prompt: "Show my open PRs",
    });
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  test("Shift+Enter doesn't send", async () => {
    setup();
    await screen.findByRole("button", { name: /^AI: Claude Code/ });
    const onOpen = jest.fn();
    window.addEventListener("dash:open-widget-builder", onOpen);
    fireEvent.change(promptBox(), { target: { value: "Show my PRs" } });
    fireEvent.keyDown(promptBox(), { key: "Enter", shiftKey: true });
    window.removeEventListener("dash:open-widget-builder", onOpen);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("start screen layout: a raised modal surface, titled sections, quiet header (screen audit)", () => {
    setup();
    const modal = screen.getByTestId("create-modal");
    expect(modal).toHaveClass("dr-modal-surface");
    expect(modal.firstChild).toHaveClass("dr-panel-head");
    expect(screen.getByTestId("create-no-ai")).toHaveTextContent(
      "Or start without AI",
    );
    expect(
      screen.getByRole("button", { name: /Blank dashboard/ }),
    ).toBeInTheDocument();
  });

  test("the no-AI row hands its choice to the host and closes", () => {
    const { onStartWithoutAi, setIsOpen } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Blank dashboard/ }));
    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(onStartWithoutAi).toHaveBeenCalledWith("blank-dashboard");
  });

  test("Widget adds registry / file / folder installs to the no-AI row", () => {
    setup();
    expect(
      screen.getByRole("button", { name: /Browse widgets in the registry/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Install a widget from file/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /New theme/ }),
    ).toBeInTheDocument();
  });
});

describe("CreateModal — AI", () => {
  test("with no AI set up, a widget can't be sent and the screen says so", async () => {
    const { onOpenAiSettings } = setup({ cli: false });
    await screen.findByText(/No AI is set up yet/);
    fireEvent.change(promptBox(), { target: { value: "Show my PRs" } });
    expect(sendButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Set up AI" }));
    expect(onOpenAiSettings).toHaveBeenCalled();
  });

  test("the AI picker writes the shared preferred-backend setting", async () => {
    const { changeSettings } = setup({
      providers: ANTHROPIC,
      settings: { aiAssistant: { model: "m1" } },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /^AI: Claude Code/ }),
    );
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /Anthropic API/ }),
    );
    expect(changeSettings).toHaveBeenCalledWith({
      aiAssistant: { model: "m1", preferredBackend: "anthropic" },
    });
  });
});

describe("CreateModal — Bot", () => {
  test("Send opens the bot form with the prompt as its instructions; Create saves it", async () => {
    const { onBotCreated, setIsOpen } = setup({
      cli: false,
      props: { initialType: "bot", workspaceId: 7 },
    });
    expect(
      screen.getByRole("button", { name: /^Type: Bot/ }),
    ).toBeInTheDocument();
    // A bot doesn't need the AI to be created — no AI picker, Send works.
    expect(screen.queryByRole("button", { name: /^AI:/ })).toBeNull();
    fireEvent.change(promptBox(), {
      target: { value: "Summarize my inbox at 9am" },
    });
    fireEvent.click(sendButton());
    expect(screen.getByTestId("bot-instructions")).toHaveTextContent(
      "Summarize my inbox at 9am",
    );
    expect(screen.getByTestId("bot-workspace")).toHaveTextContent("7");
    await act(async () => {
      fireEvent.click(screen.getByText("Create bot"));
    });
    expect(window.mainApi.bots.save).toHaveBeenCalledWith({
      name: "Inbox bot",
    });
    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(onBotCreated).toHaveBeenCalledWith({ id: "b1", name: "Inbox bot" });
  });

  test("Fill in the bot form opens a blank form; Back returns to the start", () => {
    setup({ props: { initialType: "bot" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Fill in the bot form/ }),
    );
    expect(screen.getByTestId("bot-instructions")).toHaveTextContent("(blank)");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(promptBox()).toBeInTheDocument();
  });

  test("Type menu switches to Bot", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /^Type: Widget/ }));
    const menu = screen.getByRole("menu", { name: "Type" });
    expect(
      within(menu).getByRole("menuitemradio", { name: /Dashboard/ }),
    ).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /^Bot/ }));
    expect(
      screen.getByRole("button", { name: /^Type: Bot/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Fill in the bot form/ }),
    ).toBeInTheDocument();
  });
});

describe("CreateModal — Recent (2c-2, 4e-1)", () => {
  const now = Date.now();
  const DRAFTS = [
    { id: "d1", name: "Tokyo clock", updatedAt: now - 5 * 60_000 },
    { id: "d2", name: "PR digest", updatedAt: now - 3 * 3_600_000 },
    { id: "d3", name: "", updatedAt: now - 2 * 86_400_000 },
    { id: "d4", name: "Oldest", updatedAt: now - 9 * 86_400_000 },
  ];
  const PLANS = [
    {
      id: "plan_1",
      title: "Morning Brief",
      status: "building",
      progress: { done: 3, total: 7 },
      tokens: 21000,
      updatedAt: new Date(now - 60_000).toISOString(),
    },
    {
      id: "plan_2",
      title: "Ask Test",
      status: "waiting",
      waitingFor: ["gmail"],
      updatedAt: new Date(now - 4 * 86_400_000).toISOString(),
    },
  ];

  test("two sections: questions & plans, then unfinished widgets (fix/recent-sections)", async () => {
    setup({ drafts: DRAFTS, recent: PLANS });
    const conv = await screen.findByTestId("recent-conversations");
    expect(conv).toHaveTextContent("Questions & plans");
    const convRows = [...conv.querySelectorAll('[data-testid="recent-row"]')];
    expect(convRows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(
        /Morning BriefBuilding 3\/7 · 21\.0k tokens · 1m ago/,
      ),
      expect.stringMatching(/Ask TestWaiting for Gmail · 4d ago/),
    ]);
    const dr = screen.getByTestId("recent-drafts");
    expect(dr).toHaveTextContent("Unfinished widgets");
    const drRows = [...dr.querySelectorAll('[data-testid="recent-row"]')];
    expect(drRows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Tokyo clockContinue in Widget Builder · 5m ago/),
      expect.stringMatching(/PR digestContinue in Widget Builder · 3h ago/),
      expect.stringMatching(
        /Untitled draftContinue in Widget Builder · 2d ago/,
      ),
    ]);
    // Drafts have no Remove here (the Widgets page handles drafts).
    expect(
      screen.queryByRole("button", { name: "Remove Tokyo clock from Recent" }),
    ).toBeNull();
  });

  test("a widget draft opens the Widget Builder on it and closes Create", async () => {
    const { setIsOpen } = setup({ drafts: DRAFTS });
    const onOpen = jest.fn();
    window.addEventListener("dash:open-widget-builder", onOpen);
    fireEvent.click(await screen.findByRole("button", { name: /Tokyo clock/ }));
    window.removeEventListener("dash:open-widget-builder", onOpen);
    expect(onOpen.mock.calls[0][0].detail).toEqual({ resumeDraftId: "d1" });
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  test("a plan can be removed from Recent, after a confirm; Recent follows changes", async () => {
    setup({ recent: PLANS });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Remove Morning Brief from Recent",
      }),
    );
    // Asks first (design guide rule 10); Keep it changes nothing.
    expect(screen.getByTestId("confirmation-modal")).toHaveTextContent(
      "Discard “Morning Brief”?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(window.mainApi.bots.removeCreateRecent).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Morning Brief from Recent" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(window.mainApi.bots.removeCreateRecent).toHaveBeenCalledWith(
      "plan_1",
    );
    expect(window.mainApi.bots.onCreateRecent).toHaveBeenCalled();
  });

  test("more than three drafts → All N drafts opens the Widgets page", async () => {
    const { onStartWithoutAi } = setup({ drafts: DRAFTS });
    fireEvent.click(
      await screen.findByRole("button", { name: "All 4 drafts" }),
    );
    expect(onStartWithoutAi).toHaveBeenCalledWith("widget-drafts");
  });

  test("nothing in Recent → no section", async () => {
    setup();
    await screen.findByRole("button", { name: /^AI: Claude Code/ });
    expect(screen.queryByTestId("create-recent")).toBeNull();
  });
});

describe("CreateModal — the Widget Builder inside Create (2c-3)", () => {
  const Builder = jest.fn(
    ({ initialPrompt, resumeDraftId, onClose, onTitle }) => (
      <div data-testid="builder">
        <span data-testid="builder-prompt">{String(initialPrompt)}</span>
        <span data-testid="builder-draft">{String(resumeDraftId)}</span>
        <button onClick={onClose}>builder done</button>
        <button onClick={() => onTitle("Unread mail")}>name it</button>
      </div>
    ),
  );

  beforeEach(() => {
    Builder.mockClear();
    setWidgetBuilderRenderer(Builder);
  });
  afterEach(() => setWidgetBuilderRenderer(null));

  const sendWidget = async (text) => {
    await screen.findByRole("button", { name: /^AI: Claude Code/ });
    fireEvent.change(promptBox(), { target: { value: text } });
    fireEvent.click(sendButton());
  };

  test("Send shows the builder inside Create with the prompt — no window event", async () => {
    const { setIsOpen } = setup();
    const onOpen = jest.fn();
    window.addEventListener("dash:open-widget-builder", onOpen);
    await sendWidget("Count my unread email");
    window.removeEventListener("dash:open-widget-builder", onOpen);
    expect(onOpen).not.toHaveBeenCalled();
    expect(setIsOpen).not.toHaveBeenCalled();
    expect(screen.getByTestId("builder-prompt")).toHaveTextContent(
      "Count my unread email",
    );
    expect(screen.getByTestId("builder-draft")).toHaveTextContent("null");
    const nav = screen.getByRole("navigation", { name: "Where you are" });
    expect(nav).toHaveTextContent("Create›New widget");
  });

  test("closing ends the builder step — reopening starts fresh, no builder remount", async () => {
    window.mainApi = {
      llm: {
        checkCliAvailable: jest.fn().mockResolvedValue({ available: true }),
      },
      drafts: { list: jest.fn().mockResolvedValue([]) },
    };
    function Host() {
      const [open, setOpen] = React.useState(true);
      return (
        <ThemeContext.Provider value={{ currentTheme: {} }}>
          <AppContext.Provider value={{ providers: {}, settings: {} }}>
            <button onClick={() => setOpen(true)}>reopen</button>
            <CreateModal open={open} setIsOpen={setOpen} />
          </AppContext.Provider>
        </ThemeContext.Provider>
      );
    }
    render(<Host />);
    await sendWidget("Count my unread email");
    expect(screen.getByTestId("builder")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("builder")).toBeNull();
    Builder.mockClear();
    fireEvent.click(screen.getByText("reopen"));
    expect(Builder).not.toHaveBeenCalled();
    expect(promptBox()).toBeInTheDocument();
  });

  test("Back returns to the start screen with the prompt kept", async () => {
    setup();
    await sendWidget("Count my unread email");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByTestId("builder")).toBeNull();
    expect(promptBox()).toHaveValue("Count my unread email");
  });

  test("the builder finishing closes Create", async () => {
    const { setIsOpen } = setup();
    await sendWidget("Count my unread email");
    fireEvent.click(screen.getByText("builder done"));
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  test("the builder can name the step", async () => {
    setup();
    await sendWidget("Count my unread email");
    fireEvent.click(screen.getByText("name it"));
    expect(
      screen.getByRole("navigation", { name: "Where you are" }),
    ).toHaveTextContent("Create›Unread mail");
  });

  test("Continue a draft opens it inside Create, titled with its name", async () => {
    setup({
      drafts: [{ id: "d1", name: "Tokyo clock", updatedAt: Date.now() }],
    });
    fireEvent.click(await screen.findByRole("button", { name: /Tokyo clock/ }));
    expect(screen.getByTestId("builder-draft")).toHaveTextContent("d1");
    expect(screen.getByTestId("builder-prompt")).toHaveTextContent("null");
    expect(
      screen.getByRole("navigation", { name: "Where you are" }),
    ).toHaveTextContent("Create›Tokyo clock");
  });
});

describe("CreateModal — the Scout looks first (slice 4)", () => {
  const Builder = jest.fn(({ initialPrompt }) => (
    <div data-testid="builder">
      <span data-testid="builder-prompt">{String(initialPrompt)}</span>
    </div>
  ));
  beforeEach(() => setWidgetBuilderRenderer(Builder));
  afterEach(() => setWidgetBuilderRenderer(null));

  const withScout = () => {
    Object.assign(window.mainApi.bots, {
      listDashTeam: jest
        .fn()
        .mockResolvedValue([{ id: "b_scout", role: "scout", name: "Scout" }]),
      onStream: jest.fn(() => 1),
      removeListener: jest.fn(),
      run: jest.fn().mockResolvedValue({
        status: "completed",
        output:
          'Found one.<matches>[{"source":"Registry","name":"Algolia Search","package":"@trops/algolia","why":"search"}]</matches>',
      }),
    });
  };

  const sendWidget = async (text) => {
    await screen.findByRole("button", { name: /^AI: Claude Code/ });
    fireEvent.change(promptBox(), { target: { value: text } });
    fireEvent.click(sendButton());
  };

  test("Send shows the Scout's step; Build new instead opens the builder with the prompt", async () => {
    setup();
    withScout();
    await sendWidget("an Algolia search widget");
    await screen.findByTestId("scout-matches");
    expect(
      screen.getByRole("navigation", { name: "Where you are" }),
    ).toHaveTextContent("Create›Looking first");
    expect(screen.queryByTestId("builder")).toBeNull();
    fireEvent.click(screen.getByText("Build new instead"));
    expect(screen.getByTestId("builder-prompt")).toHaveTextContent(
      "an Algolia search widget",
    );
  });

  test("picking a match closes Create and hands it to the host", async () => {
    const onOpenWidget = jest.fn();
    const { setIsOpen } = setup({ props: { onOpenWidget } });
    withScout();
    await sendWidget("an Algolia search widget");
    fireEvent.click(await screen.findByText("Install"));
    expect(setIsOpen).toHaveBeenCalledWith(false);
    expect(onOpenWidget).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "Registry",
        package: "@trops/algolia",
      }),
    );
  });
});

describe("CreateModal — Fold into the dock (4e-2)", () => {
  test("opens on a plan from Recent (Expand); Fold sends it to the dock and closes", async () => {
    const { setIsOpen } = setup({ props: { initialRecentId: "plan_9" } });
    expect(await screen.findByText("Here is the plan.")).toBeInTheDocument();
    expect(window.mainApi.bots.getCreateRecent).toHaveBeenCalledWith("plan_9");
    const onFold = jest.fn();
    window.addEventListener("dash:create-fold", onFold);
    const fold = await screen.findByRole("button", {
      name: "Fold into the sidebar",
    });
    expect(fold).not.toBeDisabled();
    fireEvent.click(fold);
    window.removeEventListener("dash:create-fold", onFold);
    expect(onFold.mock.calls[0][0].detail).toEqual({
      recentId: "plan_9",
      title: "Plan a dashboard",
    });
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  test("while the Planner answers, Fold is there but waits", async () => {
    setup();
    window.mainApi.bots.listDashTeam = jest
      .fn()
      .mockResolvedValue([
        { id: "b_planner", role: "planner", name: "Planner" },
      ]);
    window.mainApi.bots.onStream = jest.fn(() => 1);
    window.mainApi.bots.run = jest.fn(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: /^Type:/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Dashboard/ }));
    fireEvent.change(promptBox(), { target: { value: "A greeter" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const fold = await screen.findByRole("button", {
      name: "Fold into the sidebar",
    });
    expect(fold).toBeDisabled();
    expect(fold).toHaveAttribute("title", "Fold after the Planner answers");
  });

  test("no Fold on the start screen", async () => {
    setup();
    await screen.findByRole("button", { name: /^AI: Claude Code/ });
    expect(
      screen.queryByRole("button", { name: "Fold into the sidebar" }),
    ).toBeNull();
  });
});
