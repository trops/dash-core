# PRD: Bot Capabilities — Image Results, Web Fetch, and Finding Providers

**Status:** In Progress (Phases 1–2 implemented)
**Last Updated:** 2026-10-07
**Owner:** John Giatropoulos
**Location:** dash-core (framework feature; dash-electron consumes it via a version bump)
**Related PRDs:** [bot-factory.md](./bot-factory.md) (bots, engines, approvals), [bot-teams.md](./bot-teams.md) (team leads, `propose_bot`, drafts), [mcp-providers.md](./mcp-providers.md) (provider catalog, custom MCP servers)

---

## Executive Summary

Bots can only do what their tools allow, and today two gaps stop common jobs. First, bots can't see images: every tool result is flattened to text before it reaches the model, so a bot asked to "describe this product photo" has nothing to look at even when a tool returns the image. Second, when a bot needs a capability nobody has set up, such as downloading an image from a URL, the team lead can only say "there is no tool for this", and the user has to find a provider and add it by hand, sometimes by changing the app's build. This PRD adds three things, in order: **image results** that reach the model, a **Web Fetch provider** that ships with Dash so bots can download pages and images safely without shell access, and **provider discovery**, so a lead can search for a provider that fills a gap and suggest it on the draft bot, and the user can install it from the draft review in one step.

---

## Context & Background

### Problem Statement

**What problem are we solving?**

A user building an "Algolia Data Enrichment" team asked the lead for a bot that reads each record's image URL, looks at the image, and writes a label back. The lead replied that no tool could fetch an image URL. That was accurate, for two separate reasons:

1. **No safe fetch tool.** No provider the user has configured downloads a URL. Bots on the Claude Code (CLI) engine do have the SDK's built-in WebFetch and Bash, but the user doesn't want bots running shell commands or writing their own scripts, and WebFetch summarizes page text rather than returning an image.
2. **Images can't reach the model.** Even with a fetch tool, the image would be thrown away. Every bot tool result is reduced to its text parts before the model sees it (details under Current State).

Behind both is a process gap: when a capability is missing, nothing helps the user find a provider for it. The lead only sees providers that are already configured, and the user's way out was to add a provider to the build.

**Who experiences this problem?**

- Primary: Team owners who review lead-drafted bots and hit "no tool for this"
- Secondary: Maker-developers building bots that work with images, web pages, or services Dash doesn't ship

**What happens if we don't solve it?**

Image-based workflows (classification, enrichment, visual QA) stay impossible for bots. Users either give bots broad shell access to work around missing tools, which defeats the permission model, or they stop at the lead's "no tool" answer.

### Current State

**What exists today?** (dash-core v0.1.689 / dash-electron v0.0.889)

- **Where bot tools come from:** `botController._resolveTools` builds the tool set:
  - **Team leads:** only the in-process team tools (`bot-team`).
  - **Other bots:**
    - the MCP providers granted to the bot (`toolSources.resolveBotTools`, filtered by the provider's `allowedTools` and the bot's `toolSelections`)
    - the in-process memory tools (`bot-memory`)
    - bots on the Claude Code engine also get all of the SDK's built-in tools (Bash, Read, Write, WebFetch, WebSearch, …), which ask for approval unless the bot's approval policy is "allow"
- **Tool results are text only:**
  - `bots/mcpResult.js` (`normalizeMcpResult`) keeps only `type: "text"` content blocks.
  - `engines/toolLoopEngine.js` passes `r.text` to the adapters.
  - `adapters/anthropicAdapter.js` and `adapters/openAICompatibleAdapter.js` send tool results as strings.
  - `engines/agentToolBridge.js` returns `[{ type: "text" }]` to the Claude Agent SDK.
- **URL fetching in the main process:**
  - `read-data-url` downloads an HTTPS URL into a file under the app's data folder for **widgets** (network gate keyed by widget; no redirects; no size limit).
  - `themeFromUrlController.fetchBuffer` downloads images for the Settings theme picker.
  - Neither is exposed to bots.
