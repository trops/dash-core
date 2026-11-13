/**
 * WidgetApi
 * Include developer methods to easily access the Electron bridge
 *
 * NOTE: This MUST be a class to avoid the Singleton pattern
 * This gets initialized and injected into each Widget initialized with
 * the UUID of the widget.
 * The UUID is then used for filenames, etc and MUST be unique.
 */

/**
 * The file result channels are shared by every widget, and results carry
 * no request id. Each call listens for the result naming its own file and
 * then stops listening — it used to clear every listener on the channel,
 * so the last widget to read got every widget's data (and saved another
 * widget's chat into its own file).
 */
function sameFile(response, filename) {
  const got = response && response.filename;
  if (typeof got !== "string" || !got) return true; // unlabeled: legacy
  return (
    got === filename ||
    got.endsWith(`/${filename}`) ||
    got.endsWith(`\\${filename}`)
  );
}

function awaitFileResult(
  eApi,
  { completeEvent, errorEvent, filename, onComplete, onError },
) {
  if (!onComplete && !onError) return;
  // By the ids `on` returns (the function itself only off Electron).
  let completeId;
  let errorId;
  const stop = () => {
    if (typeof eApi.removeListener !== "function") return;
    eApi.removeListener(completeEvent, completeId || complete);
    eApi.removeListener(errorEvent, errorId || error);
  };
  const complete = (_event, response) => {
    if (!sameFile(response, filename)) return;
    stop();
    if (onComplete) onComplete(response);
  };
  const error = (_event, response) => {
    if (!sameFile(response, filename)) return;
    stop();
    if (onError) onError(response);
  };
  completeId = eApi.on(completeEvent, complete);
  errorId = eApi.on(errorEvent, error);
}

/**
 * A widget copy's own data file: "<widget>--<copy>.json", in Dash's data
 * folder. Reading and writing it never asks the user (it's the widget's
 * own), and a call without a filename uses it — never "undefined.json".
 * The main process recognises it the same way (electron/security/
 * ownDataFile.js) — keep the two in step.
 */
const safePart = (s) =>
  String(s == null ? "" : s).replace(/[^A-Za-z0-9._-]/g, "_");
export function ownDataFilename(widgetName, copyId) {
  return `${safePart(widgetName)}--${safePart(copyId)}.json`;
}

// The options storeData / readData take; an object with none of them is
// the data itself (storeData({ items }) saves { items }).
const DATA_OPTIONS = [
  "data",
  "filename",
  "callbackComplete",
  "callbackError",
  "append",
  "returnEmpty",
  "uuid",
  "widgetId",
];
const isOptions = (o) =>
  !!o &&
  typeof o === "object" &&
  !Array.isArray(o) &&
  DATA_OPTIONS.some((k) => Object.prototype.hasOwnProperty.call(o, k));

// "Nothing saved yet" as the main process reads it: an empty file.
const isEmptyValue = (v) =>
  v == null ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);

/** The shared api (no widget behind it) can't read or write files. */
function refuseUnknownWidget(callbackError) {
  if (callbackError) {
    callbackError({
      success: false,
      message:
        "File access needs the widget's own api (the `api` prop), so Dash knows which widget is asking.",
    });
  }
}

