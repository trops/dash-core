#!/usr/bin/env node
/**
 * Custom Google Drive MCP server.
 *
 * Tools: search, list_folder, create_folder, read_file, write_file, resolve_path
 *
 * OAuth uses PKCE with bundled app credentials (client_id + obfuscated
 * client_secret). No per-user GCP project setup — users just click
 * "Connect Google Drive" to grant access via browser.
 *
 * Usage:
 *   MCP server:  node google-drive.js          (stdio transport)
 *   OAuth auth:  node google-drive.js auth      (browser-based OAuth flow)
 *
 * Environment variables:
 *   GDRIVE_CREDENTIALS_PATH — path to stored OAuth credentials (access/refresh tokens)
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
const crypto = require("crypto");

const credentialsPath = (process.env.GDRIVE_CREDENTIALS_PATH || "").replace(
  /^~/,
  process.env.HOME || "",
);

// Bundled OAuth credentials for the Dash platform's GCP project.
// client_id is public (identifier, not a secret).
// client_secret is injected at build time from GitHub Secrets — the
// placeholder below is replaced in dist/ during `npm run build`.
// Desktop OAuth client_secrets are not confidential per Google's docs —
// the consent screen is the security boundary, not this value.
const BUNDLED_CLIENT_ID =
  "785070273499-mr9b0vup4u24he8duh3c6j5gpk7qj54j.apps.googleusercontent.com";
const BUNDLED_CLIENT_SECRET =
  process.env.GDRIVE_CLIENT_SECRET || "__GDRIVE_CLIENT_SECRET__";

function getClientId() {
  return BUNDLED_CLIENT_ID;
}

function getClientSecret() {
  return BUNDLED_CLIENT_SECRET;
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
  const clientId = getClientId();

  // Still valid (>60s remaining)?
  if (creds.expiry_date && creds.expiry_date > Date.now() + 60 * 1000) {
    return creds.access_token;
  }

  // Refresh token — Google requires client_secret even for desktop apps
  const postData = [
    `client_id=${encodeURIComponent(clientId)}`,
    `client_secret=${encodeURIComponent(getClientSecret())}`,
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
 * Make a Google Drive API request (GET, POST, PATCH, etc.).
 */
function driveRequest(apiPath, token, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const headers = { Authorization: `Bearer ${token}` };
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const req = https.request(
      { hostname: "www.googleapis.com", path: apiPath, method, headers },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(data);
            }
          } else {
            reject(
              new Error(`Drive API ${method} (${res.statusCode}): ${data}`),
            );
          }
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Multipart upload to Google Drive (for creating/updating file content).
 */
