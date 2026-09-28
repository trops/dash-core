# Bot Factory: Use Cases, MCP Coverage & Gaps

**Companion to:** [bot-factory.md](./bot-factory.md)
**Last Updated:** 2026-09-27
**Sources checked:** `electron/mcp/knownExternalMcpServers.json` (22 servers, AI-installable allow-list) and `electron/mcp/mcpServerCatalog.json` (13 servers, Settings catalog) in dash-core.

> The MCP ecosystem moves quickly. Every "official" or "replace" note below should be verified against the vendor's current docs before changing the lists.

---

## Status Key

| Status        | Meaning                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------- |
| **Available** | On the allow-list or catalog and suitable as-is                                           |
| **Replace**   | Listed, but the entry is a community, archived, or unpinned package and an official option likely exists |
| **Gap**       | Not on either list                                                                        |

Current inventory: **Allow-list:** fetch, git, time, google-maps, puppeteer, sqlite, redis, sequential-thinking, everart, stripe, cloudflare, sentry, supabase, atlassian, asana, trello, perplexity, tavily, exa, firecrawl, heroku, neon. **Catalog:** github, slack, notion, brave-search, filesystem, postgres, linear, memory, google-drive, gmail, google-calendar, algolia, gong.

---

## 1. Engineering

| Use case                     | Bots (trigger)                                     | Dashboard / widgets                    | MCP servers                       | Status |
| ---------------------------- | -------------------------------------------------- | -------------------------------------- | --------------------------------- | ------ |
| Morning PR digest            | PR Digest (weekday cron)                           | Bot Output on eng dashboard            | GitHub, Slack                     | Replace (both community/archived) |
| PR summarizer / reviewer     | Summarizer (fast tier), Security Reviewer (deep tier) on `prSelected` | GitHub PRs widget → Review Summary | GitHub                            | Replace |
| CI failure triage            | CI Triage (webhook)                                | Build status widget                    | GitHub (Actions), Slack           | Replace |
| Error spike watch            | Error Watch (event / cron)                         | Error trend chart                      | Sentry                            | Replace (remote server likely preferable) |
| Issue triage & labeling      | Triage bot (webhook / cron)                        | Backlog widget                         | Linear, Atlassian (Jira), GitHub  | Replace (Linear community; Atlassian remote exists) |
| Release notes drafting       | Release Notes (tag event)                          | Changelog widget                       | GitHub, git, Notion               | Replace / Available (git) |
| Dependency update review     | Deps bot (weekly)                                  | Outdated deps widget                   | GitHub, fetch                     | Replace / Available |
| Deploy & infra status        | Infra Watch (cron)                                 | Status board                           | Cloudflare, Heroku, Vercel        | Replace (Cloudflare) / Available (Heroku) / **Gap (Vercel)** |
| Database health & slow queries | DB Watch (cron)                                  | DB metrics widget                      | Postgres, Neon, Supabase          | Replace (Postgres archived; Supabase unpinned) / Available (Neon) |
| Incident summary             | Incident Scribe (PagerDuty / Slack event)          | Incident timeline                      | PagerDuty, Slack, Sentry          | **Gap (PagerDuty)** |
| Observability digest         | Metrics bot (cron)                                 | Grafana-style panels                   | Grafana, Datadog                  | **Gap** |
| Design handoff checks        | Design bot (on request)                            | —                                      | Figma                             | **Gap** |
| End-to-end smoke tests       | Smoke Test bot (cron / deploy event)               | Test results widget                    | Playwright                        | Replace (Puppeteer server archived; Playwright is the likely successor) |

## 2. Knowledge Work & Business

| Use case                        | Bots (trigger)                          | Dashboard / widgets              | MCP servers                              | Status |
| ------------------------------- | --------------------------------------- | -------------------------------- | ---------------------------------------- | ------ |
| Inbox triage                    | Inbox Triage (cron)                     | Priority inbox widget            | Gmail                                    | Replace (community package; Google remote servers exist) |
| Meeting prep brief              | Meeting Prep (calendar, 30 min before)  | Today's agenda widget            | Google Calendar, Gmail, Google Drive     | Replace (community) |
| Daily / weekly brief            | Brief bot (weekday cron)                | Bot Output on home dashboard     | Calendar, Gmail, Slack, Linear/Asana     | Replace |
| Project status roll-up          | Status bot (project channel)            | Project dashboard                | Asana, Trello, Linear, Notion            | Replace (Asana/Trello community; Asana remote exists) |
| Docs upkeep / stale page finder | Docs Gardener (weekly)                  | Stale docs list                  | Notion, Google Drive                     | Replace (Notion remote exists) |
| Microsoft 365 workflows         | Inbox, Calendar, Teams bots             | Same as above                    | Outlook, Teams, SharePoint               | **Gap** |
| Spreadsheet reporting           | Report bot (cron)                       | Table/chart widgets              | Google Sheets, Airtable                  | **Gap** (Drive reads files; no structured Sheets/Airtable writes) |
| Revenue & payments digest       | Revenue bot (daily)                     | MRR / churn chart                | Stripe                                   | Replace (`--tools=all` too broad; remote server likely preferable) |

