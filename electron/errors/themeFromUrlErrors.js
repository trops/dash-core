/**
 * themeFromUrlErrors.js
 *
 * Typed error classes for the Theme from URL extraction pipeline.
 * Used across dash-core (controller), dash-electron (IPC handler),
 * and dash-react (UI error mapping).
 */

const ERROR_TYPES = {
  URL_UNREACHABLE: "URL_UNREACHABLE",
  URL_TIMEOUT: "URL_TIMEOUT",
  EXTRACTION_FAILED: "EXTRACTION_FAILED",
  NO_COLORS_FOUND: "NO_COLORS_FOUND",
  FAVICON_FETCH_FAILED: "FAVICON_FETCH_FAILED",
};

class ThemeExtractionError extends Error {
  /**
   * @param {string} message - Developer-facing error message
   * @param {Object} options
   * @param {string} options.type - Machine-readable error type (from ERROR_TYPES)
   * @param {string} options.userMessage - User-facing message for UI display
   * @param {Error} [options.cause] - Original error that triggered this one
   */
  constructor(message, { type, userMessage, cause } = {}) {
    super(message);
    this.name = "ThemeExtractionError";
    this.type = type;
    this.userMessage = userMessage || "Something went wrong extracting colors.";
    this.cause = cause || null;
  }
}

class UrlUnreachableError extends ThemeExtractionError {
  constructor(message, { cause } = {}) {
    super(message || "URL is unreachable", {
      type: ERROR_TYPES.URL_UNREACHABLE,
      userMessage: "Couldn't reach that URL. Check the address.",
      cause,
    });
    this.name = "UrlUnreachableError";
  }
}

class UrlTimeoutError extends ThemeExtractionError {
  constructor(message, { cause } = {}) {
    super(message || "URL load timed out", {
      type: ERROR_TYPES.URL_TIMEOUT,
      userMessage: "The site took too long to load. Try a simpler page.",
      cause,
    });
    this.name = "UrlTimeoutError";
  }
}

class ExtractionFailedError extends ThemeExtractionError {
  constructor(message, { cause } = {}) {
    super(message || "Color extraction failed", {
      type: ERROR_TYPES.EXTRACTION_FAILED,
      userMessage: "Failed to extract colors from this site.",
      cause,
    });
    this.name = "ExtractionFailedError";
  }
}

class NoColorsFoundError extends ThemeExtractionError {
  constructor(message, { cause } = {}) {
    super(message || "No usable colors found", {
      type: ERROR_TYPES.NO_COLORS_FOUND,
      userMessage: "No usable colors found. Try a more styled page.",
      cause,
    });
    this.name = "NoColorsFoundError";
  }
}

class FaviconFetchError extends ThemeExtractionError {
  constructor(message, { cause } = {}) {
    super(message || "Favicon fetch failed", {
      type: ERROR_TYPES.FAVICON_FETCH_FAILED,
      userMessage: "Couldn't fetch the site's favicon.",
      cause,
    });
    this.name = "FaviconFetchError";
  }
}

module.exports = {
  ERROR_TYPES,
  ThemeExtractionError,
  UrlUnreachableError,
  UrlTimeoutError,
  ExtractionFailedError,
  NoColorsFoundError,
  FaviconFetchError,
};
