import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  BotOwnSettings,
  BotSettingsInstall,
  botsWithSettings,
  settingFromDraft,
  withBotInstallValues,
  botInitials,
  botsWaiting,
  botsWaitingText,
} from "./BotSettings";
import { TeamImportReview } from "./TeamImportReview";
import { DashboardInstallOptionsModal } from "../Settings/details/DashboardInstallOptionsModal";
import {
  botSetupStatus,
  botSetupLines,
  botMissingSettings,
  settingNamesUsed,
  withBotSettings,
  settingEmpty,
} from "../../utils/botSettings";

// DASH-136: a bot owns the settings for its own job.

const WORK_FOLDER = {
  name: "workFolder",
  label: "Work folder",
  type: "folder",
  required: true,
};

describe("botSettings helpers", () => {
  const team = {
    declared: [{ name: "repoUrl", label: "Repository URL", type: "url" }],
    values: {},
  };
  const bots = [
    { id: "l", name: "Planner", role: "lead", instructions: "{repoUrl}" },
    {
      id: "w",
      name: "Workspace Bot",
      instructions: "Clone into {workFolder}.",
      settings: [WORK_FOLDER],
    },
    { id: "c", name: "Coder", instructions: "Work on {repoUrl}." },
    {
      id: "t",
      name: "Ticket Bot",
      instructions: "Take a ticket.",
      settings: [{ name: "source", label: "Ticket source", type: "text" }],
    },
  ];

  it("botSetupStatus lists each bot with something missing, and why", () => {
    const status = botSetupStatus(bots, team);
    expect(status.map((b) => [b.botId, b.missing.map((m) => m.owner)])).toEqual(
      [
        ["w", ["bot"]],
        ["c", ["team"]],
      ],
    );
    expect(botSetupLines(status)).toEqual([
      "Workspace Bot: Work folder has no value.",
      "Coder: Repository URL has no value.",
    ]);
    // An optional setting it doesn't use isn't missing.
    expect(botMissingSettings(bots[3], team)).toEqual([]);
  });

  it("names used, empty values, and the bot's own on top of its team's", () => {
    expect(
      [
        ...settingNamesUsed({
          instructions: "{a} {repo.url}",
          projects: ["{b}/x"],
          checks: { steps: [{ check: { command: "cd {c}" } }] },
          schedules: [{ prompt: "{d}" }],
          subscriptions: [{ note: "{e}" }],
        }),
      ].sort(),
    ).toEqual(["a", "b", "c", "d", "e", "repo"]);
    expect(settingEmpty({ name: "x", type: "boolean" }, {})).toBe(false);
    expect(settingEmpty({ name: "x", type: "table" }, { x: [] })).toBe(true);
    expect(settingEmpty({ name: "x", default: "d" }, {})).toBe(false);
    const merged = withBotSettings(
      {
        declared: [{ name: "workFolder" }],
        values: { workFolder: "/t" },
        x: 1,
      },
      { settings: [WORK_FOLDER], settingValues: { workFolder: "/b" } },
    );
    expect(merged.values).toEqual({ workFolder: "/b" });
    expect(merged.declared).toHaveLength(1);
    expect(merged.declared[0].owner).toBe("bot");
    expect(merged.x).toBe(1);
    const same = { declared: [] };
    expect(withBotSettings(same, { name: "no settings" })).toBe(same);
  });
});

