/**
 * @jest-environment jsdom
 *
 * useInstalledWidgets — a draft saved before its first build (no package
 * on disk yet) is still listed, so the Widgets page offers Resume (QA
 * 2026-10-22: Save as draft from Build by hand never showed up).
 */

import { renderHook, waitFor } from "@testing-library/react";

let mockComponentMap = {};
jest.mock("../ComponentManager", () => ({
  ComponentManager: { componentMap: () => mockComponentMap },
}));
jest.mock("./useWidgetRegistryVersion", () => ({
  useWidgetRegistryVersion: () => 0,
}));

import { useInstalledWidgets } from "./useInstalledWidgets";

afterEach(() => {
  delete window.mainApi;
  mockComponentMap = {};
});

describe("useInstalledWidgets drafts", () => {
  it("lists a draft with no package as a draft entry", async () => {
    window.mainApi = {
      drafts: {
        list: jest
          .fn()
          .mockResolvedValue([{ id: "draft-abc123", name: "QaDraft" }]),
      },
      widgets: { list: jest.fn().mockResolvedValue([]) },
    };
    const { result } = renderHook(() => useInstalledWidgets());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const drafts = result.current.widgets.filter((w) => w.kind === "draft");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      displayName: "QaDraft",
      draftId: "draft-abc123",
      source: "draft",
      version: null,
    });
  });

  it("lists a draft that has a package once, as that package", async () => {
    mockComponentMap = {
      "ai-built.draft-abc123.Thing": {
        type: "widget",
        name: "Thing",
        _sourcePackage: "@ai-built/draft-abc123",
      },
    };
    window.mainApi = {
      drafts: {
        list: jest.fn().mockResolvedValue([
          {
            id: "draft-abc123",
            name: "Thing",
            packageDir: "/w/@ai-built/draft-abc123",
          },
        ]),
      },
      widgets: {
        list: jest.fn().mockResolvedValue([
          {
            name: "@ai-built/draft-abc123",
            packageId: "@ai-built/draft-abc123",
            path: "/w/@ai-built/draft-abc123",
          },
        ]),
      },
    };
    const { result } = renderHook(() => useInstalledWidgets());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const drafts = result.current.widgets.filter((w) => w.kind === "draft");
    expect(drafts.map((w) => w.name)).toEqual(["ai-built.draft-abc123.Thing"]);
  });
});
