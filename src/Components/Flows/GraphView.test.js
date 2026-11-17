import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { GraphView } from "./GraphView";
import { installMockFlowsApi } from "../../__mocks__/mockFlowsApi";

const workspace = { id: "ws1", name: "Newsletter" };

beforeEach(() => {
  window.localStorage.clear();
  window.mainApi = {
    bots: {
      list: jest.fn(async () => [
        {
          id: "bot_w",
          name: "Writer",
          workspaceId: "ws1",
          instructions: "Writes the newsletter.",
        },
        { id: "bot_s", name: "Sender", workspaceId: "ws1" },
        {
          id: "bot_lead",
          name: "Newsletter Lead",
          workspaceId: "ws1",
          role: "lead",
        },
      ]),
    },
  };
});

describe("GraphView", () => {
  it("shows the flow, where its goals are, and its problems (frames 5 and 7)", async () => {
    installMockFlowsApi();
    render(<GraphView workspace={workspace} />);
    expect(await screen.findByText(/AI Writer/)).toBeInTheDocument();
    expect(screen.getByText(/\[1 goal · round 2\]/)).toBeInTheDocument();
    const panel = await screen.findByTestId("warnings-panel");
    expect(
      within(panel).getByText("This setup can fool itself"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText("Nothing checks Writer's work"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("flow-problems")).toHaveTextContent("2 problems");
  });

  it("a warning's fix adds a check between Writer and Sender, tried first (frames 13–14)", async () => {
    const { api } = installMockFlowsApi();
    render(<GraphView workspace={workspace} />);
    const panel = await screen.findByTestId("warnings-panel");
    fireEvent.click(within(panel).getByRole("button", { name: "Add a check" }));
    const check = await screen.findByTestId("check-panel");
    expect(
      within(check).getByText("between Writer and Sender"),
    ).toBeInTheDocument();
    // What it gets, from the Writer's last real record.
    expect(await screen.findByTestId("what-it-gets")).toHaveTextContent(
      "input.links",
    );
    // Starting rules from what the Writer makes.
    await waitFor(() =>
      expect(
        within(screen.getByTestId("check-rules")).getAllByText("All links work")
          .length,
      ).toBeGreaterThan(0),
    );
    fireEvent.click(within(check).getByRole("button", { name: "Try it" }));
    expect(
      await within(check).findByText(/1 link is broken/),
    ).toBeInTheDocument();
    fireEvent.click(within(check).getByRole("button", { name: "Add check" }));
    await waitFor(() => expect(api.addStep).toHaveBeenCalled());
    const [, at] = api.addStep.mock.calls[0];
    expect(at.from).toBe("step_writer");
    expect(at.to).toBe("step_sender");
    expect(at.step.kind).toBe("check");
    expect(at.step.check.kind).toBe("rules");
    expect(at.step.failTo).toBe("step_writer");
    // After: what's now right, and what's left (frame 14).
    expect(await screen.findByText("New check added")).toBeInTheDocument();
    expect(
      screen.getByText("Writer's work is checked before it goes on"),
    ).toBeInTheDocument();
  });

  it("the + on an arrow offers a check, a bot or you (frames 11–12)", async () => {
    const { api } = installMockFlowsApi();
    render(<GraphView workspace={workspace} />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add a step between Notes reader and Writer",
      }),
    );
    const menu = screen.getByTestId("add-step-menu");
    expect(
      within(menu).getByText("Add between Notes reader and Writer"),
    ).toBeInTheDocument();
    fireEvent.click(within(menu).getByText("You approve"));
    await waitFor(() => expect(api.addStep).toHaveBeenCalled());
    expect(api.addStep.mock.calls[0][1].step.kind).toBe("you");
  });

  it("a step opens beside the graph and says what it reads, writes and is checked by (frame 6)", async () => {
    installMockFlowsApi();
    const onOpenBot = jest.fn();
    render(<GraphView workspace={workspace} onOpenBot={onOpenBot} />);
    fireEvent.click(await screen.findByRole("button", { name: "AI: Writer" }));
    const panel = await screen.findByTestId("step-panel");
    expect(within(panel).getByText("Reads → writes")).toBeInTheDocument();
    expect(
      within(panel).getByText(/writes its record: text, links/),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText("Nothing: Sender takes what it makes"),
    ).toBeInTheDocument();
    fireEvent.click(
      within(panel).getByRole("button", { name: "Edit this bot" }),
    );
    expect(onOpenBot).toHaveBeenCalledWith("bot_w", "settings");
  });

  it("removing a field another step uses names that step first (frame 27)", async () => {
    installMockFlowsApi();
    render(<GraphView workspace={workspace} />);
    fireEvent.click(await screen.findByRole("button", { name: "AI: Writer" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "What its record must have" }),
    );
    const panel = await screen.findByTestId("fields-panel");
    await waitFor(() =>
      expect(within(panel).getAllByTestId("field-row")).toHaveLength(2),
    );
    await waitFor(() =>
      expect(within(panel).getByText("Sender")).toBeInTheDocument(),
    );
    fireEvent.click(within(panel).getByRole("button", { name: "Remove text" }));
    expect(within(panel).getByTestId("field-break")).toHaveTextContent(
      "Sender uses text",
    );
    fireEvent.click(within(panel).getByRole("button", { name: "Keep text" }));
    expect(within(panel).queryByTestId("field-break")).not.toBeInTheDocument();
  });

  it("New flow: a starter shows what it makes before anything is made (frames 22–24)", async () => {
    const { api } = installMockFlowsApi({ flows: [] });
    const onOpenGoals = jest.fn();
    render(<GraphView workspace={workspace} onOpenGoals={onOpenGoals} />);
    expect(await screen.findByText("No flows yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New flow" }));
    fireEvent.click(await screen.findByTestId("starter-daily-brief"));
    const card = await screen.findByTestId("flow-proposal");
    expect(
      within(card).getByText("Every AI step is checked by something"),
    ).toBeInTheDocument();
    expect(
      within(card).getByText("Make 2 bots: Calendar + email, Brief writer"),
    ).toBeInTheDocument();
    expect(api.make).not.toHaveBeenCalled();
    fireEvent.click(
      within(card).getByRole("button", { name: "Make this flow" }),
    );
    await waitFor(() => expect(api.make).toHaveBeenCalled());
    const banner = await screen.findByTestId("flow-made-banner");
    expect(banner).toHaveTextContent("Daily brief is set up.");
    fireEvent.click(within(banner).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(api.undo).toHaveBeenCalledWith("flow_made01"));
  });
});
