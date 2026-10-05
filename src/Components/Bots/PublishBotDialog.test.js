import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PublishBotDialog } from "./PublishBotDialog";

const teamPreview = {
  kind: "team",
  signedIn: true,
  username: "trops",
  notIncluded: [
    'Inbox: the trigger "Inbox widget › newMail" (a widget on this dashboard)',
  ],
  last: null,
  suggested: {
    displayName: "Daily Brief (test)",
    name: "daily-brief-test",
    version: "1.0.0",
    description: "",
    visibility: "private",
  },
  pkg: {
    type: "bot-team",
    name: "Daily Brief (test)",
    members: [
      {
        role: "agenda",
        embedded: {
          name: "Agenda",
          instructions: "Read today's calendar.",
          providers: [{ type: "google-calendar", tools: null }],
        },
      },
      {
        role: "writer",
        embedded: {
          name: "Writer",
          instructions: "Save it to /Users/john/Documents/brief.md",
          providers: [{ type: "filesystem", tools: ["write_file"] }],
        },
      },
    ],
    wiring: [{ role: "writer", on: { role: "agenda", event: "completed" } }],
  },
};

const botPreview = {
  ...teamPreview,
  kind: "bot",
  notIncluded: [],
  last: { name: "trops/inbox", version: "1.0.2", visibility: "public" },
  suggested: {
    displayName: "Inbox",
    name: "inbox",
    version: "1.0.3",
    description: "",
    visibility: "public",
  },
  pkg: {
    type: "bot",
    name: "Inbox",
    bot: {
      name: "Inbox",
      instructions: "Scan unread mail.",
      providers: [{ type: "gmail", tools: null }],
    },
  },
};

function setup(props = {}) {
  const onPublish = jest.fn();
  const onClose = jest.fn();
  render(
    <PublishBotDialog
      open
      preview={teamPreview}
      onPublish={onPublish}
      onClose={onClose}
      {...props}
    />,
  );
  return { onPublish, onClose };
}

describe("PublishBotDialog (TEAM-006 slice 3a)", () => {
  it("shows every bot's full instructions and what isn't included", () => {
    setup();
    expect(
      screen.getByText("Publish team to the registry"),
    ).toBeInTheDocument();
    expect(screen.getByText("Read today's calendar.")).toBeInTheDocument();
    expect(
      screen.getByText("Save it to /Users/john/Documents/brief.md"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/check them for personal details/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Inbox widget › newMail/)).toBeInTheDocument();
    expect(
      screen.getByText("Agenda completes → Writer runs"),
    ).toBeInTheDocument();
  });

  it("publishes as Private by default, under the user's name", () => {
    const { onPublish } = setup();
    expect(screen.getByText("trops/daily-brief-test")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Private" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByText("Publish"));
    expect(onPublish).toHaveBeenCalledWith({
      displayName: "Daily Brief (test)",
      name: "daily-brief-test",
      version: "1.0.0",
      description: "",
      visibility: "private",
    });
  });

  it("lets the user edit the fields and choose Public", () => {
    const { onPublish } = setup();
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Morning brief" },
    });
    fireEvent.change(screen.getByLabelText("Package name"), {
      target: { value: "morning-brief" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Public" }));
    fireEvent.click(screen.getByText("Publish"));
    expect(onPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "morning-brief",
        description: "Morning brief",
        visibility: "public",
      }),
    );
  });

  it("says when a field won't pass the registry, and blocks Publish", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Package name"), {
      target: { value: "Has Spaces" },
    });
    expect(
      screen.getByText(/lowercase letters, digits and dashes/),
    ).toBeInTheDocument();
    expect(screen.getByText("Publish")).toBeDisabled();
  });

  it("shows a single bot, and the last published version", () => {
    setup({ preview: botPreview });
    expect(screen.getByText("Publish bot to the registry")).toBeInTheDocument();
    expect(screen.getByText("Scan unread mail.")).toBeInTheDocument();
    expect(
      screen.getByText(/Last published: trops\/inbox v1\.0\.2/),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Public" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("shows the result after publishing, and errors from the registry", () => {
    const { rerender } = render(
      <PublishBotDialog
        open
        preview={teamPreview}
        onPublish={jest.fn()}
        onClose={jest.fn()}
        result={{
          package: "trops/daily-brief-test",
          version: "1.0.0",
          visibility: "private",
        }}
      />,
    );
    expect(
      screen.getByText("Published trops/daily-brief-test v1.0.0 (private)."),
    ).toBeInTheDocument();
    rerender(
      <PublishBotDialog
        open
        preview={teamPreview}
        onPublish={jest.fn()}
        onClose={jest.fn()}
        error="Version 1.0.0 already exists"
      />,
    );
    expect(
      screen.getByText("Version 1.0.0 already exists"),
    ).toBeInTheDocument();
  });

  it("disables Publish while publishing and can be cancelled", () => {
    const { onClose } = setup({ publishing: true });
    expect(screen.getByText("Publishing…")).toBeDisabled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });
});
