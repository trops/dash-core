/**
 * ThemeQuickCreate — the "ai" method (create-entry phase 5c): a theme made
 * from a description opens with its colors, adjustable with the same
 * hue/saturation/lightness nudges as Random, and no Regenerate.
 */
import React, { useState } from "react";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeQuickCreate } from "./ThemeQuickCreate";

const SEED = {
  id: "theme-1",
  name: "Autumn Ember",
  primary: "#c2410c",
  secondary: "#a16207",
  tertiary: "#7c2d12",
  neutral: "#78716c",
  dark: {},
  light: {},
};

function Host({ onTheme }) {
  const [name, setName] = useState("Autumn Ember");
  const [method, setMethod] = useState(null);
  const [theme, setTheme] = useState(SEED);
  onTheme(theme);
  return (
    <ThemeQuickCreate
      wizardName={name}
      setWizardName={setName}
      wizardMethod={method}
      setWizardMethod={setMethod}
      wizardTheme={theme}
      setWizardTheme={setTheme}
      onComplete={() => {}}
      initialMethod="ai"
      seedTheme={SEED}
    />
  );
}

test("shows the generated colors, no method picker and no Regenerate", async () => {
  const seen = [];
  render(<Host onTheme={(t) => seen.push(t)} />);
  expect(
    await screen.findByText("Made from your description"),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Regenerate/)).toBeNull();
  expect(screen.queryByText("Generation Method")).toBeNull();
  await waitFor(() => {
    const last = seen[seen.length - 1];
    expect(last).toMatchObject({
      primary: "#c2410c",
      secondary: "#a16207",
      tertiary: "#7c2d12",
      neutral: "#78716c",
    });
  });
});
