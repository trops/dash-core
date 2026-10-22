/**
 * CreateModal — Type: Auto and Type: Theme (create-entry PRD CRE-001 AC3,
 * phase 5c): Auto works out what to make and carries on as that type, with
 * "picked by Auto · Change"; Theme opens the theme editor on an unsaved
 * theme, or says why it couldn't.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { CreateModal } from "./CreateModal";
import { pickType } from "./autoType";
import { themeFromPrompt } from "./themeFromPrompt";

jest.mock("../Settings/sections/ProvidersSection", () => ({
  ProvidersSection: () => <div data-testid="providers-section" />,
}));
jest.mock("../../ComponentManager", () => ({
  ComponentManager: { config: () => null },
}));
jest.mock("../Settings/details/BotDetail", () => ({
  BotDetail: ({ bot }) => (
    <div data-testid="bot-form">{bot ? bot.instructions : "(blank)"}</div>
  ),
}));
jest.mock("./autoType", () => ({
  ...jest.requireActual("./autoType"),
  pickType: jest.fn(),
}));
jest.mock("./themeFromPrompt", () => ({
  ...jest.requireActual("./themeFromPrompt"),
  themeFromPrompt: jest.fn(),
}));

function setup(props = {}) {
  window.mainApi = {
    llm: {
      checkCliAvailable: jest.fn().mockResolvedValue({ available: true }),
    },
    drafts: { list: jest.fn().mockResolvedValue([]) },
    bots: {
      list: jest.fn().mockResolvedValue([]),
      listCreateRecent: jest.fn().mockResolvedValue([]),
      onCreateRecent: jest.fn(() => 1),
      removeListener: jest.fn(),
    },
  };
  const handlers = {
    setIsOpen: jest.fn(),
    onStartWithoutAi: jest.fn(),
    onOpenTheme: jest.fn(),
  };
  render(
    <ThemeContext.Provider value={{ currentTheme: {} }}>
      <AppContext.Provider
        value={{ providers: {}, settings: {}, changeSettings: jest.fn() }}
      >
        <CreateModal open initialType="auto" {...handlers} {...props} />
      </AppContext.Provider>
    </ThemeContext.Provider>,
  );
  return handlers;
}

const prompt = () =>
  screen.getByRole("textbox", { name: "What do you want to make?" });

afterEach(() => {
  delete window.mainApi;
  jest.clearAllMocks();
});

test("Auto is the type; it decides, then carries on as that type", async () => {
  let resolve;
  pickType.mockReturnValue(new Promise((r) => (resolve = r)));
  setup();
  expect(
    screen.getByRole("button", { name: /^Type: Auto/ }),
  ).toBeInTheDocument();
  expect(prompt()).toHaveAttribute(
    "placeholder",
    expect.stringMatching(/a widget, a bot, a whole dashboard or a theme/),
  );
  fireEvent.change(prompt(), {
    target: { value: "every morning summarize my inbox" },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Deciding what to make…",
  );
  expect(pickType.mock.calls[0][0]).toBe("every morning summarize my inbox");
  resolve({ type: "bot", why: "runs on a schedule", by: "ai" });
  expect(await screen.findByTestId("bot-form")).toHaveTextContent(
    "every morning summarize my inbox",
  );
  expect(screen.getByTestId("auto-pick")).toHaveTextContent(
    "a bot, picked by Auto",
  );
  expect(screen.getByTestId("auto-pick")).toHaveAttribute(
    "title",
    "runs on a schedule",
  );
});

test("Change goes back with the prompt kept and Type set to the pick", async () => {
  pickType.mockResolvedValue({ type: "bot", why: "", by: "guess" });
  setup();
  fireEvent.change(prompt(), { target: { value: "remind me daily" } });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByTestId("bot-form");
  expect(screen.getByTestId("auto-pick")).toHaveTextContent(
    "a bot, guessed by Auto",
  );
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  expect(prompt()).toHaveValue("remind me daily");
  expect(
    screen.getByRole("button", { name: /^Type: Bot/ }),
  ).toBeInTheDocument();
});

test("Theme: the theme editor opens on the generated theme; Create closes", async () => {
  const theme = { id: "theme-1", name: "Autumn", primary: "#c2410c" };
  themeFromPrompt.mockResolvedValue(theme);
  const { onOpenTheme, setIsOpen } = setup({ initialType: "theme" });
  fireEvent.change(prompt(), { target: { value: "warm autumn colors" } });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(onOpenTheme).toHaveBeenCalledWith(theme));
  expect(setIsOpen).toHaveBeenCalledWith(false);
  expect(themeFromPrompt.mock.calls[0][0]).toBe("warm autumn colors");
});

test("Theme: a failure says why and offers Try again", async () => {
  themeFromPrompt
    .mockRejectedValueOnce(new Error("The AI's colors couldn't be used."))
    .mockResolvedValueOnce({ id: "t", name: "Retry" });
  const { onOpenTheme } = setup({ initialType: "theme" });
  fireEvent.change(prompt(), { target: { value: "neon" } });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(
    await screen.findByText("The AI's colors couldn't be used."),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(onOpenTheme).toHaveBeenCalledWith({ id: "t", name: "Retry" }),
  );
});

test("Back while deciding drops the late answer", async () => {
  let resolve;
  pickType.mockReturnValue(new Promise((r) => (resolve = r)));
  setup();
  fireEvent.change(prompt(), { target: { value: "a clock" } });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("status");
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  resolve({ type: "bot", why: "", by: "ai" });
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByTestId("bot-form")).toBeNull();
  expect(prompt()).toHaveValue("a clock");
});
