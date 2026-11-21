/**
 * alwaysAllow — what "Always allow" covers, in words: a provider tool, or a
 * built-in web fetch's site or page.
 */
import {
  canAlwaysAllow,
  alwaysAllowLine,
  savedText,
  grantRowText,
  webFetchTarget,
  toolWords,
  hostText,
  pageText,
  pageReach,
  pathTarget,
  isAnywhere,
} from "./alwaysAllow";

describe("a provider tool with a path (DASH-30)", () => {
  const save = {
    serverName: "Sawhorse",
    toolName: "save_model",
    input: { path: "Walnut U Desk/Walnut U Desk.shz" },
  };
  test("the folder Always allow would remember", () => {
    expect(pathTarget(save)).toEqual({
      key: "path",
      value: "Walnut U Desk/Walnut U Desk.shz",
      folder: "Walnut U Desk",
      isFile: false,
    });
    // A file at the top: only that file.
    expect(pathTarget({ ...save, input: { path: "notes.md" } })).toMatchObject({
      folder: "notes.md",
      isFile: true,
    });
    expect(pathTarget({ ...save, input: {} })).toBeNull();
    expect(pathTarget({ toolName: "Read", input: { path: "x" } })).toBeNull();
  });
  test("the line and the saved card say where", () => {
    expect(alwaysAllowLine(save)).toBe(
      "Always allow: this bot uses Save model on Sawhorse without asking in Walnut U Desk, every run. You can take it back in its settings.",
    );
    expect(alwaysAllowLine(save, "provider")).toBe(
      "Always allow: this bot uses Save model on Sawhorse without asking, anywhere in Sawhorse's files (its other always-allowed Sawhorse tools too), every run. You can take it back in its settings.",
    );
    expect(savedText(save, "Designer", "provider")).toMatch(
      /^Designer uses Save model on Sawhorse without asking, anywhere in Sawhorse's files \(its other always-allowed Sawhorse tools too\), from now on\./,
    );
    // "./notes.md" and a drive's top: only that file.
    expect(
      pathTarget({ ...save, input: { path: "./notes.md" } }),
    ).toMatchObject({ isFile: true });
    expect(
      pathTarget({ ...save, input: { path: "C:\\notes.md" } }),
    ).toMatchObject({ isFile: true });
  });
  test("rows: anywhere, and all its tools", () => {
    const row = {
      kind: "tool",
      provider: "Sawhorse",
      tool: "save_model",
      folders: ["Spool Shelf", ".", "."],
    };
    expect(isAnywhere(row)).toBe(true);
    expect(grantRowText(row).scope).toBe("Anywhere in Sawhorse's files");
    expect(grantRowText({ ...row, tool: "*" }).name).toBe(
      "All its tools · Sawhorse",
    );
    expect(
      grantRowText({ ...row, folders: ["Spool Shelf", "Spool Shelf"] }).scope,
    ).toBe("In Spool Shelf");
  });
});

const fetchAsk = {
  botId: "b1",
  toolName: "WebFetch",
  input: { url: "https://news.example.com/today#top" },
};
const gmailAsk = {
  botId: "b1",
  serverName: "Gmail",
  toolName: "mcp__claude_ai_Gmail__search_threads",
};

test("offered for a provider tool or a web fetch, never other built-ins", () => {
  expect(canAlwaysAllow(gmailAsk)).toBe(true);
  expect(canAlwaysAllow(fetchAsk)).toBe(true);
  expect(canAlwaysAllow({ toolName: "Bash", input: { command: "ls" } })).toBe(
    false,
  );
  expect(canAlwaysAllow({ toolName: "WebFetch", input: { url: "x" } })).toBe(
    false,
  );
  expect(canAlwaysAllow(null)).toBe(false);
});

test("a web fetch's site and page", () => {
  expect(webFetchTarget(fetchAsk)).toEqual({
    host: "news.example.com",
    site: "https://news.example.com",
    url: "https://news.example.com/today",
  });
  expect(webFetchTarget(gmailAsk)).toBeNull();
});

test("the line under the buttons says what Always allow means", () => {
  expect(alwaysAllowLine(gmailAsk)).toBe(
    "Always allow: this bot uses Search threads on Gmail without asking, every run. You can take it back in its settings.",
  );
  expect(alwaysAllowLine(fetchAsk)).toMatch(
    /reads pages on news\.example\.com without asking/,
  );
  expect(alwaysAllowLine(fetchAsk, "page")).toMatch(
    /reads news\.example\.com\/today without asking/,
  );
});

test("the saved card says what was saved", () => {
  expect(savedText(gmailAsk, "Morning Email Summary")).toBe(
    "Morning Email Summary uses Search threads on Gmail without asking, from now on. It still asks before anything else you haven't allowed.",
  );
  expect(savedText(fetchAsk, "", "page")).toBe(
    "This bot reads news.example.com/today without asking, from now on.",
  );
});

test("one row of Runs without asking", () => {
  expect(
    grantRowText({ kind: "tool", provider: "Gmail", tool: "search_threads" }),
  ).toEqual({
    name: "Search threads · Gmail",
    scope: "Every run, without asking",
  });
  expect(
    grantRowText({
      kind: "tool",
      provider: "Files",
      tool: "read_file",
      folders: ["/notes"],
    }).scope,
  ).toBe("In /notes");
  expect(
    grantRowText({
      kind: "builtin",
      tool: "WebFetch",
      site: "https://a.example",
    }),
  ).toEqual({ name: "Web fetch · built in", scope: "Pages on a.example" });
  expect(
    grantRowText({
      kind: "builtin",
      tool: "WebFetch",
      page: "https://b.example/y",
    }).scope,
  ).toBe("Only b.example/y");
  expect(
    grantRowText({
      kind: "builtin",
      tool: "WebFetch",
      site: "http://a.example:8080",
    }).scope,
  ).toBe("Pages on http://a.example:8080");
  expect(toolWords("list-calendars")).toBe("List calendars");
});

test("an international site name shows as people write it, and encoded", () => {
  expect(hostText("xn--bcher-kva.example")).toBe(
    "bücher.example (xn--bcher-kva.example)",
  );
  expect(hostText("news.example.com")).toBe("news.example.com");
  // A look-alike shows its encoded form next to it.
  expect(hostText(new URL("https://\u0430pple.com").hostname)).toBe(
    "\u0430pple.com (xn--pple-43d.com)",
  );
  expect(pageText("https://xn--bcher-kva.example/a")).toBe(
    "bücher.example/a (xn--bcher-kva.example)",
  );
  expect(pageText("http://xn--mnchen-3ya.de:8080/x")).toBe(
    "http://münchen.de:8080/x (xn--mnchen-3ya.de)",
  );
  expect(pageText("https://news.example.com/")).toBe("news.example.com");
  expect(hostText("xn--zz")).toBe("xn--zz");
});

test("only this page says it follows redirects within the site", () => {
  expect(pageReach("https://news.example.com/today")).toBe(
    "news.example.com/today — and any page on this site it redirects to",
  );
});
