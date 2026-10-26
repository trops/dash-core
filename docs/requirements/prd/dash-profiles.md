# PRD: Dash Profiles

**Status:** In Progress (PR 3 of 6: profiles UI)
**Last Updated:** 2026-10-26
**Owner:** trops
**Related PRDs:** [Dashboard Marketplace](./dashboard-marketplace.md), [Bot Teams](./bot-teams.md)

---

## Executive Summary

A profile is a named, separate setup inside Dash, like a Chrome profile. Examples are "Work Laptop" and "Mac Mini". Each profile has its
own dashboards, folders, themes and bots. A computer can hold several profiles and switch between them, with one active at a time. You
can save a profile to a file and load it on another computer. Later, you'll also be able to keep it in your registry account, where Dash
tells you when a copy is out of sync and can save it automatically.

---

## Context & Background

### Problem Statement

A user builds a Home Assistant dashboard on their laptop, then installs Dash on a Mac mini that should only run Home Assistant. Today
there's no way to take what they built to the second computer. "Export Everything" writes a zip, but it has no import and leaves out
widgets, bots and settings. So the user rebuilds by hand: they find and install the same widgets, recreate the dashboard and its widget
settings, and re-create the bots.

The two computers also shouldn't be identical. The laptop has Home Assistant plus three work dashboards, and the Mac mini should have only
Home Assistant.

**Who experiences this problem?**

- Primary: anyone running Dash on more than one computer (home + work, a dedicated always-on machine).
- Secondary: anyone who wants to keep separate setups on one computer (work vs personal).

---

## User Stories

**US-1: Separate profiles on one computer.** As a user, I can create profiles and switch between them, one active at a time.

- Acceptance:
  - My existing setup is the "Default" profile, with nothing moved or changed.
  - Dashboards, folders, themes and bots belong to one profile.
  - Providers and their keys, installed widget code, app settings and registry sign-in are shared by every profile on the computer.
  - Only the active profile's bots run.
  - Default can't be deleted, and neither can the active profile.

**US-2: Save a profile to a file.** As a user, I can save the active profile as a `.dashprofile` file and pick which dashboards go in.

- Acceptance:
  - The file holds the chosen dashboards with their widget settings, the widgets they use, their themes, folders and bots/teams, the
    provider list, and app settings.
  - Registry widgets are referenced by name and version. Widgets with no registry source (`@ai-built`, local) are included in the file.
  - The file never contains keys, tokens or OAuth state. Chat history and other stored widget data are not included.

**US-3: Load a profile without losing anything.** As a user, I can load a `.dashprofile` file on another computer.

- Acceptance:
  - Loading creates a profile under the file's name and never changes my other profiles.
  - Default is never overwritten: a file named "Default" loads as "Default (from <computer>)".
  - Before anything changes, I see the dashboards, the widgets to download, the widgets included in the file, and the providers that
    need my key on this computer.
  - If a profile with that name (or id) already exists, I'm warned "This will replace your '<name>' profile". I see dashboards
    added / removed / changed, widgets installed / updated, themes, folders and bots added / removed / changed. I can choose Replace,
    Load as a new profile, or Cancel.

**US-4 (step 2): Keep a profile in my account.** As a signed-in user, I can save a profile to my registry account and load it on another
computer.

- Acceptance:
  - Dash checks on launch, on sign-in and from "Check for updates", and tells me when the account copy and this computer differ, the
    same way it does for widget updates.
  - I can turn on auto-save to my account: Manually / When I make changes / Every day at a time I choose.
  - Auto-save never overwrites a newer copy saved from another computer.

---

## Out of Scope

- Live background sync. Loading is always a button the user presses.
- Copying secrets between computers. Keys are locked to each computer's keychain.
- Chat history and other stored widget data. This could become an opt-in per dashboard later.

---

## Implementation Phases

1. **Profile storage** (this PR).
   - `electron/profile/profileStore.js` keeps `Dashboard/<appId>/profiles.json`.
   - Shipped with separate per-profile folders; replaced in PR 2 (see Implementation Notes).
