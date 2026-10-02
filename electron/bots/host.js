/**
 * host.js
 *
 * The Electron host adapter for Bot Factory — the ONE place the bot subsystem
 * is allowed to touch Electron and electron-store. It supplies the injected
 * dependencies the portable core (BotStore, and later the runner/scheduler)
 * needs: filesystem paths, a clock, and a durable persistence blob.
 *
 * Keeping this boundary thin is what lets the core run in plain Node today and
 * as a standalone `dash-bot-runner` process later (PRD US-024 / NFR-006). A
 * plain-Node host with the same shape can be dropped in without touching the
 * core.
 *
 * Not yet wired into the main process — the runner (a later slice) constructs
 * the host and the store together.
 */
"use strict";

const path = require("path");
const { app, safeStorage } = require("electron");
const Store = require("electron-store");
const { createSecretBox } = require("./secretBox");

/**
 * Build the Electron host.
 * @returns {{
 *   paths: { botsRoot: string },
 *   clock: { now: () => string },
 *   persistence: { read: () => object, write: (o: object) => void }
 * }}
 */
function createElectronHost() {
  const store = new Store({ name: "dash-bots" });
  const budgetStore = new Store({ name: "dash-bot-budgets" });
  const memoryStore = new Store({ name: "dash-bot-memory" });
  const botsRoot = path.join(app.getPath("userData"), "bots");

  return {
    paths: { botsRoot },
    clock: { now: () => new Date().toISOString() },
    // Seals sensitive bot data at rest (run answers) with the OS keychain.
    // Falls back to plain text where the keychain isn't available.
    secretBox: createSecretBox(safeStorage),
    persistence: {
      // The whole bot blob lives under a single "store" key so the core reads
      // and writes one object, independent of electron-store's key API.
      read: () => store.get("store", { bots: {}, runs: {} }),
      write: (obj) => store.set("store", obj),
    },
    // Separate blob for budgets + monthly spend (Slice 5).
    budgetPersistence: {
      read: () =>
        budgetStore.get("store", { budgets: {}, spend: {}, overrides: {} }),
      write: (obj) => budgetStore.set("store", obj),
    },
    // Separate blob for scoped bot memory (P1: FR-010).
    memoryPersistence: {
      read: () => memoryStore.get("store", { scopes: {} }),
      write: (obj) => memoryStore.set("store", obj),
    },
  };
}

module.exports = { createElectronHost };
