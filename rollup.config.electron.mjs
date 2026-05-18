import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";

const INPUT_FILE_PATH = "electron/index.js";

// Electron main process — CJS only, externalize Node.js builtins and electron
//
// Every package declared in dash-core's `dependencies` block must be
// externalized here. If we let rollup inline them, code paths that
// rely on Node module-level state (xtreamer's Generator class, native
// bindings via electron-store, etc.) break with cryptic ReferenceErrors
// at runtime. The consumer (dash-electron) installs these via npm, so
// runtime resolution always finds them.
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
    "safeStorage",
    // Mirror dash-core's package.json `dependencies` block: each
    // declared runtime dep is externalized so the consumer's
    // node_modules provides it at require() time.
    "@anthropic-ai/sdk",
    "@modelcontextprotocol/sdk/client/index.js",
    "@modelcontextprotocol/sdk/client/stdio.js",
    "adm-zip",
    "algoliasearch",
    "clsx",
    "croner",
    "csv-parser",
    "css",
    "deep-equal",
    "electron-store",
    "esbuild",
    "JSONStream",
    "live-plugin-manager",
    "marked",
    "minimist",
    "node-forge",
    "node-vibrant/node",
    "objects-to-csv",
    "openai",
    "quickjs-emscripten",
    "ws",
    "xml2js",
    "xtreamer",
    "zod",
    // zod-to-json-schema has internal circular deps (parseDef →
    // selectParser → parsers/* → parseDef). Rollup's CommonJS wrapper
    // handles them with lazy require* shims that sometimes evaluate
    // out of order — when that happens the bundle dies on
    // `Object.defineProperty(map, …)` because `var map` is still
    // undefined at the call site. Externalizing punts the load to
    // Node's native CJS resolver, which handles the cycle correctly,
    // and dash-electron / any other consumer already has the package
    // in its node_modules transitively via @modelcontextprotocol/sdk.
    "zod-to-json-schema",
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
    ],
    external: EXTERNAL,
};

export default config;
