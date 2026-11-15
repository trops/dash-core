/**
 * Edit theme window (canvas page "Edit theme (proposed)"): opens on the
 * colors with a dashboard preview; click a part to change it in plain
 * words; changes marked with Reset; Dark/Light scope; Cancel asks first.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ThemeContext } from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { EditThemeModal, countChanges } from "./EditThemeModal";

const OCEAN = {
  id: "ocean",
  name: "Ocean",
  primary: "blue",
  secondary: "indigo",
  tertiary: "rose",
  neutral: "gray",
  strength: "balanced",
  dark: {},
  light: {},
};

function setup({ raw = OCEAN, saveFails = false } = {}) {
  const ctx = {
    currentTheme: {},
    rawThemes: { ocean: raw },
    themeVariant: "dark",
    changeThemesForApplication: jest.fn(),
  };
  const dashApi = {
    saveTheme: jest.fn((appId, key, theme, ok, err) =>
      saveFails ? err(null, "nope") : ok(null, { themes: { [key]: theme } }),
    ),
  };
  const onClose = jest.fn();
  const onSaved = jest.fn();
  render(
    <AppContext.Provider value={{ dashApi, credentials: { appId: "app" } }}>
      <ThemeContext.Provider value={ctx}>
        <EditThemeModal
          open
          themeKey="ocean"
          onClose={onClose}
          onSaved={onSaved}
        />
      </ThemeContext.Provider>
    </AppContext.Provider>,
  );
  return { ctx, dashApi, onClose, onSaved };
}

const save = () => screen.getByRole("button", { name: "Save changes" });
const note = () => screen.getByTestId("edit-theme-note");
const preview = () => screen.getByTestId("edit-theme-preview");
const clickPart = (id) =>
  fireEvent.click(preview().querySelector(`[data-part="${id}"]`).firstChild);
const pane = () => screen.getByTestId("part-pane");

describe("Edit theme", () => {
  test("opens on the colors with a preview, nothing changed", () => {
    setup();
    expect(screen.getByTestId("colors-pane")).toBeInTheDocument();
    expect(preview()).toBeInTheDocument();
    expect(screen.getByLabelText("Theme name")).toHaveValue("Ocean");
    expect(note()).toHaveTextContent("No changes yet.");
    expect(save()).toBeDisabled();
  });

  test("click a part in the preview to change it", () => {
    setup();
    clickPart("button-2");
    expect(within(pane()).getByText("Button 2")).toBeInTheDocument();
    expect(within(pane()).getByText(/The second button/)).toBeInTheDocument();
    // The list opened on its group, with it picked.
    expect(
      screen.getByRole("button", { name: "Buttons 4", expanded: true }),
    ).toBeInTheDocument();
  });

  test("pick a color: marked as changed, with Reset", () => {
    setup();
    clickPart("button-2");
    fireEvent.click(within(pane()).getByRole("button", { name: /^Fill:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Highlight · Dark" }));
    expect(
      within(pane()).getByText(/Highlight · Dark \(changed\)/),
    ).toBeInTheDocument();
    expect(within(pane()).getByText("1 change")).toBeInTheDocument();
    expect(note()).toHaveTextContent("1 change not saved yet.");
    expect(save()).toBeEnabled();
    expect(screen.getAllByText("Changed").length).toBeGreaterThan(0);
    fireEvent.click(within(pane()).getByRole("button", { name: "Reset Fill" }));
    expect(note()).toHaveTextContent("No changes yet.");
  });

  test("Light only changes Light and shows it", () => {
    const { dashApi } = setup();
    clickPart("button-2");
    fireEvent.click(screen.getByRole("radio", { name: "Light only" }));
    fireEvent.click(within(pane()).getByRole("button", { name: /^Fill:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Highlight · Dark" }));
    expect(screen.getByTestId("preview-note")).toHaveTextContent(
      "this part's changes are for Light only",
    );
    fireEvent.click(save());
    const saved = dashApi.saveTheme.mock.calls[0][2];
    expect(saved.light["button-2"].backgroundColor).toBe("bg-tertiary-700");
    expect(saved.dark["button-2"]).toBeUndefined();
  });

  test("the note follows what is stored, not the switch", () => {
    setup();
    clickPart("button-2");
    fireEvent.click(within(pane()).getByRole("button", { name: /^Fill:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Highlight · Dark" }));
    fireEvent.click(screen.getByRole("radio", { name: "Light only" }));
    expect(screen.getByTestId("preview-note")).not.toHaveTextContent(
      "Light only",
    );
  });

  test("Reset under Dark only leaves Light's change", () => {
    const { dashApi } = setup();
    clickPart("button-2");
    fireEvent.click(within(pane()).getByRole("button", { name: /^Fill:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Highlight · Dark" }));
    fireEvent.click(screen.getByRole("radio", { name: "Dark only" }));
    fireEvent.click(within(pane()).getByRole("button", { name: "Reset Fill" }));
    expect(screen.getByTestId("preview-note")).toHaveTextContent(
      "for Light only",
    );
    fireEvent.click(save());
    const saved = dashApi.saveTheme.mock.calls[0][2];
    expect(saved.light["button-2"].backgroundColor).toBe("bg-tertiary-700");
    expect(saved.dark["button-2"]).toBeUndefined();
  });

  test("an unknown strength reads as Balanced", () => {
    setup({ raw: { ...OCEAN, strength: "loud" } });
    expect(screen.getByText("Preview · Balanced")).toBeInTheDocument();
  });

  test("save writes the theme and closes", () => {
    const { dashApi, ctx, onClose, onSaved } = setup();
    clickPart("card");
    fireEvent.click(within(pane()).getByRole("button", { name: /^Fill:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Greys · Darkest" }));
    fireEvent.click(save());
    const [appId, key, theme] = dashApi.saveTheme.mock.calls[0];
    expect(appId).toBe("app");
    expect(key).toBe("ocean");
    expect(theme.dark["card-2"].backgroundColor).toBe("bg-neutral-900");
    expect(ctx.changeThemesForApplication).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith("ocean");
    expect(onClose).toHaveBeenCalled();
  });

  test("a failed save keeps the changes and says so", () => {
    const { onClose } = setup({ saveFails: true });
    fireEvent.click(screen.getByRole("button", { name: /^Strength/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Bold" }));
    fireEvent.click(save());
    expect(note()).toHaveTextContent("Couldn't save the theme");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("Cancel with changes asks first", () => {
    const { onClose } = setup();
    clickPart("button-2");
    fireEvent.click(within(pane()).getByRole("button", { name: /^Fill:/ }));
    fireEvent.click(screen.getByRole("button", { name: "Highlight · Dark" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Leave without saving?")).toBeInTheDocument();
    expect(
      screen.getByText("You changed 1 thing in Button 2. They'll be lost."),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Leave without saving" }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  test("Cancel with nothing changed just closes", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  test("find a component", () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText("Find a component…"), {
      target: { value: "switch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(within(pane()).getByText("Fill when on")).toBeInTheDocument();
  });

  test("change a color", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Change Highlight" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Pick / })[0]);
    expect(note()).toHaveTextContent("1 change not saved yet.");
  });

  test("countChanges counts parts, colors, strength and name", () => {
    expect(countChanges(OCEAN, OCEAN).total).toBe(0);
    expect(
      countChanges(OCEAN, { ...OCEAN, primary: "#123456", name: "Sea" }).total,
    ).toBe(2);
  });
});
