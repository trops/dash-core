/**
 * TeamChecksPanel (DASH-110, DASH-130): always shown, a line per repo, and
 * PR links that open in the browser.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  TeamChecksPanel,
  repoName,
  repoChecksLine,
  repoLines,
} from "./TeamChecksPanel";

describe("repo lines", () => {
  it("names a repo by its short name, with its check count", () => {
    expect(repoName("trops/dash-core")).toBe("dash-core");
    expect(repoName("solo")).toBe("solo");
    expect(repoChecksLine({ slug: "trops/dash-core", count: 2 })).toBe(
      "dash-core: 2 checks",
    );
    expect(repoChecksLine({ slug: "a/b", count: 1 })).toBe("b: 1 check");
    expect(repoChecksLine({ slug: "a/b", count: 0 })).toBe("b: no checks yet");
    expect(repoChecksLine({ slug: "a/b", count: null })).toBe(
      "b: Dash can't read its checks",
    );
  });

  it("flags the repos without checks, and copes with an older main process", () => {
    expect(
      repoLines({
        repos: [{ key: "b", slug: "a/b" }],
        all: [
          { key: "c", slug: "a/c", count: 2 },
          { key: "b", slug: "a/b", count: 0 },
        ],
      }).map((r) => [r.key, r.needsSetup]),
    ).toEqual([
      ["c", false],
      ["b", true],
    ]);
    expect(repoLines({ repos: [{ key: "b", slug: "a/b" }] })).toEqual([
      { key: "b", slug: "a/b", count: 0, needsSetup: true },
    ]);
    expect(repoLines(null)).toEqual([]);
  });
});

describe("TeamChecksPanel", () => {
  const openExternal = jest.fn();
  const setApi = (bots) => {
    window.mainApi = { bots, shell: { openExternal } };
  };
  afterEach(() => {
    delete window.mainApi;
    openExternal.mockReset();
  });

  it("stays shown when every repo has checks, a line per repo", async () => {
    setApi({
      reposWithoutChecks: () => ({
        repos: [],
        all: [{ key: "dc", slug: "trops/dash-core", count: 2 }],
      }),
      teamChecks: () => ({ checks: [] }),
    });
    render(<TeamChecksPanel workspaceId={1} />);
    expect(await screen.findByText("dash-core: 2 checks")).toBeInTheDocument();
    expect(screen.getByTestId("team-checks-panel")).toBeInTheDocument();
    expect(screen.queryByText("Set up checks")).toBeNull();
  });

  it("says so when the team has no repos", async () => {
    setApi({
      reposWithoutChecks: () => ({ repos: [], all: [] }),
      teamChecks: () => ({ checks: [] }),
    });
    render(<TeamChecksPanel workspaceId={1} />);
    expect(await screen.findByTestId("team-checks-none")).toBeInTheDocument();
  });

  it("a repo without checks offers Set up checks", async () => {
    setApi({
      reposWithoutChecks: () => ({
        repos: [{ key: "b", slug: "a/b" }],
        all: [{ key: "b", slug: "a/b", count: 0 }],
      }),
      teamChecks: () => ({ checks: [] }),
    });
    render(<TeamChecksPanel workspaceId={1} />);
    expect(await screen.findByText("b: no checks yet")).toBeInTheDocument();
    expect(screen.getByTestId("setup-banner-b")).toBeInTheDocument();
    expect(screen.getByText("Set up checks")).toBeInTheDocument();
  });

  it("a check's PR link opens in the browser", async () => {
    const url = "https://github.com/a/b/pull/3";
    setApi({
      reposWithoutChecks: () => ({ repos: [], all: [] }),
      teamChecks: () => ({
        checks: [
          { name: "lint", file: "lint.sh", state: "pr-open", pr: { url } },
        ],
      }),
    });
    render(<TeamChecksPanel workspaceId={1} />);
    const link = await screen.findByText(url);
    expect(link.tagName).toBe("A");
    fireEvent.click(link);
    await waitFor(() => expect(openExternal).toHaveBeenCalledWith(url));
  });
});
