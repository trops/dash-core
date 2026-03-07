#!/usr/bin/env node
/**
 * gdrive-server.mjs
 *
 * Local Google Drive MCP server wrapper that fixes the upstream OAuth2 bug.
 *
 * The upstream @modelcontextprotocol/server-gdrive creates OAuth2 without
 * client_id/client_secret, which prevents token refresh after ~1 hour.
 * This wrapper reads both the credentials file AND the OAuth keys file
 * to properly initialize OAuth2 with client credentials.
 *
 * Env vars:
 *   GDRIVE_CREDENTIALS_PATH  - path to saved credentials (access_token, refresh_token)
 *   GDRIVE_OAUTH_KEYS_PATH   - path to gcp-oauth.keys.json (client_id, client_secret)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import { google } from "googleapis";

const drive = google.drive("v3");

const server = new Server(
    {
        name: "dash/gdrive",
        version: "1.0.0",
    },
    {
        capabilities: {
            resources: {},
            tools: {},
        },
    }
);

// --- List Resources ---
server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    const pageSize = 10;
    const params = {
        pageSize,
        fields: "nextPageToken, files(id, name, mimeType)",
    };
    if (request.params?.cursor) {
        params.pageToken = request.params.cursor;
    }
    const res = await drive.files.list(params);
    const files = res.data.files;
    return {
        resources: files.map((file) => ({
            uri: `gdrive:///${file.id}`,
            mimeType: file.mimeType,
            name: file.name,
        })),
        nextCursor: res.data.nextPageToken,
    };
});

// --- Read Resource ---
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const fileId = request.params.uri.replace("gdrive:///", "");
    const file = await drive.files.get({
        fileId,
        fields: "mimeType",
    });

    // Google Docs/Sheets/etc need export
    if (file.data.mimeType?.startsWith("application/vnd.google-apps")) {
        let exportMimeType;
        switch (file.data.mimeType) {
            case "application/vnd.google-apps.document":
                exportMimeType = "text/markdown";
                break;
            case "application/vnd.google-apps.spreadsheet":
                exportMimeType = "text/csv";
                break;
            case "application/vnd.google-apps.presentation":
                exportMimeType = "text/plain";
                break;
            case "application/vnd.google-apps.drawing":
                exportMimeType = "image/png";
                break;
            default:
                exportMimeType = "text/plain";
        }
        const res = await drive.files.export(
            { fileId, mimeType: exportMimeType },
            { responseType: "text" }
        );
        return {
            contents: [
                {
                    uri: request.params.uri,
                    mimeType: exportMimeType,
                    text: res.data,
                },
            ],
        };
    }

    // Regular files — download content
    const res = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "arraybuffer" }
    );
    const mimeType = file.data.mimeType || "application/octet-stream";
    if (mimeType.startsWith("text/") || mimeType === "application/json") {
        return {
            contents: [
                {
                    uri: request.params.uri,
                    mimeType,
                    text: Buffer.from(res.data).toString("utf-8"),
                },
            ],
        };
    }
    return {
        contents: [
            {
                uri: request.params.uri,
                mimeType,
                blob: Buffer.from(res.data).toString("base64"),
            },
        ],
    };
});

// --- List Tools ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "search",
                description: "Search for files in Google Drive",
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
    };
});

// --- Call Tool ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "search") {
        const userQuery = request.params.arguments?.query;
        const escapedQuery = userQuery
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "\\'");
        const formattedQuery = `fullText contains '${escapedQuery}'`;
        const res = await drive.files.list({
            q: formattedQuery,
            pageSize: 10,
            fields: "files(id, name, mimeType, modifiedTime, size)",
        });
        const fileList = res.data.files
            ?.map((file) => `${file.name} (${file.mimeType})`)
            .join("\n");
        return {
            content: [
                {
                    type: "text",
                    text: `Found ${res.data.files?.length ?? 0} files:\n${fileList}`,
                },
            ],
            isError: false,
        };
    }
    throw new Error("Tool not found");
});

// --- Load credentials and start server ---
const credentialsPath = process.env.GDRIVE_CREDENTIALS_PATH;
const oauthKeysPath = process.env.GDRIVE_OAUTH_KEYS_PATH;

if (!credentialsPath || !fs.existsSync(credentialsPath)) {
    console.error(
        "Credentials not found. Please run OAuth auth flow first."
    );
    process.exit(1);
}

const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf-8"));

// THE FIX: Read client_id and client_secret from the OAuth keys file
// so that googleapis can refresh the access_token when it expires.
let clientId, clientSecret;
if (oauthKeysPath && fs.existsSync(oauthKeysPath)) {
    const keysFile = JSON.parse(fs.readFileSync(oauthKeysPath, "utf-8"));
    const keyData = keysFile.installed || keysFile.web;
    if (keyData) {
        clientId = keyData.client_id;
        clientSecret = keyData.client_secret;
    }
}

const auth = new google.auth.OAuth2(clientId, clientSecret);
auth.setCredentials(credentials);
google.options({ auth });

console.error(
    `Credentials loaded (refresh_token: ${credentials.refresh_token ? "present" : "missing"}). Starting server.`
);

const transport = new StdioServerTransport();
await server.connect(transport);
