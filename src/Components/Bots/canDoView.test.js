import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  ALWAYS_BLOCKED,
  builtinLevel,
  canDoView,
  providerLabel,
  readableFolder,
} from "./canDoView";
import { WhatItCanDo } from "./WhatItCanDo";

const { blockedBy } = require("../../../electron/checks/commandRules");

const worker = {
  id: "bot_w",
  name: "Worker",
  approvalPolicy: "unattended",
  projects: ["/Users/sam/Work/{repo.key}"],
  commands: { allowed: ["git", "npm test", " "], blocked: ["curl"] },
  mcpServers: ["github", "notes", "github"],
  toolSelections: { github: ["create_branch", "push"], gone: ["x"] },
};

describe("canDoView (DASH-126)", () => {
  it("reads a bot's setup: files, folders, asks, commands, providers", () => {
    const v = canDoView(worker);
    expect(v.builtins).toBe("all");
    expect(v.files).toBe("All, only in");
    expect(v.folders).toEqual(["~/Work/<repo>"]);
    expect(v.asks).toBe("Nothing (unattended, its folders only)");
    expect(v.commands).toEqual({
      shell: true,
      runs: ["git", "npm test"],
      never: ["curl"],
      note: null,
    });
    expect(v.providers).toEqual([
      {
        name: "github",
        label: "GitHub",
        tools: ["create_branch", "push"],
      },
      { name: "notes", label: "Notes", tools: null },
    ]);
    expect(v.alwaysBlocked).toMatch(/^Always blocked for every bot: /);
  });

  it("defaults: all built-ins, ask policy, no folder, no command list", () => {
    const v = canDoView({ id: "b" });
    expect(v.files).toBe("All, not limited to a folder");
    expect(v.asks).toMatch(/sends, changes or deletes/);
    expect(v.commands.note).toMatch(/^No list/);
    expect(v.providers).toEqual([]);
  });

  it("read-only and none built-ins can't run commands", () => {
    const ro = canDoView({ ...worker, builtinTools: "read-only" });
    expect(ro.files).toBe("Read only, only in");
    expect(ro.commands).toMatchObject({ shell: false, runs: [], never: [] });
    expect(ro.commands.note).toMatch(/can't run commands/);
    const none = canDoView({ ...worker, builtinTools: "none" });
    expect(none.files).toBe("None");
    expect(none.folders).toEqual([]);
  });

  it("a lead has no built-in tools; every policy has wording", () => {
    expect(builtinLevel({ role: "lead" })).toBe("none");
    expect(builtinLevel(null)).toBe("none");
    for (const p of ["ask", "ask-every", "allow", "unattended"]) {
      expect(canDoView({ approvalPolicy: p }).asks).toBeTruthy();
    }
    expect(canDoView({ approvalPolicy: "weird" }).asks).toBe(
      canDoView({}).asks,
    );
  });

  it("an empty tool list means no tools", () => {
    const v = canDoView({
      mcpServers: ["slack"],
      toolSelections: { slack: [] },
    });
    expect(v.providers[0].tools).toEqual([]);
  });

  it("readableFolder", () => {
    expect(readableFolder("/Users/sam")).toBe("~");
    expect(readableFolder("/home/sam/code/")).toBe("~/code");
    expect(readableFolder("C:\\Users\\sam\\code")).toBe("~\\code");
    expect(readableFolder("{workDir}/{repo.dir}")).toBe("<workDir>/<repo.dir>");
    expect(readableFolder("/srv/app")).toBe("/srv/app");
    expect(readableFolder("")).toBe("");
  });

  it("providerLabel", () => {
    expect(providerLabel("github")).toBe("GitHub");
    expect(providerLabel("google-drive")).toBe("Google Drive");
    expect(providerLabel("My Tracker")).toBe("My Tracker");
  });

  it("the always-blocked list matches the rules runs enforce", () => {
    const samples = [
      "git push --force",
      "git reset --hard",
      "rm -rf x",
      "git push origin main",
      "npm publish",
    ];
    const labels = samples.map((c) => blockedBy(c).label);
    expect([...labels].sort()).toEqual([...ALWAYS_BLOCKED].sort());
  });
});

describe("WhatItCanDo", () => {
  it("shows each label with its value, chips and the blocked list once", () => {
    const onEdit = jest.fn();
    render(<WhatItCanDo bot={worker} onEdit={onEdit} />);
    expect(screen.getByText("What it can do")).toBeInTheDocument();
    const files = screen.getByTestId("can-do-files");
    expect(within(files).getByText("Files and shell")).toBeInTheDocument();
    expect(within(files).getByText("~/Work/<repo>")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("can-do-runs")).getByText("npm test"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("can-do-never")).getByText("curl"),
    ).toBeInTheDocument();
    const gh = screen.getByTestId("can-do-provider-github");
    expect(within(gh).getByText("GitHub")).toBeInTheDocument();
    expect(within(gh).getByText("push")).toBeInTheDocument();
    expect(screen.getByText("Notes: every tool it offers")).toBeInTheDocument();
    expect(screen.getAllByText(/Always blocked for every bot/)).toHaveLength(1);
    fireEvent.click(screen.getByText("Edit"));
    expect(onEdit).toHaveBeenCalled();
  });

  it("no Edit without onEdit; nothing without a bot", () => {
    const { container, rerender } = render(<WhatItCanDo bot={null} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<WhatItCanDo bot={{ id: "b", role: "lead" }} />);
    expect(screen.queryByText("Edit")).toBeNull();
    expect(
      within(screen.getByTestId("can-do-providers")).getByText("None"),
    ).toBeInTheDocument();
  });
});
