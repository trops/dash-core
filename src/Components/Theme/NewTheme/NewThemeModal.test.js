/**
 * New theme window (canvas page "New theme (proposed)"): Start from →
 * Colors → Strength → Name, live preview, Create theme says what's missing.
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { NewThemeModal } from "./NewThemeModal";

function setup({ dashApi: apiOver = {}, ctxOver = {}, props = {} } = {}) {
  const ctx = {
    currentTheme: {},
    themes: { "theme-a": { name: "Ocean" } },
    rawThemes: { "theme-a": { name: "Ocean" } },
    themeKey: "theme-a",
    themeVariant: "dark",
    changeCurrentTheme: jest.fn(),
    changeThemesForApplication: jest.fn(),
    ...ctxOver,
  };
  // Like ThemeWrapper: saved themes arrive in rawThemes on the next render.
  const Harness = ({ children }) => {
    const [raw, setRaw] = React.useState(ctx.rawThemes);
    const value = {
      ...ctx,
      rawThemes: raw,
      changeThemesForApplication: (t) => {
        ctx.changeThemesForApplication(t);
        setRaw((r) => ({ ...r, ...t }));
      },
    };
    return (
      <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    );
  };
  const dashApi = {
    saveTheme: jest.fn((appId, key, theme, ok) =>
      ok(null, { themes: { [key]: theme } }),
    ),
    extractThemeFromUrl: jest.fn(),
    mapPaletteToTheme: jest.fn(),
    ...apiOver,
  };
  const onClose = jest.fn();
  const onCreated = jest.fn();
  render(
    <AppContext.Provider value={{ dashApi, credentials: { appId: "app" } }}>
      <Harness>
        <NewThemeModal
          open
          onClose={onClose}
          onCreated={onCreated}
          {...props}
        />
      </Harness>
    </AppContext.Provider>,
  );
  return { ctx, dashApi, onClose, onCreated };
}

const createBtn = () => screen.getByRole("button", { name: "Create theme" });
const pickStart = (label) =>
  fireEvent.click(screen.getByRole("button", { name: label }));
const nameBox = () => screen.getByLabelText("Theme name");
const savedTheme = (dashApi) => dashApi.saveTheme.mock.calls[0][2];

afterEach(() => {
  delete window.mainApi;
});

describe("New theme", () => {
  test("opens on the first preset, previewed, nothing saved yet", () => {
    const { dashApi } = setup();
    expect(screen.getByText("Pick a preset")).toBeInTheDocument();
    expect(screen.getByTestId("new-theme-preview")).toBeInTheDocument();
    expect(nameBox()).toHaveValue("Ocean Depth");
    expect(
      screen.getByText("Nothing is saved until you create it."),
    ).toBeInTheDocument();
    expect(dashApi.saveTheme).not.toHaveBeenCalled();
  });

  test("a preset names it, previews it at its strength, and Create makes it the app theme", () => {
    const { ctx, dashApi, onClose, onCreated } = setup();
    const presets = screen.getByTestId("presets");
    fireEvent.click(within(presets).getByText("Sunset Ember"));
    expect(nameBox()).toHaveValue("Sunset Ember");
    expect(screen.getByTestId("four-colors")).toBeInTheDocument();
    expect(screen.getByTestId("new-theme-preview")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Bold" }));
    expect(screen.getByText("Preview · Bold")).toBeInTheDocument();
    fireEvent.click(createBtn());
    expect(savedTheme(dashApi)).toEqual(
      expect.objectContaining({
        name: "Sunset Ember",
        primary: "orange",
        strength: "bold",
      }),
    );
    const key = dashApi.saveTheme.mock.calls[0][1];
    expect(ctx.changeThemesForApplication).toHaveBeenCalled();
    expect(ctx.changeCurrentTheme).toHaveBeenCalledWith(key);
    expect(onCreated).toHaveBeenCalledWith({
      key,
      name: "Sunset Ember",
      usedForApp: true,
      previousAppKey: "theme-a",
    });
    expect(onClose).toHaveBeenCalled();
  });

  test("Just save it leaves the app theme alone", () => {
    const { ctx, dashApi } = setup();
    fireEvent.click(
      within(screen.getByTestId("presets")).getByText("Sunset Ember"),
    );
    fireEvent.click(
      screen.getByRole("switch", { name: "Use it for the app now" }),
    );
    fireEvent.click(createBtn());
    expect(dashApi.saveTheme).toHaveBeenCalled();
    expect(ctx.changeCurrentTheme).not.toHaveBeenCalled();
  });

  test("no name: Create is off and says why", () => {
    setup();
    fireEvent.click(
      within(screen.getByTestId("presets")).getByText("Sunset Ember"),
    );
    fireEvent.change(nameBox(), { target: { value: "" } });
    expect(screen.getByTestId("name-needed")).toHaveTextContent(
      "Give it a name to create it.",
    );
    // Said in the footer too, beside the button.
    expect(screen.getByTestId("new-theme-note")).toHaveTextContent(
      "Give it a name to create it.",
    );
    expect(createBtn()).toBeDisabled();
  });

  test("a name typed by hand isn't replaced by the next pick", () => {
    setup();
    fireEvent.change(nameBox(), { target: { value: "Mine" } });
    fireEvent.click(
      within(screen.getByTestId("presets")).getByText("Sunset Ember"),
    );
    expect(nameBox()).toHaveValue("Mine");
  });

  test("click a color to change it", () => {
    const { dashApi } = setup();
    fireEvent.click(
      within(screen.getByTestId("presets")).getByText("Sunset Ember"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Change Main" }));
    const edit = screen.getByTestId("color-edit");
    fireEvent.click(within(edit).getByRole("button", { name: "Pick blue" }));
    fireEvent.click(createBtn());
    expect(savedTheme(dashApi).primary).toBe("#3b82f6");
    expect(savedTheme(dashApi).secondary).toBe("rose");
  });

  test("or paste a color for one of the four", () => {
    const { dashApi } = setup();
    fireEvent.click(
      within(screen.getByTestId("presets")).getByText("Sunset Ember"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Change Greys" }));
    const edit = screen.getByTestId("color-edit");
    fireEvent.change(within(edit).getByLabelText("Or paste a color"), {
      target: { value: "123456" },
    });
    fireEvent.click(within(edit).getByRole("button", { name: "Use" }));
    fireEvent.click(createBtn());
    expect(savedTheme(dashApi).neutral).toBe("#123456");
  });

  test("a name Dash filled in doesn't follow you to another start", () => {
    setup();
    expect(nameBox()).toHaveValue("Ocean Depth");
    pickStart("One color");
    expect(nameBox()).toHaveValue("");
    expect(createBtn()).toBeDisabled();
  });

  test("one color: the others go with it", () => {
    setup();
    pickStart("One color");
    expect(screen.getByText("Pick a color")).toBeInTheDocument();
    expect(screen.getByTestId("four-colors")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Three-way" }));
    expect(screen.getByRole("radio", { name: "Three-way" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("Surprise me: random colors, greys stay grey", () => {
    const { dashApi } = setup();
    pickStart("Surprise me");
    fireEvent.click(screen.getByRole("button", { name: "↻ Shuffle again" }));
    fireEvent.change(nameBox(), { target: { value: "Lucky" } });
    fireEvent.click(createBtn());
    const neutral = savedTheme(dashApi).neutral;
    expect(
      ["gray", "slate", "zinc", "neutral", "stone"].includes(neutral) ||
        /^#[0-9a-f]{6}$/i.test(neutral),
    ).toBe(true);
  });

  test("a website: Get colors finds them and names the theme", () => {
    const palette = [
      { hex: "#0ea5e9" },
      { hex: "#f59e0b" },
      { hex: "#f43f5e" },
      { hex: "#78716c" },
      { hex: "#111111" },
    ];
    const { dashApi } = setup({
      dashApi: {
        extractThemeFromUrl: jest.fn((url, ok) =>
          ok(null, { success: true, data: { palette } }),
        ),
        mapPaletteToTheme: jest.fn((p, overrides, ok) =>
          ok(null, {
            theme: {
              primary: "sky",
              secondary: "amber",
              tertiary: "rose",
              neutral: "stone",
            },
          }),
        ),
      },
    });
    pickStart("A website");
    fireEvent.change(screen.getByLabelText("Website address"), {
      target: { value: "https://www.example-coffee.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Get colors" }));
    // Dash decides which found color does which job.
    expect(dashApi.mapPaletteToTheme.mock.calls[0][1]).toEqual({});
    expect(
      screen.getByText(
        "Found 5 colors on the site — Dash picked the four below. Click one to swap it.",
      ),
    ).toBeInTheDocument();
    expect(nameBox()).toHaveValue("Example Coffee");
  });

  test("a website answer that arrives after you moved on is ignored", () => {
    let answer = null;
    const { dashApi } = setup({
      dashApi: {
        extractThemeFromUrl: jest.fn((url, ok) => {
          answer = () =>
            ok(null, {
              success: true,
              data: { palette: [{ hex: "#0ea5e9" }] },
            });
        }),
        mapPaletteToTheme: jest.fn(),
      },
    });
    pickStart("A website");
    fireEvent.change(screen.getByLabelText("Website address"), {
      target: { value: "https://slow.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Get colors" }));
    pickStart("A preset");
    fireEvent.click(
      within(screen.getByTestId("presets")).getByText("Sunset Ember"),
    );
    answer();
    expect(dashApi.mapPaletteToTheme).not.toHaveBeenCalled();
    expect(nameBox()).toHaveValue("Sunset Ember");
  });

  test("a website that fails says so", () => {
    setup({
      dashApi: {
        extractThemeFromUrl: jest.fn((url, ok) =>
          ok(null, { success: false, error: { message: "Page not found" } }),
        ),
      },
    });
    pickStart("A website");
    fireEvent.change(screen.getByLabelText("Website address"), {
      target: { value: "https://nope.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Get colors" }));
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(createBtn()).toBeDisabled();
  });

  test("the registry: pick a theme others made; it keeps the credit", async () => {
    window.mainApi = {
      registry: {
        searchThemes: jest.fn(async () => ({
          packages: [
            {
              scope: "@maria",
              name: "nordic-dawn",
              displayName: "Nordic Dawn",
              author: "maria",
              version: "1.2.0",
              strength: "subtle",
              colors: {
                primary: "sky",
                secondary: "pink",
                tertiary: "amber",
                neutral: "slate",
              },
            },
          ],
        })),
      },
    };
    const { dashApi } = setup();
    pickStart("The registry");
    expect(screen.getByText("Pick a theme")).toBeInTheDocument();
    const results = await screen.findByTestId(
      "registry-results",
      {},
      { timeout: 2000 },
    );
    expect(within(results).getByText("by maria")).toBeInTheDocument();
    fireEvent.click(within(results).getByText("Nordic Dawn"));
    expect(nameBox()).toHaveValue("Nordic Dawn");
    expect(screen.getByRole("radio", { name: "Subtle" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(createBtn());
    expect(savedTheme(dashApi)).toEqual(
      expect.objectContaining({
        name: "Nordic Dawn",
        primary: "sky",
        strength: "subtle",
        remixedFrom: { package: "maria/nordic-dawn", version: "1.2.0" },
      }),
    );
  });

  test("a save that fails stays open and says why", () => {
    const { onClose } = setup({
      dashApi: {
        saveTheme: jest.fn((appId, key, theme, ok, fail) =>
          fail(null, { message: "disk full" }),
        ),
      },
    });
    fireEvent.click(
      within(screen.getByTestId("presets")).getByText("Sunset Ember"),
    );
    fireEvent.click(createBtn());
    expect(screen.getByTestId("new-theme-note")).toHaveTextContent(
      "Couldn't save the theme: disk full",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  test("describe it opens a Dash Lead conversation and closes", async () => {
    const { onClose } = setup();
    const heard = jest.fn();
    window.addEventListener("dash:open-workspace", heard);
    fireEvent.click(
      screen.getByRole("button", { name: "describe it to the Dash Lead" }),
    );
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(heard).toHaveBeenCalled());
    expect(heard.mock.calls[0][0].detail.making).toEqual({
      kind: "theme",
      from: "themes",
    });
    window.removeEventListener("dash:open-workspace", heard);
  });
});
