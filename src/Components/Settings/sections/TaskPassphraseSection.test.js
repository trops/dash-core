/**
 * @jest-environment jsdom
 *
 * Settings › MCP Server › Task passphrase (bot-teams TEAM-016): set it, the
 * short hint, Show / Hide, Change, Remove, the lock's Unlock now, and the
 * teams that take tasks — one per line.
 */

import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@trops/dash-react", () => {
  const R = require("react");
  return {
    ThemeContext: R.createContext({ currentTheme: {} }),
    useStatusTokens: () => ({ warning: { text: "warn-text" } }),
    AlertBanner: ({ message, children }) => (
      <div role="status">
        {message}
        {children}
      </div>
    ),
    Button: ({ title, onClick, disabled }) => (
      <button onClick={onClick} disabled={disabled}>
        {title}
      </button>
    ),
    Button3: ({ title, onClick }) => <button onClick={onClick}>{title}</button>,
    ConfirmationModal: ({ isOpen, title, confirmLabel, onConfirm }) =>
      isOpen ? (
        <div role="dialog">
          {title}
          <button onClick={onConfirm}>{confirmLabel}</button>
        </div>
      ) : null,
    InputText: ({ value, onChange, onKeyDown, ariaLabel, placeholder }) => (
      <input
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    ),
  };
});

jest.mock("../../Dashboard/ConfigListRow", () => ({
  useConfigTokens: () => ({
    muted: "muted",
    strong: "strong",
    hairline: "hairline",
    selectedBg: "selected",
    fieldBg: "field",
  }),
}));

import { TaskPassphraseSection } from "./TaskPassphraseSection";

const workspaces = [
  { id: 7, name: "Room Design" },
  { id: 8, name: "Home Projects" },
];

function install(state, over = {}) {
  let changed = null;
  const bots = {
    getTaskPassphraseState: jest.fn().mockResolvedValue(state),
    listMcpTaskTeams: jest.fn().mockResolvedValue(over.teams || []),
    setTaskPassphrase: jest.fn().mockResolvedValue({ ok: true, short: false }),
    revealTaskPassphrase: jest.fn().mockResolvedValue("purple otter"),
    removeTaskPassphrase: jest.fn().mockResolvedValue({ ok: true }),
    unlockMcpTasks: jest.fn().mockResolvedValue({ ok: true }),
    onMcpTasksChanged: jest.fn((cb) => {
      changed = cb;
      return "1";
    }),
    removeListener: jest.fn(),
  };
  window.mainApi = { bots };
  return { bots, fireChanged: () => changed && changed() };
}

