import React from "react";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import { DiscardList } from "./DiscardList";

jest.mock("../../Context", () => ({
  ThemeContext: require("react").createContext({ currentTheme: {} }),
}));

describe("DiscardList (phase 1e)", () => {
  test("lists what will be discarded", () => {
    render(
      <DiscardList
        changes={{ discarded: ["Added a row", "Removed Emails"], kept: [] }}
      />,
    );
    const list = screen.getByRole("list", {
      name: "Changes that will be discarded",
    });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Added a row", "Removed Emails"]);
    expect(screen.queryByText("Kept")).toBeNull();
  });

  test("says what is kept", () => {
    render(
      <DiscardList
        changes={{
          discarded: ["Added Weather"],
          kept: ["Widgets you installed stay installed."],
        }}
      />,
    );
    expect(screen.getByText("Kept")).toBeInTheDocument();
    expect(
      screen.getByText("Widgets you installed stay installed."),
    ).toBeInTheDocument();
  });
});
