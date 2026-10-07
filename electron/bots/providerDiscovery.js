/**
 * providerDiscovery.js
 *
 * find_providers for team leads (bot-capabilities CAP-003): given a plain
 * description of a missing capability ("download an image from a URL"), find
 * providers that could fill it, in trust order:
 *   1. installed  — the user's own providers (Settings › Providers)
 *   2. built-in   — Dash's catalog (mcpServerCatalog.json)
 *   3. vetted     — the curated known-external list
 *   4. community  — the official MCP Registry (unverified)
 *
 * Read-only: nothing is installed here — leads only suggest, the user installs
 * (CAP-005). Local tiers use simple keyword matching; the registry does its own
 * search. Portable (NFR-006): no Electron — the catalogs, the user's providers
 * and the registry search are injected.
 */
"use strict";

const TIER_ORDER = ["installed", "built-in", "vetted", "community"];
const PER_TIER = { installed: 10, "built-in": 5, vetted: 5, community: 5 };
const REGISTRY_KEYWORDS = 3;

const STOP_WORDS = new Set(
  (
    "a an the and or of to from for in on at by with into onto via as is are be " +
    "can could should would that this these those it its my your their our some " +
    "any all each per using use get make do does need needs want like such " +
    "provider providers tool tools server servers mcp service services"
  ).split(" "),
);

