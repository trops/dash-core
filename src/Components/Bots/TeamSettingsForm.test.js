import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import {
  TeamSettingsForm,
  TeamSettingsPanel,
  emptySettings,
} from "./TeamSettingsForm";
import { TeamImportReview } from "./TeamImportReview";
import { DashboardInstallOptionsModal } from "../Settings/details/DashboardInstallOptionsModal";
import { installedText } from "../Settings/details/dashboardBots";

// DASH-57 (Code Factory G6): a team's settings, filled in at install and
// changed later on the dashboard.

const SETTINGS = [
  { name: "repoUrl", label: "Repository URL", type: "url" },
  { name: "baseBranch", label: "Base branch", type: "text", default: "main" },
  { name: "workFolder", label: "Work folder", type: "folder" },
  { name: "merge", label: "Merge when approved", type: "boolean" },
];

afterEach(() => {
  delete window.mainApi;
});

describe("TeamSettingsForm", () => {
  it("shows each setting, its default as the hint, and which are empty", () => {
    const onChange = jest.fn();
    render(
      <TeamSettingsForm
        settings={SETTINGS}
        values={{ repoUrl: "https://github.com/me/a.git" }}
        usedBy={{ workFolder: ["Coder", "Reviewer"] }}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText("Repository URL")).toHaveValue(
      "https://github.com/me/a.git",
    );
    expect(screen.getByLabelText("Base branch")).toHaveAttribute(
      "placeholder",
      "main (the default)",
    );
    const folder = screen.getByTestId("team-setting-workFolder");
    expect(folder).toHaveTextContent("Used by Coder, Reviewer as {workFolder}");
    expect(folder).toHaveTextContent("No value yet");
    expect(screen.getByTestId("team-setting-repoUrl")).not.toHaveTextContent(
      "No value yet",
    );
    fireEvent.change(screen.getByLabelText("Work folder"), {
      target: { value: "/w/a" },
    });
    expect(onChange).toHaveBeenCalledWith("workFolder", "/w/a");
    fireEvent.click(screen.getByLabelText("Merge when approved"));
    expect(onChange).toHaveBeenCalledWith("merge", true);
  });

  it("a folder can be chosen", async () => {
    const onChange = jest.fn();
    window.mainApi = {
      flows: { pickFolder: jest.fn(async () => ({ path: "/Users/me/F" })) },
    };
    render(
      <TeamSettingsForm settings={SETTINGS} values={{}} onChange={onChange} />,
    );
    fireEvent.click(
      within(screen.getByTestId("team-setting-workFolder")).getByText(
        "Choose…",
      ),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("workFolder", "/Users/me/F"),
    );
  });

  it("emptySettings: no value and no default (a yes/no is never empty)", () => {
    expect(
      emptySettings(SETTINGS, { repoUrl: "x" }).map((s) => s.name),
    ).toEqual(["workFolder"]);
  });
});

describe("installing a team package", () => {
  const preview = {
    manifest: {
      name: "Code Factory",
      settings: SETTINGS,
      members: [
        {
          role: "coder",
          embedded: {
            name: "Coder",
            instructions: "Work on {repoUrl}.",
            schedules: [],
            providers: [],
          },
        },
      ],
      wiring: [],
    },
    plan: { members: [{ role: "coder", needs: [] }], settings: SETTINGS },
  };

  it("shows each bot's checks, a command as it is, before installing", () => {
    const withChecks = JSON.parse(JSON.stringify(preview));
    withChecks.manifest.members[0].embedded.checks = {
      steps: [
        {
          id: "step_c1",
          kind: "check",
          name: "Tests pass",
          check: { kind: "command", command: "cd {workFolder} && npm test" },
        },
        { id: "step_c2", kind: "you", name: "You approve" },
      ],
    };
    render(
      <TeamImportReview
        preview={withChecks}
        onInstall={() => {}}
        onCancel={() => {}}
      />,
    );
    const box = screen.getByTestId("team-member-checks-coder");
    expect(box).toHaveTextContent(
      "Tests pass: runs cd {workFolder} && npm test",
    );
    expect(box).toHaveTextContent("You approve: waits for your approval");
    expect(box).toHaveTextContent("Commands install switched off");
  });

  it("fills in its settings on the review screen and installs with them", () => {
    const onInstall = jest.fn();
    render(
      <TeamImportReview
        preview={preview}
        onInstall={onInstall}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("team-install-settings")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Repository URL"), {
      target: { value: "https://github.com/me/sandbox.git" },
    });
    fireEvent.click(screen.getByText("Install team"));
    expect(onInstall).toHaveBeenCalledWith({}, null, {
      repoUrl: "https://github.com/me/sandbox.git",
    });
  });
});

