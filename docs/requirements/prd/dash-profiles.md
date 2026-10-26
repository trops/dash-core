# PRD: Dash Profiles

**Status:** In Progress (PR 1 of 6: profile storage)
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
   - `electron/profile/profilePaths.js` (`getProfileDataDir`, `getProfileFilePath`) resolves the active profile's folder.
   - The per-profile controllers build their paths through it: workspaces, themes, menu items, layouts, dashboard ratings, and the
     dashboard config reads.
   - Default stays in `Dashboard/<appId>/`, and other profiles go in `Dashboard/<appId>/profiles/<id>/`.
2. **Switching + bots per profile.** `profileId` on bots, only the active profile's bots run, session recents per profile, the switch flow,
   and the MCP Dash server follows the active profile.
3. **Profiles UI.** The switcher in the sidebar account menu, and Settings › Profiles (new / rename / delete / duplicate / switch).
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

---

## Testing Requirements

- `electron/profile/profileStore.test.js`: create, rename, delete and switch; the Default and active-profile guards; damaged files;
  unsafe ids.
- `electron/profile/profilePaths.test.js`: with no `profiles.json`, controllers read the same folder as before. After a switch, every
  controller reads and writes only the new profile, and Default is untouched.

---

## Revision History

- 2026-10-26: Created. Plan approved; PR 1 (profile storage) in progress.
