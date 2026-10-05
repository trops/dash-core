import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TeamImportReview, wiringText } from "./TeamImportReview";

const member = (role, name, extra = {}) => ({
  role,
  embedded: {
    type: "bot",
    name,
    instructions: `${name} does its job.`,
    modelSource: "claude-code",
    approvalPolicy: "ask",
    schedules: [],
    providers: [],
    ...extra,
  },
});

const preview = {
  fileName: "Daily Brief.team.json",
  manifest: {
    name: "Daily Brief",
    description: "Morning brief",
    members: [
      member("agenda", "Agenda", {
        providers: [{ type: "google-calendar", tools: null }],
        schedules: [{ cron: "0 7 * * *", prompt: "" }],
      }),
      member("inbox", "Inbox", {
        approvalPolicy: "allow",
        providers: [{ type: "gmail", tools: ["search_emails"] }],
      }),
      member("writer", "Writer", {
        providers: [{ type: "filesystem", tools: ["write_file"] }],
      }),
    ],
    wiring: [
      { role: "inbox", on: { role: "agenda", event: "completed" } },
      { role: "writer", on: { role: "inbox", event: "completed" } },
    ],
  },
  plan: {
    members: [
      {
        role: "agenda",
        fileApprovalPolicy: "ask",
        needs: [
          {
            type: "google-calendar",
            options: ["Google Calendar"],
            chosen: "Google Calendar",
          },
        ],
      },
      {
        role: "inbox",
        fileApprovalPolicy: "allow",
        needs: [
          { type: "gmail", options: ["Gmail 3", "Gmail Work"], chosen: null },
        ],
      },
      {
        role: "writer",
        fileApprovalPolicy: "ask",
        needs: [{ type: "filesystem", options: [], chosen: null }],
      },
    ],
    wiring: [
      { role: "inbox", on: { role: "agenda", event: "completed" } },
      { role: "writer", on: { role: "inbox", event: "completed" } },
    ],
  },
};

function setup(props = {}) {
  const onInstall = jest.fn();
  const onCancel = jest.fn();
  render(
    <TeamImportReview
      preview={preview}
      onInstall={onInstall}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onInstall, onCancel };
}

describe("wiringText", () => {
  it("reads as a sentence per link", () => {
    const names = { agenda: "Agenda", inbox: "Inbox" };
    expect(
      wiringText(
        { role: "inbox", on: { role: "agenda", event: "completed" } },
        names,
      ),
    ).toBe("Agenda completes → Inbox runs");
    expect(
      wiringText(
        { role: "inbox", on: { role: "agenda", event: "failed" } },
        names,
      ),
    ).toBe("Agenda fails → Inbox runs");
    expect(
      wiringText(
        {
          role: "inbox",
          on: { role: "agenda", event: "tool.gmail.search_emails" },
        },
        names,
      ),
    ).toBe("Agenda uses gmail search_emails → Inbox runs");
  });
});

