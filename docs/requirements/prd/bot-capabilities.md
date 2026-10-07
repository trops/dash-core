# PRD: Bot Capabilities — Image Results, Web Fetch, and Finding Providers

**Status:** Draft
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
**Status:** Not Started

**Acceptance Criteria:**

- [ ] AC1: A tool result is `{ text, images, isError }`, where `images` is a list of `{ data (base64), mimeType }`. `text`-only results behave exactly as today.
- [ ] AC2: `normalizeMcpResult` keeps MCP `{ type: "image", data, mimeType }` blocks in `images`, and still joins text blocks into `text`.
- [ ] AC3: The Anthropic adapter sends images as `image` content blocks inside the `tool_result`; the OpenAI-compatible adapter sends them in the format that API accepts for tool output (or as a follow-up user message with `image_url` parts where tool messages can't carry images).
- [ ] AC4: `agentToolBridge` returns image blocks to the Claude Agent SDK alongside text.
- [ ] AC5: In-process tools (memory, team) are unaffected.
- [ ] AC6: If the bot's model can't take images, the run doesn't fail silently: the tool result text says the image was omitted because the model doesn't support images, and names the model.
- [ ] AC7: Images in the Activity feed and run history are shown as a placeholder ("image, 240 KB, image/png") rather than stored inline, so run logs don't grow by megabytes.

**Edge Cases:**

- Unsupported image type (e.g. SVG, TIFF) → dropped with a text note naming the type.
- Image larger than the provider's limit (e.g. Anthropic's per-image size limit) → downscaled if possible, otherwise dropped with a text note giving the size and limit.
- Many images in one result → capped (proposed: 5), with a note saying how many were omitted.

**Definition of Done:**

- [ ] Code implemented and reviewed
- [ ] Unit tests pass (normalizer, both adapters, bridge)
- [ ] Integration test: a fake MCP tool returning an image reaches a stubbed model call as an image
- [ ] Acceptance criteria verified
- [ ] Documentation updated

---

**CAP-002: Web Fetch provider ships with Dash**

> As a team owner,
> I want a built-in provider that downloads web pages and images,
> so that bots can use web content without shell access or scripts.

**Priority:** P0
**Status:** Not Started

**Acceptance Criteria:**

- [ ] AC1: A **Web Fetch** provider appears in the built-in catalog and needs no credentials. It runs inside Dash with no `node`, `uvx`, or other runtime required on the user's machine.
- [ ] AC2: `fetch_image(url)` downloads an image and returns it as an image result (CAP-001), plus a short text line (final URL, type, size, dimensions where known).
- [ ] AC3: `fetch_url(url)` downloads a page and returns readable text (HTML converted to text/markdown), truncated to a stated limit.
- [ ] AC4: Safety rules apply to every request:
  - HTTPS only.
  - At most 5 redirects, each re-checked against these rules.
  - A size cap (proposed 10 MB) enforced while streaming.
  - A timeout (proposed 20 s).
  - `fetch_image` only accepts `image/png`, `image/jpeg`, `image/gif`, `image/webp`.
  - Requests to localhost, private, link-local, and other internal addresses are refused, checked on the resolved IP (not just the hostname) so DNS tricks can't reach internal machines.
- [ ] AC5: The provider has an optional **Allowed sites** list (hostnames, `*.example.com` supported). Empty means any public site.
- [ ] AC6: Calls go through the normal bot permission gate: granting the provider to a bot, choosing its tools, approvals, and "Always allow" all work as for other providers.
- [ ] AC7: The provider shows up in `team_providers`, so leads can propose bots that use it.
- [ ] AC8: Errors are plain and specific ("Not an image: text/html", "Blocked: private network address", "Too large: 14 MB, limit 10 MB").

**Edge Cases:**

- URL that redirects from HTTPS to HTTP → refused.
- Server that lies about `Content-Type` → the image's bytes are checked (magic number) before it's returned.
- Very large dimensions → downscaled to the model's limits where possible (see CAP-001).

**Definition of Done:**

- [ ] Code implemented and reviewed
- [ ] Unit tests pass (URL rules, address blocking, redirect handling, size cap, type checks)
- [ ] Manual test: the Algolia enrichment bot fetches and labels an image with no built-in shell tools
- [ ] Acceptance criteria verified
- [ ] Documentation updated

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

- **Description:** Built-in, in-process provider with `fetch_image` and `fetch_url`, safety rules, and optional allowed sites (CAP-002).
- **Priority:** P0
- **Validation:** Unit tests for every safety rule; manual end-to-end bot.

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
- **Discovery is read-only.** `find_providers` reads local catalogs and one public HTTPS endpoint, and never installs anything. Installing reuses the existing paths (`install_known_mcp_server` confirmation; `CustomMcpServerForm`).

### Dependencies

- The official MCP Registry search API (community tier only; optional at runtime).
- An HTML-to-text converter for `fetch_url` (choose an existing dependency if one is already bundled; otherwise list it in the implementation plan).

---

## Open Questions & Decisions

### Open Questions

1. **Size and count limits:** 10 MB per fetch, 5 images per result, 20 s timeout. Are those right?
2. **Downscaling:** downscale large images in the main process (Electron `nativeImage`), or reject them with a clear error?
3. **Web Fetch as a granted provider vs. always-on tool:** this PRD makes it a provider the user grants per bot. Confirm that's preferred over giving every bot the tools automatically.
4. **CAP-006 timing:** ship the built-in tools setting with phase 1, or later?
5. **Which models count as vision-capable** for AC6 of CAP-001: per-provider flag in `modelProviders.js`, or try and report the API error?

### Decisions Made

| Decision                                       | Rationale                                                                                                                               | Date       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| New PRD rather than extending bot-teams.md     | Capabilities apply to all bots, not just teams                                                                                          | 2026-10-07 |
| Web Fetch is a provider, not a hidden built-in | Reuses grants, tool selection, approvals, "Always allow"; visible to leads via `team_providers`; user decides which bots get web access | 2026-10-07 |
| Leads suggest, users install                   | Installing runs third-party code with the user's credentials                                                                            | 2026-10-07 |
| Images first                                   | Every other phase (Web Fetch, Puppeteer, image search) depends on images reaching the model                                             | 2026-10-07 |

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

- CAP-002 (depends on Phase 1)

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

---

## Revision History

| Version | Date       | Author | Changes       |
| ------- | ---------- | ------ | ------------- |
| 1.0     | 2026-10-07 | John   | Initial draft |
