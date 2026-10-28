/**
 * The Widget Builder's publish prompt: private by default (public when the
 * widget already is), the public note, publishing with the choice, the
 * personal-folder check, sign-in, and nothing shown for a widget the user
 * can't publish.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PublishBuiltWidget, publishedText } from "./PublishBuiltWidget";

const appId = "@test/app";
const pkg = "@ai-built/smart-lights";
const plan = {
  success: true,
  package: pkg,
  publishable: true,
  publishAs: "@trops/smart-lights",
  version: "0.1.0",
  exists: false,
  visibility: "private",
};

function mount(api = {}) {
  window.mainApi = {
    profiles: {
      planBuiltPublish: jest.fn().mockResolvedValue(plan),
      publishBuilt: jest.fn().mockResolvedValue({
        success: true,
        status: "published",
        publishedAs: "@trops/smart-lights",
        version: "0.1.0",
        visibility: "private",
        dashboardsSwitched: 1,
      }),
      ...api,
    },
    registryAuth: {
      getProfile: jest.fn().mockResolvedValue({ username: "trops" }),
    },
  };
  const onPublished = jest.fn();
  const view = render(
    <PublishBuiltWidget
      appId={appId}
      packageName={pkg}
      onPublished={onPublished}
    />,
  );
  return { onPublished, ...view };
}

afterEach(() => {
  delete window.mainApi;
});

describe("PublishBuiltWidget", () => {
  test("private by default, and publishes with that", async () => {
    const { onPublished } = mount();
    const priv = await screen.findByLabelText("Private — only you");
    expect(priv).toBeChecked();
    expect(screen.queryByText(/Anyone can find and install it/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Publish to my account" }),
    );
    expect(await screen.findByTestId("publish-built-done")).toHaveTextContent(
      "Published @trops/smart-lights 0.1.0 to your account (private). 1 dashboard uses it now. @ai-built/smart-lights stays installed — remove it from Widgets when you're ready.",
    );
    expect(window.mainApi.profiles.publishBuilt).toHaveBeenCalledWith(
      appId,
      pkg,
      { visibility: "private", confirmPersonalPaths: false },
    );
    expect(onPublished).toHaveBeenCalled();
  });

  test("public: says what that means, and sends it", async () => {
    mount();
    fireEvent.click(
      await screen.findByLabelText("Public — anyone can install it"),
    );
    expect(
      screen.getByText(/Each version you publish stays in the registry/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Publish to my account" }),
    );
    await waitFor(() =>
      expect(window.mainApi.profiles.publishBuilt.mock.calls[0][2]).toEqual({
        visibility: "public",
        confirmPersonalPaths: false,
      }),
    );
  });

  test("already public: stays public — making it private is the Widgets page's job", async () => {
    mount({
      planBuiltPublish: jest.fn().mockResolvedValue({
        ...plan,
        exists: true,
        visibility: "public",
      }),
    });
    expect(await screen.findByTestId("publish-built-public")).toHaveTextContent(
      "hides every version, including from people who installed it",
    );
    expect(screen.queryByLabelText("Private — only you")).toBeNull();
    expect(screen.getByTestId("publish-built-exists")).toHaveTextContent(
      "Publishes as a new version of @trops/smart-lights, already in your account.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Publish to my account" }),
    );
    await waitFor(() =>
      expect(window.mainApi.profiles.publishBuilt.mock.calls[0][2]).toEqual({
        visibility: "public",
        confirmPersonalPaths: false,
      }),
    );
  });

  test("published but not installed here: done, never published twice", async () => {
    mount({
      publishBuilt: jest.fn().mockResolvedValue({
        success: false,
        status: "failed",
        published: true,
        publishedAs: "@trops/smart-lights",
        version: "0.1.0",
        visibility: "private",
        error: "Published, but installing it here failed: offline.",
      }),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Publish to my account" }),
    );
    expect(await screen.findByTestId("publish-built-done")).toBeInTheDocument();
    expect(screen.getByText(/installing it here failed/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Publish to my account" }),
    ).toBeNull();
  });

  test("dashboards switched: they're re-read", async () => {
    const seen = jest.fn();
    window.addEventListener("dash:workspaces-changed", seen);
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Publish to my account" }),
    );
    await screen.findByTestId("publish-built-done");
    expect(seen).toHaveBeenCalled();
    window.removeEventListener("dash:workspaces-changed", seen);
  });

  test("can't publish now (account unreachable, name taken): says why", async () => {
    mount({
      planBuiltPublish: jest.fn().mockResolvedValue({
        ...plan,
        publishable: false,
        why: "name-taken",
        reason:
          "@trops/smart-lights is already the name of a dashboard you published — rename the widget to publish it.",
      }),
    });
    expect(await screen.findByTestId("publish-built-why")).toHaveTextContent(
      "rename the widget to publish it",
    );
  });

  test("files that mention this computer's folders: shown, then published anyway", async () => {
    const publishBuilt = jest
      .fn()
      .mockResolvedValueOnce({
        success: false,
        status: "needs-confirmation",
        findings: [{ file: "a.js", match: "/Users/me" }],
      })
      .mockResolvedValueOnce({
        success: true,
        publishedAs: "@trops/smart-lights",
        version: "0.1.0",
        visibility: "private",
      });
    mount({ publishBuilt });
    fireEvent.click(
      await screen.findByRole("button", { name: "Publish to my account" }),
    );
    expect(await screen.findByTestId("publish-built-paths")).toHaveTextContent(
      "a.js: /Users/me",
    );
    // Not ticked: says so, doesn't try again.
    fireEvent.click(
      screen.getByRole("button", { name: "Publish to my account" }),
    );
    expect(screen.getByText(/Tick "Publish anyway"/)).toBeInTheDocument();
    expect(publishBuilt).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Publish anyway"));
    fireEvent.click(
      screen.getByRole("button", { name: "Publish to my account" }),
    );
    await screen.findByTestId("publish-built-done");
    expect(publishBuilt.mock.calls[1][2].confirmPersonalPaths).toBe(true);
  });

  test("signed out: asks to sign in", async () => {
    mount({
      planBuiltPublish: jest
        .fn()
        .mockResolvedValue({ success: false, signInRequired: true }),
    });
    expect(
      await screen.findByRole("button", { name: "Sign in to publish" }),
    ).toBeInTheDocument();
  });

  test("someone else's widget: nothing to offer", async () => {
    const planBuiltPublish = jest.fn().mockResolvedValue({
      ...plan,
      publishable: false,
      why: "not-yours",
      reason: "Published by someone else",
    });
    const { container } = mount({ planBuiltPublish });
    await waitFor(() => expect(planBuiltPublish).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  test("a failure says why", async () => {
    mount({
      publishBuilt: jest
        .fn()
        .mockResolvedValue({ success: false, error: "Registry said no" }),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Publish to my account" }),
    );
    expect(await screen.findByText("Registry said no")).toBeInTheDocument();
  });

  test("publishedText", () => {
    expect(
      publishedText({
        publishedAs: "@trops/x",
        version: "1.0.0",
        visibility: "public",
        dashboardsSwitched: 2,
      }),
    ).toBe(
      "Published @trops/x 1.0.0 to your account (public). 2 dashboards use it now.",
    );
  });
});
