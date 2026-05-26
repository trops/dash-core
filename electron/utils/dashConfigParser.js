/**
 * dashConfigParser.js
 *
 * AST-allowlist parser for `.dash.js` config files (Phase 5B, P1 #10).
 *
 * Why this exists: `.dash.js` configs are user-supplied code that we
 * need to READ structurally, never EXECUTE. The historical approach
 * used `vm.runInContext` to evaluate the `export default {…}` literal
 * in a sandboxed context, which is exposed-by-design — a malicious
 * config that smuggled a `MemberExpression` (`process.env.x`) or a
 * `CallExpression` (`require("child_process")`) would run in the
 * Node-shaped sandbox at install-time.
 *
 * This parser uses `acorn` to produce an AST, then walks ONLY the
 * node types that can legitimately appear in a data literal. Anything
 * else throws — the config is rejected, no code runs.
 *
 * Note: not to be confused with `safeJsExecutor.js`, which sandboxes
 * EXECUTION of widget-supplied JS bodies in QuickJS-WASM. This module
 * is for parsing static data; safeJsExecutor is for running logic.
 * Different threat models, different tools.
 */

"use strict";

const acorn = require("acorn");

// Top-level identifier values that are legitimate in a config literal.
// Anything else resolves to null (which matches the historical "stub
// imported identifier as undefined" behavior — we use null because
// JSON-equivalent shapes are easier to assert in tests).
const ALLOWED_GLOBAL_IDENTIFIERS = new Set(["undefined", "Infinity", "NaN"]);

class DashConfigParseError extends Error {
  constructor(message, nodeType) {
    super(message);
    this.name = "DashConfigParseError";
    this.nodeType = nodeType;
  }
}

/**
 * Parse a `.dash.js` source string and return its exported default
 * object as plain data.
 *
 * @param {string} source - Full source of the .dash.js file.
 * @returns {{ ok: true, config: object } | { ok: false, error: string }}
 */
function parseDashConfig(source) {
  if (typeof source !== "string" || source.length === 0) {
    return { ok: false, error: "source must be a non-empty string" };
  }

  // Step 1: extract the `export default { ... }` literal.
  let exportedObjectStr = extractDefaultExportLiteral(source);
  if (!exportedObjectStr) {
    return {
      ok: false,
      error: "could not find `export default { ... }` literal in config",
    };
  }

  // Step 2: regex-sanitize component references so the AST walker
  // preserves them as strings rather than nulling them as
  // unresolvable identifiers. The shape `component: SomeName`
  // appears in nearly every config; treating it as a string keeps
  // downstream consumers happy.
  exportedObjectStr = exportedObjectStr.replace(
    /component\s*:\s*([A-Z][a-zA-Z0-9_$]*)/g,
    'component: "$1"',
  );

  // Step 3: feed the literal to acorn as an expression and walk it.
  let ast;
  try {
    // Wrap in parens so acorn parses it as an expression (an
    // ObjectExpression at the top level would otherwise look
    // like a block statement).
    ast = acorn.parseExpressionAt(`(${exportedObjectStr})`, 0, {
      ecmaVersion: "latest",
      sourceType: "script",
    });
  } catch (err) {
    return {
      ok: false,
      error: `failed to parse config literal: ${err.message}`,
    };
  }

  try {
    const config = walk(ast);
    if (config === null || typeof config !== "object") {
      return {
        ok: false,
        error: "config literal must evaluate to an object",
      };
    }
    return { ok: true, config };
  } catch (err) {
    if (err instanceof DashConfigParseError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: `walker failure: ${err.message}` };
  }
}

/**
 * Extract the object-literal source for `export default {…}`.
 *
 * Handles both:
 *   1. Direct literal:   `export default { ... };`
 *   2. Variable export:  `const x = { ... }; export default x;`
 */
function extractDefaultExportLiteral(source) {
  // Direct literal pattern.
  const direct = source.match(/export\s+default\s+({[\s\S]*});?\s*$/);
  if (direct) return direct[1];

  // Named-variable pattern. Find the identifier exported, then locate
  // its declaration's object literal.
  const named = source.match(
    /export\s+default\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*;?\s*$/,
  );
  if (named) {
    const varName = named[1];
    const decl = source.match(
      new RegExp(
        `(?:const|let|var)\\s+${varName}\\s*=\\s*({[\\s\\S]*?});\\s*(?:export\\s+default)`,
      ),
    );
    if (decl) return decl[1];
  }

  return null;
}

function walk(node) {
  switch (node.type) {
    case "ObjectExpression": {
      const out = {};
      for (const prop of node.properties) {
        if (prop.type !== "Property") {
          throw new DashConfigParseError(
            `unsupported object-property type: ${prop.type}`,
            prop.type,
          );
        }
        if (prop.computed) {
          throw new DashConfigParseError(
            "computed object keys are not allowed",
            "Property",
          );
        }
        let key;
        if (prop.key.type === "Identifier") {
          key = prop.key.name;
        } else if (
          prop.key.type === "Literal" &&
          (typeof prop.key.value === "string" ||
            typeof prop.key.value === "number")
        ) {
          key = String(prop.key.value);
        } else {
          throw new DashConfigParseError(
            `unsupported object key: ${prop.key.type}`,
            prop.key.type,
          );
        }
        out[key] = walk(prop.value);
      }
      return out;
    }
    case "ArrayExpression": {
      return node.elements.map((el) => (el === null ? null : walk(el)));
    }
    case "Literal":
      return node.value;
    case "TemplateLiteral": {
      // Only allow templates with zero substitutions (i.e. raw
      // strings with no `${…}`). Anything else could read a
      // local-scope identifier when evaluated and we don't
      // execute.
      if (node.expressions.length > 0) {
        throw new DashConfigParseError(
          "template literals with substitutions are not allowed",
          "TemplateLiteral",
        );
      }
      return node.quasis.map((q) => q.value.cooked).join("");
    }
    case "UnaryExpression":
      if (node.operator === "-" && node.argument.type === "Literal") {
        return -node.argument.value;
      }
      if (node.operator === "+" && node.argument.type === "Literal") {
        return +node.argument.value;
      }
      throw new DashConfigParseError(
        `unsupported unary operator: ${node.operator}`,
        "UnaryExpression",
      );
    case "Identifier":
      if (ALLOWED_GLOBAL_IDENTIFIERS.has(node.name)) {
        if (node.name === "undefined") return undefined;
        if (node.name === "Infinity") return Infinity;
        if (node.name === "NaN") return NaN;
      }
      // Any other identifier is an unresolved import or
      // reference. The historical behavior was to stub these to
      // `undefined`; we mirror that with `null` for
      // JSON-friendliness — downstream code that filters
      // nullish entries (e.g. `providers.filter(Boolean)`) is
      // already in place from the vm.runInContext era.
      return null;
    default:
      throw new DashConfigParseError(
        `unsupported node type: ${node.type}`,
        node.type,
      );
  }
}

module.exports = { parseDashConfig, DashConfigParseError };
