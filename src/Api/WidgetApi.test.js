/**
 * WidgetApi.test.js
 *
 */

import { WidgetApi, ownDataFilename } from "./WidgetApi";
import { DashboardPublisher } from "../DashboardPublisher";

const electronApiMock = {
  data: {
    saveData: (data, filename, append) => {
      return { data, filename, append };
    },
    removeAllListeners: () => {
      console.log("remove all listeners");
      return;
    },
  },
};

describe("WidgetApi tests", () => {
  // Mock
  const uuid = "12345";
  const uuid2 = "6789";
  let api, api2;

  const eventName = "CustomSearchbar-10-searchQueryChanged";
  const listeners = {
    handleSearchChange: [eventName], //["CustomSearchbar[10].searchQueryChanged"],
  };

  const pub = DashboardPublisher;

  test("initialize the api", () => {
    api = WidgetApi;
    console.log("api", api);
    expect(api).not.toBe(null);
  });

  test("set the publisher", () => {
    api.setPublisher(pub);
    expect(api.pub()).not.toBe(null);
  });

  test("register listeners", () => {
    const handlerMap = {
      handleSearchChange: (data) => console.log(data),
    };
    api.registerListeners(listeners, handlerMap, uuid);
    expect(api.pub().listeners).not.toBe(null);
  });

  test("register listeners duplicate listener", () => {
    const handlerMap = {
      handleSearchChange: (data) => console.log(data),
    };
    api.registerListeners(listeners, handlerMap, uuid);
    // holds them as an array
    const eventType = listeners[Object.keys(listeners)[0]][0];
    const handlersForKey = api.pub().listeners().get(eventType);
    expect(handlersForKey.length).toEqual(1);
  });

  test("register listeners same event different widget", () => {
    const handlerMap = {
      handleSearchChange: (data) => console.log(data),
    };
    api.registerListeners(listeners, handlerMap, uuid2);
    // holds them as an array
    const eventType = listeners[Object.keys(listeners)[0]][0];
    const handlersForKey = api.pub().listeners().get(eventType);
    expect(handlersForKey.length).toEqual(2);
  });

  test("emit event from pub", () => {
    // holds them as an array
    // const eventType = "CustomSearchbar[10].searchQueryChanged";
    api.publishEvent(eventName, { test: "hello" }, uuid);
    expect(true).toBe(true);
  });

  test("store data to test.txt", () => {
    const dataToSave = "test";
    let result = null;

    api.setElectronApi(electronApiMock);
    api.storeData({
      data: dataToSave,
      filename: "test.txt",
      callbackComplete: (e, message) => {
        console.log("complete", e, message);
        result = message;
        expect(result).not.toBe(null);
      },
      callbackError: (e, message) => {
        console.log("error: ", e, message);
        result = null;
        expect(result).toBe(null);
      },
      append: true,
      uuid,
    });
  });
});

// Every widget shared one WidgetApi, so a file read was tagged with the
// widget that rendered last. WidgetFactory gives each its own.
describe("WidgetApi — one per widget", () => {
  test("each widget's file read carries its own id", () => {
    const reads = [];
    const electron = {
      on: () => {},
      removeAllListeners: () => {},
      events: {},
      data: { readData: (_f, _a, widgetId) => reads.push(widgetId) },
    };
    const notepad = Object.create(WidgetApi);
    const notify = Object.create(WidgetApi);
    notepad.init({ id: 3, name: "trops.dash-samples.NotepadWidget" });
    notepad.setElectronApi(electron);
    notify.init({ id: 4, name: "trops.dash-samples.NotificationWidget" });
    notify.setElectronApi(electron);
    notepad.readData({ uuid: "x" });
    expect(reads).toEqual(["trops.dash-samples.NotepadWidget"]);
  });
});

describe("WidgetApi — file results go to the widget that asked", () => {
  const fakeIpc = () => {
    const listeners = {};
    return {
      listeners,
      on: (evt, fn) => {
        listeners[evt] = [...(listeners[evt] || []), fn];
      },
      removeListener: (evt, fn) =>
        (listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn)),
      removeAllListeners: () => {},
      emit: (evt, payload) =>
        [...(listeners[evt] || [])].forEach((fn) => fn(null, payload)),
      events: {
        DATA_READ_FROM_FILE_COMPLETE: "read-ok",
        DATA_READ_FROM_FILE_ERROR: "read-err",
        DATA_SAVE_TO_FILE_COMPLETE: "save-ok",
        DATA_SAVE_TO_FILE_ERROR: "save-err",
      },
      data: { readData: () => {}, saveData: () => {} },
    };
  };
  const widget = (ipc, name) => {
    const w = Object.create(WidgetApi);
    w.init({ id: 1, name });
    w.setElectronApi(ipc);
    return w;
  };

  test("two widgets reading at once each get their own file", () => {
    const ipc = fakeIpc();
    const got = { a: [], b: [] };
    widget(ipc, "s.p.A").readData({
      filename: "1-s.p.A-1.json",
      callbackComplete: (d) => got.a.push(d),
    });
    widget(ipc, "s.p.B").readData({
      filename: "1-s.p.B-2.json",
      callbackComplete: (d) => got.b.push(d),
    });
    ipc.emit("read-ok", {
      filename: "/data/1-s.p.A-1.json",
      data: JSON.stringify({ who: "A" }),
    });
    ipc.emit("read-ok", {
      filename: "/data/1-s.p.B-2.json",
      data: JSON.stringify({ who: "B" }),
    });
    expect(got).toEqual({ a: [{ who: "A" }], b: [{ who: "B" }] });
    expect(ipc.listeners["read-ok"]).toEqual([]);
    expect(ipc.listeners["read-err"]).toEqual([]);
  });

  test("an error for another widget's file isn't reported to this one", () => {
    const ipc = fakeIpc();
    const errs = [];
    widget(ipc, "s.p.A").storeData({
      data: {},
      filename: "1-s.p.A-1.json",
      callbackError: (e) => errs.push(e),
    });
    ipc.emit("save-err", { filename: "1-s.p.B-2.json", message: "denied" });
    expect(errs).toEqual([]);
    ipc.emit("save-err", { filename: "1-s.p.A-1.json", message: "denied" });
    expect(errs).toHaveLength(1);
  });

  test("the shared api (no widget) refuses file access", () => {
    const ipc = fakeIpc();
    const calls = [];
    ipc.data.readData = () => calls.push("read");
    const errs = [];
    const shared = Object.create(WidgetApi);
    shared.setElectronApi(ipc);
    shared.readData({ filename: "x.json", callbackError: (e) => errs.push(e) });
    expect(calls).toEqual([]);
    expect(errs[0].message).toMatch(/own api/);
  });
});

