/**
 * BuildParts — the Build log's Remove summary and Try the bots (create-entry
 * CRE-004 / CRE-006; kept from Create's build screen in lead-workspace
 * release 6c, with the cases its tests had).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RemoveSummary, TryBots } from "./BuildParts";

describe("RemoveSummary — what goes and what stays", () => {
  test("a new dashboard: it goes, with its bots, lead and new widgets; installs stay", () => {
    render(
      <RemoveSummary
        built={{
          dashboard: { id: "77", name: "Ask Test" },
          bots: [{ id: "bot_1", name: "Greeter" }],
          widgets: ["@ai-built/ask"],
          installs: ["@trops/google-calendar"],
          updated: [],
          placed: [],
        }}
      />,
    );
    const s = screen.getByTestId("remove-summary");
    expect(s).toHaveTextContent('The "Ask Test" dashboard');
    expect(s).toHaveTextContent("The Greeter bot");
    expect(s).toHaveTextContent("The dashboard's team lead, if it has one");
    expect(s).toHaveTextContent("The @ai-built/ask widget");
    expect(s).toHaveTextContent("@trops/google-calendar — stays installed");
  });

  test("a dashboard you have: it stays; what was added goes; the theme goes back", () => {
    const slack = { id: "17", name: "Slack Pack", targeted: true };
    render(
      <RemoveSummary
        built={{
          dashboard: slack,
          bots: [{ id: "bot_1", name: "Greeter" }],
          widgets: [],
          updated: ["@ai-built/notes"],
          installs: [],
          placed: [{ widgetId: 5, component: "trops.clock.Clock" }],
          theme: {
            name: "Nordic Frost",
            key: "theme-9",
            previous: "theme-2",
            previousName: "Dusk",
          },
        }}
      />,
    );
    const s = screen.getByTestId("remove-summary");
    expect(s).not.toHaveTextContent('The "Slack Pack" dashboard"');
    expect(s).not.toHaveTextContent("team lead, if it has one");
    expect(s).toHaveTextContent("The widget it put on Slack Pack");
    expect(s).toHaveTextContent("The Nordic Frost theme — Dusk goes back");
    expect(s).toHaveTextContent(
      'The "Slack Pack" dashboard, its team lead and everything else on it',
    );
    expect(s).toHaveTextContent("@ai-built/notes — keeps its changes");
  });

  test("a theme with nothing before it goes back to the app's", () => {
    render(
      <RemoveSummary
        built={{
          dashboard: { id: "1", name: "Home", targeted: true },
          theme: { name: "Dusk", key: "t", previous: null },
        }}
      />,
    );
    expect(screen.getByTestId("remove-summary")).toHaveTextContent(
      "The Dusk theme — it goes back to the app's theme",
    );
  });
});

describe("TryBots — new bots start paused, tested: turn one on", () => {
  beforeEach(() => {
    window.mainApi = {
      bots: {
        getPauseState: jest.fn().mockResolvedValue({ bots: ["bot_1"] }),
        run: jest.fn(),
        resumeBot: jest.fn().mockResolvedValue({ ok: true }),
      },
    };
  });
  afterEach(() => {
    delete window.mainApi;
  });

  test("Turn on turns it on; there's no real run from here", async () => {
    render(<TryBots bots={[{ id: "bot_1", name: "Greeter" }]} />);
    const turnOn = await screen.findByRole("button", {
      name: "Turn Greeter on",
    });
    expect(
      screen.queryByRole("button", { name: "Run Greeter now" }),
    ).toBeNull();
    expect(
      screen.getByText(/Each was tested before it was saved/),
    ).toBeInTheDocument();
    fireEvent.click(turnOn);
    expect(await screen.findByText("Greeter is on.")).toBeInTheDocument();
    expect(window.mainApi.bots.resumeBot).toHaveBeenCalledWith("bot_1");
    expect(window.mainApi.bots.run).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Turn Greeter on" }),
    ).toBeNull();
  });

  test("a bot that isn't paused says it's on, and has no Turn on", async () => {
    window.mainApi.bots.getPauseState = jest
      .fn()
      .mockResolvedValue({ bots: [] });
    render(<TryBots bots={[{ id: "bot_1", name: "Greeter" }]} />);
    expect(await screen.findByText("Greeter is on.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Turn Greeter on" }),
    ).toBeNull();
  });
});
