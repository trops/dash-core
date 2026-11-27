/**
 * Repo checks rows (DASH-110, DASH-120): PR links open in the browser
 * (DASH-130).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { RepoChecksRows } from "./TeamChecksPanel";

describe("RepoChecksRows PR links (DASH-130)", () => {
  const openExternal = jest.fn();
  beforeEach(() => {
    window.mainApi = { shell: { openExternal } };
  });
  afterEach(() => {
    delete window.mainApi;
    openExternal.mockReset();
  });
  const data = (over = {}) => ({
    repos: [],
    withChecks: [],
    checks: [],
    busy: null,
    note: null,
    setUp: () => {},
    resolve: () => {},
    ...over,
  });

  it("a team check's PR opens in the browser", () => {
    const url = "https://github.com/o/web/pull/3";
    render(
      <RepoChecksRows
        data={data({
          checks: [
            { name: "lint", file: "lint.sh", state: "pr-open", pr: { url } },
          ],
        })}
      />,
    );
    const link = screen.getByText(url);
    expect(link.tagName).toBe("A");
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith(url);
  });

  it("so does the one Set up checks just opened", () => {
    const url = "https://github.com/o/web/pull/4";
    render(
      <RepoChecksRows
        data={data({
          note: { url, text: ": setup and validate, tried in a fresh clone." },
        })}
      />,
    );
    expect(screen.getByTestId("team-checks-note")).toHaveTextContent(
      `Opened ${url}: setup and validate, tried in a fresh clone.`,
    );
    fireEvent.click(screen.getByText(url));
    expect(openExternal).toHaveBeenCalledWith(url);
  });

  it("an error note stays plain text", () => {
    render(<RepoChecksRows data={data({ note: "No token" })} />);
    expect(screen.getByTestId("team-checks-note")).toHaveTextContent(
      "No token",
    );
  });
});
