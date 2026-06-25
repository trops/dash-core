import { slugifyProviderType, uniqueProviderType } from "./providerType";

describe("slugifyProviderType", () => {
  it("kebab-cases a name", () => {
    expect(slugifyProviderType("My Granola Server")).toBe("my-granola-server");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugifyProviderType("  Foo__Bar!!  (v2) ")).toBe("foo-bar-v2");
  });

  it("falls back when there are no slug-able characters", () => {
    expect(slugifyProviderType("!!!")).toBe("custom-provider");
    expect(slugifyProviderType("")).toBe("custom-provider");
    expect(slugifyProviderType(null)).toBe("custom-provider");
  });
});

describe("uniqueProviderType", () => {
  it("returns the base slug when not taken", () => {
    expect(uniqueProviderType("Granola", ["slack", "github"])).toBe("granola");
  });

  it("suffixes on collision with an existing type", () => {
    expect(uniqueProviderType("Granola", ["granola"])).toBe("granola-2");
    expect(uniqueProviderType("Granola", ["granola", "granola-2"])).toBe(
      "granola-3",
    );
  });

  it("handles an empty existing-types list", () => {
    expect(uniqueProviderType("My Server")).toBe("my-server");
  });

  it("never collides — two providers with the same name get distinct types", () => {
    const taken = [];
    const a = uniqueProviderType("Test MCP", taken);
    taken.push(a);
    const b = uniqueProviderType("Test MCP", taken);
    expect(a).toBe("test-mcp");
    expect(b).toBe("test-mcp-2");
    expect(a).not.toBe(b);
  });
});
