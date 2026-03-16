const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  ERROR_TYPES,
  ThemeExtractionError,
  UrlUnreachableError,
  UrlTimeoutError,
  ExtractionFailedError,
  NoColorsFoundError,
  FaviconFetchError,
} = require("./themeFromUrlErrors");

describe("themeFromUrlErrors", () => {
  describe("ERROR_TYPES enum", () => {
    it("has all expected error types", () => {
      assert.equal(ERROR_TYPES.URL_UNREACHABLE, "URL_UNREACHABLE");
      assert.equal(ERROR_TYPES.URL_TIMEOUT, "URL_TIMEOUT");
      assert.equal(ERROR_TYPES.EXTRACTION_FAILED, "EXTRACTION_FAILED");
      assert.equal(ERROR_TYPES.NO_COLORS_FOUND, "NO_COLORS_FOUND");
      assert.equal(ERROR_TYPES.FAVICON_FETCH_FAILED, "FAVICON_FETCH_FAILED");
    });
  });

  describe("ThemeExtractionError (base class)", () => {
    it("sets type, userMessage, and cause properties", () => {
      const cause = new Error("original");
      const err = new ThemeExtractionError("test message", {
        type: "TEST_TYPE",
        userMessage: "User-facing message",
        cause,
      });
      assert.equal(err.message, "test message");
      assert.equal(err.name, "ThemeExtractionError");
      assert.equal(err.type, "TEST_TYPE");
      assert.equal(err.userMessage, "User-facing message");
      assert.equal(err.cause, cause);
    });

    it("defaults userMessage when not provided", () => {
      const err = new ThemeExtractionError("msg", { type: "X" });
      assert.equal(err.userMessage, "Something went wrong extracting colors.");
    });

    it("defaults cause to null when not provided", () => {
      const err = new ThemeExtractionError("msg", { type: "X" });
      assert.equal(err.cause, null);
    });

    it("is an instance of Error", () => {
      const err = new ThemeExtractionError("msg", { type: "X" });
      assert.ok(err instanceof Error);
      assert.ok(err instanceof ThemeExtractionError);
    });
  });

  describe("UrlUnreachableError", () => {
    it("has correct type and userMessage", () => {
      const err = new UrlUnreachableError();
      assert.equal(err.type, ERROR_TYPES.URL_UNREACHABLE);
      assert.equal(
        err.userMessage,
        "Couldn't reach that URL. Check the address.",
      );
      assert.equal(err.name, "UrlUnreachableError");
    });

    it("uses custom message when provided", () => {
      const err = new UrlUnreachableError("custom msg");
      assert.equal(err.message, "custom msg");
    });

    it("uses default message when not provided", () => {
      const err = new UrlUnreachableError();
      assert.equal(err.message, "URL is unreachable");
    });

    it("preserves cause chain", () => {
      const original = new Error("ECONNREFUSED");
      const err = new UrlUnreachableError("fail", { cause: original });
      assert.equal(err.cause, original);
      assert.equal(err.cause.message, "ECONNREFUSED");
    });

    it("is instanceof ThemeExtractionError and Error", () => {
      const err = new UrlUnreachableError();
      assert.ok(err instanceof ThemeExtractionError);
      assert.ok(err instanceof Error);
    });
  });

  describe("UrlTimeoutError", () => {
    it("has correct type and userMessage", () => {
      const err = new UrlTimeoutError();
      assert.equal(err.type, ERROR_TYPES.URL_TIMEOUT);
      assert.equal(
        err.userMessage,
        "The site took too long to load. Try a simpler page.",
      );
      assert.equal(err.name, "UrlTimeoutError");
    });

    it("uses default message when not provided", () => {
      const err = new UrlTimeoutError();
      assert.equal(err.message, "URL load timed out");
    });

    it("preserves cause chain", () => {
      const original = new Error("ETIMEDOUT");
      const err = new UrlTimeoutError("timed out", { cause: original });
      assert.equal(err.cause, original);
    });

    it("is instanceof ThemeExtractionError and Error", () => {
      const err = new UrlTimeoutError();
      assert.ok(err instanceof ThemeExtractionError);
      assert.ok(err instanceof Error);
    });
  });

  describe("ExtractionFailedError", () => {
    it("has correct type and userMessage", () => {
      const err = new ExtractionFailedError();
      assert.equal(err.type, ERROR_TYPES.EXTRACTION_FAILED);
      assert.equal(err.userMessage, "Failed to extract colors from this site.");
      assert.equal(err.name, "ExtractionFailedError");
    });

    it("uses default message when not provided", () => {
      const err = new ExtractionFailedError();
      assert.equal(err.message, "Color extraction failed");
    });

    it("preserves cause chain", () => {
      const original = new TypeError("Cannot read property");
      const err = new ExtractionFailedError("fail", { cause: original });
      assert.equal(err.cause, original);
    });

    it("is instanceof ThemeExtractionError and Error", () => {
      const err = new ExtractionFailedError();
      assert.ok(err instanceof ThemeExtractionError);
      assert.ok(err instanceof Error);
    });
  });

  describe("NoColorsFoundError", () => {
    it("has correct type and userMessage", () => {
      const err = new NoColorsFoundError();
      assert.equal(err.type, ERROR_TYPES.NO_COLORS_FOUND);
      assert.equal(
        err.userMessage,
        "No usable colors found. Try a more styled page.",
      );
      assert.equal(err.name, "NoColorsFoundError");
    });

    it("uses default message when not provided", () => {
      const err = new NoColorsFoundError();
      assert.equal(err.message, "No usable colors found");
    });

    it("preserves cause chain", () => {
      const original = new Error("empty palette");
      const err = new NoColorsFoundError("none", { cause: original });
      assert.equal(err.cause, original);
    });

    it("is instanceof ThemeExtractionError and Error", () => {
      const err = new NoColorsFoundError();
      assert.ok(err instanceof ThemeExtractionError);
      assert.ok(err instanceof Error);
    });
  });

  describe("FaviconFetchError", () => {
    it("has correct type and userMessage", () => {
      const err = new FaviconFetchError();
      assert.equal(err.type, ERROR_TYPES.FAVICON_FETCH_FAILED);
      assert.equal(err.userMessage, "Couldn't fetch the site's favicon.");
      assert.equal(err.name, "FaviconFetchError");
    });

    it("uses default message when not provided", () => {
      const err = new FaviconFetchError();
      assert.equal(err.message, "Favicon fetch failed");
    });

    it("preserves cause chain", () => {
      const original = new Error("404");
      const err = new FaviconFetchError("not found", { cause: original });
      assert.equal(err.cause, original);
    });

    it("is instanceof ThemeExtractionError and Error", () => {
      const err = new FaviconFetchError();
      assert.ok(err instanceof ThemeExtractionError);
      assert.ok(err instanceof Error);
    });
  });
});