describe("TaskPassphraseSection", () => {
  it("none set: the entry, and that teams won't take tasks", async () => {
    install({ set: false });
    render(<TaskPassphraseSection workspaces={workspaces} />);
    expect(
      await screen.findByPlaceholderText("e.g. purple otter"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("passphrase-none")).toHaveTextContent(
      "No passphrase yet, so teams won't take tasks via MCP.",
    );
    expect(screen.getByTestId("passphrase-teams")).toHaveTextContent(
      "No team takes tasks via MCP yet",
    );
  });

  it("a short one gets the hint; too short can't be saved", async () => {
    const { bots } = install({ set: false });
    render(<TaskPassphraseSection workspaces={workspaces} />);
    const input = await screen.findByLabelText("Passphrase");
    fireEvent.change(input, { target: { value: "otter" } });
    expect(screen.getByTestId("passphrase-short")).toHaveTextContent(
      "Short and easy to guess. Two or three words is safer.",
    );
    fireEvent.change(input, { target: { value: "ot!" } });
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Use at least 4 letters.",
    );
    expect(bots.setTaskPassphrase).not.toHaveBeenCalled();
  });

  it("saves it, then shows it hidden with Show / Change / Remove", async () => {
    const { bots } = install({ set: false });
    render(<TaskPassphraseSection workspaces={workspaces} />);
    const input = await screen.findByLabelText("Passphrase");
    fireEvent.change(input, { target: { value: "purple otter" } });
    bots.getTaskPassphraseState.mockResolvedValue({
      set: true,
      short: false,
      setAt: new Date(2026, 10, 1).toISOString(),
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });
    expect(bots.setTaskPassphrase).toHaveBeenCalledWith("purple otter");
    expect(await screen.findByTestId("passphrase-value")).toHaveTextContent(
      "• • • • • •",
    );
    expect(screen.getByText(/^Set Nov 1\. Agents never see it/)).toBeTruthy();
    expect(screen.getByText("Change")).toBeInTheDocument();
  });

  it("Show reveals it, Hide hides it again", async () => {
    const { bots } = install({ set: true, short: false });
    render(<TaskPassphraseSection workspaces={workspaces} />);
    const show = await screen.findByText("Show");
    await act(async () => {
      fireEvent.click(show);
    });
    expect(bots.revealTaskPassphrase).toHaveBeenCalled();
    expect(screen.getByTestId("passphrase-value")).toHaveTextContent(
      "purple otter",
    );
    fireEvent.click(screen.getByText("Hide"));
    expect(screen.getByTestId("passphrase-value")).toHaveTextContent(
      "• • • • • •",
    );
  });

  it("Change opens the entry with Cancel; Remove asks first", async () => {
    const { bots } = install({ set: true, short: true });
    render(<TaskPassphraseSection workspaces={workspaces} />);
    // A short saved one keeps its hint.
    expect(
      await screen.findByText(
        "Short and easy to guess. Two or three words is safer.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Change"));
    expect(screen.getByLabelText("Passphrase")).toHaveValue("");
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByText("Remove"));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Remove the task passphrase?",
    );
    await act(async () => {
      fireEvent.click(screen.getAllByText("Remove")[1]);
    });
    expect(bots.removeTaskPassphrase).toHaveBeenCalled();
  });

  it("locked: says until when, with Unlock now", async () => {
    const until = new Date(2026, 10, 1, 9, 31).toISOString();
    const { bots } = install({ set: true, lockedUntil: until });
    render(<TaskPassphraseSection workspaces={workspaces} />);
    expect(await screen.findByRole("status")).toHaveTextContent(
      /5 wrong passphrases via MCP · tasks are locked until 9:31/,
    );
    await act(async () => {
      fireEvent.click(screen.getByText("Unlock now"));
    });
    expect(bots.unlockMcpTasks).toHaveBeenCalled();
  });

  it("lists the teams that take tasks, one per line, and follows changes", async () => {
    const { bots, fireChanged } = install({ set: true }, { teams: ["7"] });
    render(<TaskPassphraseSection workspaces={workspaces} />);
    expect(await screen.findByText("Room Design")).toBeInTheDocument();
    expect(screen.queryByText("Home Projects")).toBeNull();
    bots.listMcpTaskTeams.mockResolvedValue(["7", "8", "99"]);
    await act(async () => fireChanged());
    await waitFor(() =>
      expect(screen.getByText("Home Projects")).toBeInTheDocument(),
    );
    // A dashboard that's gone isn't listed.
    expect(screen.getByTestId("passphrase-teams").children).toHaveLength(3);
  });

  it("the short hint is a warning, alone (not with 'No passphrase yet')", async () => {
    install({ set: false });
    render(<TaskPassphraseSection workspaces={workspaces} />);
    fireEvent.change(await screen.findByLabelText("Passphrase"), {
      target: { value: "otter" },
    });
    expect(screen.getByTestId("passphrase-short")).toHaveClass("warn-text");
    expect(screen.queryByTestId("passphrase-none")).toBeNull();
  });

  it("says why it didn't save when Dash refuses it (over 200 characters)", async () => {
    const { bots } = install({ set: false });
    bots.setTaskPassphrase.mockResolvedValue({
      ok: false,
      error: "Keep it under 200 characters.",
    });
    render(<TaskPassphraseSection workspaces={workspaces} />);
    fireEvent.change(await screen.findByLabelText("Passphrase"), {
      target: { value: "purple otter ".repeat(20) },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Keep it under 200 characters.",
    );
  });

  it("Show that fails says so", async () => {
    const { bots } = install({ set: true });
    bots.revealTaskPassphrase.mockRejectedValue(new Error("x"));
    render(<TaskPassphraseSection workspaces={workspaces} />);
    const show = await screen.findByText("Show");
    await act(async () => {
      fireEvent.click(show);
    });
    expect(screen.getByTestId("passphrase-notice")).toHaveTextContent(
      "Couldn't show the passphrase. Try again.",
    );
  });

  it("a shown phrase hides when it's changed elsewhere", async () => {
    const { bots, fireChanged } = install({
      set: true,
      setAt: "2026-11-01T08:00:00Z",
    });
    render(<TaskPassphraseSection workspaces={workspaces} />);
    const show = await screen.findByText("Show");
    await act(async () => {
      fireEvent.click(show);
    });
    expect(screen.getByTestId("passphrase-value")).toHaveTextContent(
      "purple otter",
    );
    bots.getTaskPassphraseState.mockResolvedValue({
      set: true,
      setAt: "2026-11-01T09:00:00Z",
    });
    await act(async () => fireChanged());
    await waitFor(() =>
      expect(screen.getByTestId("passphrase-value")).toHaveTextContent(
        "• • • • • •",
      ),
    );
  });

  it("the lock goes away on its own when it runs out", async () => {
    jest.useFakeTimers();
    try {
      const until = new Date(Date.now() + 60 * 1000).toISOString();
      const { bots } = install({ set: true, lockedUntil: until });
      render(<TaskPassphraseSection workspaces={workspaces} />);
      await act(async () => {});
      expect(screen.getByText(/tasks are locked until/)).toBeInTheDocument();
      bots.getTaskPassphraseState.mockResolvedValue({
        set: true,
        lockedUntil: null,
      });
      await act(async () => {
        jest.advanceTimersByTime(61 * 1000);
      });
      await act(async () => {});
      expect(screen.queryByText(/tasks are locked until/)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops listening when closed", async () => {
    const { bots } = install({ set: true });
    const { unmount } = render(
      <TaskPassphraseSection workspaces={workspaces} />,
    );
    await screen.findByText("Show");
    unmount();
    expect(bots.removeListener).toHaveBeenCalledWith("1");
  });
});
