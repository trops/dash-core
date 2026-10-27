/**
 * secretFields.test.js — keys and passwords typed into widgets, and tokens
 * in provider arguments and addresses, never leave this computer: the
 * setting travels, its value doesn't.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  looksSecretName,
  secretFieldsOfPackage,
  blankDashboardSecrets,
  blankSecretsInDashboards,
  restoreSecrets,
  hasSecretValue,
  redactUrl,
  redactArgs,
} = require("./secretFields");

describe("looksSecretName", () => {
  it("catches names that say they hold a secret", () => {
    for (const n of [
      "apiKey",
      "api_key",
      "ACCESS_KEY",
      "accessToken",
      "password",
      "clientSecret",
      "bearerToken",
      "credentials",
      "privateKey",
    ]) {
      assert.equal(looksSecretName(n), true, n);
    }
  });
  it("leaves ordinary settings alone", () => {
    for (const n of [
      "title",
      "author",
      "searchKeyword",
      "sortKey",
      "keyboardShortcut",
      "monkey",
      "indexName",
      "autoRefreshSeconds",
    ]) {
      assert.equal(looksSecretName(n), false, n);
    }
  });
});

describe("secretFieldsOfPackage", () => {
  it("reads which settings a widget declares secret (parsed, never run)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zz-secret-pkg-"));
    fs.mkdirSync(path.join(dir, "widgets"));
    fs.writeFileSync(
      path.join(dir, "widgets", "Weather.dash.js"),
      `import { Weather } from "./Weather";
export default {
  name: "Weather",
  component: Weather,
  userConfig: {
    city: { type: "text", defaultValue: "" },
    serviceCode: { type: "secret", defaultValue: "" },
  },
};`,
    );
    const map = secretFieldsOfPackage(dir);
    assert.deepEqual([...map.get("Weather")], ["serviceCode"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

const dashboard = {
  id: 7,
  name: "Home",
  layout: [
    {
      id: 1,
      uuid: "u1",
      component: "trops.weather.Weather",
      packageId: "@trops/weather",
      userPrefs: {
        title: "Weather",
        city: "Boston",
        serviceCode: "S3CRET",
        apiKey: "",
      },
    },
  ],
  pages: [
    {
      id: "p2",
      layout: [
        {
          id: 2,
          uuid: "u2",
          component: "Container",
          items: [
            {
              id: 3,
              uuid: "u3",
              component: "trops.ha.Lights",
              userPrefs: { accessToken: "TOKEN-123", room: "Kitchen" },
            },
          ],
        },
      ],
    },
  ],
};
const declared = (item) =>
  item.component === "trops.weather.Weather"
    ? new Set(["serviceCode"])
    : new Set();

describe("blankDashboardSecrets", () => {
  it("keeps each secret setting but not its value, everywhere in the dashboard", () => {
    const { workspace, blanked } = blankDashboardSecrets(dashboard, declared);
    const w = workspace.layout[0].userPrefs;
    assert.equal(w.serviceCode, "");
    assert.equal(w.city, "Boston");
    assert.ok("serviceCode" in w);
    const lights = workspace.pages[0].layout[0].items[0].userPrefs;
    assert.equal(lights.accessToken, "");
    assert.equal(lights.room, "Kitchen");
    // Only settings that had a value are listed.
    assert.deepEqual(
      blanked.map((b) => [b.item, b.component, b.field, b.title]),
      [
        ["layout/u1", "Weather", "serviceCode", "Weather"],
        ["page:p2/u3", "Lights", "accessToken", null],
      ],
    );
    // The original isn't touched.
    assert.equal(dashboard.layout[0].userPrefs.serviceCode, "S3CRET");
    assert.ok(!JSON.stringify(workspace).includes("S3CRET"));
    assert.ok(!JSON.stringify(workspace).includes("TOKEN-123"));
  });

  it("blankSecretsInDashboards names the dashboard for each one", () => {
    const { workspaces, blanked } = blankSecretsInDashboards([dashboard], null);
    assert.equal(blanked[0].dashboard, "Home");
    assert.equal(blanked[0].dashboardId, 7);
    // Without the installed widget, a name that says secret still counts.
    assert.equal(
      workspaces[0].pages[0].layout[0].items[0].userPrefs.accessToken,
      "",
    );
  });
});

describe("restoreSecrets", () => {
  it("a dashboard loaded over this computer's copy keeps this computer's keys", () => {
    const fromFile = blankDashboardSecrets(dashboard, declared).workspace;
    fromFile.layout[0].userPrefs.city = "Paris";
    const merged = restoreSecrets(fromFile, dashboard, declared);
    assert.equal(merged.layout[0].userPrefs.serviceCode, "S3CRET");
    assert.equal(merged.layout[0].userPrefs.city, "Paris");
    assert.equal(
      merged.pages[0].layout[0].items[0].userPrefs.accessToken,
      "TOKEN-123",
    );
    assert.equal(hasSecretValue(dashboard, "page:p2/u3", "accessToken"), true);
    assert.equal(hasSecretValue(fromFile, "page:p2/u3", "accessToken"), false);
  });
});

describe("item ids repeat across pages", () => {
  it("each page's widget is its own: the key on page one is found there only", () => {
    const paged = {
      id: 9,
      pages: [
        { id: "p1", layout: [{ id: 2, userPrefs: { apiKey: "K1" } }] },
        { id: "p2", layout: [{ id: 2, userPrefs: { apiKey: "" } }] },
      ],
    };
    assert.equal(hasSecretValue(paged, "page:p1/2", "apiKey"), true);
    assert.equal(hasSecretValue(paged, "page:p2/2", "apiKey"), false);
    const { blanked } = blankDashboardSecrets(paged);
    assert.deepEqual(
      blanked.map((b) => b.item),
      ["page:p1/2"],
    );
  });
});

describe("provider arguments and addresses", () => {
  it("token-like argument values are removed, the rest kept", () => {
    assert.deepEqual(
      redactArgs([
        "-y",
        "@modelcontextprotocol/server-x",
        "--token=abc123",
        "--api-key",
        "sk-999",
        "--port",
        "8080",
        "https://h/x?apikey=zz&q=1",
      ]),
      [
        "-y",
        "@modelcontextprotocol/server-x",
        "--token=",
        "--api-key",
        "",
        "--port",
        "8080",
        "https://h/x?apikey=&q=1",
      ],
    );
  });
  it("URLs lose passwords and key-like query values", () => {
    assert.equal(
      redactUrl("https://user:pw@example.com/mcp?token=T&region=us"),
      "https://user@example.com/mcp?token=&region=us",
    );
    assert.equal(
      redactUrl("https://example.com/mcp"),
      "https://example.com/mcp",
    );
    assert.equal(redactUrl("not a url"), "not a url");
  });
});
