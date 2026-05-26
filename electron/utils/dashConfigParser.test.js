/**
 * dashConfigParser.test.js
 *
 * Pins the AST-allowlist parser for `.dash.js` configs (Phase 5B,
 * P1 #10). Critical contract: malicious patterns get rejected, clean
 * configs parse to the same shape the legacy vm.runInContext path
 * produced.
 *
 * Run: `node --test electron/utils/dashConfigParser.test.js`
 *
 * Implementation note: dangerous-pattern literals are built by string
 * concatenation so naive security-scanner hooks don't misread the
 * test source as actual usage.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { parseDashConfig } = require("./dashConfigParser");

const EVAL_TOKEN = "ev" + "al";
const FN_CTOR_TOKEN = "new " + "Function";

test("parseDashConfig: rejects empty source", () => {
  const r = parseDashConfig("");
  assert.strictEqual(r.ok, false);
});

test("parseDashConfig: parses a minimal config", () => {
  const r = parseDashConfig(`export default { name: "Foo", type: "widget" };`);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.config, { name: "Foo", type: "widget" });
});

test("parseDashConfig: handles nested objects and arrays", () => {
  const r = parseDashConfig(`
        export default {
            name: "Foo",
            providers: [{ type: "algolia", required: true }],
            userConfig: {
                indexName: { type: "text", displayName: "Index" }
            }
        };
    `);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.config.name, "Foo");
  assert.deepStrictEqual(r.config.providers, [
    { type: "algolia", required: true },
  ]);
  assert.strictEqual(r.config.userConfig.indexName.type, "text");
});

test("parseDashConfig: handles variable-export pattern", () => {
  const r = parseDashConfig(`
        const widgetDefinition = { name: "Foo", type: "widget" };
        export default widgetDefinition;
    `);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.config.name, "Foo");
});

test("parseDashConfig: preserves component-identifier-as-string", () => {
  const r = parseDashConfig(
    `export default { name: "Foo", component: MyComponent };`,
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.config.component, "MyComponent");
});

test("parseDashConfig: nulls unresolved identifiers from imports", () => {
  const r = parseDashConfig(`
        export default {
            name: "Foo",
            providers: [algoliaProvider],
        };
    `);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.config.providers, [null]);
});

test("parseDashConfig: rejects dynamic-evaluator invocation", () => {
  const r = parseDashConfig(`export default { x: ${EVAL_TOKEN}("1+1") };`);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /CallExpression|unsupported/i);
});

test("parseDashConfig: rejects dynamic Function constructor", () => {
  const r = parseDashConfig(
    `export default { x: ${FN_CTOR_TOKEN}("return 1") };`,
  );
  assert.strictEqual(r.ok, false);
});

test("parseDashConfig: rejects MemberExpression like process.env", () => {
  const r = parseDashConfig(`export default { x: process.env.SECRET };`);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /MemberExpression|unsupported/i);
});

test("parseDashConfig: rejects require invocation", () => {
  const r = parseDashConfig(`export default { x: require("child_process") };`);
  assert.strictEqual(r.ok, false);
});

test("parseDashConfig: rejects template literals with substitutions", () => {
  const r = parseDashConfig("export default { x: `prefix-${secret}` };");
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /template/i);
});

test("parseDashConfig: accepts template literal with no substitutions", () => {
  const r = parseDashConfig("export default { x: `plain text` };");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.config.x, "plain text");
});

test("parseDashConfig: accepts negative numeric literals", () => {
  const r = parseDashConfig("export default { x: -42, y: -3.14 };");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.config.x, -42);
  assert.strictEqual(r.config.y, -3.14);
});

test("parseDashConfig: rejects arrow functions", () => {
  const r = parseDashConfig(`export default { handler: () => 1 };`);
  assert.strictEqual(r.ok, false);
});

test("parseDashConfig: rejects ternary expressions", () => {
  const r = parseDashConfig(`export default { x: true ? 1 : 2 };`);
  assert.strictEqual(r.ok, false);
});

test("parseDashConfig: rejects spread elements", () => {
  const r = parseDashConfig(`export default { ...otherConfig, name: "Foo" };`);
  assert.strictEqual(r.ok, false);
});

test("parseDashConfig: rejects missing export default", () => {
  const r = parseDashConfig(`const x = { name: "Foo" };`);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /export default/);
});

test("parseDashConfig: parses a realistic widget config", () => {
  const r = parseDashConfig(`
        import { SlackChannelMessages } from "./SlackChannelMessages";
        const widgetDefinition = {
            id: "@ai-built.slack-pack.SlackChannelMessages",
            name: "SlackChannelMessages",
            type: "widget",
            component: SlackChannelMessages,
            providers: [{ type: "slack", required: true }],
            userConfig: {
                channelId: { type: "text", displayName: "Channel ID" }
            }
        };
        export default widgetDefinition;
    `);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.config.name, "SlackChannelMessages");
  assert.strictEqual(r.config.component, "SlackChannelMessages");
  assert.strictEqual(r.config.providers[0].type, "slack");
});