describe("declaring a setting on the bot's Settings tab", () => {
  it("settingFromDraft checks the name and reads a table's columns", () => {
    expect(settingFromDraft({ name: "1x" }).error).toBeTruthy();
    expect(settingFromDraft({ name: "a" }, [{ name: "a" }]).error).toMatch(
      /already/,
    );
    expect(
      settingFromDraft({
        name: "repo",
        type: "table",
        columns: "url:url, baseBranch",
        required: true,
      }).setting,
    ).toEqual({
      name: "repo",
      label: "repo",
      type: "table",
      required: true,
      columns: [
        { name: "url", label: "url", type: "url" },
        { name: "baseBranch", label: "baseBranch", type: "text" },
      ],
    });
  });

  it("fills one in, adds one and takes one away", () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <BotOwnSettings
        botName="Workspace Bot"
        settings={[WORK_FOLDER]}
        values={{}}
        onChange={onChange}
      />,
    );
    expect(
      screen.getByTestId("team-setting-workFolder-required"),
    ).toHaveTextContent("Required");
    expect(
      screen.getByText(/Workspace Bot can't do its job until it has one/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Work folder"), {
      target: { value: "~/F" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      settings: [WORK_FOLDER],
      values: { workFolder: "~/F" },
    });
    rerender(
      <BotOwnSettings
        botName="Workspace Bot"
        settings={[WORK_FOLDER]}
        values={{ workFolder: "~/F" }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove setting Work folder"));
    expect(onChange).toHaveBeenLastCalledWith({ settings: [], values: {} });
  });
});

describe("the install form's per-bot section", () => {
  const members = [
    {
      role: "workspace-bot",
      embedded: { name: "Workspace Bot", settings: [WORK_FOLDER] },
    },
    { role: "coder", embedded: { name: "Coder" } },
  ];

  it("botsWithSettings and withBotInstallValues", () => {
    expect(botsWithSettings(members)).toEqual([
      { role: "workspace-bot", name: "Workspace Bot", settings: [WORK_FOLDER] },
    ]);
    // A registry summary's members carry settings directly.
    expect(
      botsWithSettings([{ role: "r", name: "R", settings: [WORK_FOLDER] }]),
    ).toHaveLength(1);
    expect(withBotInstallValues({ a: 1 }, {})).toEqual({ a: 1 });
    expect(withBotInstallValues(null, { r: { x: 1 }, s: {} })).toEqual({
      "@bots": { r: { x: 1 } },
    });
  });

  it("shows a card per bot and how many still need settings", () => {
    render(
      <BotSettingsInstall
        bots={botsWithSettings(members)}
        values={{}}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByText("Bots that need something from you"),
    ).toBeInTheDocument();
    expect(screen.getByText("Workspace Bot · Work folder")).toBeInTheDocument();
    expect(
      screen.getByTestId("bot-settings-install-waiting"),
    ).toHaveTextContent("1 bot still needs settings.");
  });

  it("the import review installs with each bot's values", () => {
    const onInstall = jest.fn();
    render(
      <TeamImportReview
        preview={{
          manifest: {
            name: "Team",
            members: [
              {
                role: "workspace-bot",
                embedded: {
                  type: "bot",
                  name: "Workspace Bot",
                  instructions: "Clone into {workFolder}.",
                  schedules: [],
                  providers: [],
                  settings: [WORK_FOLDER],
                },
              },
            ],
            wiring: [],
          },
          plan: { members: [{ role: "workspace-bot", needs: [] }] },
        }}
        onInstall={onInstall}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Work folder"), {
      target: { value: "~/Factory" },
    });
    fireEvent.click(screen.getByText("Install team"));
    expect(onInstall).toHaveBeenCalledWith({}, null, {
      "@bots": { "workspace-bot": { workFolder: "~/Factory" } },
    });
  });

  it("the registry dashboard install does too", () => {
    const onConfirm = jest.fn();
    render(
      <DashboardInstallOptionsModal
        isOpen
        setIsOpen={() => {}}
        pkg={{ name: "factory", displayName: "Factory" }}
        menuItems={[{ id: 1, name: "Work" }]}
        onConfirm={onConfirm}
        teamBots={botsWithSettings(members)}
      />,
    );
    fireEvent.change(screen.getByLabelText("Work folder"), {
      target: { value: "~/Factory" },
    });
    fireEvent.click(screen.getByText("Install"));
    expect(onConfirm).toHaveBeenCalledWith({
      name: "Factory",
      menuId: "1",
      teamValues: { "@bots": { "workspace-bot": { workFolder: "~/Factory" } } },
      openSetup: false,
    });
  });
});

describe("install cards and buttons (DASH-130)", () => {
  const members = [
    {
      role: "workspace-bot",
      name: "Workspace Bot",
      settings: [WORK_FOLDER],
    },
    {
      role: "notes",
      name: "Notes",
      settings: [{ name: "tag", label: "Tag", type: "text" }],
    },
  ];

  it("initials, and how many bots still wait", () => {
    expect(botInitials("Ticket Bot")).toBe("TB");
    expect(botInitials("triage")).toBe("TR");
    expect(botInitials("pr-bot")).toBe("PB");
    expect(botInitials("")).toBe("?");
    expect(botsWaiting(members, {})).toBe(1);
    expect(
      botsWaiting(members, { "workspace-bot": { workFolder: "~/F" } }),
    ).toBe(0);
    expect(botsWaitingText(0)).toBeNull();
    expect(botsWaitingText(3)).toMatch(
      /^3 bots still need settings\. The dashboard installs, and those bots wait/,
    );
  });

  it("each card has the bot's initials and Required only when it has one", () => {
    render(
      <BotSettingsInstall bots={members} values={{}} onChange={() => {}} />,
    );
    expect(
      screen.getAllByTestId("bot-settings-install-initials")[0],
    ).toHaveTextContent("WB");
    expect(
      screen.getByTestId("bot-settings-install-workspace-bot-required"),
    ).toHaveTextContent("Required");
    expect(
      screen.queryByTestId("bot-settings-install-notes-required"),
    ).toBeNull();
    expect(screen.getByText(/later on the team's Set up/)).toBeInTheDocument();
  });

  const renderModal = (onConfirm) =>
    render(
      <DashboardInstallOptionsModal
        isOpen
        setIsOpen={() => {}}
        pkg={{ name: "factory", displayName: "Factory" }}
        menuItems={[{ id: 1, name: "Work" }]}
        onConfirm={onConfirm}
        teamBots={members}
      />,
    );

  it("installs with a required setting empty, saying what waits", () => {
    const onConfirm = jest.fn();
    renderModal(onConfirm);
    expect(screen.getByTestId("install-waiting")).toHaveTextContent(
      "1 bot still needs settings.",
    );
    // The form says it once, not twice.
    expect(screen.queryByTestId("bot-settings-install-waiting")).toBeNull();
    fireEvent.click(screen.getByText("Install, fill in later"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Factory", openSetup: false }),
    );
  });

  it("Install and open Set up says so", () => {
    const onConfirm = jest.fn();
    renderModal(onConfirm);
    fireEvent.click(screen.getByText("Install and open Set up"));
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ openSetup: true }),
    );
  });

  it("a dashboard with no team has one Install button", () => {
    const onConfirm = jest.fn();
    render(
      <DashboardInstallOptionsModal
        isOpen
        setIsOpen={() => {}}
        pkg={{ name: "plain" }}
        menuItems={[]}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByText("Install and open Set up")).toBeNull();
    fireEvent.click(screen.getByText("Install"));
    expect(onConfirm).toHaveBeenCalledWith({ name: "plain", menuId: null });
  });
});
