import {
  dropBotForm,
  keepBotForm,
  reopenBotForm,
  worthKeeping,
} from "./botFormDrafts";

const DEF = { name: "Deal Finder", instructions: "Find deals." };

beforeEach(() => {
  window.mainApi = {
    bots: {
      saveCreateRecent: jest.fn().mockResolvedValue({ id: "f1" }),
      removeCreateRecent: jest.fn().mockResolvedValue({ ok: true }),
      getCreateRecent: jest.fn().mockResolvedValue({
        id: "f1",
        kind: "botform",
        conversation: { botForm: { definition: DEF, workspaceId: "9" } },
      }),
    },
  };
});
afterEach(() => {
  delete window.mainApi;
});

describe("botFormDrafts", () => {
  it("keeps a form with a name or instructions, under its id again", async () => {
    expect(worthKeeping({ name: " " })).toBe(false);
    expect(worthKeeping({ instructions: "x" })).toBe(true);
    expect(await keepBotForm({ definition: { name: "" } })).toBeNull();
    expect(
      await keepBotForm({ definition: DEF, workspaceId: "9", draftId: "f1" }),
    ).toBe("f1");
    expect(window.mainApi.bots.saveCreateRecent).toHaveBeenCalledWith({
      id: "f1",
      kind: "botform",
      prompt: "Deal Finder",
      conversation: { botForm: { definition: DEF, workspaceId: "9" } },
    });
  });

  it("drops it once the bot is created", () => {
    dropBotForm("f1");
    expect(window.mainApi.bots.removeCreateRecent).toHaveBeenCalledWith("f1");
    dropBotForm(null);
    expect(window.mainApi.bots.removeCreateRecent).toHaveBeenCalledTimes(1);
  });

  it("reopens it in its form, as it was left", async () => {
    const heard = [];
    const on = (e) => heard.push(e.detail);
    window.addEventListener("dash:new-bot", on);
    expect(await reopenBotForm("f1")).toBe(true);
    window.removeEventListener("dash:new-bot", on);
    expect(heard).toEqual([
      expect.objectContaining({
        workspaceId: "9",
        initial: DEF,
        draftId: "f1",
      }),
    ]);
  });
});
