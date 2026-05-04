# IPC Filesystem Audit

**Status:** Phase A — discovery (this doc). Phase B is enforcement (separate PR).
**Threat model:** a malicious widget calls `window.mainApi.*` to read, write, or
delete files outside its sandbox, or to execute arbitrary code in the main
process.

This doc enumerates every IPC handler whose input includes a path or executable
string that is supplied by the renderer. Each finding is rated **CRITICAL**,
**HIGH**, **MEDIUM**, or **INFO** with a recommended guard.

## Threat-class summary

| Class | Count | Top issue |
|---|---|---|
| **CRITICAL** — RCE in main process | 0 (was 1; resolved in 0.1.484) | `mainApi.data.transformFile` previously evaluated renderer-supplied JS via dynamic-function compilation. Now sandboxed via QuickJS WASM — see `electron/utils/safeJsExecutor.js`. |
| **HIGH** — arbitrary path write | 5 | `saveData`, `convertJsonToCsvFile`, `parseXMLStream`, `parseCSVStream`, `readDataFromURL` |
| **HIGH** — arbitrary path read | 4 | `readJSONFromFile`, `readLinesFromFile`, `algoliaApi.createBatchesFromFile`, `algoliaApi.partialUpdateObjectsFromDirectory` |
| **MEDIUM** — partial scoping but `path.join` traversal | 1 | `saveData` joins under userData but accepts `../` segments |
| **INFO** — main-controlled paths (already safe) | many | `settingsApi`, `themeApi`, `workspaceApi`, `layoutApi`, etc. — paths constructed entirely from `app.getPath('userData')` + literal segments |

## Critical findings

### 1. `mainApi.data.transformFile` — Remote Code Execution (RESOLVED in 0.1.484)

**Original status:** RCE in main process via the dynamic-function constructor on
renderer-supplied `mappingFunctionBody`. Removed in 0.1.484.

**Resolution:** `electron/utils/transform.js:339+` no longer compiles user JS in
the main-process JS engine. Bodies now run in a QuickJS WASM sandbox
(`electron/utils/safeJsExecutor.js`) with:

- No host globals (`process`, `require`, `fetch`, `module`, `globalThis-of-host` are absent)
- 1-second per-record timeout (interrupts infinite loops)
- 32 MB memory cap (interrupts memory bombs)
- Disposed VM context per `transformFile` invocation; no cross-call state

The previous attack — `mappingFunctionBody = "require('fs').rmSync(...); ..."` —
now errors immediately with `"'require' is not defined"`. Sandbox-escape patterns
(`Function.constructor`, `[].constructor.constructor`) cannot reach Node globals
because the dynamic-function constructor compiles its body INSIDE the QuickJS
sandbox where those globals don't exist.

The sandbox properties are pinned by `electron/utils/safeJsExecutor.test.js`
(11 tests, run as part of `npm run ci`). New escape patterns get appended to
that test as they're discovered.

**What this does NOT cover:**

- Side-channel info leakage via the returned record values — user code can still
  encode arbitrary data into the output records and the host writes them. The
  sandbox prevents *capability acquisition*, not data exfiltration *if the
  caller already has read access to the input*. Out of scope for the sandbox;
  Phase B's path-scoping limits which input files transformFile can read.

### 2–6. Arbitrary path write — `dataApi`

All five accept renderer-supplied path arguments and pass them directly (or via
`path.join` without containment) to `writeFileSync`:

| API method | File:line | Path arg | Containment |
|---|---|---|---|
| `mainApi.data.saveData` | `dataController.js:300` | `filename` | `path.join(userData, "Dashboard", "data", filename)` — `..` segments traverse |
| `mainApi.data.convertJsonToCsvFile` | dataController | `filename` | none verified |
| `mainApi.data.parseXMLStream` | dataController | `outpath` | none |
| `mainApi.data.parseCSVStream` | dataController | `outpath` | none |
| `mainApi.data.readDataFromURL` | dataController | `toFilepath` | none — also fetches arbitrary URL |