## 3. Sales, Support & Solutions Engineering

| Use case                          | Bots (trigger)                         | Dashboard / widgets        | MCP servers                    | Status |
| --------------------------------- | -------------------------------------- | -------------------------- | ------------------------------ | ------ |
| Call summaries & follow-ups       | Call Recap (after Gong call)           | Deal notes widget          | Gong, CRM                      | Replace (Gong community) / **Gap (CRM)** |
| Account digest before a call      | Account Prep (calendar)                | Account card               | HubSpot or Salesforce, Gmail, Gong | **Gap (HubSpot, Salesforce)** |
| Demo environment sanity check     | Demo Check (before calendar demo)      | Demo health widget         | Algolia, fetch                 | Available |
| Search relevance monitoring       | Relevance bot (cron)                   | Algolia metrics widgets    | Algolia                        | Available |
| Support ticket triage             | Ticket Triage (webhook)                | Queue widget               | Zendesk, Intercom              | **Gap** |
| Competitor & market monitoring    | Market Watch (weekly)                  | News/feed widget           | Exa, Tavily, Firecrawl, Perplexity, fetch | Available (Tavily unpinned) |

## 4. Research & Content

| Use case                      | Bots (trigger)             | Dashboard / widgets    | MCP servers                                | Status |
| ----------------------------- | -------------------------- | ---------------------- | ------------------------------------------ | ------ |
| Topic research brief          | Researcher (on request)    | Bot Output             | Exa, Tavily, Perplexity, Brave Search      | Available / Replace (Brave archived reference server) |
| Web page change monitoring    | Page Watch (cron)          | Changes feed           | Firecrawl, fetch                           | Available |
| Social post drafting          | Social Drafts (weekly)     | Drafts queue           | LinkedIn, X, Buffer                        | **Gap** (drafts only; posting stays manual) |
| Image generation for posts    | Art bot (on request)       | Gallery widget         | EverArt                                    | Replace (archived reference server) |
| Video / podcast notes         | Notes bot (on request)     | —                      | YouTube transcripts                        | **Gap** |

## 5. Home, Maker & Personal

| Use case                           | Bots (trigger)                        | Dashboard / widgets            | MCP servers                                 | Status |
| ---------------------------------- | ------------------------------------- | ------------------------------ | ------------------------------------------- | ------ |
| 3D print farm monitor              | Print Watch (event / cron)            | Printer status, job queue      | Bambu Lab (printer status, AMS, jobs)       | **Gap** (community projects only; strong custom-server candidate) |
| Smart home routines & alerts       | Home bot (events)                     | Home status widget             | Home Assistant                              | **Gap** (Home Assistant ships an MCP server integration) |
| Home project tracker               | Project bot (weekly)                  | Project board                  | Notion or Trello, Google Drive              | Replace |
| Weather-aware scheduling           | Yard/Project planner (daily)          | Weather widget                 | Weather API                                 | **Gap** (fetch + a public weather API works as a stopgap) |
| Local places & errands             | Errand bot (on request)               | Map widget                     | Google Maps                                 | Replace (archived reference server) |
| Personal notes & journal search    | Notes bot                             | —                              | Obsidian / filesystem                       | Available (filesystem) / **Gap (Obsidian)** |

## 6. Dash Itself

| Use case                        | Bots (trigger)                   | Dashboard / widgets        | MCP servers              | Status |
| ------------------------------- | -------------------------------- | -------------------------- | ------------------------ | ------ |
| Widget update & health check    | Widget Steward (weekly)          | Installed widgets list     | Dash MCP                 | Available |
| Dashboard builder assistant     | Builder bot (on request)         | Any                        | Dash MCP                 | Available |
| Registry release watcher        | Registry bot (cron)              | Registry feed              | Dash MCP, GitHub         | Available / Replace |
| Bot cost & usage review         | Cost bot (weekly)                | Activity Feed, spend chart | Bot Factory built-ins    | Available (with US-019) |

---

## Gap Summary (prioritized)

