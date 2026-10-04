/**
 * ThemesPage — the Themes Manage page as list + detail
 * (app-navigation PRD NAV-009).
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";

jest.mock("../Settings/details/DiscoverThemesDetail", () => ({
  DiscoverThemesDetail: () => <div data-testid="discover" />,
}));
jest.mock("../Settings/details/PublishThemeModal", () => ({
  PublishThemeModal: ({ isOpen, themeKey }) =>
    isOpen ? <div data-testid="publish">{themeKey}</div> : null,
}));
jest.mock("../Theme/ThemeManagerModal", () => ({
  ThemeManagerModal: ({ open }) =>
    open ? <div data-testid="theme-wizard" /> : null,
}));

import { ThemesPage } from "./ThemesPage";

const variant = (hex) => ({
  cssValue: {
    "bg-neutral-very-dark": hex,
    "bg-primary-dark": hex,
  },
});
const processed = (name, extra = {}) => ({
  name,
  primary: "indigo",
  dark: variant("#000001"),
  light: variant("#ffff01"),
  ...extra,
});
const themes = {
  "theme-a": processed("Aurora"),
  "theme-b": processed("Bravo"),
  "theme-c": processed("Coral", { _registryMeta: { package: "@x/coral" } }),
};
const rawThemes = {
  "theme-a": { id: "theme-a", name: "Aurora", primary: "indigo" },
  "theme-b": { id: "theme-b", name: "Bravo", primary: "sky" },
  "theme-c": { id: "theme-c", name: "Coral", _registryMeta: {} },
};
const workspaces = [
  { id: 1, name: "Kitchen Sink", themeKey: "theme-b" },
  { id: 2, name: "Plain" },
];

function setup(props = {}, ctxOver = {}) {
  const ctx = {
    themes,
    rawThemes,
    themeKey: "theme-a",
    themeVariant: "dark",
    currentTheme: {},
    changeCurrentTheme: jest.fn(),
    changeThemeVariant: jest.fn(),
    changeThemesForApplication: jest.fn(),
    ...ctxOver,
  };
  const dashApi = {
    saveTheme: jest.fn((appId, key, theme, ok) =>
      ok(null, { themes: { ...rawThemes, [key]: theme } }),
    ),
    deleteTheme: jest.fn((appId, key, ok) => ok(null, { themes: rawThemes })),
    listThemes: jest.fn(),
  };
  const onOpenWorkspace = jest.fn();
  const onOpenThemeEditor = jest.fn();
  const utils = render(
    <ThemeContext.Provider value={ctx}>
      <ThemesPage
        workspaces={workspaces}
        dashApi={dashApi}
        credentials={{ appId: "app" }}
        onOpenWorkspace={onOpenWorkspace}
        onOpenThemeEditor={onOpenThemeEditor}
        {...props}
      />
    </ThemeContext.Provider>,
  );
  return { ...utils, ctx, dashApi, onOpenWorkspace, onOpenThemeEditor };
}

const list = () => screen.getByRole("list", { name: "Themes" });
const detail = () => screen.getByTestId("theme-detail");
const names = () =>
  within(list())
    .getAllByRole("button")
    .map((b) => b.querySelector("[data-name]").textContent);
const row = (name) =>
  within(list())
    .getAllByRole("button")
    .find((b) => b.querySelector("[data-name]").textContent === name);

describe("ThemesPage list (NAV-009 AC1)", () => {
  it("lists the app theme first with where each theme is used", () => {
    setup();
    expect(names()).toEqual(["Aurora", "Bravo", "Coral"]);
    expect(within(row("Aurora")).getByText("App theme")).toBeInTheDocument();
    expect(
      within(row("Bravo")).getByText("Used by 1 dashboard"),
    ).toBeInTheDocument();
    expect(within(row("Coral")).getByText("Not in use")).toBeInTheDocument();
  });

  it("searches and filters by in use / not used", () => {
    setup();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "cor" },
    });
    expect(names()).toEqual(["Coral"]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("radio", { name: "In use" }));
    expect(names()).toEqual(["Aurora", "Bravo"]);
    fireEvent.click(screen.getByRole("radio", { name: "Not used" }));
    expect(names()).toEqual(["Coral"]);
  });

  it("the Light / Dark switch changes the app's variant", () => {
    const { ctx } = setup();
    fireEvent.click(screen.getByRole("switch"));
    expect(ctx.changeThemeVariant).toHaveBeenCalledWith("light");
  });

  it("Browse marketplace shows the theme marketplace", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Browse marketplace" }));
    expect(screen.getByTestId("discover")).toBeInTheDocument();
  });

  it("New Theme opens the creation wizard", () => {
    const onCreateAcknowledged = jest.fn();
    setup({ createRequested: true, onCreateAcknowledged });
    expect(screen.getByTestId("theme-wizard")).toBeInTheDocument();
    expect(onCreateAcknowledged).toHaveBeenCalled();
  });
});

describe("ThemesPage detail (NAV-009 AC2)", () => {
  it("previews the theme, with a Dark / Light preview toggle that leaves the app alone", () => {
    const { ctx } = setup();
    fireEvent.click(row("Bravo"));
    const preview = within(detail()).getByTestId("theme-preview");
    expect(preview.style.backgroundColor).toBe("rgb(0, 0, 1)");
    fireEvent.click(within(detail()).getByRole("radio", { name: "Light" }));
    expect(
      within(detail()).getByTestId("theme-preview").style.backgroundColor,
    ).toBe("rgb(255, 255, 1)");
    expect(ctx.changeThemeVariant).not.toHaveBeenCalled();
  });

  it("shows the palette and the dashboards using it, with Open", () => {
    const { onOpenWorkspace } = setup();
    fireEvent.click(row("Bravo"));
    expect(within(detail()).getByText("primary")).toBeInTheDocument();
    fireEvent.click(within(detail()).getByRole("button", { name: "Open" }));
    expect(onOpenWorkspace).toHaveBeenCalledWith(workspaces[0]);
  });
});

describe("ThemesPage actions (NAV-009 AC3)", () => {
  it("the app theme says so and can't be deleted", () => {
    setup();
    fireEvent.click(row("Aurora"));
    expect(
      within(detail()).queryByRole("button", { name: "Use as app theme" }),
    ).toBeNull();
    expect(within(detail()).getByText("Current app theme")).toBeTruthy();
    expect(within(detail()).queryByRole("button", { name: "Delete" })).toBe(
      null,
    );
  });

  it("uses another theme as the app theme", () => {
    const { ctx } = setup();
    fireEvent.click(row("Bravo"));
    fireEvent.click(
      within(detail()).getByRole("button", { name: "Use as app theme" }),
    );
    expect(ctx.changeCurrentTheme).toHaveBeenCalledWith("theme-b");
  });

  it("Edit theme opens the editor on that theme", () => {
    const { onOpenThemeEditor } = setup();
    fireEvent.click(row("Bravo"));
    fireEvent.click(
      within(detail()).getByRole("button", { name: "Edit theme" }),
    );
    expect(onOpenThemeEditor).toHaveBeenCalledWith("theme-b");
  });

  it("Duplicate saves a copy and selects it", async () => {
    const { dashApi, ctx } = setup();
    fireEvent.click(row("Bravo"));
    fireEvent.click(
      within(detail()).getByRole("button", { name: "Duplicate" }),
    );
    expect(dashApi.saveTheme).toHaveBeenCalledTimes(1);
    const [appId, key, theme] = dashApi.saveTheme.mock.calls[0];
    expect(appId).toBe("app");
    expect(key).toMatch(/^theme-\d+$/);
    expect(theme).toMatchObject({ name: "Bravo (Copy)", primary: "sky" });
    expect(ctx.changeThemesForApplication).toHaveBeenCalled();
  });

  it("Publish is offered for your own themes, not registry ones", () => {
    setup();
    fireEvent.click(row("Bravo"));
    fireEvent.click(within(detail()).getByRole("button", { name: "Publish…" }));
    expect(screen.getByTestId("publish")).toHaveTextContent("theme-b");
    fireEvent.click(row("Coral"));
    expect(
      within(detail()).queryByRole("button", { name: "Publish…" }),
    ).toBeNull();
  });

  it("delete asks first (naming the dashboards using it), then deletes", async () => {
    const { dashApi } = setup();
    fireEvent.click(row("Bravo"));
    fireEvent.click(within(detail()).getByRole("button", { name: "Delete" }));
    const modal = screen.getByTestId("confirmation-modal");
    expect(
      within(modal).getByText(
        "Kitchen Sink uses it and will switch to the app theme. This can't be undone.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(modal).getByText("Delete"));
    await waitFor(() =>
      expect(dashApi.deleteTheme).toHaveBeenCalledWith(
        "app",
        "theme-b",
        expect.any(Function),
        expect.any(Function),
      ),
    );
  });
});