- **Provider sources:**
  - **Built-in catalog** (`electron/mcp/mcpServerCatalog.json`): 13 providers. Google Drive's server ships inside Dash (`{{MCP_DIR}}/servers/google-drive.js`, run with `node`).
  - **Curated list** (`electron/mcp/knownExternalMcpServers.json`): 22 vetted third-party servers (fetch, puppeteer, firecrawl, tavily, exa, perplexity, …). Installing one goes through `install_known_mcp_server` on Dash's MCP server, after a confirmation dialog. Today only the AI Widget Builder uses that tool.
  - **Custom MCP servers:** `CustomMcpServerForm` in Settings adds any server by command or URL.
- **What the lead sees:**
  - `team_providers` lists only the user's configured providers.
  - `propose_bot` can list missing services in `needs`, but can't suggest where to get them.
  - `propose_bot` has no way to choose the bot's engine.

**Limitations:**

- Images returned by any tool (Puppeteer screenshots, image search results, a future fetch tool) never reach the model.
- No bot-safe way to download a URL. The options are shell access, or nothing.
- A missing capability is a dead end for the lead; the user has to research providers by hand.
- Adding a vetted provider to the curated list requires an app release.

---

## Goals & Success Metrics

### Primary Goals

1. **Bots can see images** — an image returned by any granted tool reaches a vision-capable model as an image, on both engines.
2. **Safe web access without a shell** — a bot granted the Web Fetch provider can download a page or image with no Bash, Write, or scripts involved.
3. **Gaps become suggestions** — when a draft needs something the user doesn't have, the lead names concrete providers that would fill it, and the user can install one from the draft review.

### Success Metrics

| Metric                                        | Target                                                  | How Measured                                                        |
| --------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| Image tool results reaching the model         | 100% for vision-capable models on both engines          | Unit tests per engine/adapter; manual run of an image-labelling bot |
| Image-labelling bot built with no shell tools | Works end to end with only Web Fetch + a vision model   | Manual test: the Algolia enrichment bot from the problem statement  |
| Drafts with a gap that include a suggestion   | ≥ 1 suggested provider whenever discovery finds a match | Unit tests on `find_providers`; manual lead conversation            |
| Installs that skip the user                   | 0                                                       | Code review + tests: install only from a user action in the review  |

### Non-Goals

- **Automatic installs.** A lead or bot never installs a provider. Installing runs third-party code with the user's credentials, so it is always the user's action.
- **Vetting the public MCP Registry.** Registry results are shown as unverified; Dash doesn't review them.
- **Image editing or generation.** This PRD covers reading images, not producing them.
- **Browser automation.** Logged-in pages and JavaScript-heavy sites are out of scope for Web Fetch (Puppeteer from the curated list covers some of that once images pass through).

---

## User Personas

### Team Owner (business user)

**Role:** Project manager, SE, or analyst who reviews bots drafted by a team lead

**Goals:**

- Approve bots that do the job without handing them broad access
- Fill a missing capability without researching MCP servers

**Pain Points:**

- "No tool for this" with no next step
- Being told to give a bot shell access to work around a gap

**Technical Level:** Beginner to Intermediate

**Success Scenario:** The lead's draft says "Needs: download images. Suggested: Web Fetch (built in)". The owner grants it in the review, approves the bot, and it labels the records.

### Maker-Developer

**Role:** Builds and publishes bots and teams

**Goals:**

- Use image-returning MCP servers (screenshots, image search) in bots
- Add a community MCP server for a niche service without waiting for a Dash release

**Pain Points:**

- Image results silently dropped
- Curated list only changes with app releases

**Technical Level:** Advanced

**Success Scenario:** A Puppeteer screenshot reaches the model; a registry server found by `find_providers` installs through the pre-filled custom form.

---

## User Stories

### Must-Have (P0)

**CAP-001: Image tool results reach the model**

> As a bot builder,
> I want images returned by a bot's tools to reach the model as images,
> so that bots can describe, classify, or check images.

**Priority:** P0
**Status:** Implemented

**Acceptance Criteria:**

