/**
 * One AI question, and a theme from a description (create-entry PRD
 * CRE-001 AC3, phase 5c). Type: Auto went with the Create window
 * (lead-workspace release 6c); the theme maker is kept for its next round.
 */
import { aiOnce, firstJson, contentText } from "../../utils/aiOnce";
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