describe("installing a dashboard from the registry", () => {
  it("the install options ask for its team's settings", () => {
    const onConfirm = jest.fn();
    render(
      <DashboardInstallOptionsModal
        isOpen
        setIsOpen={() => {}}
        pkg={{ name: "code-factory", displayName: "Code Factory" }}
        menuItems={[{ id: 1, name: "Work" }]}
        onConfirm={onConfirm}
        teamSettings={SETTINGS}
      />,
    );
    fireEvent.change(screen.getByLabelText("Work folder"), {
      target: { value: "~/Factory" },
    });
    fireEvent.click(screen.getByText("Install"));
    expect(onConfirm).toHaveBeenCalledWith({
      name: "Code Factory",
      menuId: "1",
      teamValues: { workFolder: "~/Factory" },
    });
  });

  it("without settings, nothing changes", () => {
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
    expect(screen.queryByTestId("install-team-settings")).toBeNull();
    fireEvent.click(screen.getByText("Install"));
    expect(onConfirm).toHaveBeenCalledWith({ name: "plain", menuId: null });
  });

  it("after installing, says which settings still need a value", () => {
    expect(
      installedText(
        {
          workspace: { name: "Code Factory" },
          summary: {
            bots: {
              installed: [{ id: "b1" }],
              needsSettings: ["Repository URL", "Work folder"],
            },
          },
        },
        "x",
      ),
    ).toMatch(
      /Fill in its team settings \(Repository URL, Work folder\) on the Bots page/,
    );
  });

  it("after installing, says how many command checks are off", () => {
    expect(
      installedText(
        {
          workspace: { name: "Code Factory" },
          summary: {
            bots: {
              installed: [{ id: "b1" }],
              heldChecks: ["Coder: Tests pass", "Coder: Lint"],
            },
          },
        },
        "x",
      ),
    ).toMatch(/2 command checks are off until you turn them on/);
  });
});

describe("TeamSettingsPanel (the dashboard's team settings)", () => {
  it("loads them, and saves a change", async () => {
    let team = {
      declared: SETTINGS,
      values: { repoUrl: "https://github.com/me/a.git" },
      usedBy: { repoUrl: ["Coder"] },
    };
    window.mainApi = {
      bots: {
        getTeamValues: jest.fn(async () => team),
        setTeamValues: jest.fn(async (id, change) => {
          team = { ...team, values: { ...change.values } };
          return team;
        }),
      },
    };
    render(<TeamSettingsPanel workspaceId={7} />);
    const input = await screen.findByLabelText("Repository URL");
    expect(input).toHaveValue("https://github.com/me/a.git");
    expect(screen.getByText("Save settings").closest("button")).toBeDisabled();
    fireEvent.change(input, {
      target: { value: "https://github.com/me/b.git" },
    });
    fireEvent.click(screen.getByText("Save settings"));
    await waitFor(() =>
      expect(window.mainApi.bots.setTeamValues).toHaveBeenCalledWith(7, {
        values: {
          repoUrl: "https://github.com/me/b.git",
          baseBranch: "",
          workFolder: "",
          merge: "",
        },
      }),
    );
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("shows why it wasn't saved", async () => {
    window.mainApi = {
      bots: {
        getTeamValues: jest.fn(async () => ({
          declared: SETTINGS,
          values: {},
        })),
        setTeamValues: jest.fn(async () => ({
          errors: ["Work folder: must be a whole path (/… or ~/…)"],
        })),
      },
    };
    render(<TeamSettingsPanel workspaceId={7} />);
    fireEvent.change(await screen.findByLabelText("Work folder"), {
      target: { value: "work" },
    });
    fireEvent.click(screen.getByText("Save settings"));
    expect(await screen.findByTestId("team-settings-errors")).toHaveTextContent(
      "Work folder: must be a whole path",
    );
  });

  it("shows nothing for a team with no settings", async () => {
    window.mainApi = {
      bots: {
        getTeamValues: jest.fn(async () => ({ declared: [], values: {} })),
      },
    };
    const { container } = render(<TeamSettingsPanel workspaceId={7} />);
    await waitFor(() =>
      expect(window.mainApi.bots.getTeamValues).toHaveBeenCalled(),
    );
    expect(container).toBeEmptyDOMElement();
  });
});