- [x] AC1: A tool result is `{ text, images, isError }`, where `images` is a list of `{ data (base64), mimeType }`. `text`-only results behave exactly as today.
- [x] AC2: `normalizeMcpResult` keeps MCP `{ type: "image", data, mimeType }` blocks in `images`, and still joins text blocks into `text`.
- [x] AC3: The Anthropic adapter sends images as `image` content blocks inside the `tool_result`; the OpenAI-compatible adapter sends them in the format that API accepts for tool output (or as a follow-up user message with `image_url` parts where tool messages can't carry images).
- [x] AC4: `agentToolBridge` returns image blocks to the Claude Agent SDK alongside text.
- [x] AC5: In-process tools (memory, team) are unaffected.
- [x] AC6: If the bot's model can't take images, the run doesn't fail silently. _(Implemented as: images are sent, and if the API refuses them the run error reads "This model can't read images (model). Choose a model that supports images in the bot's Settings." — no per-model capability flag to maintain.)_
- [x] AC7: Images in the Activity feed and run history are shown as a placeholder ("[image: image/png, 240 KB]") rather than stored inline, so run logs don't grow by megabytes.

**Edge Cases:**

- Unsupported image type (e.g. SVG, TIFF) → dropped with a text note naming the type.
- Image larger than the provider's limit (e.g. Anthropic's per-image size limit) → dropped with a text note giving the size and limit. _(Shrinking moved to CAP-002's **Shrink large images** setting, where Web Fetch has Electron's image tools.)_
- Many images in one result → capped at 5, with a note saying how many were omitted.

**Implementation notes (2026-10-07):**

- **One helper module:** `electron/bots/toolImages.js` (pure, no Electron) — `collectImages` (PNG/JPEG/GIF/WebP, ≤ 5 MB each, ≤ 5 per result, a note per dropped image), `imagePlaceholder`/`describeResult` (Activity text), `stripImagesForStorage` (saved sessions), `imageRejectionMessage` (AC6).
- **Normalizer:** `bots/mcpResult.js` adds `images` only when there are some, so text-only results keep their exact old shape.
- **Tool-loop engine:** passes `images` to the adapter; Activity's `tool_result.output` gets placeholders; the stored session is `stripImagesForStorage(messages)` while the live history keeps the images for later turns of the same run. A continued session sees placeholders, not images.
- **Anthropic adapter:** text-only results stay a string; with images, the `tool_result` content is `[text?, image…]` (no empty text block — the API rejects those).
- **OpenAI-compatible adapter:** Chat Completions tool messages are text-only, so images follow in one `user` message of `image_url` data-URL parts, each group labelled "Images returned by <tool> (call <id>)". An image-only tool message gets "Returned N image(s), attached below."
- **Claude Agent bridge:** returns MCP `{ type: "image", data, mimeType }` blocks; `_fromUser` shows placeholders for image parts in either the API or MCP shape.
- **Verified for real** on the claude-agent engine with the user's installed CLI (Claude Haiku 4.5): a test tool returned a solid-red PNG and the model answered "Red". The Anthropic API path couldn't be run for real (the account was out of credit); it's covered by adapter unit tests.
- **Found while verifying:** the Claude Code CLI writes each session transcript, and every tool-result image, to `~/.claude/projects/<bot sandbox path>/<session>/` (images under `tool-results/`, and the path is appended to the tool-result text). Dash's own logs stay image-free, but Claude Code bots leave image copies there. Follow-up: see Open Question 6.

**Definition of Done:**

- [x] Code implemented and reviewed
- [x] Unit tests pass (normalizer, both adapters, bridge)
- [x] Integration test: a fake MCP tool returning an image reaches a stubbed model call as an image
- [x] Acceptance criteria verified
- [x] Documentation updated

---

**CAP-002: Web Fetch provider ships with Dash**

> As a team owner,
> I want a built-in provider that downloads web pages and images,
> so that bots can use web content without shell access or scripts.

**Priority:** P0
**Status:** Implemented (AC5b partly — see notes)

**Acceptance Criteria:**

