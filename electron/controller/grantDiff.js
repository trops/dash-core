/**
 * grantDiff.js
 *
 * Pure-function diff between two grant blobs. Used by the
 * `widget-mcp:set-grant` IPC handler to decide whether the change
 * needs OS-native confirmation (broadening permissions) or can pass
 * through silently (revocations / equal / narrowing).
 *
 * Returns { broadening: boolean, summary: string[] }. `summary` is a
 * list of human-readable additions used to populate the native
 * confirm dialog.
 *
 * Broadening dimensions checked:
 *   - servers: new server name present in newGrant.servers but not in
 *     currentGrant.servers
 *   - server tools: new tool name in an existing server's `tools[]`
 *   - server paths: new entry in `readPaths[]` or `writePaths[]`
 *     (including `*` wildcard added)
 *   - domains.fs: new block, or new `readPaths[]` / `writePaths[]`
 *     entry within an existing block (including `*`)
 *   - domains.network: new block, or new `hosts[]` entry (including
 *     `*` and `*.<base>` wildcards)
 *
 * Reductions, equality, and "no permission" → "no permission"
 * transitions are NOT broadening.
 */
"use strict";

function _arr(x) {
  return Array.isArray(x) ? x : [];
}

function _added(currentList, newList) {
  const cur = new Set(_arr(currentList));
  const out = [];
  for (const item of _arr(newList)) {
    if (!cur.has(item)) out.push(item);
  }
  return out;
}

function _diffServer(serverName, currentSrv, newSrv) {
  const summary = [];
  const cur = currentSrv || {};
  const nxt = newSrv || {};

  for (const tool of _added(cur.tools, nxt.tools)) {
    summary.push(`server "${serverName}" tool "${tool}"`);
  }
  for (const p of _added(cur.readPaths, nxt.readPaths)) {
    summary.push(`server "${serverName}" readPath "${p}"`);
  }
  for (const p of _added(cur.writePaths, nxt.writePaths)) {
    summary.push(`server "${serverName}" writePath "${p}"`);
  }
  return summary;
}

function _diffServers(curServers, nxtServers) {
  const summary = [];
  const cur = curServers || {};
  const nxt = nxtServers || {};
  for (const name of Object.keys(nxt)) {
    if (!cur[name]) {
      // Whole new server entry → list each component as broadening.
      const srv = nxt[name];
      const tools = _arr(srv?.tools);
      const reads = _arr(srv?.readPaths);
      const writes = _arr(srv?.writePaths);
      if (tools.length === 0 && reads.length === 0 && writes.length === 0) {
        // Empty-shell server entry — no actual permissions added.
        // Skip; not a meaningful broadening.
        continue;
      }
      summary.push(`new server "${name}"`);
      for (const t of tools) summary.push(`  tool "${t}"`);
      for (const p of reads) summary.push(`  readPath "${p}"`);
      for (const p of writes) summary.push(`  writePath "${p}"`);
    } else {
      summary.push(..._diffServer(name, cur[name], nxt[name]));
    }
  }
  return summary;
}

function _diffDomainsFs(curFs, nxtFs) {
  const summary = [];
  const cur = curFs || {};
  const nxt = nxtFs || {};
  for (const p of _added(cur.readPaths, nxt.readPaths)) {
    summary.push(`fs readPath "${p}"`);
  }
  for (const p of _added(cur.writePaths, nxt.writePaths)) {
    summary.push(`fs writePath "${p}"`);
  }
  return summary;
}

function _diffDomainsNetwork(curNet, nxtNet) {
  const summary = [];
  const cur = curNet || {};
  const nxt = nxtNet || {};
  for (const h of _added(cur.hosts, nxt.hosts)) {
    summary.push(`network host "${h}"`);
  }
  return summary;
}

/**
 * @param {object|null|undefined} currentGrant
 * @param {object|null|undefined} newGrant
 * @returns {{ broadening: boolean, summary: string[] }}
 */
function isBroadening(currentGrant, newGrant) {
  const cur = currentGrant || {};
  const nxt = newGrant || {};

  const summary = [
    ..._diffServers(cur.servers, nxt.servers),
    ..._diffDomainsFs(cur?.domains?.fs, nxt?.domains?.fs),
    ..._diffDomainsNetwork(cur?.domains?.network, nxt?.domains?.network),
  ];

  return { broadening: summary.length > 0, summary };
}

module.exports = { isBroadening };