describe("TeamImportReview (TEAM-007 slice 1)", () => {
  it("shows the team, its members and how they're wired", () => {
    setup();
    expect(screen.getByText("Import team: Daily Brief")).toBeInTheDocument();
    expect(screen.getByText("Morning brief")).toBeInTheDocument();
    expect(
      screen.getByText("Agenda completes → Inbox runs"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Inbox completes → Writer runs"),
    ).toBeInTheDocument();
    for (const name of ["Agenda", "Inbox", "Writer"]) {
      expect(screen.getByTestId(`team-member-${name}`)).toBeInTheDocument();
    }
    expect(screen.getByText(/added paused/i)).toBeInTheDocument();
  });

  it("uses the only matching provider, offers a choice, or says it's missing", () => {
    setup();
    expect(
      screen.getByText(/Not chosen — installs without gmail/),
    ).toBeInTheDocument();
    const agenda = screen.getByTestId("team-member-Agenda");
    expect(
      within(agenda).getByText("google-calendar: Google Calendar"),
    ).toBeInTheDocument();
    const inbox = screen.getByTestId("team-member-Inbox");
    expect(
      Array.from(within(inbox).getByLabelText("gmail provider").options).map(
        (o) => o.value,
      ),
    ).toEqual(["Gmail 3", "Gmail Work"]);
    const writer = screen.getByTestId("team-member-Writer");
    expect(
      within(writer).getByText(
        /filesystem: none set up — add one in Settings › Providers/,
      ),
    ).toBeInTheDocument();
  });

  it("says imported bots ask before external actions, noting a file that said otherwise", () => {
    setup();
    const inbox = screen.getByTestId("team-member-Inbox");
    expect(
      within(inbox).getByText(
        "Asks before external actions (the file said: Allow without prompting)",
      ),
    ).toBeInTheDocument();
    const agenda = screen.getByTestId("team-member-Agenda");
    expect(
      within(agenda).getByText("Asks before external actions"),
    ).toBeInTheDocument();
  });

  it("installs with the user's provider choices", () => {
    const { onInstall } = setup();
    fireEvent.change(screen.getByLabelText("gmail provider"), {
      target: { value: "Gmail Work" },
    });
    fireEvent.click(screen.getByText("Install team"));
    expect(onInstall).toHaveBeenCalledWith(
      { inbox: { gmail: "Gmail Work" } },
      null,
    );
  });

  it("installs with no choices when the user picks none (unpicked providers stay off)", () => {
    const { onInstall } = setup();
    fireEvent.click(screen.getByText("Install team"));
    expect(onInstall).toHaveBeenCalledWith({}, null);
  });

  it("can be cancelled, and disables Install while installing", () => {
    const { onCancel } = setup({ installing: true });
    expect(screen.getByText("Install team")).toBeDisabled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("TeamImportReview — picking bots (TEAM-007 slice 3b)", () => {
  const withMemory = {
    ...preview,
    manifest: {
      ...preview.manifest,
      members: preview.manifest.members.map((m) =>
        m.role === "writer"
          ? {
              ...m,
              embedded: {
                ...m.embedded,
                instructions: "Read brief/inbox from team memory.",
              },
            }
          : m,
      ),
    },
  };

  it("ticks every bot by default and installs them all (no roles)", () => {
    const onInstall = jest.fn();
    render(
      <TeamImportReview
        preview={preview}
        onInstall={onInstall}
        onCancel={jest.fn()}
      />,
    );
    for (const name of ["Agenda", "Inbox", "Writer"]) {
      expect(screen.getByRole("checkbox", { name })).toBeChecked();
    }
    fireEvent.click(screen.getByText("Install team"));
    expect(onInstall).toHaveBeenCalledWith({}, null);
  });

  it("installs only the ticked bots and warns about what they lose", () => {
    const onInstall = jest.fn();
    render(
      <TeamImportReview
        preview={withMemory}
        onInstall={onInstall}
        onCancel={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Inbox" }));
    expect(
      screen.getByText(
        "Writer normally runs when Inbox completes — that trigger won't be set up.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Writer shares results with its teammates through team memory/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Install 2 bots")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Install 2 bots"));
    expect(onInstall).toHaveBeenCalledWith({}, ["agenda", "writer"]);
  });

  it("can't install with nothing ticked", () => {
    render(
      <TeamImportReview
        preview={preview}
        onInstall={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    for (const name of ["Agenda", "Inbox", "Writer"]) {
      fireEvent.click(screen.getByRole("checkbox", { name }));
    }
    expect(screen.getByText("Install 0 bots")).toBeDisabled();
  });

  it("says where a registry package came from", () => {
    render(
      <TeamImportReview
        preview={{
          ...preview,
          fileName: undefined,
          source: {
            package: "trops/daily-brief",
            version: "1.0.0",
            author: "trops",
          },
        }}
        onInstall={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(
      screen.getByText("From the registry: trops/daily-brief v1.0.0 by trops"),
    ).toBeInTheDocument();
  });

  it("calls a single bot a bot", () => {
    const one = {
      ...preview,
      kind: "bot",
      manifest: {
        ...preview.manifest,
        members: [preview.manifest.members[0]],
        wiring: [],
      },
      plan: { ...preview.plan, members: [preview.plan.members[0]], wiring: [] },
    };
    render(
      <TeamImportReview
        preview={one}
        onInstall={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByText("Install bot: Daily Brief")).toBeInTheDocument();
    expect(screen.getByText("Install bot")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