- [x] AC1: A **Web Fetch** provider appears in the built-in catalog and is listed and configured in **Settings › Providers** like any other provider. It needs no credentials. It runs inside Dash with no `node`, `uvx`, or other runtime required on the user's machine.
- [x] AC2: `fetch_image(url)` downloads an image and returns it as an image result (CAP-001), plus a short text line (final URL, type, size, dimensions where known).
- [x] AC3: `fetch_url(url)` downloads a page and returns readable text (HTML converted to text/markdown), truncated to a stated limit.
- [x] AC4: Fixed safety rules apply to every request and **can't be changed in settings**:
  - HTTPS only.
  - At most 5 redirects, each re-checked against these rules.
  - `fetch_image` only accepts `image/png`, `image/jpeg`, `image/gif`, `image/webp`.
  - Requests to localhost, private, link-local, and other internal addresses are refused, checked on the resolved IP (not just the hostname) so DNS tricks can't reach internal machines.
  - The model's own image limits (e.g. Anthropic's per-image size) apply whatever the settings say.
- [x] AC5: The provider has **user settings**, edited in Settings › Providers and stored as non-secret fields in its `credentialSchema` (the same mechanism Filesystem uses for **Allowed Directories**):

  | Setting               | Field type       | Default | Range / notes                                                                                                                                                 |
  | --------------------- | ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Max download size     | number (MB)      | 10      | 1–50; the 50 MB ceiling is fixed so one fetch can't exhaust memory. Enforced while streaming.                                                                 |
  | Timeout               | number (seconds) | 20      | 5–120                                                                                                                                                         |
  | Max images per result | number           | 5       | 1–20                                                                                                                                                          |
  | Allowed sites         | list of text     | empty   | Hostnames; `*.example.com` matches subdomains. Empty means any public site.                                                                                   |
  | Shrink large images   | toggle           | on      | On: images over the model's limit are downscaled in the main process (Electron `nativeImage`). Off: they're rejected with an error giving the size and limit. |

  Out-of-range values are refused when saving, with the allowed range shown. A provider saved before a setting existed uses that setting's default.

- [x] AC5a: The user can add **more than one** Web Fetch provider, each with its own name and settings (e.g. "Web Fetch — product images" limited to the product CDN, and an unrestricted "Web Fetch — research"). Each bot only uses the copies granted to it, and the lead sees each copy by name in `team_providers`.
- [ ] AC5b: Settings take effect on the next tool call; no restart or reconnect is needed. _(Partly: saving restarts the copy Settings runs, but bots' per-dashboard copies keep the old settings until they restart (e.g. app restart) — the same as any provider's credentials today. See Open Question 7.)_
- [x] AC6: Calls go through the normal bot permission gate: granting the provider to a bot, choosing its tools, approvals, and "Always allow" all work as for other providers.
- [x] AC7: The provider shows up in `team_providers`, so leads can propose bots that use it.
- [x] AC8: Errors are plain and specific, and name the setting when one applies ("Not an image: text/html", "Blocked: private network address", "Too large: 14 MB; this provider's limit is 10 MB (Settings › Providers › Web Fetch)", "Not in this provider's allowed sites: example.org").

**Edge Cases:**

- URL that redirects from HTTPS to HTTP → refused.
- Redirect to a site outside **Allowed sites** → refused, naming the redirect target.
- Server that lies about `Content-Type` → the image's bytes are checked (magic number) before it's returned.
- Very large dimensions → downscaled when **Shrink large images** is on; otherwise refused (see CAP-001).

**Definition of Done:**