**Path traversal demo for `saveData`:**

```
mainApi.data.saveData(
  "<malicious payload>",
  "../../../../../../etc/passwd",
  false,
  "{}",
);
```

`path.join` happily resolves `..` segments. The write hits `/etc/passwd` (or
whatever path traversal is reachable from the userData dir).

**Recommended fix:** add a `safePath(p, allowedRoots)` utility that:

1. `path.resolve()` the requested path
2. assert it `startsWith()` one of the allowed roots
3. throw if not

Migrate every handler that accepts a renderer-supplied path. Allowed roots per
handler are typically:

- `userData/Dashboard/<appId>/data/` (data files)
- `userData/widgets/<widgetId>/` (widget storage — see Phase C: per-widget scoping)
- The OS Downloads folder ONLY if the user explicitly chose it via a save
  dialog (`mainApi.dialog.chooseFile`)

### 7–10. Arbitrary path read — `dataApi`, `algoliaApi`

Same shape as the writes:

| API method | Path arg | Risk |
|---|---|---|
| `mainApi.data.readJSONFromFile` | `filepath` | Reads any JSON file the user can read; widget exfiltrates |
| `mainApi.data.readLinesFromFile` | `filepath` | Reads any text file |
| `mainApi.algolia.createBatchesFromFile` | `filepath`, `batchFilepath` | Read + write |
| `mainApi.algolia.partialUpdateObjectsFromDirectory` | `dir` | Reads every file in a directory |

Read access is less catastrophic than write+RCE but still leaks secrets
(`~/.aws/credentials`, `~/.ssh/id_rsa`, browser cookies, etc.) to a hostile
widget.

**Recommended fix:** same `safePath` containment.

## Methodology

1. Listed all 28 files in `electron/api/`. Each exposes IPC channels via
   `ipcRenderer.invoke`.
2. For each method, identified renderer-supplied parameters that look like
   paths/filenames or executable code (variable names: `filepath`, `filename`,
   `outpath`, `toFilepath`, `dir`, `directory`, `mappingFunctionBody`).
3. Traced each to its `ipcMain.handle` registration in
   `electron/controller/*.js` or `dash-electron/public/electron.js`.
4. Inspected the handler implementation for input validation and what
   filesystem operation it performs.
5. Classified each as A (main-controlled, safe), B (renderer-suggested but
   constrained), or C (renderer-controlled, vulnerable).

## Phase B plan

A separate PR adds:

1. `electron/utils/safePath.js` — exports `safePath(requested, allowedRoots[])`
   that resolves and validates containment. Throws on violation. Unit-tested.
2. Migrates the C-class handlers above to use it. One handler per commit so
   each is reviewable.
3. Adds a regression-pin test that greps `dataController.js` etc. for any
   `writeFileSync(filename, ...)` pattern not preceded by a `safePath(`
   invocation.

The transformFile RCE is its own emergency PR — it can't be fixed by path
scoping alone and warrants immediate attention before Phase B path work.

## What this audit does NOT cover

- **Network egress.** Widgets can `fetch()` any URL from the renderer; not part
  of this filesystem audit. Future plan.
- **MCP tool gating.** The user's threat-model example
  ("filesystem MCP delete files") is governed by the MCP client, not by these
  IPC handlers. Future plan: per-widget MCP tool allowlist.
- **CSP-level script injection.** Widget can inject `<script src=evil>` because
  CSP allows `'unsafe-inline'`. Future plan.
- **Renderer sandbox per widget.** Widgets currently share the renderer
  process with all of dash-electron. Future plan.

## Open questions

- For `transformFile`'s legitimate use cases (CSV/JSON column-mapping in the
  Dashboard config UI?), is there a way to express the same transforms
  declaratively? If so, the eval path can be removed entirely.
- What constitutes a widget's "scope" for path containment? Today there's no
  per-widget directory enforced — the same widget can read/write all of
  `userData/Dashboard/data/`. Phase C: introduce
  `userData/widgets/<scoped-widget-id>/` and migrate widget storage.
