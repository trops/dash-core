const { app } = require("electron");
var fs = require("fs");
const path = require("path");
const events = require("../events");
const { getFileContents, writeToFile } = require("../utils/file");
const { safePath, getAllowedRoots } = require("../utils/safePath");
const { gateFsCall, gateFsCallWithJit } = require("../security/fsGate");
const {
  gateNetworkCall,
  gateNetworkCallWithJit,
} = require("../security/networkGate");
const { readEnforceFlag, readJitFlag } = require("../utils/securityFlags");

// Reads the enforcement + JIT flags from settings.json. Mirrors the
// helper in mcpController. The flag is shared across MCP and fs domains
// — see Phase 2 plan for rationale (the cosmetic rename to a
// domain-neutral name is a separate slice).
function _loadFlags() {
  try {
    const settingsPath = path.join(
      app.getPath("userData"),
      appName,
      "settings.json",
    );
    if (!fs.existsSync(settingsPath)) return null;
    return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (_e) {
    return null;
  }
}

/**
 * Run the fs gate before a dataController handler does its work.
 * On deny, sends an error event to the renderer and returns false so
 * the caller can early-out. On allow, returns true.
 *
 * @returns {Promise<boolean>}
 */
async function _runFsGate(win, action, widgetId, args, errorEvent, token) {
  const settings = _loadFlags();
  if (!readEnforceFlag(settings)) return true; // gate disabled
  // Slice 1 (additive): token is the trusted identity when present.
  // If neither token nor widgetId is supplied, legacy bypass still
  // applies; slice 2 will flip this to deny.
  if (!widgetId && !token) return true;
  const gate = readJitFlag(settings)
    ? await gateFsCallWithJit(
        { widgetId, token, action, args },
        { enableJit: true },
      )
    : gateFsCall({ widgetId, token, action, args });
  if (gate.allow) return true;
  if (win && errorEvent) {
    win.webContents.send(errorEvent, {
      success: false,
      message: "fs permission gate: " + gate.reason,
    });
  }
  return false;
}

/**
 * Phase 3 network gate. Same shape as _runFsGate but for outbound
 * URLs. Mirrors fs's "disabled / no widgetId / sync vs async" branching.
 */
async function _runNetworkGate(win, action, widgetId, args, errorEvent, token) {
  const settings = _loadFlags();
  if (!readEnforceFlag(settings)) return true;
  if (!widgetId && !token) return true;
  const gate = readJitFlag(settings)
    ? await gateNetworkCallWithJit(
        { widgetId, token, action, args },
        { enableJit: true },
      )
    : gateNetworkCall({ widgetId, token, action, args });
  if (gate.allow) return true;
  if (win && errorEvent) {
    win.webContents.send(errorEvent, {
      success: false,
      message: "network permission gate: " + gate.reason,
    });
  }
  return false;
}

// Convert Json to Csv
const ObjectsToCsv = require("objects-to-csv");
const Transform = require("../utils/transform");
const https = require("https");

const configFilename = "data.json";
const appName = "Dashboard";

const dataController = {
  /**
   * saveLayout
   * Create a workspace from a json configuration object (no template)
   *
   * @param {BrowserWindow} win the main window
   * @param {string} appId the application id
   * @param {object} pageObject the page config object
   */
  convertJsonToCsvFile: (win, appId, jsonObject, toFilename = "test.csv") => {
    try {
      // Validate the renderer-supplied filename is contained within
      // the data directory. path.join doesn't reject `..` segments;
      // safePath does.
      const candidate = path.join(
        app.getPath("userData"),
        appName,
        appId,
        "data",
        toFilename,
      );
      let filename;
      try {
        filename = safePath(candidate, getAllowedRoots("data"));
      } catch (pathErr) {
        win.webContents.send(events.DATA_JSON_TO_CSV_FILE_ERROR, {
          error: pathErr.message,
        });
        return;
      }

      // make sure the file exists...
      const fileContents = getFileContents(filename, "");

      const csv = new ObjectsToCsv(jsonObject);

      csv
        .toDisk(filename)
        .then((result) => {
          win.webContents.send(events.DATA_JSON_TO_CSV_FILE_COMPLETE, {
            succes: true,
            result,
            filename,
          });
        })
        .catch((e) =>
          win.webContents.send(events.DATA_JSON_TO_CSV_FILE_ERROR, {
            error: e.message,
          }),
        );
    } catch (e) {
      win.webContents.send(events.DATA_JSON_TO_CSV_FILE_ERROR, {
        error: e.message,
      });
    }
  },

  /**
   * convertJsonToCsvString
   * @param {BrowserWindow} win
   * @param {*} jsonObject array of json objects
   */
  convertJsonToCsvString: (win, jsonObject = []) => {
    try {
      const csv = new ObjectsToCsv(jsonObject);
      csv
        .toString(filename)
        .then((result) => {
          win.webContents.send(events.DATA_JSON_TO_CSV_STRING_COMPLETE, {
            succes: true,
            csvString: result,
          });
        })
        .catch((e) =>
          win.webContents.send(events.DATA_JSON_TO_CSV_STRING_ERROR, {
            error: e.message,
          }),
        );
    } catch (e) {
      win.webContents.send(events.DATA_JSON_TO_CSV_STRING_ERROR, {
        error: e.message,
      });
    }
  },

  readLinesFromFile: (win, filepath, lineCount) => {
    try {
      let validated;
      try {
        validated = safePath(filepath, getAllowedRoots("data"));
      } catch (pathErr) {
        win.webContents.send(events.READ_LINES_ERROR, {
          error: pathErr.message,
        });
        return;
      }
      const t = new Transform();
      t.readLinesFromFile(win, validated, lineCount, events.READ_LINES_UPDATE)
        .then((res) => {
          win.webContents.send(events.READ_LINES_COMPLETE, {
            success: true,
            filepath,
            lineCount,
            lines: res,
          });
        })
        .catch((e) => {
          //console.log(e);
          win.webContents.send(events.READ_LINES_ERROR, {
            error: e.message,
          });
        });
    } catch (error) {
      win.webContents.send(events.READ_LINES_ERROR, {
        error: e.message,
      });
    }
  },

  readJSONFromFile: (win, filepath, objectCount = null) => {
    try {
      let validated;
      try {
        validated = safePath(filepath, getAllowedRoots("data"));
      } catch (pathErr) {
        win.webContents.send(events.READ_JSON_ERROR, {
          error: pathErr.message,
        });
        return;
      }
      console.log("reading json from file ", validated, objectCount);
      const t = new Transform();
      t.readJSONFromFile(win, validated, objectCount, events.READ_JSON_UPDATE)
        .then((res) => {
          win.webContents.send(events.READ_JSON_COMPLETE, {
            success: true,
            filepath,
          });
        })
        .catch((e) => {
          //console.log(e);
          win.webContents.send(events.READ_JSON_ERROR, {
            error: e.message,
          });
        });
    } catch (error) {
      console.log(error);
      win.webContents.send(events.READ_JSON_ERROR, {
        error: e.message,
      });
    }
  },

  readDataFromURL: async (
    win,
    url,
    toFilepath,
    widgetId = null,
    token = null,
  ) => {
    // Phase 3 network gate. Runs before HTTPS-protocol + safePath
    // checks so JIT can prompt the user without leaking URL parser
    // edge cases through error timing.
    const gateOk = await _runNetworkGate(
      win,
      "readDataFromURL",
      widgetId,
      { url },
      events.READ_DATA_URL_ERROR,
      token,
    );
    if (!gateOk) return;
    try {
      // Validate URL is https protocol only
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error("Invalid URL provided");
      }
      if (parsedUrl.protocol !== "https:") {
        throw new Error(
          "Only HTTPS URLs are allowed, got: " + parsedUrl.protocol,
        );
      }

      // Validate toFilepath is within the app data directory.
      // safePath replaces the previous inline check; same containment
      // intent, plus realpath/symlink protection.
      const resolvedFilepath = safePath(toFilepath, getAllowedRoots("data"));

      const writeStream = fs.createWriteStream(resolvedFilepath);

      https
        .get(url, (resp) => {
          resp.on("data", (chunk) => {
            writeStream.write(chunk);
          });

          resp.on("end", () => {
            win.webContents.send(events.READ_DATA_URL_COMPLETE, {
              success: true,
              toFilepath: resolvedFilepath,
            });
          });
        })
        .on("error", (err) => {
          win.webContents.send(events.READ_DATA_URL_ERROR, {
            error: err.message,
          });
        });
    } catch (error) {
      console.log(error);
      win.webContents.send(events.READ_DATA_URL_ERROR, {
        error: error.message,
      });
    }
  },

  /**
   * parseXMLStream
   * @param {*} filepath
   * @param {*} outpath
   * @param {*} start
   * @param {*} recordNode
   * @param {*} objectIdKey
   */
  parseXMLStream: (
    win,
    filepath,
    outpath,
    start,
    recordNode = null,
    objectIdKey = null,
  ) => {
    try {
      let validatedIn, validatedOut;
      try {
        const roots = getAllowedRoots("data");
        validatedIn = safePath(filepath, roots);
        validatedOut = safePath(outpath, roots);
      } catch (pathErr) {
        win.webContents.send(events.PARSE_XML_STREAM_ERROR, {
          error: pathErr.message,
        });
        return;
      }
      const t = new Transform();
      t.parseXMLStream(
        validatedIn,
        validatedOut,
        start,
        // recordNode,
        // objectIdKey,
        // win,
        // events.PARSE_XML_STREAM_UPDATE
      )
        .then((res) => {
          win.webContents.send(events.PARSE_XML_STREAM_COMPLETE, {
            success: true,
            filepath,
            outpath,
          });
        })
        .catch((e) => {
          console.log(e);
          win.webContents.send(events.PARSE_XML_STREAM_ERROR, {
            error: e.message,
          });
        });
    } catch (e) {
      win.webContents.send(events.PARSE_XML_STREAM_ERROR, {
        error: e.message,
      });
    }
  },

  /**
   * parseCSVStream
   * @param {*} win
   * @param {*} filepath
   * @param {*} outpath
   * @param {*} delimiter
   * @param {*} objectIdKey
   * @param {Array} headers optional array of headers to choose from the file
   */
  parseCSVStream: (
    win,
    filepath,
    outpath,
    delimiter = ",",
    objectIdKey = null,
    headers = null,
    limit = null,
  ) => {
    try {
      let validatedIn, validatedOut;
      try {
        const roots = getAllowedRoots("data");
        validatedIn = safePath(filepath, roots);
        validatedOut = safePath(outpath, roots);
      } catch (pathErr) {
        win.webContents.send(events.PARSE_CSV_STREAM_ERROR, {
          error: pathErr.message,
        });
        return;
      }
      const t = new Transform();
      t.parseCSVStream(
        validatedIn,
        validatedOut,
        delimiter,
        objectIdKey,
        headers,
        win,
        events.PARSE_CSV_STREAM_UPDATE,
        limit,
      )
        .then((res) => {
          win.webContents.send(events.PARSE_CSV_STREAM_COMPLETE, {
            success: true,
            filepath,
            outpath,
          });
        })
        .catch((e) => {
          console.log(e);
          win.webContents.send(events.PARSE_CSV_STREAM_ERROR, {
            error: e.message,
          });
        });
    } catch (e) {
      win.webContents.send(events.PARSE_CSV_STREAM_ERROR, {
        error: e.message,
      });
    }
  },
  /**
   * saveToFile
   *
   * This will save to the /appName/data directory
   * We want this to happen so that all of the data is accessible regardless of the appId
   * Is this the correct behavior?
   *
   * @param {*} win
   * @param {*} data
   * @param {*} filename
   * @param {*} append
   * @param {*} returnEmpty
   */
  saveToFile: async (
    win,
    data,
    filename,
    append,
    returnEmpty = {},
    widgetId = null,
    token = null,
  ) => {
    // Phase 2 fs gate. Runs before safePath containment so JIT can
    // prompt the user without leaking path-shape information through
    // error timing. See electron/security/fsGate.js.
    const gateOk = await _runFsGate(
      win,
      "saveToFile",
      widgetId,
      { filename },
      events.DATA_SAVE_TO_FILE_ERROR,
      token,
    );
    if (!gateOk) return;
    try {
      if (data) {
        // Validate filename is contained within the data directory.
        // path.join doesn't reject `..` segments; safePath does.
        const candidate = path.join(
          app.getPath("userData"),
          appName,
          "data",
          filename,
        );
        let toFilename;
        try {
          toFilename = safePath(candidate, getAllowedRoots("data"));
        } catch (pathErr) {
          win.webContents.send(events.DATA_SAVE_TO_FILE_ERROR, {
            success: false,
            filename,
            message: pathErr.message,
          });
          return;
        }

        //console.log("saving to file ", toFilename);

        // // call this to make sure the directory structure exists
        let fileContents = getFileContents(toFilename, returnEmpty);
        if (fileContents === null || fileContents === "") {
          fileContents = JSON.stringify(returnEmpty);
        }

        // timestamp
        const stamp = Date.now();

        let writeContents = null;

        if (append === true) {
          // append data
          if (JSON.stringify(returnEmpty) === "{}") {
            const tempWriteContents = JSON.parse(fileContents);
            tempWriteContents[stamp] = data;
            writeContents = JSON.stringify(tempWriteContents);
            writeToFile(toFilename, writeContents);
          }

          if (JSON.stringify(returnEmpty) === "[]") {
            const tempWriteContents = JSON.parse(fileContents);
            tempWriteContents.push({ [stamp]: data });
            writeContents = JSON.stringify(tempWriteContents);
            // writeContents = JSON.parse(fileContents);
            // writeContents.push({ [stamp]: data });
            writeToFile(toFilename, writeContents);
          }
        } else {
          // overwrite existing
          writeContents = JSON.stringify(data);
          if (JSON.stringify(returnEmpty) === "{}") {
            writeToFile(
              toFilename,
              writeContents,
              // JSON.stringify({ [stamp]: data })
            );
          }
          if (JSON.stringify(returnEmpty) === "[]") {
            writeToFile(
              toFilename,
              writeContents,
              // JSON.stringify([{ [stamp]: data }])
            );
          }
        }

        // console.log(events.DATA_SAVE_TO_FILE_COMPLETE, {
        //     success: true,
        //     filename: toFilename,
        //     fileContents,
        // });

        win.webContents.send(events.DATA_SAVE_TO_FILE_COMPLETE, {
          success: true,
          filename: toFilename,
          fileContents: JSON.parse(writeContents),
        });
      }
    } catch (e) {
      console.log(e);
      win.webContents.send(events.DATA_SAVE_TO_FILE_ERROR, {
        success: false,
        filename: filename,
        message: e.message,
      });
    }
  },

  readFromFile: async (
    win,
    filename,
    returnIfEmpty = {},
    widgetId = null,
    token = null,
  ) => {
    // Phase 2 fs gate — same as saveToFile.
    const gateOk = await _runFsGate(
      win,
      "readFromFile",
      widgetId,
      { filename },
      events.DATA_READ_FROM_FILE_ERROR,
      token,
    );
    if (!gateOk) return;
    try {
      if (filename) {
        // filename to the pages file (live pages)
        const fromFilename = path.join(
          app.getPath("userData"),
          appName,
          "data",
          filename,
        );
        console.log("reading from file ", fromFilename, returnIfEmpty);
        // make sure the file exists...
        const fileContents = getFileContents(fromFilename, returnIfEmpty);

        console.log("file contents ", fileContents, fromFilename);

        win.webContents.send(events.DATA_READ_FROM_FILE_COMPLETE, {
          succes: true,
          filename: fromFilename,
          data: JSON.stringify(fileContents),
        });
      }
    } catch (e) {
      win.webContents.send(events.DATA_READ_FROM_FILE_ERROR, {
        succes: false,
        message: e.message,
      });
    }
  },

  /**
   * transformFile
   * Transform the file from one format to another using the provided mapping function block
   * and arguments that are optional (default - refObj, index)
   * @param {*} win
   * @param {*} filepath
   * @param {*} outFilepath
   * @param {*} mappingFunctionBody
   * @param {*} args
   */
  transformFile: (
    win,
    filepath,
    outFilepath,
    mappingFunctionBody,
    args = ["refObj", "index"],
  ) => {
    try {
      const t = new Transform();
      t.transformFileToFile(
        win,
        filepath,
        outFilepath,
        mappingFunctionBody,
        args,
        events.TRANSFORM_FILE_UPDATE,
      )
        .then((result) => {
          win.webContents.send(events.TRANSFORM_FILE_COMPLETE, {
            succes: true,
            filename: filepath,
            toFilename: outFilepath,
          });
        })
        .catch((e) => {
          win.webContents.send(events.TRANSFORM_FILE_ERROR, {
            succes: false,
            message: e.message,
          });
        });
    } catch (e) {
      win.webContents.send(events.TRANSFORM_FILE_ERROR, {
        succes: false,
        message: e.message,
      });
    }
  },
};

module.exports = dataController;
