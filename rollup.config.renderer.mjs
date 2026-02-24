import babel from "@rollup/plugin-babel";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import filesize from "rollup-plugin-filesize";
import external from "rollup-plugin-peer-deps-external";
import strip from "@rollup/plugin-strip";
import json from "@rollup/plugin-json";

const INPUT_FILE_PATH = "src/index.js";

const GLOBALS = {
    react: "React",
    "react-dom": "ReactDOM",
};

const PLUGINS = [
    external({
        includeDependencies: true,
    }),
    babel({
        babelHelpers: "runtime",
        exclude: "node_modules/**",
        skipPreflightCheck: true,
    }),
    resolve({
        browser: true,
        extensions: [".js", ".jsx", ".json", ".ts", ".tsx"],
    }),
    commonjs({
        include: "node_modules/**",
    }),
    json(),
    filesize(),
    strip(),
];

const EXTERNAL = [
    "react",
    "react-dom",
    "@trops/dash-react",
    /^@fortawesome\//,
];

const CJS_AND_ES_EXTERNALS = [...EXTERNAL, /@babel\/runtime/];

const config = [
    {
        input: INPUT_FILE_PATH,
        output: {
            dir: "dist",
            format: "cjs",
            sourcemap: true,
            preserveModules: false,
        },
        plugins: PLUGINS,
        external: CJS_AND_ES_EXTERNALS,
    },
    {
        input: INPUT_FILE_PATH,
        output: {
            file: "dist/index.esm.js",
            format: "es",
            sourcemap: true,
        },
        plugins: PLUGINS,
        external: CJS_AND_ES_EXTERNALS,
    },
];

export default config;
