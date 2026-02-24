import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import filesize from "rollup-plugin-filesize";

const INPUT_FILE_PATH = "electron/index.js";

// Electron main process — CJS only, externalize Node.js builtins and electron
const EXTERNAL = [
    "electron",
    "fs",
    "path",
    "os",
    "child_process",
    "crypto",
    "http",
    "https",
    "net",
    "stream",
    "url",
    "util",
    "zlib",
    "events",
    // Externalize heavy dependencies that consumers should install
    "esbuild",
    "@anthropic-ai/sdk",
    "@modelcontextprotocol/sdk/client/index.js",
    "@modelcontextprotocol/sdk/client/stdio.js",
    "safeStorage",
    "algoliasearch",
    "openai",
    "JSONStream",
    "live-plugin-manager",
];

const config = {
    input: INPUT_FILE_PATH,
    output: {
        file: "dist/electron/index.js",
        format: "cjs",
        sourcemap: true,
        exports: "auto",
    },
    plugins: [
        resolve({
            preferBuiltins: true,
            extensions: [".js", ".json"],
        }),
        commonjs(),
        json(),
        filesize(),
    ],
    external: EXTERNAL,
};

export default config;
