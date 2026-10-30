/**
 * PublishThemeModal — a theme that's published already (theme change
 * leftovers, frame 53): it starts at its visibility and says so; private
 * when the registry couldn't be asked; never published, as before.
 */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("@trops/dash-react", () => {
  const actual = jest.requireActual("@trops/dash-react");
  return {
    ...actual,
    // The real Modal portals and animates; the content is what's tested.
    Modal: ({ isOpen, children }) =>
      isOpen ? <div data-testid="modal">{children}</div> : null,
  };
});
jest.mock("../../../hooks/useRegistryAuthGate", () => ({
  useRegistryAuthGate: () => ({
    ensureAuthed: async () => true,
    authGate: null,
  }),
}));

import { PublishThemeModal } from "./PublishThemeModal";

function setup(published) {
  window.mainApi = {
    registryAuth: {
      getStatus: jest.fn().mockResolvedValue({ authenticated: true }),
      getProfile: jest
        .fn()
        .mockResolvedValue({ username: "me", displayName: "Me" }),
    },
    themes: {
      getThemePublishPreview: jest.fn().mockResolvedValue({
        success: true,
        colors: {},
        published,
      }),
    },
  };
  render(
    <PublishThemeModal
      isOpen
      setIsOpen={jest.fn()}
      appId="@trops/dash-electron"
      themeKey="theme-dusk"
      themeName="Dusk"
    />,
  );
}

async function toDetails() {
  const next = await screen.findByRole("button", { name: "Next" });
  await waitFor(() => expect(next).not.toBeDisabled());
  fireEvent.click(next);
}

describe("a theme that's published already", () => {
  test("starts at its visibility and says so", async () => {
    setup({
      package: "@me/dusk",
      version: "1.2.0",
      visibility: "private",
      nextVersion: "1.2.1",
      checked: true,
    });
    await toDetails();
    const box = await screen.findByTestId("publish-theme-published");
    expect(box).toHaveTextContent("Published as v1.2.0 · private");
    expect(box).toHaveTextContent(
      "This update is v1.2.1. It stays private unless you change it below.",
    );
    // Private is the chosen one.
    const privateOpt = screen
      .getAllByRole("button")
      .find((b) => /^Private/.test(b.textContent || ""));
    expect(privateOpt.className).toMatch(/border-indigo-500/);
  });

  test("the registry couldn't be asked: it starts private", async () => {
    setup({
      package: "@me/dusk",
      version: "1.2.0",
      visibility: null,
      nextVersion: null,
      checked: false,
    });
    await toDetails();
    const box = await screen.findByTestId("publish-theme-published");
    expect(box).toHaveTextContent(
      "Couldn't check how Dusk is published — it starts private.",
    );
  });

  test("gone from the registry: publishing puts it back, private", async () => {
    setup({
      package: "@me/dusk",
      version: "1.2.0",
      visibility: null,
      nextVersion: null,
      checked: false,
      gone: true,
    });
    await toDetails();
    const box = await screen.findByTestId("publish-theme-published");
    expect(box).toHaveTextContent(
      "Dusk isn't on the registry any more — publishing puts it back. It starts private.",
    );
  });

  test("a choice made before the answer arrives stays", async () => {
    let answer;
    window.mainApi = {
      registryAuth: {
        getStatus: jest.fn().mockResolvedValue({ authenticated: true }),
        getProfile: jest
          .fn()
          .mockResolvedValue({ username: "me", displayName: "Me" }),
      },
      themes: {
        getThemePublishPreview: jest.fn(() => new Promise((r) => (answer = r))),
      },
    };
    render(
      <PublishThemeModal
        isOpen
        setIsOpen={jest.fn()}
        appId="@trops/dash-electron"
        themeKey="theme-dusk"
        themeName="Dusk"
      />,
    );
    await toDetails();
    const publicOpt = () =>
      screen
        .getAllByRole("button")
        .find((b) => /^Public/.test(b.textContent || ""));
    fireEvent.click(publicOpt());
    answer({
      success: true,
      colors: {},
      published: {
        package: "@me/dusk",
        version: "1.2.0",
        visibility: "private",
        nextVersion: "1.2.1",
        checked: true,
      },
    });
    await screen.findByTestId("publish-theme-published");
    expect(publicOpt().className).toMatch(/border-indigo-500/);
  });

  test("never published: no box, public as before", async () => {
    setup(null);
    await toDetails();
    await screen.findByText("Visibility");
    expect(screen.queryByTestId("publish-theme-published")).toBeNull();
    const publicOpt = screen
      .getAllByRole("button")
      .find((b) => /^Public/.test(b.textContent || ""));
    expect(publicOpt.className).toMatch(/border-indigo-500/);
  });
});
