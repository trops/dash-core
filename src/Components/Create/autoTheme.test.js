/**
 * Type: Auto and Type: Theme (create-entry PRD CRE-001 AC3, phase 5c).
 */
import { aiOnce, firstJson, contentText } from "../../utils/aiOnce";
import { guessType, parseAutoAnswer, pickType, AUTO_SYSTEM } from "./autoType";
import { parseThemeAnswer, themeFromPrompt } from "./themeFromPrompt";

function fakeLlm({ text = "", error = null } = {}) {
  const ls = { delta: [], complete: [], error: [] };
  let n = 0;
  const llm = {
    sent: [],
    removed: [],
    onStreamDelta: (cb) => (ls.delta.push(cb), String(++n)),
    onStreamComplete: (cb) => (ls.complete.push(cb), String(++n)),
    onStreamError: (cb) => (ls.error.push(cb), String(++n)),
    removeStreamListener: (id) => llm.removed.push(id),
    abortRequest: jest.fn(),
    sendMessage: jest.fn(async (requestId, params) => {
      llm.sent.push({ requestId, params });
      // Someone else's stream first — ignored.
      ls.delta.forEach((cb) => cb({ requestId: "other", text: "NO" }));
      if (error) {
        ls.error.forEach((cb) => cb({ requestId, error }));
        return;
      }
      ls.delta.forEach((cb) => cb({ requestId, text }));
      ls.complete.forEach((cb) => cb({ requestId, content: [] }));
    }),
  };
  return llm;
}

describe("aiOnce — one question, one answer", () => {
  test("asks with no tools and its own system prompt; collects the text", async () => {
    const llm = fakeLlm({ text: "  hello  " });
    const answer = await aiOnce({
      system: "S",
      prompt: "P",
      backend: "claude-code",
      llm,
    });
    expect(answer).toBe("hello");
    const { params } = llm.sent[0];
    expect(params).toMatchObject({
      backend: "claude-code",
      systemPrompt: "S",
      replaceSystemPrompt: true,
      disableTools: true,
      tools: [],
      messages: [{ role: "user", content: "P" }],
    });
    expect(params.widgetUuid).toBeUndefined();
    expect(llm.removed).toHaveLength(3);
  });

  test("the Anthropic API uses the provider's key; no key, no AI or an error say so", async () => {
    const llm = fakeLlm({ text: "ok" });
    await aiOnce({
      system: "S",
      prompt: "P",
      backend: "anthropic",
      providers: {
        Claude: {
          type: "anthropic",
          providerClass: "credential",
          credentials: { apiKey: "sk-1" },
        },
      },
      llm,
    });
    expect(llm.sent[0].params.apiKey).toBe("sk-1");
    await expect(
      aiOnce({ system: "S", prompt: "P", backend: "anthropic", llm }),
    ).rejects.toThrow(/no API key/);
    await expect(
      aiOnce({ system: "S", prompt: "P", backend: null, llm }),
    ).rejects.toThrow(/No AI is set up/);
    await expect(
      aiOnce({
        system: "S",
        prompt: "P",
        backend: "claude-code",
        llm: fakeLlm({ error: "boom" }),
      }),
    ).rejects.toThrow("boom");
  });

  test("helpers", () => {
    expect(firstJson('Sure:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(firstJson('x {"b":2} y')).toEqual({ b: 2 });
    expect(firstJson("nope")).toBeNull();
    expect(contentText([{ type: "text", text: "a" }, { type: "x" }])).toBe("a");
  });
});

describe("Auto — what to make", () => {
  test("the AI's answer, read from JSON", () => {
    expect(
      parseAutoAnswer('{"type":"Dashboard","why":"several things"}'),
    ).toEqual({ type: "dashboard", why: "several things" });
    expect(parseAutoAnswer('{"type":"spaceship"}')).toBeNull();
    expect(AUTO_SYSTEM).toMatch(/"widget" \| "bot" \| "dashboard" \| "theme"/);
  });

  test("a keyword guess without an AI", () => {
    expect(guessType("a dark theme with teal colors")).toBe("theme");
    expect(guessType("a morning brief dashboard")).toBe("dashboard");
    expect(guessType("every morning summarize my inbox")).toBe("bot");
    expect(guessType("a clock for Tokyo")).toBe("widget");
  });

  test("pickType uses the AI, and guesses when it fails or there's none", async () => {
    const ask = jest
      .fn()
      .mockResolvedValue('{"type":"bot","why":"runs on a schedule"}');
    expect(
      await pickType("summaries", { backend: "claude-code", ask }),
    ).toEqual({ type: "bot", why: "runs on a schedule", by: "ai" });
    const broken = jest.fn().mockRejectedValue(new Error("x"));
    expect(
      await pickType("a dashboard for sales", {
        backend: "claude-code",
        ask: broken,
      }),
    ).toEqual({ type: "dashboard", why: "", by: "guess" });
    const unused = jest.fn();
    expect(await pickType("a clock", { backend: null, ask: unused })).toEqual({
      type: "widget",
      why: "",
      by: "guess",
    });
    expect(unused).not.toHaveBeenCalled();
  });
});

describe("Theme — from a description", () => {
  test("four hex colors and a name become an unsaved theme", () => {
    const theme = parseThemeAnswer(
      '{"name":"Autumn Ember","primary":"#C2410C","secondary":"#a16207","tertiary":"#7c2d12","neutral":"#78716c"}',
    );
    expect(theme).toMatchObject({
      name: "Autumn Ember",
      primary: "#c2410c",
      secondary: "#a16207",
      tertiary: "#7c2d12",
      neutral: "#78716c",
      dark: {},
      light: {},
    });
    expect(theme.id).toMatch(/^theme-/);
  });

  test("anything not a 6-digit hex is refused", async () => {
    expect(
      parseThemeAnswer(
        '{"primary":"orange","secondary":"#a16207","tertiary":"#7c2d12","neutral":"#78716c"}',
      ),
    ).toBeNull();
    await expect(
      themeFromPrompt("warm", {
        backend: "claude-code",
        ask: async () => "I can't",
      }),
    ).rejects.toThrow(/couldn't be used/);
  });
});
