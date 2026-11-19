/**
 * How Claude on this computer connects to Dash's MCP server (Settings ›
 * MCP Server). The server only speaks https, with a certificate Dash makes
 * itself, so a client both needs the https address and has to trust that
 * certificate (NODE_EXTRA_CA_CERTS). Both Claude Code and Claude Desktop
 * reach it through mcp-remote, which carries the token and the certificate.
 *
 * @param {{ port: number, token: string, certPath?: string|null }} args
 * @returns {{ url: string, claudeCode: string, claudeDesktop: string }}
 */
export function mcpClientSetup({ port, token, certPath = null }) {
  const url = `https://127.0.0.1:${port}/mcp`;
  const header = `Authorization: Bearer ${token}`;
  const env = certPath ? { NODE_EXTRA_CA_CERTS: certPath } : null;
  const claudeCode = [
    "claude mcp add dash",
    env ? `--env NODE_EXTRA_CA_CERTS="${certPath}"` : null,
    `-- npx -y mcp-remote ${url} --header "${header}"`,
  ]
    .filter(Boolean)
    .join(" ");
  const claudeDesktop = JSON.stringify(
    {
      mcpServers: {
        dash: {
          command: "npx",
          args: ["-y", "mcp-remote", url, "--header", header],
          ...(env ? { env } : {}),
        },
      },
    },
    null,
    2,
  );
  return { url, claudeCode, claudeDesktop };
}
