/**
 * MountTokenWrapper.test.js — the mount registers the widget type AND the
 * placed widget ("<dashboardId>:<uuid>"), so the MCP gate can keep each
 * placed widget's grant on its own (DASH-46).
 */
import React from "react";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MountTokenWrapper } from "./MountTokenWrapper";
import { gateInstanceId } from "../utils/scopedComponentId";

describe("MountTokenWrapper", () => {
  let registerMount;
  let unregisterMount;

  beforeEach(() => {
    let n = 0;
    registerMount = jest.fn(async () => `token-${++n}`);
    unregisterMount = jest.fn();
    window.mainApi = { framework: { registerMount, unregisterMount } };
  });

  afterEach(() => {
    delete window.mainApi;
  });

  test("registers (scopedId, '<dashboardId>:<uuid>')", async () => {
    const instanceId = gateInstanceId({ dashboardId: 17, uuid: "u1" });
    render(
      <MountTokenWrapper
        widgetId="ai-built.notesfolder.NotesFolder"
        instanceId={instanceId}
        widgetData={{}}
      >
        <span>child</span>
      </MountTokenWrapper>,
    );
    await waitFor(() => expect(registerMount).toHaveBeenCalledTimes(1));
    expect(registerMount).toHaveBeenCalledWith(
      "ai-built.notesfolder.NotesFolder",
      "17:u1",
    );
  });

  test("a new uuid registers again and drops the old token", async () => {
    const { rerender } = render(
      <MountTokenWrapper widgetId="a.b.C" instanceId="17:u1" widgetData={{}}>
        <span>child</span>
      </MountTokenWrapper>,
    );
    await waitFor(() => expect(registerMount).toHaveBeenCalledTimes(1));
    rerender(
      <MountTokenWrapper widgetId="a.b.C" instanceId="17:u2" widgetData={{}}>
        <span>child</span>
      </MountTokenWrapper>,
    );
    await waitFor(() => expect(registerMount).toHaveBeenCalledTimes(2));
    expect(registerMount).toHaveBeenLastCalledWith("a.b.C", "17:u2");
    expect(unregisterMount).toHaveBeenCalledWith("token-1");
  });

  test("no instance: registers with null", async () => {
    render(
      <MountTokenWrapper widgetId="a.b.C" widgetData={{}}>
        <span>child</span>
      </MountTokenWrapper>,
    );
    await waitFor(() => expect(registerMount).toHaveBeenCalledTimes(1));
    expect(registerMount).toHaveBeenCalledWith("a.b.C", null);
  });
});

describe("gateInstanceId", () => {
  test("'<dashboardId>:<uuid>', or null when either is missing", () => {
    expect(gateInstanceId({ dashboardId: 17, uuid: "u1" })).toBe("17:u1");
    expect(gateInstanceId({ dashboardId: "ws1", uuid: 3 })).toBe("ws1:3");
    expect(gateInstanceId({ dashboardId: 0, uuid: "u1" })).toBe("0:u1");
    expect(gateInstanceId({ uuid: "u1" })).toBeNull();
    expect(gateInstanceId({ dashboardId: 17 })).toBeNull();
    expect(gateInstanceId({ dashboardId: 17, uuid: "" })).toBeNull();
    expect(gateInstanceId(null)).toBeNull();
  });
});
