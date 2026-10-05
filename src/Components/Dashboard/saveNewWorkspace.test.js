import { saveNewWorkspace, isSavedWorkspace } from "./saveNewWorkspace";

describe("saveNewWorkspace", () => {
  const workspace = { id: 123, name: "Daily Brief", layout: [] };

  it("resolves once dashApi.saveWorkspace reports success", async () => {
    const dashApi = {
      saveWorkspace: jest.fn((appId, ws, onOk) => onOk({}, { ok: true })),
    };
    await expect(
      saveNewWorkspace({ dashApi, appId: "app-1", workspace }),
    ).resolves.toEqual({ ok: true });
    expect(dashApi.saveWorkspace).toHaveBeenCalledWith(
      "app-1",
      workspace,
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("rejects with a readable message when the save fails", async () => {
    const dashApi = {
      saveWorkspace: jest.fn((appId, ws, onOk, onErr) =>
        onErr({}, { message: "disk full" }),
      ),
    };
    await expect(
      saveNewWorkspace({ dashApi, appId: "app-1", workspace }),
    ).rejects.toThrow("disk full");
  });

  it("rejects when saveWorkspace throws synchronously", async () => {
    const dashApi = {
      saveWorkspace: jest.fn(() => {
        throw new Error("ipc gone");
      }),
    };
    await expect(
      saveNewWorkspace({ dashApi, appId: "app-1", workspace }),
    ).rejects.toThrow("ipc gone");
  });

  it("rejects when there is no dashApi or appId to save with", async () => {
    await expect(
      saveNewWorkspace({ dashApi: null, appId: "app-1", workspace }),
    ).rejects.toThrow(/couldn't save/i);
    await expect(
      saveNewWorkspace({
        dashApi: { saveWorkspace: jest.fn() },
        appId: null,
        workspace,
      }),
    ).rejects.toThrow(/couldn't save/i);
  });
});

describe("isSavedWorkspace", () => {
  const saved = [{ id: 1 }, { id: "2" }];

  it("is true only for a workspace in the saved list", () => {
    expect(isSavedWorkspace(saved, 1)).toBe(true);
    expect(isSavedWorkspace(saved, 2)).toBe(true);
    expect(isSavedWorkspace(saved, 3)).toBe(false);
  });

  it("is false with no id or no saved list", () => {
    expect(isSavedWorkspace(saved, null)).toBe(false);
    expect(isSavedWorkspace(null, 1)).toBe(false);
    expect(isSavedWorkspace([], 1)).toBe(false);
  });
});