export const WidgetApi = {
  params: null,

  init: function (params) {
    this.params = params;
  },

  setPublisher: function (publisher) {
    this._pub = publisher;
  },

  setElectronApi: function (api) {
    try {
      /**
       * include the main electron apis that we want to expose ONLY
       */
      if (api !== undefined && api !== null) {
        // ElectronDashboardApi wraps the raw mainApi inside this.api.
        // Unwrap it so we get the actual IPC methods (on, data, events, etc).
        const rawApi = api.api || api;
        // set the mainApi to electron inside the widget.
        this._electronApi = {
          on: rawApi.on || {},
          removeAllListeners: rawApi.removeAllListeners || {},
          removeListener: rawApi.removeListener,
          data: rawApi.data || {},
          algolia: rawApi.algolia || {},
          events: rawApi.events || {},
          dialog: rawApi.dialog || {},
        };
      }
    } catch (e) {
      console.log("Error Setting Electron API ", e.message);
    }
  },

  setSettings: function (settings) {
    this._settings = settings;
  },

  id: function () {
    return this.params.id;
  },

  name: function () {
    return this.params.name;
  },

  /** This copy's own data file (see ownDataFilename). */
  ownFilename: function () {
    return ownDataFilename(this.params?.name, this.params?.id);
  },

  /**
   * Save this widget's state — any JSON value — in its own file, replacing
   * what was there. Never asks the user. → Promise of the value saved.
   */
  saveState: function (value) {
    return new Promise((resolve, reject) => {
      // Kept as { value } so false, 0 and "" save too (the main process
      // skips a save of a falsy value).
      this.storeData({
        data: { value },
        append: false,
        callbackComplete: () => resolve(value),
        callbackError: (e) =>
          reject(new Error((e && e.message) || "Couldn't save")),
      });
    });
  },

  /**
   * Load what saveState saved; `fallback` when nothing is saved yet.
   * → Promise of the value.
   */
  loadState: function (fallback = null) {
    return new Promise((resolve, reject) => {
      this.readData({
        callbackComplete: (saved) => {
          const wrapped =
            saved &&
            typeof saved === "object" &&
            !Array.isArray(saved) &&
            Object.keys(saved).length === 1 &&
            Object.prototype.hasOwnProperty.call(saved, "value");
          if (wrapped) resolve(saved.value);
          else resolve(isEmptyValue(saved) ? fallback : saved);
        },
        callbackError: (e) =>
          reject(new Error((e && e.message) || "Couldn't load")),
      });
    });
  },

  settings: function () {
    return this._settings;
  },

  electronApi: function () {
    return this._electronApi;
  },

  pub: function () {
    return this._pub;
  },

  /**
   * publishEvent
   * @param {string} name the name of the widget (TODO - uuid + handler)
   * @param {object} events the payload for the event published
   */
  publishEvent: function (name = null, events, uuid = null, meta = null) {
    try {
      console.log("trying to publish event ", name, uuid);
      if (this.pub() !== null && name !== null && events !== null) {
        if ("pub" in this.pub()) {
          // meta.workspaceId = the publishing widget's dashboard.
          this.pub().pub(name, events, meta);
        }
      }
    } catch (e) {
      console.log("error ", e.message);
    }
  },

  /**
   * registerListeners
   *
   * Register an array of listeners (strings) and set the handler (object)
   * Each handler has a key and Component named the same so we can use the handler
   * methods in code.
   *
   * @param {array} listeners the listeners (event names) that the widget is listening FOR
   * @param {object} handlers the methods/function names that will be triggered when an event is "heard"
   */
  registerListeners: function (listeners, handlers, uuid) {
    try {
      // console.log("registering listeners ", listeners, handlers, uuid);
      if (this.pub() !== null && uuid !== null) {
        if ("registerListeners" in this.pub()) {
          if (this.pub()["registerListeners"] !== null) {
            this.pub().registerListeners(listeners, handlers, uuid);
          }
        }
      }
    } catch (e) {
      console.log(e.message);
    }
  },

  /**
   * chooseFile
   */
  chooseFile: function () {
    try {
      console.log("e api trying to choose file");
      // grab the electron api
      const eApi = this.electronApi();
      if (eApi) {
        // remove the listeners (reset)
        if ("removeAllListeners" in eApi) {
          console.log(eApi);
          // eApi.removeAllListeners();
          // eApi.on(eApi.events.CHOOSE_FILE_COMPLETE, (data) => {
          //     console.log("chose a file");
          // });
          eApi.dialog.chooseFile();
        }
      }
    } catch (e) {
      console.log("choose file error ", e);
    }
  },
  /**
   * storeData
   *
   * Allow the widget to have access to "local storage"
   * Store any object data to the filesystem in a predetermined filepath
   * based on the widget information (dashboard.workspace.widget...)
   *
   * @param {object} data
   * @param {object} options filename - name of the file, callbacks for complete and error
   */
  storeData: function (options = {}) {
    // storeData({ items }) — an object without any of the options is the
    // data itself, saved in place of what was there.
    const opts = isOptions(options)
      ? options
      : { data: options, append: false };
    const {
      data,
      filename = null,
      callbackComplete = null,
      callbackError = null,
      append = true,
      returnEmpty = {},
      uuid,
      // Package-level identity for the fs gate. Defaults to the
      // singleton's `params.name` (set by WidgetFactory at mount). An
      // explicit widgetId passed by the caller wins. The widgetId param
      // is what the gate's `getGrant(widgetId)` lookup keys on, so it
      // MUST match the package name used when grants were written
      // (install consent / Settings → Privacy & Security).
      widgetId = null,
    } = opts;
    try {
      // set the filename: given, else the uuid's, else the widget's own
      const toFilename =
        filename !== null && filename !== undefined
          ? filename
          : uuid
            ? `${uuid}.json`
            : this.ownFilename();

      // grab the electron api
      const eApi = this.electronApi();
      if (eApi) {
        // Auto-thread widgetId from this widget's api (WidgetFactory
        // gives each widget its own) when the caller didn't supply one.
        // This is what makes the fs gate fire for ordinary widgets that
        // call `api.storeData({data, filename})` without knowing about
        // widgetId.
        const effectiveWidgetId = widgetId || this.params?.name || null;
        if (!effectiveWidgetId) {
          refuseUnknownWidget(callbackError);
          return;
        }
        awaitFileResult(eApi, {
          completeEvent: eApi.events.DATA_SAVE_TO_FILE_COMPLETE,
          errorEvent: eApi.events.DATA_SAVE_TO_FILE_ERROR,
          filename: toFilename,
          onComplete: callbackComplete,
          onError: callbackError,
        });
        eApi.data.saveData(
          data,
          toFilename,
          append,
          returnEmpty,
          effectiveWidgetId,
        );
      }
    } catch (e) {
      if (callbackError !== null) {
        callbackError({ message: e.message });
      }
    }
  },

  /**
   * readData
   * Read data from the filesystem (electron)
   *
   * @param {object} options
   * - filename - the name of the file if you want to override the default uuid as filename
   * - callbackComplete - the handler for dealing with the complete callback data
   * - callbackError - the handler for dealing with the error callback data
   * - uuid - the UUID for the widget/workspace
   */
  readData: function (options = {}, onError = null) {
    // readData(onComplete, onError) — callbacks in place of the options.
    const opts =
      typeof options === "function"
        ? { callbackComplete: options, callbackError: onError }
        : options || {};
    const {
      filename = null,
      callbackComplete = null,
      callbackError = null,
      uuid,
      // Phase 2 JIT consent — see storeData for the rationale.
      widgetId = null,
    } = opts;
    try {
      const toFilename =
        filename !== null && filename !== undefined
          ? filename
          : uuid
            ? `${uuid}.json`
            : this.ownFilename();
      const eApi = this.electronApi();
      if (eApi) {
        // Auto-thread widgetId from this widget's api — same as storeData.
        const effectiveWidgetId = widgetId || this.params?.name || null;
        if (!effectiveWidgetId) {
          refuseUnknownWidget(callbackError);
          return;
        }
        awaitFileResult(eApi, {
          completeEvent: eApi.events.DATA_READ_FROM_FILE_COMPLETE,
          errorEvent: eApi.events.DATA_READ_FROM_FILE_ERROR,
          filename: toFilename,
          onComplete:
            callbackComplete &&
            ((response) => {
              // response.data is a JSON string from the main process;
              // parse it so callers receive the actual object.
              let parsed = response;
              if (response?.data) {
                try {
                  parsed = JSON.parse(response.data);
                } catch (_) {
                  parsed = response.data;
                }
              }
              callbackComplete(parsed);
            }),
          onError: callbackError,
        });
        eApi.data.readData(toFilename, [], effectiveWidgetId);
      }
    } catch (e) {
      console.log(e);
    }
  },
};
