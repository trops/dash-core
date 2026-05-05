/**
 * dataApi.js
 *
 * Handle the data configuration file
 */
// ipcRenderer that must be used to invoke the events
const { ipcRenderer } = require("electron");

const {
  DATA_JSON_TO_CSV_FILE,
  DATA_JSON_TO_CSV_STRING,
  DATA_READ_FROM_FILE,
  DATA_SAVE_TO_FILE,
  PARSE_XML_STREAM,
  PARSE_CSV_STREAM,
  READ_LINES,
  TRANSFORM_FILE,
  READ_JSON,
  READ_DATA_URL,
} = require("../events");

const dataApi = {
  // convert a json array of objects to a csv string and save to file
  convertJsonToCsvFile: (appId, jsonObject, filename) =>
    ipcRenderer.invoke(DATA_JSON_TO_CSV_FILE, {
      appId,
      jsonObject,
      filename,
    }),

  // convert a json array of objects to a csv string and return a string
  convertJsonToCsvString: (appId, jsonObject) =>
    ipcRenderer.invoke(DATA_JSON_TO_CSV_STRING, { appId, jsonObject }),

  parseXMLStream: (filepath, outpath, start) =>
    ipcRenderer.invoke(PARSE_XML_STREAM, {
      filepath,
      outpath,
      start,
    }),

  parseCSVStream: (
    filepath,
    outpath,
    delimiter = ",",
    objectIdKey = null,
    headers = null,
    limit = null,
  ) => {
    ipcRenderer.invoke(PARSE_CSV_STREAM, {
      filepath,
      outpath,
      delimiter,
      objectIdKey,
      headers,
      limit,
    });
  },

  readLinesFromFile: (filepath, lineCount) => {
    ipcRenderer.invoke(READ_LINES, { filepath, lineCount });
  },

  readJSONFromFile: (filepath, objectCount = null) => {
    ipcRenderer.invoke(READ_JSON, { filepath, objectCount });
  },

  readDataFromURL: (url, toFilepath) => {
    ipcRenderer.invoke(READ_DATA_URL, { url, toFilepath });
  },

  /*
   * saveData
   * @param {object} options { filename, extension }
   * @param {object} returnEmpty the return empty object
   */
  saveData: (data, filename, append, returnEmpty, widgetId = null) =>
    ipcRenderer.invoke(DATA_SAVE_TO_FILE, {
      data,
      filename,
      append,
      returnEmpty,
      widgetId,
    }),

  /*
   * readData
   * @param {string} filename the filename to read (not path)
   * @param {string|null} widgetId Phase 2 JIT consent — the widget's
   *   package name (e.g. "@trops/notes-summarizer"). Used by the fs
   *   gate to scope per-widget read access. Null disables the gate
   *   for legacy callers (`enforceWidgetMcpPermissions` flag still
   *   gates the gate itself).
   */
  readData: (filename, returnEmpty = [], widgetId = null) =>
    ipcRenderer.invoke(DATA_READ_FROM_FILE, {
      filename,
      returnEmpty,
      widgetId,
    }),

  /**
   * transformFile
   * @returns
   */
  transformFile: (filepath, outFilepath, mappingFunctionBody, args) => {
    ipcRenderer.invoke(TRANSFORM_FILE, {
      filepath,
      outFilepath,
      mappingFunctionBody,
      args,
    });
  },
};

module.exports = dataApi;
