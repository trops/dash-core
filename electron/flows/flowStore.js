/**
 * flowStore.js
 *
 * A dashboard's flows (flows PRD), one folder each:
 *
 *   <root>/<flowId>/flow.json   steps, who hands to whom, checks, fields
 *   <root>/<flowId>/scripts/    files command checks run (check-links.js)
 *   <root>/<flowId>/checks/     script checks written in the editor
 *   <root>/<flowId>/data/       small files checks read (banned-words.txt)
 *
 * A flow belongs to one dashboard; a dashboard can have several. Each save
 * bumps the flow's version: goals already running keep the copy they
 * started with (goalStore), so nothing changes what done means halfway.
 *
 * Flows hold no secrets (they're what gets published), so flow.json is
 * plain JSON, written to a temp file and renamed into place.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeFlow, FLOW_ID, botIdsOf, chain } = require("./flowModel");

const FOLDERS = ["scripts", "checks", "data"];
const MAX_FILE = 256 * 1024;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

const sameWs = (a, b) =>
  a != null && a !== "" && b != null && b !== "" && String(a) === String(b);

/**
 * @param {{ root: string, now?: () => number, random?: () => number,
 *           onChange?: (change: object) => void }} deps
 */
function createFlowStore({
  root,
  now = Date.now,
  random = Math.random,
  onChange = () => {},
}) {
  const flows = new Map();

  const newId = () =>
    `flow_${now().toString(36)}${Math.floor(random() * 36 ** 6)
      .toString(36)
      .padStart(6, "0")}`;
  const dirOf = (id) => path.join(root, id);

  function write(flow) {
    const dir = dirOf(flow.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of FOLDERS)
      fs.mkdirSync(path.join(dir, f), { recursive: true });
    const file = path.join(dir, "flow.json");
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(flow, null, 2));
    fs.renameSync(tmp, file);
  }

  function changed(change) {
    try {
      onChange(change);
    } catch (_e) {
      // Listeners never break a write.
    }
  }

  function load() {
    flows.clear();
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch (_e) {
      return;
    }
    for (const name of names) {
      if (!FLOW_ID.test(name)) continue;
      try {
        const flow = JSON.parse(
          fs.readFileSync(path.join(dirOf(name), "flow.json"), "utf8"),
        );
        if (flow && flow.id === name) flows.set(name, flow);
      } catch (_e) {
        // An unreadable flow is skipped, never overwritten.
      }
    }
  }

  const list = ({ workspaceId } = {}) =>
    [...flows.values()]
      .filter((f) => workspaceId == null || sameWs(f.workspaceId, workspaceId))
      .sort((a, b) => a.createdAt - b.createdAt);

  const get = (id) => flows.get(id) || null;

  /**
   * @param {object} input  a flow (flowModel.normalizeFlow's shape) plus
   *   `madeBots` (bots the flow made, so Undo and delete can offer them)
   */
  function create(input = {}) {
    const clean = normalizeFlow(input);
    if (!clean.workspaceId) return { error: "A flow belongs to a dashboard." };
    if (!clean.steps.length)
      return { error: "A flow needs at least one step." };
    const at = now();
    const flow = {
      ...clean,
      id: newId(),
      version: 1,
      package: input.package || null,
      madeBots: Array.isArray(input.madeBots) ? input.madeBots.map(String) : [],
      localFiles: Array.isArray(input.localFiles) ? input.localFiles : [],
      createdAt: at,
      updatedAt: at,
    };
    write(flow);
    flows.set(flow.id, flow);
    changed({ type: "flow", flowId: flow.id, workspaceId: flow.workspaceId });
    return { flow };
  }

  /** Save a changed flow: steps, edges, name… The version goes up by one. */
  function update(id, next = {}) {
    const cur = flows.get(id);
    if (!cur) return { error: "No such flow." };
    const clean = normalizeFlow({
      ...cur,
      ...next,
      workspaceId: cur.workspaceId,
    });
    if (!clean.steps.length)
      return { error: "A flow needs at least one step." };
    const flow = {
      ...cur,
      ...clean,
      id,
      version: (cur.version || 1) + 1,
      package: next.package !== undefined ? next.package : cur.package,
      madeBots:
        next.madeBots !== undefined ? next.madeBots : cur.madeBots || [],
      localFiles:
        next.localFiles !== undefined ? next.localFiles : cur.localFiles || [],
      edited: next.edited !== undefined ? next.edited : cur.edited,
      updatedAt: now(),
    };
    write(flow);
    flows.set(id, flow);
    changed({ type: "flow", flowId: id, workspaceId: flow.workspaceId });
    return { flow };
  }

  function remove(id) {
    const cur = flows.get(id);
    if (!cur) return { error: "No such flow." };
    try {
      fs.rmSync(dirOf(id), { recursive: true, force: true });
    } catch (e) {
      return { error: `It couldn't be deleted: ${(e && e.message) || e}` };
    }
    flows.delete(id);
    changed({ type: "deleted", flowId: id, workspaceId: cur.workspaceId });
    return { ok: true, flow: cur };
  }

  function removeForWorkspace(workspaceId) {
    const removed = [];
    for (const f of list({ workspaceId })) {
      const r = remove(f.id);
      if (r.ok) removed.push(f.id);
    }
    return removed;
  }

  /** Flows whose first step (the source) is this bot. */
  const sourceFlowsFor = (botId, workspaceId) =>
    list({ workspaceId }).filter((f) => {
      const first = chain(f)[0];
      return first && first.kind === "source" && first.botId === String(botId);
    });

  /** Flows that use a bot at any step. */
  const flowsUsingBot = (botId) =>
    [...flows.values()].filter((f) => botIdsOf(f).includes(String(botId)));

  /**
   * The flow a create_goal call means: named (on its dashboard), else the
   * one this bot is the source of, else none.
   */
  function resolve({ name, botId, workspaceId }) {
    const own = list({ workspaceId });
    if (name && String(name).trim()) {
      const want = String(name).trim().toLowerCase();
      const hit = own.find(
        (f) => f.id === name || f.name.toLowerCase() === want,
      );
      if (!hit) {
        return {
          error: `No flow called "${name}" on this dashboard${
            own.length
              ? `: it has ${own.map((f) => `"${f.name}"`).join(", ")}`
              : ""
          }.`,
        };
      }
      return hit;
    }
    const mine = sourceFlowsFor(botId, workspaceId);
    return mine.length === 1 ? mine[0] : null;
  }

  // ---- the flow's own files (phase 6) ------------------------------------

  /** "scripts/check-links.js" → its path, only inside the flow's folders. */
  function filePath(id, ref) {
    if (!flows.has(id)) return null;
    const m = /^([a-z]+)\/(.+)$/.exec(String(ref || ""));
    if (!m || !FOLDERS.includes(m[1]) || !FILE_NAME.test(m[2])) return null;
    return path.join(dirOf(id), m[1], m[2]);
  }

  function listFiles(id) {
    if (!flows.has(id)) return [];
    const out = [];
    for (const folder of FOLDERS) {
      let names = [];
      try {
        names = fs.readdirSync(path.join(dirOf(id), folder));
      } catch (_e) {
        names = [];
      }
      for (const n of names) {
        if (!FILE_NAME.test(n)) continue;
        try {
          const st = fs.statSync(path.join(dirOf(id), folder, n));
          if (st.isFile()) out.push({ ref: `${folder}/${n}`, size: st.size });
        } catch (_e) {
          // Gone between the read and the stat.
        }
      }
    }
    return out;
  }

  function readFile(id, ref) {
    const p = filePath(id, ref);
    if (!p) return null;
    try {
      return fs.readFileSync(p, "utf8");
    } catch (_e) {
      return null;
    }
  }

  function writeFile(id, ref, content) {
    const p = filePath(id, ref);
    if (!p)
      return {
        error: "Files go in scripts/, checks/ or data/, with a plain name.",
      };
    const body = String(content == null ? "" : content);
    if (Buffer.byteLength(body) > MAX_FILE)
      return { error: "That file is too big (256 KB at most)." };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    const flow = flows.get(id);
    changed({ type: "files", flowId: id, workspaceId: flow.workspaceId });
    return { ok: true, ref };
  }

  /** "Copy in from this computer…": the file is kept with the flow from now on. */
  function copyIn(id, fromPath, folder = "scripts") {
    if (!FOLDERS.includes(folder)) return { error: "No such folder." };
    let body;
    try {
      const st = fs.statSync(fromPath);
      if (!st.isFile()) return { error: "That isn't a file." };
      if (st.size > MAX_FILE)
        return { error: "That file is too big (256 KB at most)." };
      body = fs.readFileSync(fromPath, "utf8");
    } catch (e) {
      return { error: `It couldn't be read: ${(e && e.message) || e}` };
    }
    const name = path.basename(fromPath).replace(/[^A-Za-z0-9._-]/g, "-");
    return writeFile(id, `${folder}/${name}`, body);
  }

  function removeFile(id, ref) {
    const p = filePath(id, ref);
    if (!p) return { error: "No such file." };
    try {
      fs.rmSync(p, { force: true });
    } catch (e) {
      return { error: `It couldn't be removed: ${(e && e.message) || e}` };
    }
    const flow = flows.get(id);
    changed({ type: "files", flowId: id, workspaceId: flow.workspaceId });
    return { ok: true };
  }

  const folderOf = (id) => (flows.has(id) ? dirOf(id) : null);

  load();

  return {
    load,
    list,
    get,
    create,
    update,
    remove,
    removeForWorkspace,
    sourceFlowsFor,
    flowsUsingBot,
    resolve,
    filePath,
    listFiles,
    readFile,
    writeFile,
    copyIn,
    removeFile,
    folderOf,
  };
}

module.exports = { createFlowStore, FOLDERS };
