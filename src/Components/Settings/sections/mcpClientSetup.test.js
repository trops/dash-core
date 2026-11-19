import { mcpClientSetup } from "./mcpClientSetup";

describe("connecting Claude to Dash's MCP server", () => {
  const setup = mcpClientSetup({
    port: 3141,
    token: "tok-1",
    certPath: "/Users/x/Library/Application Support/Dash/certs/cert.pem",
  });

  test("the address is https — the server speaks nothing else", () => {
    expect(setup.url).toBe("https://127.0.0.1:3141/mcp");
    expect(setup.claudeCode).not.toContain("http://");
    expect(setup.claudeDesktop).not.toContain("http://");
  });

  test("Claude Code: one command, trusting Dash's certificate", () => {
    expect(setup.claudeCode).toBe(
      'claude mcp add dash --env NODE_EXTRA_CA_CERTS="/Users/x/Library/Application Support/Dash/certs/cert.pem" -- npx -y mcp-remote https://127.0.0.1:3141/mcp --header "Authorization: Bearer tok-1"',
    );
  });

  test("Claude Desktop: mcp-remote with the token and the certificate", () => {
    const dash = JSON.parse(setup.claudeDesktop).mcpServers.dash;
    expect(dash.command).toBe("npx");
    expect(dash.args).toEqual([
      "-y",
      "mcp-remote",
      "https://127.0.0.1:3141/mcp",
      "--header",
      "Authorization: Bearer tok-1",
    ]);
    expect(dash.env.NODE_EXTRA_CA_CERTS).toMatch(/cert\.pem$/);
  });

  test("no certificate yet: no trust setting", () => {
    const s = mcpClientSetup({ port: 3141, token: "t" });
    expect(s.claudeCode).not.toContain("NODE_EXTRA_CA_CERTS");
    expect(JSON.parse(s.claudeDesktop).mcpServers.dash.env).toBeUndefined();
  });
});