function driveUploadRequest(
  apiPath,
  token,
  method,
  metadata,
  content,
  mimeType,
) {
  return new Promise((resolve, reject) => {
    const boundary = "dash_boundary_" + Date.now().toString(36);
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--`;

    const req = https.request(
      {
        hostname: "www.googleapis.com",
        path: apiPath,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(data);
            }
          } else {
            reject(
              new Error(`Drive upload ${method} (${res.statusCode}): ${data}`),
            );
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Tool helper functions ────────────────────────────────────────────

async function listFolder(token, folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent("files(id,name,mimeType)");
  const result = await driveRequest(
    `/drive/v3/files?q=${q}&fields=${fields}&pageSize=200`,
    token,
  );
  return result.files || [];
}

async function createFolder(token, parentId, name) {
  const body = JSON.stringify({
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents: [parentId],
  });
  return await driveRequest(
    "/drive/v3/files?fields=id,name",
    token,
    "POST",
    body,
  );
}

async function readFile(token, fileId) {
  return await driveRequest(`/drive/v3/files/${fileId}?alt=media`, token);
}

async function writeFile(token, parentId, name, content, mimeType) {
  mimeType = mimeType || "text/markdown";
  // Upsert: check if file with this name already exists in parent
  const escapedName = name.replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `name='${escapedName}' and '${parentId}' in parents and trashed=false`,
  );
  const existing = await driveRequest(
    `/drive/v3/files?q=${q}&fields=files(id)`,
    token,
  );
  const existingId = existing.files?.[0]?.id;

  if (existingId) {
    const result = await driveUploadRequest(
      `/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,name`,
      token,
      "PATCH",
      {},
      content,
      mimeType,
    );
    return { ...result, _action: "updated" };
  } else {
    const result = await driveUploadRequest(
      `/upload/drive/v3/files?uploadType=multipart&fields=id,name`,
      token,
      "POST",
      { name, parents: [parentId], mimeType },
      content,
      mimeType,
    );
    return { ...result, _action: "created" };
  }
}

async function resolvePath(token, pathStr) {
  const segments = pathStr
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  let currentId = "root";
  for (const segment of segments) {
    const children = await listFolder(token, currentId);
    const match = children.find((c) => c.name === segment);
    if (!match) return null;
    currentId = match.id;
  }
  return currentId;
}

// ── Auth subcommand ──────────────────────────────────────────────────
if (process.argv[2] === "auth") {
  (async () => {
    try {
      const http = require("http");
      const { URL } = require("url");
      const clientId = getClientId();

      const scopes = ["https://www.googleapis.com/auth/drive"];

      // PKCE: generate code verifier + challenge (additional security layer)
      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

      let redirectUri;

      // Start local server to catch the callback
      const server = http.createServer(async (req, res) => {
        const reqUrl = new URL(req.url, redirectUri);
        const code = reqUrl.searchParams.get("code");
        if (!code) {
          res.writeHead(400);
          res.end("Missing authorization code");
          return;
        }

        // Exchange code for tokens (PKCE code_verifier + client_secret)
        const postData = [
          `code=${encodeURIComponent(code)}`,
          `client_id=${encodeURIComponent(clientId)}`,
          `client_secret=${encodeURIComponent(getClientSecret())}`,
          `code_verifier=${encodeURIComponent(codeVerifier)}`,
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

      server.on("error", (err) => {
        console.error("OAuth server error:", err.message);
        process.exit(1);
      });

      // Use ephemeral port (0) — OS assigns a free port
      server.listen(0, () => {
        const actualPort = server.address().port;
        redirectUri = `http://localhost:${actualPort}`;

        const authUrl =
          `https://accounts.google.com/o/oauth2/v2/auth?` +
          `client_id=${encodeURIComponent(clientId)}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&response_type=code` +
          `&scope=${encodeURIComponent(scopes.join(" "))}` +
          `&access_type=offline` +
          `&prompt=consent` +
          `&code_challenge=${encodeURIComponent(codeChallenge)}` +
          `&code_challenge_method=S256`;

        const { exec } = require("child_process");
        exec(`open "${authUrl}"`);
        console.log(
          `\nOpening browser for authorization (port ${actualPort})...\n`,
        );
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
              query: { type: "string", description: "Search query" },
            },
            required: ["query"],
          },
        },
        {
          name: "list_folder",
          description:
            "List children of a Google Drive folder by ID. Use 'root' for My Drive.",
          inputSchema: {
            type: "object",
            properties: {
              folderId: {
                type: "string",
                description: "Folder ID, or 'root' for My Drive",
              },
            },
            required: ["folderId"],
          },
        },
        {
          name: "create_folder",
          description:
            "Create a new folder inside a parent folder. Returns the new folder's ID.",
          inputSchema: {
            type: "object",
            properties: {
              parentId: { type: "string", description: "Parent folder ID" },
              name: { type: "string", description: "New folder name" },
            },
            required: ["parentId", "name"],
          },
        },
        {
          name: "read_file",
          description:
            "Read the text content of a Drive file by ID. Plain text files only.",
          inputSchema: {
            type: "object",
            properties: {
              fileId: { type: "string", description: "File ID" },
            },
            required: ["fileId"],
          },
        },
        {
          name: "write_file",
          description:
            "Create or update a text file in a folder (upsert by name).",
          inputSchema: {
            type: "object",
            properties: {
              parentId: { type: "string", description: "Parent folder ID" },
              name: { type: "string", description: "File name" },
              content: { type: "string", description: "File content" },
              mimeType: {
                type: "string",
                description: "Optional MIME type (default: text/markdown)",
              },
            },
            required: ["parentId", "name", "content"],
          },
        },
        {
          name: "resolve_path",
          description:
            "Walk a slash-separated path from My Drive root and return the final file/folder ID, or null if any segment is missing.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description:
                  "Slash-separated path, e.g. 'Sales Pipeline/AMER/ENT/Acme Corp'",
              },
            },
            required: ["path"],
          },
        },
      ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = request.params.arguments || {};

      try {
        const token = await getAccessToken();

        switch (toolName) {
          case "search": {
            const query = args.query;
            if (!query) {
              return {
                content: [
                  { type: "text", text: "Missing required argument: query" },
                ],
                isError: true,
              };
            }
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
                  { type: "text", text: `No files found for query: ${query}` },
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
          }

          case "list_folder": {
            if (!args.folderId) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Missing required argument: folderId",
                  },
                ],
                isError: true,
              };
            }
            const children = await listFolder(token, args.folderId);
            if (children.length === 0) {
              return {
                content: [{ type: "text", text: "Folder is empty." }],
              };
            }
            const childLines = children.map(
              (f) => `${f.name} (${f.mimeType}) [${f.id}]`,
            );
            return {
              content: [
                {
                  type: "text",
                  text: `${children.length} children:\n${childLines.join("\n")}`,
                },
              ],
            };
          }

          case "create_folder": {
            if (!args.parentId || !args.name) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Missing required arguments: parentId, name",
                  },
                ],
                isError: true,
              };
            }
            const folder = await createFolder(token, args.parentId, args.name);
            return {
              content: [
                {
                  type: "text",
                  text: `Created folder "${folder.name}" [${folder.id}]`,
                },
              ],
            };
          }

          case "read_file": {
            if (!args.fileId) {
              return {
                content: [
                  { type: "text", text: "Missing required argument: fileId" },
                ],
                isError: true,
              };
            }
            const content = await readFile(token, args.fileId);
            return {
              content: [
                {
                  type: "text",
                  text:
                    typeof content === "string"
                      ? content
                      : JSON.stringify(content),
                },
              ],
            };
          }

          case "write_file": {
            if (!args.parentId || !args.name || args.content == null) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Missing required arguments: parentId, name, content",
                  },
                ],
                isError: true,
              };
            }
            const writeResult = await writeFile(
              token,
              args.parentId,
              args.name,
              args.content,
              args.mimeType,
            );
            return {
              content: [
                {
                  type: "text",
                  text: `${writeResult._action} "${writeResult.name}" [${writeResult.id}]`,
                },
              ],
            };
          }

          case "resolve_path": {
            if (!args.path) {
              return {
                content: [
                  { type: "text", text: "Missing required argument: path" },
                ],
                isError: true,
              };
            }
            const resolvedId = await resolvePath(token, args.path);
            if (resolvedId) {
              return {
                content: [
                  { type: "text", text: `Resolved to ID: ${resolvedId}` },
                ],
              };
            }
            return {
              content: [{ type: "text", text: `Path not found: ${args.path}` }],
            };
          }

          default:
            return {
              content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
              isError: true,
            };
        }
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