/** Meaningful lowercase words of a capability description. */
function keywordsOf(text) {
  const seen = new Set();
  const out = [];
  for (const w of String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)) {
    if (w.length < 3 || STOP_WORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

// "images" also matches "image", "pages" matches "page".
function stem(word) {
  return word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
}

// Common verbs/nouns that appear in most descriptions ("search", "send",
// "messages"). They count toward a match but can't make one on their own.
const WEAK_WORDS = new Set(
  (
    "search searches read write send sends find list create update delete manage " +
    "post check view open text message messages data file files web page pages " +
    "info information content api apis access account accounts query"
  ).split(" "),
);

const isWeak = (k) => WEAK_WORDS.has(k) || WEAK_WORDS.has(stem(k));

/** Words that say what's specific about the capability (else all of them). */
function strongKeywords(keywords) {
  const strong = keywords.filter((k) => !isWeak(k));
  return strong.length ? strong : keywords;
}

/**
 * How well `text` fits the capability: the number of keywords it contains,
 * or 0 unless it contains at least half of the specific (non-weak) ones —
 * so "send SMS" doesn't match every messaging provider, and extra words in a
 * longer request ("… to a local file") don't hide a good match.
 */
function score(text, keywords) {
  const hay = String(text || "").toLowerCase();
  const has = (k) => hay.includes(k) || hay.includes(stem(k));
  const hits = keywords.filter(has);
  if (!hits.length) return 0;
  const specific = strongKeywords(keywords);
  if (specific.filter(has).length < Math.ceil(specific.length / 2)) return 0;
  return hits.length;
}

function catalogText(entry) {
  return [entry.id, entry.name, entry.description, ...(entry.tags || [])].join(
    " ",
  );
}

/** What a catalog entry runs, in a few words. */
function describeRuns(mcpConfig) {
  const c = mcpConfig || {};
  if (c.transport === "in_process") return "Built into Dash";
  if (c.transport === "streamable_http") return c.url || "Remote server";
  return [c.command, ...(c.args || [])].filter(Boolean).join(" ");
}

/** Display names of the credentials a catalog entry asks for. */
function credentialsOf(credentialSchema) {
  return Object.entries(credentialSchema || {})
    .filter(([, f]) => f && (f.secret === true || f.required === true))
    .map(([key, f]) => f.displayName || key);
}

function fromCatalog(entry, tier) {
  return {
    id: `${tier === "vetted" ? "vetted" : "builtin"}:${entry.id}`,
    tier,
    name: entry.name,
    description: entry.description || "",
    runs: describeRuns(entry.mcpConfig),
    credentials: credentialsOf(entry.credentialSchema),
    sourceUrl: entry.sourceUrl || null,
    installable: true,
    install: {
      kind: tier === "vetted" ? "vetted" : "catalog",
      catalogId: entry.id,
    },
  };
}

// Registry rows → one entry per server, latest version, with install info.
function latestOf(rows) {
  const meta = (r) =>
    (r && r._meta && r._meta["io.modelcontextprotocol.registry/official"]) ||
    {};
  return rows.slice().sort((a, b) => {
    const la = meta(a).isLatest ? 1 : 0;
    const lb = meta(b).isLatest ? 1 : 0;
    if (la !== lb) return lb - la;
    return String(meta(b).updatedAt || "").localeCompare(
      String(meta(a).updatedAt || ""),
    );
  })[0];
}

function registryInstall(server) {
  for (const pkg of Array.isArray(server.packages) ? server.packages : []) {
    const id = pkg && pkg.identifier;
    if (!id) continue;
    const spec = pkg.version ? `${id}@${pkg.version}` : id;
    let mcpConfig = null;
    if (pkg.registryType === "npm") {
      mcpConfig = { transport: "stdio", command: "npx", args: ["-y", spec] };
    } else if (pkg.registryType === "pypi") {
      mcpConfig = {
        transport: "stdio",
        command: "uvx",
        args: [pkg.version ? `${id}==${pkg.version}` : id],
      };
    }
    if (!mcpConfig) continue;
    const envMapping = {};
    const credentialSchema = {};
    for (const v of Array.isArray(pkg.environmentVariables)
      ? pkg.environmentVariables
      : []) {
      if (!v || !v.name) continue;
      envMapping[v.name] = v.name;
      credentialSchema[v.name] = {
        type: "text",
        displayName: v.name,
        required: !!v.isRequired,
        secret: !!v.isSecret,
        instructions: v.description || null,
      };
    }
    mcpConfig.envMapping = envMapping;
    return { mcpConfig, credentialSchema };
  }
  for (const remote of Array.isArray(server.remotes) ? server.remotes : []) {
    if (!remote || remote.type !== "streamable-http" || !remote.url) continue;
    const mcpConfig = { transport: "streamable_http", url: remote.url };
    const credentialSchema = {};
    const headerTemplate = {};
    for (const h of Array.isArray(remote.headers) ? remote.headers : []) {
      if (!h || !h.name) continue;
      const key = h.name.replace(/[^A-Za-z0-9]/g, "");
      headerTemplate[h.name] = `{{${key}}}`;
      credentialSchema[key] = {
        type: "text",
        displayName: h.name,
        required: !!h.isRequired,
        secret: !!h.isSecret,
        instructions: h.description || null,
      };
    }
    if (Object.keys(headerTemplate).length)
      mcpConfig.headerTemplate = headerTemplate;
    return { mcpConfig, credentialSchema };
  }
  return null;
}

/**
 * @param {{ servers?: object[] }} json   MCP Registry /v0/servers response
 * @param {string[]} keywords             for ranking
 */
function normalizeRegistryServers(json, keywords = []) {
  const rows = (json && Array.isArray(json.servers) ? json.servers : []).filter(
    (r) => r && r.server && r.server.name,
  );
  const byName = new Map();
  for (const r of rows) {
    const list = byName.get(r.server.name) || [];
    list.push(r);
    byName.set(r.server.name, list);
  }
  const out = [];
  for (const [name, list] of byName) {
    const server = latestOf(list).server;
    const install = registryInstall(server);
    const kinds = [
      ...new Set(
        [
          ...(server.packages || []).map((p) => p && p.registryType),
          ...(server.remotes || []).map((r) => r && r.type),
        ].filter(Boolean),
      ),
    ];
    out.push({
      id: `community:${name}`,
      tier: "community",
      name: server.title || name,
      description: String(server.description || "").slice(0, 300),
      version: server.version || null,
      runs: install
        ? describeRuns(install.mcpConfig)
        : `No install info Dash can use${kinds.length ? ` (${kinds.join(", ")})` : ""}`,
      credentials: install ? Object.keys(install.credentialSchema) : [],
      sourceUrl:
        (server.repository && server.repository.url) ||
        server.websiteUrl ||
        null,
      installable: !!install,
      install: install
        ? { kind: "custom", name: server.title || name, ...install }
        : null,
      _score: registryScore(
        `${name} ${server.title || ""} ${server.description || ""}`,
        keywords,
      ),
    });
  }
  return out.filter((e) => e._score > 0 || !keywords.length);
}

// The registry already matched the query, so one specific word is enough
// (it ranks; the strict local rule would drop good one-line descriptions).
function registryScore(text, keywords) {
  const hay = String(text || "").toLowerCase();
  const hits = keywords.filter((k) => hay.includes(k) || hay.includes(stem(k)));
  return hits.some((k) => strongKeywords(keywords).includes(k))
    ? hits.length
    : 0;
}

/**
 * @param {string} capability
 * @param {{ listInstalled: () => object[], getCatalog: () => object[],
 *           getKnownExternal: () => object[],
 *           searchRegistry: (query: string) => Promise<object> }} deps
 * @returns {Promise<{ results: object[], notes: string[] }>}
 */
async function findProviders(capability, deps) {
  const keywords = keywordsOf(capability);
  if (!keywords.length) {
    throw new Error(
      "Describe the capability you need, e.g. 'download an image from a URL'.",
    );
  }
  const notes = [];
  const catalog = (deps.getCatalog && deps.getCatalog()) || [];
  const vetted = (deps.getKnownExternal && deps.getKnownExternal()) || [];
  const installed = (deps.listInstalled && deps.listInstalled()) || [];
  const catalogById = new Map(
    [...catalog, ...vetted].filter((e) => e && e.id).map((e) => [e.id, e]),
  );

  const tiers = { installed: [], "built-in": [], vetted: [], community: [] };

  // 1. Installed — matched on name, type, tools, and their catalog entry.
  const installedTypes = new Set();
  for (const p of installed) {
    if (!p || !p.name) continue;
    const entry = catalogById.get(p.type);
    const s = score(
      [
        p.name,
        p.type,
        ...(p.tools || []),
        entry ? catalogText(entry) : "",
      ].join(" "),
      keywords,
    );
    if (!s) continue;
    if (p.type) installedTypes.add(p.type);
    tiers.installed.push({
      id: `installed:${p.name}`,
      tier: "installed",
      name: p.name,
      description: entry ? entry.description || "" : "",
      runs: "Already set up",
      credentials: [],
      sourceUrl: null,
      installable: true,
      install: { kind: "use", providerName: p.name },
      tools: Array.isArray(p.tools) ? p.tools : null,
      _score: s,
    });
  }

  // 2–3. Built-in and vetted catalogs (skip types the user already has).
  for (const [tier, list] of [
    ["built-in", catalog],
    ["vetted", vetted],
  ]) {
    for (const entry of list) {
      if (!entry || !entry.id || installedTypes.has(entry.id)) continue;
      const s = score(catalogText(entry), keywords);
      if (s) tiers[tier].push({ ...fromCatalog(entry, tier), _score: s });
    }
  }

  // 4. Community — the registry searches by keyword; merge a few searches.
  // A failed search doesn't sink the others (the registry can be flaky).
  if (typeof deps.searchRegistry === "function") {
    const settled = await Promise.allSettled(
      strongKeywords(keywords)
        .slice(0, REGISTRY_KEYWORDS)
        .map((k) => Promise.resolve().then(() => deps.searchRegistry(k))),
    );
    const ok = settled.filter((s) => s.status === "fulfilled");
    if (!ok.length) {
      notes.push(
        "Community search (the MCP Registry) is unavailable right now; showing Dash's own lists only.",
      );
    } else {
      const merged = {
        servers: ok.flatMap((s) =>
          s.value && Array.isArray(s.value.servers) ? s.value.servers : [],
        ),
      };
      tiers.community = normalizeRegistryServers(merged, keywords);
      if (ok.length < settled.length) {
        notes.push(
          "Some community searches (the MCP Registry) didn't answer; results may be incomplete.",
        );
      }
    }
  }

  const results = [];
  for (const tier of TIER_ORDER) {
    tiers[tier]
      .sort((a, b) => b._score - a._score)
      .slice(0, PER_TIER[tier])
      .forEach(({ _score, ...entry }) => results.push(entry));
  }
  return { results, notes };
}

/** The lead-facing text for find_providers results (fenced by the caller). */
function describeFindings(capability, { results, notes }) {
  const label = {
    installed: "Already set up (use these first)",
    "built-in": "Built into Dash (the user adds it in Settings › Providers)",
    vetted: "Vetted by Dash (the user installs it after a confirmation)",
    community:
      "Community — UNVERIFIED third-party code from the MCP Registry (only if nothing above fits)",
  };
  const lines = [`Providers for "${capability}":`];
  if (!results.length) {
    lines.push(
      "Nothing found. Put the capability in propose_bot's needs so the user knows it's missing.",
    );
  }
  for (const tier of TIER_ORDER) {
    const group = results.filter((e) => e.tier === tier);
    if (!group.length) continue;
    lines.push("", `${label[tier]}:`);
    for (const e of group) {
      const bits = [`- ${e.name} [id: ${e.id}]`];
      if (e.description) bits.push(`— ${e.description}`);
      lines.push(bits.join(" "));
      const details = [`runs: ${e.runs}`];
      if (e.tools && e.tools.length)
        details.push(`tools: ${e.tools.join(", ")}`);
      if (e.credentials.length)
        details.push(`needs: ${e.credentials.join(", ")}`);
      if (e.sourceUrl) details.push(`source: ${e.sourceUrl}`);
      if (!e.installable) details.push("can't be installed from Dash");
      lines.push(`  ${details.join(" · ")}`);
    }
  }
  for (const n of notes) lines.push("", n);
  if (results.length) {
    lines.push(
      "",
      "To suggest one on a draft, pass propose_bot gaps: [{ need, suggestions: [id, …] }] using the ids above. Installed providers can also go straight in providers. You can't install anything — the user does.",
    );
  }
  return lines.join("\n");
}

module.exports = {
  findProviders,
  describeFindings,
  keywordsOf,
  normalizeRegistryServers,
  TIER_ORDER,
};
