# PRD: Remixes

**Status:** In Progress (R1 registry shipped; R2 dash-core)
**Last Updated:** 2026-10-27
**Owner:** trops
**Related PRDs:** [Dash Profiles](./dash-profiles.md), [Dashboard Marketplace](./dashboard-marketplace.md)

---

## Executive Summary

Anyone can change a widget, dashboard, theme or bot they installed. Publishing your changed version of someone else's work is
a **remix**: it goes under your own name and credits the original author. Each package's author decides whether it may be
remixed. By default public packages may be and private ones may not, so a dashboard built for a customer (shared privately,
and later paid for) can't be republished by that customer.

---

## Context & Background

### Problem Statement

The Widget Builder already made "remixes" of other people's widgets (`@ai-built/<name>Remix`, with `remixedFrom` in the local
`dash.json`), but the credit went nowhere: the registry dropped it, and nothing showed it. Installed dashboards couldn't be
published at all, so a user who adapted one had no way to share it. And nothing stopped someone a private package was shared
with from republishing it under their own name.

**Who experiences this problem?**

- Authors of private or (later) paid packages, whose work could be republished by the people they share it with.
- Users who adapt someone else's public dashboard or widget and want to share their version, with credit.

---

## User Stories

**US-1: The author decides.** As an author, I choose whether each of my packages may be remixed.

- Acceptance:
  - Public packages may be remixed and private ones may not, unless I choose otherwise ("Allow remixes" in the Publish
    dialogs and on the registry account page).
  - A package published before this follows its visibility, so existing private packages are protected right away.
  - Making a public package private stops it being remixable, unless I chose to allow remixes.

**US-2: Remixes are credited.** As a user, I can publish my version of someone else's work, credited to them.

- Acceptance:
  - Publishing someone else's widget, dashboard, theme or bot (installed from the registry, or a copy of one) goes under my
    name, never updates the original, and the registry records "Remix of X by Y" from the original's own record.
  - A remix of a remix also credits the first original.
  - The registry package page and the app's registry details show the credit.

**US-3: Remixes the author doesn't allow are refused.** As an author, my private or no-remix work can't be republished.

- Acceptance:
  - The registry refuses a publish that says it's a remix of a package that doesn't allow remixes (403), or of a private
    package the publisher can't read (404, the same answer as "not found", so nothing leaks).
  - The app checks first and shows the reason before uploading anything.
  - Using and personalizing are unaffected: settings, layout and my own copy on my computer.

---

## Out of Scope

- Detecting copies that strip the credit (R1b: a fingerprint of each package's files, checked on publish — needs a new
  registry table and IAM).
- Payments (Stripe) — paid packages will be private, so they inherit "no remixes" by default.

---

## Implementation Phases

1. **R1 — dash-registry v1.9.0** (`src/lib/remixRules.ts`): `allowRemix` stored only when the owner or a manifest sets it,
   else it follows visibility; `remixedFrom` checked against the original (`checkEntitlement` with `claimSeat: false`, so a
   check never uses up a seat); a package stays a remix of the same original (409 otherwise); credit with `root`; PATCH
   `allowRemix`; GET and resolve return the effective value; package page credit; account page checkbox.
2. **R2 — dash-core** (`electron/registry/remix.js`, `src/utils/remixSource.js`, `AllowRemixOption`):
   - `remixOrigin(kind, record)` — what an item is a copy of: a Widget Builder remix (`dash.json` `remixedFrom`), someone
     else's widget installed from the registry, a dashboard / theme / bot / team installed from someone else's package, or
     a copy made with Duplicate (`remixedFrom`). The user's own work and `@ai-built` have none.
   - `checkRemix` asks the registry first: not allowed → the publish stops with the reason; allowed → `remixedFrom` is sent.
   - Dashboards installed from someone else can now be published, as a remix. One imported from a file still can't.
   - Duplicate keeps the credit (`remixedFrom`) for dashboards and themes.
   - "Allow remixes" in the widget, dashboard, theme and bot Publish dialogs (follows visibility until changed; sent only
     when changed).
   - Registry dashboard and theme details show "Remix of X by Y".
   - Review fixes: a published remix remembers its original (`remixedFrom` on the record), so a later publish — even
     under another name — is still a remix and is checked again; an original that's gone or private now refuses the
     copy (it's not published uncredited); widgets installed before `installSource` existed count as registry
     installs; a team checks every member's original and keeps crediting the same one; a copy's own `remixedFrom` never
     goes out in a package or comes in with an install; a theme bundled in a dashboard doesn't bring the
     publisher's publish record.
   - Open question (user): copies made through Create (a starter's plan, a registry dashboard's bot) are adapted by
     the Planner, so they carry no source yet.
3. **R3 — dash-electron**: the Widget Builder's Remix mode checks the original's `allowRemix` first; version bump.
4. **R1b (later)**: content fingerprints.

---

## Testing Requirements

- dash-registry `src/lib/remixRules.test.ts`: defaults, the decision (allowed, refused, private, owner, chains, deleted
  originals, same original only), manifest validation.
- dash-core `electron/registry/remix.test.js`: origins for every kind; the check's outcomes.
- dash-core `src/utils/remixSource.test.js`: what Duplicate keeps; the credit text; the publish option.
- End-to-end refusal needs a second registry account (all public packages today are the owner's).

---

## Revision History

- 2026-10-27: Created. User decisions: editing someone else's widget or dashboard is a remix that credits the author;
  authors choose with "Allow remixes" (public yes, private/paid no by default). R1 shipped in dash-registry v1.9.0.
