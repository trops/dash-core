import {
  aiBackendOptions,
  effectiveAiBackend,
  findAnthropicProvider,
} from "./aiBackend";

describe("aiBackend", () => {
  test("findAnthropicProvider finds the Anthropic credential provider", () => {
    expect(findAnthropicProvider({})).toBeNull();
    expect(
      findAnthropicProvider({
        Slack: { type: "slack" },
        "Anthropic (AI Assistant)": { type: "anthropic" },
      })[0],
    ).toBe("Anthropic (AI Assistant)");
    expect(
      findAnthropicProvider({ A: { type: "anthropic", providerClass: "mcp" } }),
    ).toBeNull();
  });

  test("effectiveAiBackend: preferred if available, else whichever is, else null", () => {
    expect(
      effectiveAiBackend({
        preferred: "claude-code",
        cliAvailable: true,
        hasAnthropic: true,
      }),
    ).toBe("claude-code");
    expect(
      effectiveAiBackend({
        preferred: "anthropic",
        cliAvailable: true,
        hasAnthropic: true,
      }),
    ).toBe("anthropic");
    expect(
      effectiveAiBackend({
        preferred: "anthropic",
        cliAvailable: true,
        hasAnthropic: false,
      }),
    ).toBe("claude-code");
    expect(
      effectiveAiBackend({
        preferred: "claude-code",
        cliAvailable: false,
        hasAnthropic: true,
      }),
    ).toBe("anthropic");
    expect(
      effectiveAiBackend({ cliAvailable: false, hasAnthropic: false }),
    ).toBeNull();
  });

  test("aiBackendOptions disables what isn't set up, with a hint", () => {
    const [cli, api] = aiBackendOptions({
      cliAvailable: false,
      hasAnthropic: false,
    });
    expect(cli).toMatchObject({ value: "claude-code", disabled: true });
    expect(cli.hint).toMatch(/not found/);
    expect(api).toMatchObject({ value: "anthropic", disabled: true });
    expect(api.hint).toMatch(/API key/);

    const checking = aiBackendOptions({
      cliAvailable: null,
      hasAnthropic: true,
    });
    expect(checking[0].hint).toMatch(/Checking/);
    expect(checking[1].disabled).toBeFalsy();

    const ready = aiBackendOptions({ cliAvailable: true, hasAnthropic: true });
    expect(ready.every((o) => !o.disabled)).toBe(true);
  });
});
