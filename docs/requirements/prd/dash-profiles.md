# PRD: Dash Profiles

**Status:** In Progress (PR 5: load from file)
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
4. **Save to file.**
   - **4a** (`electron/profile/profileFile.js`): Settings › Profiles › Save to file… writes a `.dashprofile` zip of the
     profile's own records as they are (ids, widget settings, pages), the folders and themes its dashboards use, bot
     definitions without the session, providers it uses without keys, and app theme + update check.
   - Every widget is checked against the registry by exact version. Only an exact version installed from the registry is
     referenced. Otherwise (newer here, a local build, not published, `@ai-built`) its installed folder is copied into the file,
     without `node_modules`. If the registry can't be reached, widgets are referenced and marked unchecked.
   - New installs record `installSource` (registry / url / local) so a local build of a published version is detected.
   - Each save records `link: { revision, savedAt, dashboardHashes }` on the profile.
   - General › Backup now points to profiles; Export Everything could not be loaded back.
   - **4b** (`electron/profile/profilePublish.js`), user decisions:
     - Signed in, the Save dialog lists the widgets going into the file that the user can publish under their name
       (`@ai-built/*` or their own scope). **Nothing is ticked by default**; nothing is ever published except from this dialog.
     - Never over an existing registry version (the registry would silently replace it): the patch number goes up until free.
       First publish is private; later ones keep the package's visibility (publishing without one would make it public).
     - The plan is recomputed in the main process; the renderer only names the package.
     - After `@ai-built/x` publishes as `@user/x`, the published package is installed and **every dashboard on this computer**
       that used it points at `@user/x` (same code and version): component ids, `packageId`, `_sourcePackage` and event-wiring
       strings (`repointLayoutPackage` in `schema/dashboardConfigUtils.js`). The `@ai-built` copy stays installed.
     - Personal paths in the widget's files: the dialog shows them and publishes only after "Publish anyway".
     - A failed publish leaves the widget in the file; a failed install after publishing leaves dashboards on the local copy.
     - The dialog closes once the file is saved, so each outcome goes to the "Saved" notice: what was published (and how
       many dashboards switched), and for each failure, why it went into the file instead (including the registry's reasons).
     - Live test (2026-10-27) caught three bugs, all fixed in 4b:
       - A layout item's `componentName` wins over `component` when it loads, so it's repointed too (and `workspace`).
         `uuid` is kept because widget data is stored under it.
       - A publish failure was invisible (the dialog closed on save).
       - Widgets with only a `dash.json` named `@ai-built/x` (every Widget Builder widget) published as `@user/@ai-built/x`,
         which the registry rejects (`packageJsonFromDashJson` keeps just the package name).
     - A published package must still pass the publish checks (e.g. no hard-coded colors). Older `@ai-built` widgets that
       fail them stay in the file, with the reason shown.
5. **Load from file** (`electron/profile/profileLoad.js`, `LoadProfileModal.js`), user decisions:
   - Settings › Profiles › **Load from file…**. The main process shows the open dialog and keeps the file under a token
     (10 minutes, at most 2); the renderer never passes a path.
   - The file is refused if any entry is outside it (`..`, absolute, backslashes), a symlink, not one of the known files or
     `widgets/<safe package id>/…`, or if it is too big; `kind` and `schemaVersion` must match.
   - Target: matched by profile id, then by name; otherwise a new profile (keeping the file's profile id when free).
     **Default is never replaced** — a file of Default loads as "Default (from <computer>)". Replacing can become
     "Load as a new profile instead" (asks for a name).
   - Records keep their ids (the profile is an id list over shared records). Each item is new, already here, changed, or
     leaves this profile (it stays on this Mac).
   - **The newer copy wins by default** (user, 2026-10-27): for a changed item, the newer published version when both
     copies have one (`_dashboardConfig.version`/`installedVersion`, bot `published`/`installedFrom`, theme
     `_registryMeta`), else the more recently edited (`updatedAt`; dashboard saves now stamp it), else this Mac's. Each
     changed item has a "use the file's" checkbox, with the reason and which other profiles hold it.
   - Widgets: missing → installed (registry ones at the exact version; copies from the file through
     `installFromLocalPath`); the file's newer version → update (ticked; says how many dashboards here use it); this
     Mac's newer → kept; **a build made on this Mac** (local/url install, folder copy, `@ai-built`) → kept unless ticked.
   - Code copied into the file is ticked by default only for the user's own widgets (`@ai-built/*` or their scope) and
     never over a registry-installed widget; anything else is offered unticked as "Code from the file, not the registry".
     Installs are announced to the windows (`widget:installed`) and permissions refreshed, like the install handlers.
   - A dashboard's lead bot goes with it: Save includes it; on load this Mac's lead for that dashboard is kept and the
     file's isn't added.
   - New bots arrive **paused** (a loaded lead too); their ids go into the loaded profile's list (`botController.save(def, {addToProfile,
     keepId})`), never the active one's.
   - App settings (theme, update check): opt-in checkbox, off.
   - Providers aren't created (one without its key would look set up but fail): the preview and the result list the ones
     to set up on this Mac.
   - The profile records `link: { revision, savedAt, loadedAt, loadedFrom, dashboardHashes }` for sync.
   - **Secrets (hotfix, 2026-10-27, `electron/profile/secretFields.js`):** a key typed into a widget is stored in plain
     text in the dashboard. Saving keeps the setting but blanks its value — settings the widget declares `type: "secret"`
     or `"password"` (read with the safe `.dash.js` parser), or whose name says so (apiKey, accessToken, password,
     clientSecret…; not "sortKey" or "author"). The manifest lists them (`secretsToEnter`); loading shows "Enter on this
     Mac: dashboard › widget › setting" unless this Mac already has the value, compares dashboards without them, and a
     dashboard taken from the file keeps this Mac's values. Provider arguments and URLs have token-like values
     redacted (`--token=…`, `--api-key …`, `?key=…`, URL passwords). Export Everything gets both fixes.
   - **Fast follow** (user): the Save dialog offers private publishing for everything in the profile — dashboards, bots,
     themes as well as widgets — opt-in like widgets.
6. **dash-electron** picks up the new version.
7. **v2: the registry is the source of truth** (user, 2026-10-27). A profile becomes a package.json-like manifest:
   every dashboard, bot (and team), theme and widget is published privately and listed as `"@user/name": version`,
   plus a provider list (no keys) and a small personal settings overlay. Bots and teams are their own packages
   (dashboards publish with `includeBots: false`); an item of the user's that fails the publish checks blocks the
   save; a third-party widget the registry doesn't have leaves its dashboard out, with a warning. Groundwork first:
   - **7a. Package identity** (`electron/registry/packageRef.js`, `registryPackages.js`):
     - `normalizePackageRef` gives one name, `@scope/name`, for any form the kinds used.
     - Install and publish of dashboards, themes, bots and teams also write
       `registryRef: { package, kind, version, origin: "installed"|"published", at }`. `readRegistryRef` reads it,
       falling back to the older fields (`_dashboardConfig`, `_registryMeta`, `installedFrom`, `published`), so
       nothing needs migrating. A published dashboard or theme leaves out the publisher's `registryRef`.
     - `getPackageInfo` (kind, versions, latest, visibility), `nextFreeVersion` and `kindConflict` (the registry's
       "a package keeps its kind" rule, checked before publishing). The Save dialog doesn't offer a widget whose
       name is already another kind of package.
     - Loading compares versions only between copies of the same `@scope/name`.
   - **7b. Exact versions and in-place installs** (`resolveForInstall`, `electron/bots/botUpdate.js`):
     - Dashboards, themes and bots/teams install at an exact version when asked (else the latest), check the
       package's kind, and look again past the cached registry index for something just published elsewhere.
       Dashboard installs now verify the publisher's signature like the other kinds, and install the widgets
       they need at the version the dashboard recorded (the latest if that version is gone).
     - `installDashboardFromRegistry(…, { version, intoWorkspaceId, withTeam })`: into an existing dashboard it
       keeps its id, name, folder, theme and this computer's widget settings and providers
       (`keepPersonalization`, by section and widget id), and never adds the team again; `withTeam: false`
       leaves the team out (a profile installs bots as their own packages).
     - Themes: an update goes over the theme installed from that package; a new one never over a different
       theme with the same name ("Ocean (2)") — `themeKeyFor`.
     - Bots: `updateFromRegistry(previewId, botIdsByRole)` updates existing bots: what a bot does comes from
       the package, how it runs here (providers, approvals, wiring, run state) stays; a provider the new
       version needs is reported, never added.
     - A dashboard installed from your own account can be published again (others' still can't).
     - The editor's save no longer drops where a dashboard came from (`registryRef`, `_dashboardConfig`) —
       before, one edit lost it, and with it the "can't publish someone else's dashboard" rule. So an edited
       copy of someone else's dashboard now stays unpublishable; publishing it as a credited **remix** under
       your name is planned next (user, 2026-10-27: editing someone else's widget or dashboard is a remix that
       credits the original author).
     - Widgets a dashboard needs install at its recorded versions only when asked (`exactWidgetVersions`, for
       profiles); gallery and onboarding installs still get the latest.
     - Widget settings carried over in place match by page and widget id, or by the same widget and component
       anywhere when the page ids differ (unless that's ambiguous).
     - The dashboard update check reads `registryRef` and offers only newer versions (your own published
       dashboards no longer always showed "update available").
   - **7c. Publishing dashboards and themes without a save dialog** (`publishDashboardHeadless`,
     `publishThemeHeadless`, `planPackagePublish`):
     - Names are picked automatically (user, 2026-10-27), never asked: an item already published from (or
       installed from) the user's own account keeps that package — later publishes are new versions of it,
       even after a rename; otherwise a slug of its name, with "-2", "-3"… when another item of any kind has
       it. A different item never lands on an existing package as a new version of it.
     - The version is this computer's, or the next the registry doesn't have. A new package is private; an
       existing one keeps its visibility (none is sent; the registry keeps it).
     - Signed in only; nothing is left on disk; a dashboard whose widgets the registry can't supply isn't
       published (they go first); dashboards go without their bots (bots are their own packages).
     - Picked names follow the registry's rule (kebab-case, starting with a letter, 2-50 characters):
       "2024 Plan" → `dashboard-2024-plan`; a suffix still fits.
     - A duplicated dashboard drops what the original was published as, so publishing the copy never updates
       the original's package.
     - Fixed on the way: a published theme carried the previous version; the theme Publish dialog re-sent a
       version its package already had (now the next free one); dashboard publish listed other people's
       widgets under the publisher's name — now only `@ai-built` and scopes of widgets built on this computer
       are renamed, and the Publish dialog no longer republishes a widget it couldn't look up; the rename
       missed `componentName`, `workspace` and event wiring, and the publish check didn't look at them;
       Publish was hidden for themes the user had published before.

8. **v2 save and load** (plan approved 2026-10-27; user: a changed public package of the user's is shown ticked and can
   be held back; a save publishes only what changed):
   - **V2-A — save** (`electron/registry/fingerprint.js`, `electron/profile/profileManifest.js`,
     `electron/profile/profileSaveV2.js`, `botController.publishHeadless`, `SaveProfileModal`):
     - The file is a small JSON (`schemaVersion: 2`): packages at exact versions (dashboards with their id, name,
       folder and theme; bots and a dashboard's team; themes; widgets), folders, providers without keys, and the
       settings publishing leaves out — each widget's settings and providers by section and widget id (secret
       values blanked) and each bot's providers, tools and AI (never approvals). No records, no code.
     - Every publish and install records a content fingerprint on `registryRef` (what would be published, not
       where it is here or the user's settings); a save publishes only what changed since.
     - Each item is referenced (unchanged), published (the user's, new or changed — private when new), published as
       a remix (someone else's, changed, if allowed), or left out with the reason (a dashboard imported from a file,
       one using a widget nobody can publish, someone else's that doesn't allow remixes, installed before Dash
       recorded its source). The user's own item that can't be published blocks the save; signed in only.
     - Order: widgets (`@ai-built` ones become the user's, and dashboards switch to them), themes, dashboards, then
       bots — a dashboard's bots as one team package (its lead goes with it), others one by one.
     - The Save dialog reviews it first; a changed public package of the user's is ticked "Release this as a new
       public version" and can be held back (the file keeps its last version).
     - Review fixes: fingerprints are taken once an install is finished (a team wired, a dashboard's listeners
       written) and a bot's covers its wiring and approval policy; a dashboard's team is the whole team on it; a
       dashboard's own team (it came with the dashboard package — its bots record that package) goes with the
       dashboard while unchanged (`withTeam`) and, once changed, publishes as a remix of the dashboard; a bot from a
       team package isn't saved on its own; a held-back public widget keeps the version the registry has; an old
       publish without a recorded scope is published again. The Save button says what's missing (dash-react's
       ConfirmationModal has no disabled state — backlog), and the dialog can't close while publishing.
     - Loading a v2 file comes in V2-B; dash-electron moves to the new dash-core only once both are in.

   - **V2-B — load** (`electron/profile/profileLoadV2.js`, `LoadProfileV2Modal`; v1 files still load):
     - The file is read as JSON and checked (kind, schema 2, package names, exact versions, at most 500 items).
     - Each item is matched to this computer by package, not id: install, update (the profile's is newer — ticked),
       already here, kept (this Mac's is newer, or a widget built here — the profile's can be ticked), or
       unavailable (deleted, or not shared with this user — skipped and said). A registry that can't be reached
       stops the load.
     - Order: widgets at exact versions, themes, folders, dashboards (`exactWidgetVersions`, in place when one is
       here, with its own team when the profile says so), then bots and teams (paused).
     - The overlay goes back on: each widget's settings and providers by section and widget id — a blanked key
       never overwrites one this Mac has, and an update in place only fills what's missing; bots get their
       provider choices back. Provider names map to this Mac's: the same name is used; one of the same type is
       offered ("Use for …"); otherwise **Set up** opens the provider form for that type and says which name to
       give it (prefilling the name is a follow-up).
     - The profile's lists use this computer's ids (dashboards, themes, folders, bots and the dashboards' leads).
     - Default is never replaced; app settings only when ticked; keys to enter and paused bots are listed after.
     - Review fixes: the file is untrusted — names must be strings (else dropped), and widget or bot settings may
       only name providers the file lists (each shown in the preview); "constructor"-like names resolve to
       nothing. Everything the load adds is taken back out of the profile in use (installs add to it). A dashboard's
       own team is in the loaded profile and named in the preview. Folders are matched to this computer's ids
       (numbers). Updating a bot in place uses that copy and keeps this Mac's provider choices. A results widget's
       bot isn't carried between computers. The keys list names the widget.

Step 2 (plan approved 2026-10-27): profiles kept in your account, the out-of-sync alert, auto-save. User decisions: the
registry's existing per-user table (no new storage or IAM; about 350 KB per profile); auto-save never releases a public
item (it waits for the user to release it); when both computers changed, the choice is for the whole profile (keep this
Mac's / use the account's).

   - **S1 — registry** (dash-registry v1.10.0): `/api/auth/me/profiles` list / get / save / delete, only the signed-in
     user's. A save sends the revision it last saw and is refused (409) when the account has a newer one — checked again
     as it's written. Stored in the UserLibrary table under `~profile#<id>` (no package scope can start with `~`).

   - **S2 — save to and load from the account** (`electron/profile/profileAccount.js`, `AccountProfilesModal`):
     - Each profile here can be linked to one account copy: `profileAccounts.json` (`{ accountId, revision, savedAt,
       updatedOn }`), kept apart from profiles.json so Default can be kept in the account without starting profiles.
       An account copy is linked to one profile here at most; deleting a profile here forgets its link.
     - **Save to my account** (next to Save to file): the same review and publishing, then kept in the account. When
       another computer saved it since, nothing is published and the save says when and where the newer copy came from;
       a copy removed from the account is added back as new on the next save.
     - **Load from my account…** lists the account's profiles (where and when saved, which profile here holds it) and
       opens the same Load preview as a file — the account copy is untrusted, checked like a file. Loading replaces the
       profile it's linked to (even if renamed here); Default is never replaced, so Default's account copy loads as its
       own profile and Default stays linked. A profile can be removed from the account there (asked first).
     - New IPC: `profile:save-account | list-account | preview-load-account | delete-account` (handlers in dash-electron).
     - Review fixes: links belong to the registry user who made them (`{ owner: { profileId: link } }`) — someone else
       signed in on the same computer sees none and can't move them. A load links only when no other profile here holds
       that copy and the target isn't linked to a different one (loading "as new" never steals a link). After a refused
       save the dialog offers **Replace the account's copy** ("keep this computer's", the approved whole-profile choice) —
       it replaces only the revision the user saw — so Default, which a load never replaces, can always be saved again.
       A refusal after publishing says what was published. Registry text is checked before it's stored or shown.

   - **S3 — knowing when you're out of sync** (`electron/profile/profileDigest.js`, `useProfileSync`, the updates dialog):
     - Each account save and load records the profile's digest in its link: a fingerprint per dashboard, bot, theme and
       folder it holds (published content + widget settings and provider choices + name, folder, theme). Opening a
       dashboard or a bot run doesn't change it.
     - `profile:sync-status` compares each linked profile with the account: **account newer** (revision differs),
       **changed here** (digest differs, counted per kind), **both**, or in step. Copies no longer in the account aren't
       listed.
     - It runs with the other update checks: at launch (the updates dialog pops when `checkForUpdatesOnLaunch` is on,
       and "Remind me later" works the same), after signing in, and from "Check for updates". The dialog's
       **Profiles in your account** section says "Updated on laptop · Oct 27, 9:00 AM" → **Load**, "You changed 2
       dashboards here" → **Save**, or both → **Keep this computer's** / **Use the account's** (the whole profile; user
       decision). Each opens Settings › Profiles straight into that Save or Load dialog; "keep" replaces only the account
       revision shown.
     - **Default is replaced in place by its own account copy** (user decision, 2026-10-27): loading the copy Default is
       linked to replaces what Default holds, and Default keeps its name. Any other copy of Default (a file, someone
       else's) still loads as its own profile.
     - Replacing a profile now lists what leaves it ("Leaves this profile (stays on this computer): Office, Mailer").
     - The Welcome screen of a new install offers **Load a profile from my account**.
     - New IPC: `profile:sync-status`.

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
- `electron/profile/profileFile.test.js`: widget classification (6 cases), no secrets in the zip, bundled folder without
  node_modules, revision counts up, Default-only writes no profiles.json.
- `src/Components/Settings/sections/SaveProfileModal.test.js`: counts, widget status text, options, save and cancel; publish
  section (off by default, publish then save, personal-paths confirm, failure still saves, signed out).
- `electron/profile/profilePublish.test.js`: free versions, the publish plan, repointing incl. event wiring, publish + install +
  switch with fakes, failures change nothing.
- `src/Components/Settings/sections/ProfilesSection.test.js`: active marker, Delete guards, ticks, the untick and switch confirms.
- `electron/registry/packageRef.test.js`: names in every form, `registryRef` and each kind's older fields, same-package
  checks, a published dashboard without the publisher's ref.
- `electron/registry/registryPackages.test.js`: package info with a fake fetch (404/401/403, errors), next free version,
  kind conflicts.

---

## Revision History

- 2026-10-27: S2 merged (core v0.1.847, registry v1.10.1, electron v0.0.1040). S3: out-of-sync check; Default replaced in place by its own account copy (user decision).
- 2026-10-27: Step 2 planned and approved; S1 (registry v1.10.0) merged; S2 save to / load from the account.
- 2026-10-27: v2 planned (registry as source of truth); 7a package identity.
- 2026-10-26: Created. Plan approved; PR 1 (profile storage) merged in dash-core v0.1.834.
- 2026-10-26: PR 2: profiles became id lists (user decision), plus switching and bots per profile. Merged in v0.1.835.
- 2026-10-26: PR 4b: publish from Save (opt-in ticks; every dashboard on this computer switches to the published package).
- 2026-10-26: PR 4a: save to file, with exact-version registry checks (user: make sure the registry copy is up to date).
- 2026-10-26: PR 3: profiles UI; `profile:duplicate | list-contents | set-membership` IPC.
