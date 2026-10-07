/**
 * mcpUtils — field derivation and config building for built-in providers
 * (bot-capabilities FR-C02a).
 */
import {
  deriveFormFields,
  buildMcpConfigFromOverrides,
  isBuiltinMcpConfig,
} from "./mcpUtils";

const webFetchConfig = { transport: "in_process", builtin: "web-fetch" };

describe("isBuiltinMcpConfig", () => {
  it("is true only for in_process configs", () => {
    expect(isBuiltinMcpConfig(webFetchConfig)).toBe(true);
    expect(isBuiltinMcpConfig({ transport: "stdio" })).toBe(false);
    expect(isBuiltinMcpConfig(null)).toBe(false);
  });
});

describe("deriveFormFields", () => {
  it("carries min, max, default, unit and placeholder from the schema", () => {
    const fields = deriveFormFields(webFetchConfig, {
      maxDownloadMb: {
        type: "number",
        displayName: "Max download size",
        default: 10,
        min: 1,
        max: 50,
        unit: "MB",
      },
      allowedSites: {
        type: "text-list",
        displayName: "Allowed sites",
        placeholder: "cdn.example.com",
      },
    });
    expect(fields).toEqual([
      {
        key: "maxDownloadMb",
        displayName: "Max download size",
        required: false,
        secret: false,
        instructions: null,
        type: "number",
        default: 10,
        min: 1,
        max: 50,
        unit: "MB",
      },
      {
        key: "allowedSites",
        displayName: "Allowed sites",
        required: false,
        secret: false,
        instructions: null,
        type: "text-list",
        placeholder: "cdn.example.com",
      },
    ]);
  });

  it("leaves ordinary fields' shape unchanged", () => {
    const [field] = deriveFormFields(
      { transport: "stdio", envMapping: { API_KEY: "apiKey" } },
      { apiKey: { displayName: "API Key", secret: true } },
    );
    expect(field).toEqual({
      key: "apiKey",
      displayName: "API Key",
      required: false,
      secret: true,
      instructions: null,
      type: "text",
    });
  });
});

describe("buildMcpConfigFromOverrides", () => {
  it("returns a built-in config unchanged (no envMapping added)", () => {
    expect(buildMcpConfigFromOverrides(webFetchConfig, [], [])).toEqual(
      webFetchConfig,
    );
  });
});