describe("WidgetApi — a widget's own data (no filename, no prompt)", () => {
  const ipcWith = () => {
    const listeners = {};
    const calls = { save: [], read: [] };
    return {
      calls,
      on: (evt, fn) => {
        listeners[evt] = [...(listeners[evt] || []), fn];
      },
      removeListener: (evt, fn) =>
        (listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn)),
      removeAllListeners: () => {},
      emit: (evt, payload) =>
        [...(listeners[evt] || [])].forEach((fn) => fn(null, payload)),
      events: {
        DATA_READ_FROM_FILE_COMPLETE: "read-ok",
        DATA_READ_FROM_FILE_ERROR: "read-err",
        DATA_SAVE_TO_FILE_COMPLETE: "save-ok",
        DATA_SAVE_TO_FILE_ERROR: "save-err",
      },
      data: {
        readData: (...a) => calls.read.push(a),
        saveData: (...a) => calls.save.push(a),
      },
    };
  };
  const widget = (ipc) => {
    const w = Object.create(WidgetApi);
    w.init({ id: "7-a-3", name: "ai-built.shoppinglist.ShoppingList" });
    w.setElectronApi(ipc);
    return w;
  };

  test("no filename: the widget's own file — never undefined.json", () => {
    const ipc = ipcWith();
    widget(ipc).storeData({ data: { a: 1 } });
    widget(ipc).readData({ callbackComplete: () => {} });
    const own = ownDataFilename("ai-built.shoppinglist.ShoppingList", "7-a-3");
    expect(own).toBe("ai-built.shoppinglist.ShoppingList--7-a-3.json");
    expect(ipc.calls.save[0][1]).toBe(own);
    expect(ipc.calls.read[0][0]).toBe(own);
  });

  test("readData(callback, callback) still works", () => {
    const ipc = ipcWith();
    const got = [];
    widget(ipc).readData(
      (d) => got.push(d),
      () => {},
    );
    ipc.emit("read-ok", {
      filename: "/data/ai-built.shoppinglist.ShoppingList--7-a-3.json",
      data: JSON.stringify({ items: ["Milk"] }),
    });
    expect(got).toEqual([{ items: ["Milk"] }]);
  });

  test("storeData({ items }) saves that object, replacing what was there", () => {
    const ipc = ipcWith();
    widget(ipc).storeData({ items: ["Milk", "Eggs"] });
    const [data, filename, append] = ipc.calls.save[0];
    expect(data).toEqual({ items: ["Milk", "Eggs"] });
    expect(filename).toMatch(/--7-a-3\.json$/);
    expect(append).toBe(false);
  });

  test("saveState / loadState: a promise, the value back as saved", async () => {
    const ipc = ipcWith();
    const saved = widget(ipc).saveState(["Milk", "Eggs"]);
    const [data, filename, append] = ipc.calls.save[0];
    expect([data, append]).toEqual([{ value: ["Milk", "Eggs"] }, false]);
    ipc.emit("save-ok", { filename: `/data/${filename}` });
    await expect(saved).resolves.toEqual(["Milk", "Eggs"]);

    const loaded = widget(ipc).loadState([]);
    ipc.emit("read-ok", {
      filename: `/data/${filename}`,
      data: JSON.stringify({ value: ["Milk", "Eggs"] }),
    });
    await expect(loaded).resolves.toEqual(["Milk", "Eggs"]);
  });

  test('false, 0 and "" save and load like any value', async () => {
    const ipc = ipcWith();
    widget(ipc).saveState(false);
    expect(ipc.calls.save[0][0]).toEqual({ value: false });
    const loaded = widget(ipc).loadState(true);
    ipc.emit("read-ok", {
      filename: "/data/ai-built.shoppinglist.ShoppingList--7-a-3.json",
      data: JSON.stringify({ value: 0 }),
    });
    await expect(loaded).resolves.toBe(0);
  });

  test("loadState: nothing saved yet → the fallback; a failure rejects", async () => {
    const ipc = ipcWith();
    const empty = widget(ipc).loadState({ items: [] });
    ipc.emit("read-ok", {
      filename: "/data/ai-built.shoppinglist.ShoppingList--7-a-3.json",
      data: JSON.stringify([]),
    });
    await expect(empty).resolves.toEqual({ items: [] });
    const bad = widget(ipc).loadState([]);
    ipc.emit("read-err", {
      filename: "ai-built.shoppinglist.ShoppingList--7-a-3.json",
      message: "disk full",
    });
    await expect(bad).rejects.toThrow("disk full");
  });
});