| Priority | Server(s)                      | Unlocks                                              | Notes |
| -------- | ------------------------------ | ---------------------------------------------------- | ----- |
| P1       | HubSpot, Salesforce            | Account prep, call follow-ups (SE persona)           | Both vendors offer hosted MCP options; verify |
| P1       | Microsoft 365 (Outlook, Teams) | Inbox, calendar, and chat bots for M365 organizations | Large share of business users; verify official availability |
| P1       | Zendesk, Intercom              | Support triage                                        | Intercom offers a remote server; verify Zendesk |
| P1       | Google Sheets / Airtable       | Structured reporting bots                             | Common business output target |
| P2       | PagerDuty, Grafana, Datadog    | Incident and observability bots                       | Official servers exist or are in preview; verify |
| P2       | Vercel, Figma                  | Deploy status, design handoff                         | Official remote/dev-mode servers exist; verify |
| P2       | Home Assistant                 | Smart home bots                                       | Uses HA's built-in MCP server integration |
| P2       | Bambu Lab                      | Print farm monitoring                                 | No official server known; build a Dash-maintained one (local MQTT/LAN) |
| P3       | Weather, YouTube transcripts, Obsidian, social platforms | Personal and content bots   | Fetch-based stopgaps exist for several |

---

## Hygiene Findings on the Current Lists

These affect bots directly because the PRD (US-025) requires pinned, trustworthy installs:

1. **Archived reference servers.** Several entries point at `@modelcontextprotocol/server-*` packages that were moved to the archived servers repo (e.g. GitHub, Puppeteer, Postgres, Brave Search, Google Maps, Redis, EverArt). Replace with official or maintained successors (e.g. GitHub's own server, Microsoft's Playwright server).
2. **Community packages where official servers exist.** Slack, Gmail, Google Calendar, Linear, Asana, Trello, Atlassian, and Gong use community packages. Official remote servers appear to exist for Slack, Google Workspace, Linear, Asana, Atlassian, and Notion; prefer those (remote servers also avoid running local code).
3. **Unpinned versions.** `@supabase/mcp-server-supabase@latest` and `tavily-mcp@latest` conflict with the PRD's version-pinning guardrail (US-025 AC9). Most other `npx -y` entries are implicitly unpinned too.
4. **Over-broad defaults.** Stripe is configured with `--tools=all`; bots should start from read-only tools per the fail-closed grant model.
5. **Two lists, overlapping roles.** The allow-list (AI-installable) and catalog (Settings) are separate. Consider one source with a flag for "AI may propose install," so the capability-request ladder (US-025) checks one list.

---

## Launch Templates & Starter Dashboard Packages

Priority bot templates (built in, US-008) and the dashboard packages that bundle them with companion widgets (US-027). Packages marked **Blocked** need a gap server first.

| Package (workspace)       | Bots (tier)                                             | Companion widgets                          | MCP servers                  | Status |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------ | ---------------------------- | ------ |
| Engineering Review Team   | PR Summarizer (fast), Security Reviewer (deep), Notifier (fast) | GitHub PRs, Review Summary, Bot Status | GitHub, Slack                | Ready after hygiene fixes |
| Morning PR Digest         | PR Digest (fast)                                        | Bot Output, Activity Feed                  | GitHub, Slack                | Ready after hygiene fixes |
| Daily Brief               | Brief bot (balanced)                                    | Today's agenda, Bot Output                 | Google Calendar, Gmail, Slack | Ready after hygiene fixes |
| Inbox Zero                | Inbox Triage (fast)                                     | Priority inbox, Bot Chat                   | Gmail                        | Ready after hygiene fixes |
| Meeting Prep              | Meeting Prep (balanced)                                 | Agenda, Bot Output                         | Calendar, Gmail, Drive       | Ready after hygiene fixes |
| Production Watch          | Error Watch (fast), Incident Scribe (balanced)          | Error trend, Bot Status                    | Sentry, Slack (+ PagerDuty)  | Partial (PagerDuty gap) |
| SE Demo Prep              | Demo Check (fast), Account Prep (balanced)              | Demo health, Account card                  | Algolia, fetch (+ CRM, Gong) | Partial (CRM gap) |
| Market Watch              | Market Watch (balanced)                                 | News feed, Bot Output                      | Exa or Tavily, Firecrawl     | Ready (pin Tavily) |
| Maker Print Farm          | Print Watch (fast)                                      | Printer status, Job queue                  | Bambu Lab                    | **Blocked** (build custom server) |
| Smart Home                | Home bot (fast)                                         | Home status                                | Home Assistant               | **Blocked** (add to catalog) |

Each package's bots declare their required servers and tools, so the review screen and setup checklist show exactly what will be connected before anything runs.

---

## Suggested Next Steps

1. Verify and apply the hygiene fixes before bots can install servers (blocks US-025 P1).
2. Add P1 gap servers, preferring vendor-hosted remote servers.
3. Build a Dash-maintained **Bambu Lab MCP server** as a reference custom server (dogfoods the custom-server path and the container sandbox).
4. Build the launch templates and the "Ready" starter packages above, starting with Engineering Review Team as the reference package for US-027.