2. **Profiles as id lists + switching.**
   - A profile is the list of ids it holds: `items: { dashboards, folders, themes, bots }`. Everything lives once in the shared files,
     and one item can be in several profiles.
   - The controllers filter their lists to the active profile, add new items to it, and remove deleted items from every profile.
   - Only the active profile's bots run and show. The Dash team is shared. Recent dashboards and open tabs are kept per profile.
   - `profile:*` IPC: list / get-active / create / rename / delete / switch.
3. **Profiles UI.**
   - Account menu: the profiles (one tap switches) and "Manage profiles…", shown only once a second profile exists.
   - Settings › Profiles: list + detail; New / Rename / Duplicate / Delete / Switch; what the profile holds as ticks per
     dashboard, bot, folder and theme, each saying which other profiles hold it.
   - "Remove from <profile>" in the Dashboards page "…" menu and on a bot's page.
   - Switching asks first when bots are running.
4. **Save to file.** The `.dashprofile` format.
5. **Load from file.** Create-or-replace with the difference preview, plus the sync groundwork: `revision` and dashboard hashes.
6. **dash-electron** picks up the new version.

Step 2 (separate plan): registry `users/{sub}/profiles/` storage, `/api/me/profiles`, the out-of-sync alert in `AppUpdatesModal`, and
auto-save.

---

## Implementation Notes

- **PR 1:** with no `profiles.json`, every path resolves to exactly the same file as before, so existing installs need no migration.
  - A missing or damaged `profiles.json`, or an unknown active id, means "Default only". It's never an error, so it can't hide the
    user's dashboards.
  - Profile ids are checked against `^[a-z0-9-]{1,64}$` before they're used in a path.
  - Providers (`providers.json`), `settings.json`, `Dashboard/data/` and installed widgets are deliberately shared and not moved.
- **PR 2:** switched to id lists, at the user's request: a profile is a config of what it holds, so one bot or dashboard can be in two
  profiles. PR 1's per-profile folders were dropped; no install had any yet, because there was no UI.
  - `utils/appPaths.js` (`getAppFilePath`) is the one place that builds `Dashboard/<appId>/<file>`.
  - `profile/profileMembership.js`: `filterToActive`, `addToActive`, `removeEverywhere`. With no `profiles.json`, nothing is filtered.
  - Creating the first extra profile writes Default's lists from everything that exists; a new profile starts empty.
  - Themes are a soft list: a profile shows its own themes, the themes its dashboards use, and the app theme.
  - Bots: `_inActiveProfile` gates scheduling, resume catch-up, events, the paused queue and `startBlocker`;
    `applyActiveProfile()` reschedules on a switch, and a bot in both profiles keeps running.
  - Opening a dashboard brings its lead into the active profile.
  - `profile/activeProfile.js` records the main process's appId (used by recent dashboards and the MCP Dash server).
  - Added the missing `removeRecentDashboard`, which dash-electron already called.

---

## Testing Requirements

- `electron/profile/profileStore.test.js`: create, rename, delete and switch; the Default and active-profile guards; damaged files;
  unsafe ids.
- `electron/profile/profileMembership.test.js`: no filtering with only Default; first profile keeps everything in Default; new
  items join the active profile; an item in two profiles shows in both; delete removes it everywhere.
- `electron/profile/botProfiles.test.js`: new bots join the active profile; the Dash team is shared; switching schedules and stops
  the right bots; events skip other profiles' bots; delete removes a bot everywhere.
- `electron/profile/sessionProfiles.test.js`: recents and open tabs per profile; `removeRecentDashboard`.
- `electron/profile/profileContents.test.js`: contents with inProfile/alsoIn; unticking never deletes; duplicate.
- `src/Components/Settings/sections/ProfilesSection.test.js`: active marker, Delete guards, ticks, the untick and switch confirms.

---

## Revision History

- 2026-10-26: Created. Plan approved; PR 1 (profile storage) merged in dash-core v0.1.834.
- 2026-10-26: PR 2: profiles became id lists (user decision), plus switching and bots per profile. Merged in v0.1.835.
- 2026-10-26: PR 3: profiles UI; `profile:duplicate | list-contents | set-membership` IPC.