- [x] Code implemented and reviewed
- [x] Unit tests pass (URL rules, address blocking, redirect handling, size cap, type checks, each setting and its range checks)
- [ ] Manual test: the Algolia enrichment bot fetches and labels an image with no built-in shell tools _(the user's hands-on test; an equivalent engine-level run passed — see notes)_
- [x] Acceptance criteria verified
- [x] Documentation updated

**Implementation notes (2026-10-07):**

- **In-process transport:** `mcpConfig: { transport: "in_process", builtin: "web-fetch" }`. `mcpController.startServer` gets the client side of an in-memory link from `electron/mcp/builtinServers/index.js` (`createBuiltinTransport`, MCP SDK `InMemoryTransport`); everything downstream (tool allow-lists, bot grants and approvals, widgets, the Assistant, Test connection) is unchanged. The catalog's command refresh skips built-ins.
- **Modules (`electron/mcp/builtinServers/`):** `webFetch.js` (the MCP server, settings with defaults and ranges, shrink via Electron `nativeImage` — PNG/JPEG only), `safeFetch.js` (HTTPS only, ≤ 5 redirects each re-checked, internal addresses refused by a guarded DNS lookup on the IP actually connected to, size cap while streaming, timeout, allowed sites), `addressGuard.js` (IPv4/IPv6 internal ranges incl. IPv4-in-IPv6, NAT64, 6to4), `imageSniff.js` (type and size from the bytes), `htmlToText.js` (small HTML → light markdown; no new dependency).
- **`fetch_image`** takes `url` or `urls` (up to Max images per result); per-URL failures are listed while successes are returned. Tools carry no read-only hint, so under "Ask before external actions" each call asks (or uses "Always allow"). Tool names start with `fetch_`, so mcpController's existing 5-second response cache applies.
- **Settings UI (FR-C02a):** see FR-C02a notes.
- **Verified in the app:** through the real IPC — tools listed; a public PNG returned as an image; `https://127.0.0.1` refused; `https://localtest.me` (DNS → 127.0.0.1) refused by the DNS check; `http://` refused; a page returned as text; a site outside Allowed sites refused, naming the setting. Settings screens checked in light and dark; a test copy saved (detail shows "Built into Dash"), edited, Test connection ("Connected! Found 2 tools."), then deleted. End to end, a Claude Code bot (user's CLI, Claude Haiku 4.5) called `fetch_image` on the Google logo through the bot result path and answered "Google".
- **Not changed:** the widget-side picker (`McpServerPicker`, layout builder) keeps its own text-only field renderer, so Web Fetch's settings show as plain text boxes there (values still work). Follow-up: use `ProviderSettingField` there too.

---

### Should-Have (P1)

**CAP-003: Leads can search for providers**

> As a team owner,
> I want the lead to look for providers that fill a missing capability,
> so that "no tool for this" comes with options.

**Priority:** P1
**Status:** Not Started

**Acceptance Criteria:**

- [ ] AC1: Leads get a read-only tool, `find_providers(capability)`, where `capability` is a plain description ("download an image from a URL", "search stock photos").
- [ ] AC2: It searches, in this order, and labels each result with its tier:
  1. **Installed:** the user's configured providers.
  2. **Built-in:** the built-in catalog.
  3. **Vetted:** the curated list.
  4. **Community (unverified):** the official MCP Registry search API (`https://registry.modelcontextprotocol.io/v0/servers?search=…`).
- [ ] AC3: Each result includes name, description, tier, how it runs (command or URL), what credentials it needs, and the source repo when known. Registry results are de-duplicated (the API returns one row per version; keep the latest).
- [ ] AC4: Results are fenced as untrusted data in the lead's prompt, like other team tool output.
- [ ] AC5: If the registry can't be reached, the tool still returns the local tiers and says the community search was unavailable.
- [ ] AC6: `propose_bot`'s description tells the lead to call `find_providers` for anything `team_providers` doesn't cover.

**Edge Cases:**

- No match anywhere → the lead says so and keeps the gap in `needs`.
- A registry entry with no install information → listed with a "no install info" note, no Install button.

---

**CAP-004: Draft bots carry suggested providers**

> As a team owner,
> I want each gap on a draft bot to list providers that would fill it,
> so that I can decide what to add without researching.

**Priority:** P1
**Status:** Not Started

**Acceptance Criteria:**

- [ ] AC1: `propose_bot`'s `needs` items can include `suggestions`: provider references returned by `find_providers` (id, tier, name).
- [ ] AC2: The draft review shows each need with its suggestions and their tier labels; vetted and built-in suggestions come first.
- [ ] AC3: Suggestions are validated when the draft is saved: an id that `find_providers` didn't return is dropped.

---

**CAP-005: Install a suggested provider from the draft review**

> As a team owner,
> I want to install a suggested provider from the draft review,
> so that I can fill the gap and approve the bot in one place.

**Priority:** P1
**Status:** Not Started

**Acceptance Criteria:**

- [ ] AC1: Each suggestion has an **Install** button (or **Use** for installed and built-in providers that only need adding to the bot).
- [ ] AC2: **Vetted** suggestions install through the existing confirmation dialog used by `install_known_mcp_server`.
- [ ] AC3: **Community** suggestions open the Custom MCP server form pre-filled from the registry entry, with a clear "Unverified: this runs third-party code on your computer" warning and the exact command or URL shown.
- [ ] AC4: After install, the provider can be granted to the draft in the same review, and the need is marked filled.
- [ ] AC5: Nothing installs without the user's click and confirmation; leads and bots have no install tool.

---

### Nice-to-Have (P2)

**CAP-006: Turn off Claude Code built-in tools per bot**

> As a team owner,
> I want to turn off the SDK's built-in tools (Bash, Write, WebFetch, …) for a bot,
> so that a Claude Code bot can only use the providers I grant it.

**Priority:** P2
**Status:** Not Started

**Acceptance Criteria:**

- [ ] AC1: A bot setting, **Built-in tools**: All (today's behavior), Read-only (Read, Glob, Grep), or None.
- [ ] AC2: "None" uses the same mechanism leads already use (`tools: []` plus the `canUseTool` backstop).
- [ ] AC3: Lead-drafted bots default to **None** unless the draft explains why it needs built-ins.

---

**CAP-007: Curated provider list served from the registry**

> As a maker-developer,
> I want newly vetted providers to appear without an app release,
> so that the vetted tier keeps up with the ecosystem.

**Priority:** P2
**Status:** Not Started

**Acceptance Criteria:**

- [ ] AC1: dash-registry serves the curated list, signed like other registry assets.
- [ ] AC2: The app uses the registry copy when it verifies, and falls back to the bundled copy offline or on a bad signature.

---

## Feature Requirements

### Functional Requirements

**FR-C01: Image-capable tool results**

- **Description:** Tool results carry `images` alongside `text` through the normalizer, both adapters, and the Agent SDK bridge (CAP-001).
- **Priority:** P0
- **Validation:** Unit tests per layer; integration test with a fake image tool.

**FR-C02: Web Fetch provider**

- **Description:** Built-in, in-process provider with `fetch_image` and `fetch_url`, fixed safety rules, and user settings (size, timeout, image count, allowed sites, shrink) configured in Settings › Providers; multiple copies allowed (CAP-002).
- **Priority:** P0
- **Validation:** Unit tests for every safety rule and setting; manual end-to-end bot.

**FR-C02a: Number and list fields for provider settings**

- **Description:** The provider settings form (`credentialSchema`) gains a `number` field type (with `min`, `max`, `default`, and a unit label) and a `text-list` field type (add/remove rows, like `directory-list` but free text, with optional per-item validation). A `toggle` field type is also added (today the form only special-cases `file` and `directory-list`; everything else renders as text). Values are validated when saving. Built with dash-react inputs.
- **Priority:** P0 (needed by Web Fetch's settings)
- **Validation:** Unit tests for validation and defaults; light and dark screenshots of the Web Fetch settings form.
- **Status:** Implemented (2026-10-07). One shared renderer, `src/Components/Settings/details/ProviderSettingField.js` (text/password, file, directory-list, number, toggle, text-list; built from dash-react `InputText`, `Switch`, `ButtonIcon`, `FormLabel`, `Caption2`), with `validateSettingField` (type-aware: required, number ranges, absolute directory paths) and `hasSettingValue`. Used by `McpCatalogDetail` (create) and `CustomMcpServerForm` (edit), replacing their copied renderers and the old `DirectoryListField`. `deriveFormFields` now carries `min`/`max`/`default`/`unit`/`placeholder`. Built-ins show "Built into Dash" instead of transport/command/JSON, in the forms and in `ProviderDetail`. Values keep the shapes the main process reads (numbers as strings, toggles as booleans, lists comma-joined). Also fixed while here: these forms passed `label` to dash-react `FormLabel`, which takes `title`, so field names (e.g. "Provider Name") never rendered.

**FR-C03: Provider discovery**

- **Description:** `find_providers` for leads across installed, built-in, vetted, and community tiers (CAP-003).
- **Priority:** P1
- **Validation:** Unit tests with a stubbed registry response (including duplicates and an outage).

**FR-C04: Suggestions and install from review**

- **Description:** `needs[].suggestions` on drafts; Install/Use actions in the draft review (CAP-004, CAP-005).
- **Priority:** P1
- **Validation:** Unit tests for suggestion validation; manual install of a vetted and a community provider.

### Non-Functional Requirements

- **Security:** Web Fetch refuses internal addresses on the resolved IP and after every redirect; installs only happen from a user action; discovery output is fenced as untrusted.
- **Privacy:** Fetched content isn't persisted beyond the run, except text the bot chooses to save to memory.
- **Performance:** Image results are capped in size and count; run logs store placeholders, not image data.
- **Portability:** The Web Fetch provider runs inside Dash, with nothing required on the user's machine (unlike `node`- or `uvx`-launched servers). This is the lesson from the Intel CLI bug: don't depend on a binary the release build might not include.

---

## User Workflows

### Workflow 1: Image labelling with Web Fetch

1. The user asks the Algolia Data Enrichment lead for a bot that labels each record's image.
2. The lead calls `team_providers`, sees Web Fetch, and proposes a bot granted Algolia + Web Fetch (`fetch_image` only).
3. The user reviews and approves the draft.
4. On each run, the bot reads records, calls `fetch_image` on each image URL, sees the image, and writes a label back with an Algolia partial update.

### Workflow 2: Filling a gap the user doesn't have

1. The user asks for a bot that finds a stock photo for each product.
2. `team_providers` has nothing for image search, so the lead calls `find_providers("search stock photos")`.
3. The draft's need lists, say, one vetted and two community servers.
4. The user clicks **Install** on one. Vetted: confirmation dialog. Community: pre-filled custom form with the unverified warning.
5. The user grants the new provider to the draft and approves it.

---

## Design Considerations

### UI/UX Requirements

- Tier labels use dash-react `Tag`/`StatusBadge` with theme tokens: Installed and Built-in neutral, Vetted success, Community warning.
- The unverified warning uses `AlertBanner` (warning, compact).
- Image placeholders in the Activity feed use `Caption2` text, not thumbnails (no image data in logs).

### Architecture Requirements

- **Tool result shape:** `{ text, images?, isError }` is the one contract between `_callTool`, the engines, and the adapters. `images` is optional so in-process tools don't change.
- **Web Fetch lives in the main process.** It's registered as a built-in provider served in-process (like the memory and team virtual servers, but granted and gated like a normal provider). It uses Electron's `net`/Node `https` with a custom DNS lookup that rejects internal addresses.
- **Settings are read per call.** Each tool call reads the calling provider's saved settings (by provider name), clamps them to the fixed ceilings, and applies them. Fixed safety rules are code, not settings.
- **Discovery is read-only.** `find_providers` reads local catalogs and one public HTTPS endpoint, and never installs anything. Installing reuses the existing paths (`install_known_mcp_server` confirmation; `CustomMcpServerForm`).

### Dependencies

- The official MCP Registry search API (community tier only; optional at runtime).
- An HTML-to-text converter for `fetch_url` (choose an existing dependency if one is already bundled; otherwise list it in the implementation plan).

---

## Open Questions & Decisions

### Open Questions

1. ~~**Size and count limits**~~ — resolved: user settings on the provider (see Decisions Made).
2. ~~**Downscaling**~~ — resolved: the **Shrink large images** setting (on by default).
3. **Web Fetch as a granted provider vs. always-on tool:** this PRD makes it a provider the user grants per bot. Confirm that's preferred over giving every bot the tools automatically.
4. **CAP-006 timing:** ship the built-in tools setting with phase 1, or later?
5. ~~**Which models count as vision-capable**~~ — resolved: send the images and translate an API refusal into a plain error (see CAP-001 AC6).
6. **Claude Code keeps its own copies of images:** the CLI saves session transcripts and tool-result images under `~/.claude/projects/<bot sandbox path>/`. Should Dash clean these up (e.g. when a bot is deleted, or after N days), turn off the CLI's session saving for bots where possible, or just document it?
7. **Settings reaching running bot copies (CAP-002 AC5b):** saving a provider restarts only the copy Settings runs; bots' per-dashboard copies keep their old settings/credentials until they restart. Restart every running copy of a provider on save (all providers, not just Web Fetch), or read Web Fetch's settings per call?

### Decisions Made

| Decision                                       | Rationale                                                                                                                               | Date       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| New PRD rather than extending bot-teams.md     | Capabilities apply to all bots, not just teams                                                                                          | 2026-10-07 |
| Web Fetch is a provider, not a hidden built-in | Reuses grants, tool selection, approvals, "Always allow"; visible to leads via `team_providers`; user decides which bots get web access | 2026-10-07 |
| Leads suggest, users install                   | Installing runs third-party code with the user's credentials                                                                            | 2026-10-07 |
| Images first                                   | Every other phase (Web Fetch, Puppeteer, image search) depends on images reaching the model                                             | 2026-10-07 |
| Web Fetch limits are provider settings         | The user sets size, timeout, image count, allowed sites, and shrink in Settings › Providers; safety rules and ceilings stay fixed       | 2026-10-07 |
| Multiple Web Fetch copies allowed              | Different bots can get different limits (e.g. one locked to a CDN) by granting different copies                                         | 2026-10-07 |

---

## Out of Scope

- Automatic installation of any provider
- Reviewing or rating community MCP servers
- Image generation or editing
- Logged-in or JavaScript-rendered page fetching in Web Fetch

---

## Implementation Phases

### Phase 1: Bots can see images (P0)

- CAP-001

### Phase 2: Web Fetch provider (P0)

- FR-C02a: number, list, and toggle fields for provider settings
- CAP-002 (depends on Phase 1 and FR-C02a)

### Phase 3: Finding providers (P1)

- CAP-003, CAP-004, CAP-005

### Phase 4: Future (P2)

- CAP-006 (unless pulled forward; see Open Question 4)
- CAP-007

---

## Testing Requirements

### Unit Tests

- `normalizeMcpResult` with text-only, image-only, mixed, oversized, and unsupported-type results
- Both adapters' tool-result formatting with images
- `agentToolBridge` returning image blocks
- Web Fetch: HTTPS-only, redirect limit and re-checks, private-address blocking on resolved IPs, size cap, timeout, content-type and magic-number checks, allowed sites
- `find_providers`: tier order, de-duplication of registry versions, registry outage, fencing

### Integration Tests

- A fake MCP tool returning an image reaches a stubbed model call as an image, on both engines
- A bot granted Web Fetch calls `fetch_image` through the permission gate (approval, then "Always allow")

### E2E Tests

- Draft review: a need with suggestions; Use a built-in provider; Install a vetted provider through the confirmation dialog

### Manual Testing

- The Algolia enrichment bot from the problem statement labels a real image with no built-in shell tools (released app, Intel Mac)
- Light and dark screenshots of the draft review with tier labels and the unverified warning
- Light and dark screenshots of Settings › Providers › Web Fetch; two Web Fetch copies with different allowed sites, each granted to a different bot

---

## Revision History

| Version | Date       | Author | Changes                                                                                    |
| ------- | ---------- | ------ | ------------------------------------------------------------------------------------------ |
| 1.0     | 2026-10-07 | John   | Initial draft                                                                              |
| 1.1     | 2026-10-07 | John   | Web Fetch limits as provider settings; multiple copies; new settings field types (FR-C02a) |
| 1.2     | 2026-10-07 | John   | CAP-001 implemented (Phase 1); Open Question 6 (Claude Code's own image copies)            |
| 1.3     | 2026-10-07 | John   | CAP-002 Web Fetch + FR-C02a settings fields implemented (Phase 2); Open Question 7         |
