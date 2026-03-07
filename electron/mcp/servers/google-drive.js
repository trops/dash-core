#!/usr/bin/env node
/**
 * Custom Google Drive MCP server.
 *
 * Replaces the archived @modelcontextprotocol/server-gdrive which has a
 * fundamental bug: it creates OAuth2 clients without client_id/client_secret,
 * so it can never refresh tokens.
 *
 * Exposes a single "search" tool with { query: string } input — identical
 * interface to the original, so no widget changes are needed.
 *
 * Usage:
 *   MCP server:  node google-drive.js          (stdio transport)
 *   OAuth auth:  node google-drive.js auth      (browser-based OAuth flow)
 *
 * Environment variables:
 *   GDRIVE_CREDENTIALS_PATH — path to stored OAuth credentials (access/refresh tokens)
 *   GDRIVE_OAUTH_PATH       — path to Google OAuth client keys file
 */
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const fs = require("fs");
const https = require("https");
const path = require("path");

const credentialsPath = (process.env.GDRIVE_CREDENTIALS_PATH || "").replace(
  /^~/,
  process.env.HOME || "",
);
const oauthKeysPath = (process.env.GDRIVE_OAUTH_PATH || "").replace(
  /^~/,
  process.env.HOME || "",
);

/**
 * Read OAuth client credentials from the keys file.
 */
function getClientCredentials() {
  const keysFile = JSON.parse(fs.readFileSync(oauthKeysPath, "utf8"));
  const keyData = keysFile.installed || keysFile.web;
  return {
    client_id: keyData.client_id,
    client_secret: keyData.client_secret,
  };
}

/**
 * Read stored credentials (access_token, refresh_token, expiry_date).
 */
function readCredentials() {
  return JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
}

/**
 * Get a valid access token, refreshing if expired.
 */
async function getAccessToken() {
  let creds = readCredentials();
  const { client_id, client_secret } = getClientCredentials();

  // Still valid (>60s remaining)?
  if (creds.expiry_date && creds.expiry_date > Date.now() + 60 * 1000) {
    return creds.access_token;
  }

  // Refresh
  const postData = [
    `client_id=${encodeURIComponent(client_id)}`,
    `client_secret=${encodeURIComponent(client_secret)}`,
    `refresh_token=${encodeURIComponent(creds.refresh_token)}`,
    "grant_type=refresh_token",
  ].join("&");

  const body = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "oauth2.googleapis.com",
        path: "/token",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            reject(
              new Error(`Token refresh failed (${res.statusCode}): ${data}`),
            );
          }
        });
      },
    );
    req.on("error", reject);
    req.write(postData);
    req.end();
  });

  creds.access_token = body.access_token;
  creds.expiry_date = Date.now() + (body.expires_in || 3600) * 1000;
  if (body.refresh_token) {
    creds.refresh_token = body.refresh_token;
  }
  fs.writeFileSync(credentialsPath, JSON.stringify(creds, null, 2));
  return creds.access_token;
}

/**
 * Make a Google Drive API request.
 */
function driveRequest(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "www.googleapis.com",
        path,
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Drive API error (${res.statusCode}): ${data}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ── Auth subcommand ──────────────────────────────────────────────────
if (process.argv[2] === "auth") {
  (async () => {
    try {
      const http = require("http");
      const { URL } = require("url");
      const { client_id, client_secret } = getClientCredentials();

      const keysFile = JSON.parse(fs.readFileSync(oauthKeysPath, "utf8"));
      const keyData = keysFile.installed || keysFile.web;
      const redirectUri =
        keyData.redirect_uris?.[0] || "http://localhost:3000/oauth2callback";

      // Extract port from redirect URI
      const redirectUrl = new URL(redirectUri);
      const port = parseInt(redirectUrl.port, 10) || 3000;

      const scopes = ["https://www.googleapis.com/auth/drive.readonly"];

      const authUrl =
        `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(client_id)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes.join(" "))}` +
        `&access_type=offline` +
        `&prompt=consent`;

      console.log(
        `\nOpen this URL in your browser to authorize:\n\n${authUrl}\n`,
      );

      // Start local server to catch the callback
      const server = http.createServer(async (req, res) => {
        const reqUrl = new URL(req.url, `http://localhost:${port}`);
        const code = reqUrl.searchParams.get("code");
        if (!code) {
          res.writeHead(400);
          res.end("Missing authorization code");
          return;
        }

        // Exchange code for tokens
        const postData = [
          `code=${encodeURIComponent(code)}`,
          `client_id=${encodeURIComponent(client_id)}`,
          `client_secret=${encodeURIComponent(client_secret)}`,
          `redirect_uri=${encodeURIComponent(redirectUri)}`,
          `grant_type=authorization_code`,
        ].join("&");

        try {
          const body = await new Promise((resolve, reject) => {
            const tokenReq = https.request(
              {
                hostname: "oauth2.googleapis.com",
                path: "/token",
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  "Content-Length": Buffer.byteLength(postData),
                },
              },
              (tokenRes) => {
                let data = "";
                tokenRes.on("data", (chunk) => (data += chunk));
                tokenRes.on("end", () => {
                  if (tokenRes.statusCode === 200) {
                    resolve(JSON.parse(data));
                  } else {
                    reject(
                      new Error(
                        `Token exchange failed (${tokenRes.statusCode}): ${data}`,
                      ),
                    );
                  }
                });
              },
            );
            tokenReq.on("error", reject);
            tokenReq.write(postData);
            tokenReq.end();
          });

          const creds = {
            access_token: body.access_token,
            refresh_token: body.refresh_token,
            expiry_date: Date.now() + (body.expires_in || 3600) * 1000,
          };

          const credDir = path.dirname(credentialsPath);
          fs.mkdirSync(credDir, { recursive: true });
          fs.writeFileSync(credentialsPath, JSON.stringify(creds, null, 2));

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<h1>Authorization successful!</h1><p>You can close this tab.</p>",
          );
          console.log(`\nCredentials saved to ${credentialsPath}\n`);
          server.close();
          process.exit(0);
        } catch (err) {
          res.writeHead(500);
          res.end(`Error: ${err.message}`);
          console.error("Token exchange error:", err.message);
          server.close();
          process.exit(1);
        }
      });

      server.listen(port, () => {
        console.log(`Listening on port ${port} for OAuth callback...`);
      });
    } catch (err) {
      console.error("Auth error:", err.message);
      process.exit(1);
    }
  })();
} else {
  // ── MCP Server ──────────────────────────────────────────────────────
  (async () => {
    const server = new Server(
      { name: "google-drive", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "search",
          description: "Search for files in Google Drive by name or content",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query",
              },
            },
            required: ["query"],
          },
        },
      ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== "search") {
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${request.params.name}`,
            },
          ],
          isError: true,
        };
      }

      const query = request.params.arguments?.query;
      if (!query) {
        return {
          content: [{ type: "text", text: "Missing required argument: query" }],
          isError: true,
        };
      }

      try {
        const token = await getAccessToken();
        const encodedQuery = encodeURIComponent(
          `fullText contains '${query.replace(/'/g, "\\'")}'`,
        );
        const result = await driveRequest(
          `/drive/v3/files?q=${encodedQuery}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&pageSize=20`,
          token,
        );

        const files = result.files || [];
        if (files.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No files found for query: ${query}`,
              },
            ],
          };
        }

        const lines = files.map(
          (f) =>
            `${f.name} (${f.mimeType})${f.webViewLink ? ` - ${f.webViewLink}` : ""}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `Found ${files.length} files:\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
  })();
}
