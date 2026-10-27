import React, { useCallback, useContext, useEffect, useState } from "react";
import {
  AlertBanner,
  Button2,
  Button3,
  Checkbox,
  ConfirmationModal,
  FontAwesomeIcon,
  InputText,
  ListRow,
  SubHeading3,
  Tag3,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { SectionLayout } from "../SectionLayout";
import { SaveProfileModal } from "./SaveProfileModal";

// What a profile holds, in the order the detail pane shows it.
const KINDS = [
  { kind: "dashboards", title: "Dashboards", noun: "dashboard" },
  { kind: "bots", title: "Bots", noun: "bot" },
  { kind: "folders", title: "Folders", noun: "folder" },
  { kind: "themes", title: "Themes", noun: "theme" },
];

// Groups longer than this get a search box.
const SEARCH_AFTER = 8;

const profilesApi = () => window.mainApi?.profiles;

const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * One kind of item (dashboards, bots…) with a checkbox per item: ticked
 * means this profile holds it. Each row says which other profiles hold it.
 */
const ContentsGroup = ({
  title,
  items,
  onToggle,
  onTickAll,
  busyKey,
  startOpen = true,
}) => {
  const { hairline, muted } = useConfigTokens();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(startOpen);
  const q = query.trim().toLowerCase();
  const shown = q
    ? items.filter((i) => (i.name || "").toLowerCase().includes(q))
    : items;
  const held = items.filter((i) => i.inProfile).length;
  return (
    <section
      className={`flex flex-col gap-3 rounded-lg border p-4 ${hairline}`}
      data-testid={`profile-group-${title.toLowerCase()}`}
    >
      <div className="flex flex-row items-center justify-between gap-4">
        <div className="flex flex-row items-baseline gap-3 min-w-0">
          <SubHeading3 title={title} padding={false} />
          <span className={`text-sm whitespace-nowrap ${muted}`}>
            {held} of {items.length}
          </span>
        </div>
        <div className="flex flex-row gap-2 flex-shrink-0">
          {open && items.length && held < items.length ? (
            <Button3 title="Tick all" size="sm" onClick={onTickAll} />
          ) : null}
          {items.length ? (
            <Button3
              title={open ? "Hide" : "Show"}
              size="sm"
              ariaLabel={`${open ? "Hide" : "Show"} ${title.toLowerCase()}`}
              onClick={() => setOpen(!open)}
            />
          ) : null}
        </div>
      </div>
      {!open ? null : items.length > SEARCH_AFTER ? (
        <InputText
          value={query}
          onChange={setQuery}
          placeholder={`Search ${title.toLowerCase()}`}
          ariaLabel={`Search ${title.toLowerCase()}`}
        />
      ) : null}
      {items.length === 0 ? (
        <span className={`text-sm ${muted}`}>None on this computer yet.</span>
      ) : !open ? null : (
        <div className="flex flex-col gap-2">
          {shown.map((item) => (
            <div
              key={String(item.id)}
              className="flex flex-row items-center gap-3 min-w-0"
            >
              <Checkbox
                label={item.name}
                checked={!!item.inProfile}
                disabled={busyKey === String(item.id)}
                onChange={(checked) => onToggle(item, checked)}
              />
              {item.alsoIn && item.alsoIn.length ? (
                <span className={`text-sm truncate ${muted}`}>
                  · also in {item.alsoIn.join(", ")}
                </span>
              ) : null}
            </div>
          ))}
          {shown.length === 0 ? (
            <span className={`text-sm ${muted}`}>No matches.</span>
          ) : null}
        </div>
      )}
    </section>
  );
};

/**
 * Settings › Profiles (dash-profiles PRD, PR 3): the profiles on this
 * computer, which one is active, and what each holds. A profile is a list
 * of dashboards, bots, folders and themes — an item can be in several.
 */
export const ProfilesSection = ({ onReloadContents = null }) => {
  const appContext = useContext(AppContext);
  const appId = appContext?.credentials?.appId;
  const { muted } = useConfigTokens();

  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState("default");
  const [selectedId, setSelectedId] = useState("default");
  const [contents, setContents] = useState(null);
  const [hasProfiles, setHasProfiles] = useState(false);
  const [error, setError] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  // "create" | "rename" | "duplicate" — the name form in the detail pane.
  const [nameForm, setNameForm] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  // { type: "delete" | "switch" | "untick", ... } — at most one confirm.
  const [confirm, setConfirm] = useState(null);
  // The profile being saved to a file, and the last save's result.
  const [saving, setSaving] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadProfiles = useCallback(async () => {
    if (!appId || !profilesApi()) return;
    const res = await profilesApi().list(appId);
    if (!res || !res.success) {
      setError(res?.error || "Couldn't load profiles.");
      return;
    }
    setProfiles(res.profiles || []);
    setActiveId(res.activeProfileId);
  }, [appId]);

  const loadContents = useCallback(
    async (profileId) => {
      if (!appId || !profilesApi()) return;
      const res = await profilesApi().listContents(appId, profileId);
      if (!res || !res.success) {
        setError(res?.error || "Couldn't load what this profile holds.");
        return;
      }
      setContents(res.contents);
      setHasProfiles(!!res.hasProfiles);
    },
    [appId],
  );

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (selectedId) loadContents(selectedId);
  }, [selectedId, loadContents]);

  const selected = profiles.find((p) => p.id === selectedId) || null;
  const isActive = selected && selected.id === activeId;
  const isDefault = selected && selected.id === "default";

  function openNameForm(kind) {
    setError(null);
    setNameForm(kind);
    setNameDraft(
      kind === "rename"
        ? selected?.name || ""
        : kind === "duplicate"
          ? `${selected?.name || "Profile"} copy`
          : "",
    );
  }

  async function submitName() {
    const name = nameDraft.trim();
    if (!name) return;
    setError(null);
    let res;
    if (nameForm === "create") res = await profilesApi().create(appId, name);
    if (nameForm === "rename")
      res = await profilesApi().rename(appId, selectedId, name);
    if (nameForm === "duplicate")
      res = await profilesApi().duplicate(appId, selectedId, name);
    if (!res || !res.success) {
      setError(res?.error || "That didn't work.");
      return;
    }
    setNameForm(null);
    await loadProfiles();
    if (res.profile) setSelectedId(res.profile.id);
    else loadContents(selectedId);
  }

  async function askSwitch() {
    let running = [];
    try {
      running = (await window.mainApi?.bots?.listRunning?.()) || [];
    } catch (_e) {
      running = [];
    }
    if (running.length) setConfirm({ type: "switch", running });
    else doSwitch();
  }

  async function doSwitch() {
    setConfirm(null);
    const res = await profilesApi().switch(appId, selectedId);
    // On success the window reloads into the new profile.
    if (!res || !res.success) setError(res?.error || "Couldn't switch.");
  }

  async function doDelete() {
    const target = confirm?.profile;
    setConfirm(null);
    if (!target) return;
    const res = await profilesApi().delete(appId, target.id);
    if (!res || !res.success) {
      setError(res?.error || "Couldn't delete the profile.");
      return;
    }
    setSelectedId(activeId);
    loadProfiles();
  }

  function onToggle(kind) {
    return (item, checked) => {
      // Taking out the last profile that holds it: say so first.
      if (!checked && (!item.alsoIn || item.alsoIn.length === 0)) {
        setConfirm({ type: "untick", kind, item });
        return;
      }
      setMembership(kind, item, checked);
    };
  }

  async function setMembership(kind, item, include) {
    setConfirm(null);
    setError(null);
    setBusyKey(String(item.id));
    const res = await profilesApi().setMembership(
      appId,
      selectedId,
      kind,
      item.id,
      include,
    );
    setBusyKey(null);
    if (!res || !res.success) {
      setError(res?.error || "Couldn't change the profile.");
      return;
    }
    // A dashboard brings its folder, so it isn't "Uncategorized" there.
    if (include && kind === "dashboards" && item.menuId != null) {
      const folder = (contents?.folders || []).find(
        (f) => String(f.id) === String(item.menuId),
      );
      if (folder && !folder.inProfile) {
        await profilesApi().setMembership(
          appId,
          selectedId,
          "folders",
          folder.id,
          true,
        );
      }
    }
    await afterChange();
  }

  async function afterChange() {
    await loadContents(selectedId);
    loadProfiles();
    // The sidebar and lists show the active profile — refresh them.
    if (selectedId === activeId && onReloadContents) onReloadContents();
  }

  // 5: everything of one kind into this profile (adding never needs asking).
  async function tickAll(kind) {
    setError(null);
    const missing = (contents?.[kind] || []).filter((i) => !i.inProfile);
    setBusyKey("all");
    for (const item of missing) {
      const res = await profilesApi().setMembership(
        appId,
        selectedId,
        kind,
        item.id,
        true,
      );
      if (!res || !res.success) {
        setError(res?.error || "Couldn't change the profile.");
        break;
      }
    }
    setBusyKey(null);
    await afterChange();
  }

  const listContent = (
    <div className="flex flex-col gap-2 p-3">
      <Button2
        title="New profile"
        onClick={() => {
          setSelectedId(null);
          openNameForm("create");
        }}
        testId="profiles-new"
      />
      <nav aria-label="Profiles" className="flex flex-col gap-0.5">
        {profiles.map((p) => {
          const counts = p.items
            ? `${plural(p.items.dashboards.length, "dashboard")} · ${plural(
                p.items.bots.length,
                "bot",
              )}`
            : null;
          return (
            <ListRow
              key={p.id}
              icon={<FontAwesomeIcon icon="user" className="h-3.5 w-3.5" />}
              title={p.name}
              meta={
                p.id === activeId
                  ? `Active${hasProfiles && counts ? ` · ${counts}` : ""}`
                  : hasProfiles
                    ? counts
                    : null
              }
              selected={p.id === selectedId && !nameForm}
              onClick={() => {
                setNameForm(null);
                setError(null);
                setSelectedId(p.id);
              }}
              testId={`profile-row-${p.id}`}
            />
          );
        })}
      </nav>
    </div>
  );

  let detailContent = null;
  if (nameForm === "create") {
    detailContent = (
      <div className="flex flex-col gap-4 p-6 overflow-y-auto">
        <SubHeading3 title="New profile" padding={false} />
        <span className={`text-sm ${muted} max-w-prose`}>
          A profile is its own set of dashboards, bots, folders and themes. It
          starts empty — choose what it holds after you create it, or use
          Duplicate on an existing profile to start from a copy. Providers and
          their keys are shared by every profile.
        </span>
        <InputText
          label="Name"
          value={nameDraft}
          onChange={setNameDraft}
          placeholder="e.g. Mac Mini"
          autoFocus
        />
        <div className="flex flex-row gap-2">
          <Button2 title="Create profile" onClick={submitName} />
          <Button3 title="Cancel" onClick={() => setNameForm(null)} />
        </div>
      </div>
    );
  } else if (selected) {
    detailContent = (
      <div className="flex flex-col gap-4 p-6 overflow-y-auto min-h-0">
        <div className="flex flex-row items-center justify-between gap-4 flex-wrap">
          {nameForm === "rename" || nameForm === "duplicate" ? (
            <div className="flex flex-row items-end gap-2 flex-1 min-w-0">
              <InputText
                label={
                  nameForm === "rename" ? "Profile name" : "Name of the copy"
                }
                value={nameDraft}
                onChange={setNameDraft}
                autoFocus
              />
              <Button2
                title={nameForm === "rename" ? "Save name" : "Duplicate"}
                onClick={submitName}
              />
              <Button3 title="Cancel" onClick={() => setNameForm(null)} />
            </div>
          ) : (
            <div className="flex flex-row items-center gap-2 min-w-0">
              <SubHeading3 title={selected.name} padding={false} />
              {isActive ? <Tag3 text="Active" /> : null}
            </div>
          )}
          {nameForm ? null : (
            <div className="flex flex-row gap-2 flex-wrap">
              {!isActive ? (
                <Button2
                  title="Switch to this profile"
                  onClick={askSwitch}
                  testId="profile-switch"
                />
              ) : null}
              <Button3
                title="Save to file…"
                onClick={() => {
                  setNotice(null);
                  setSaving(selected);
                }}
                testId="profile-save-file"
              />
              <Button3 title="Rename" onClick={() => openNameForm("rename")} />
              <Button3
                title="Duplicate"
                onClick={() => openNameForm("duplicate")}
              />
              <span
                title={
                  isDefault
                    ? "The Default profile can't be deleted."
                    : isActive
                      ? "Switch to another profile before deleting this one."
                      : undefined
                }
              >
                <Button3
                  title="Delete"
                  danger
                  disabled={isDefault || isActive}
                  onClick={() =>
                    setConfirm({ type: "delete", profile: selected })
                  }
                  testId="profile-delete"
                />
              </span>
            </div>
          )}
        </div>

        {!hasProfiles ? (
          <span className={`text-sm ${muted} max-w-prose`}>
            Default holds everything on this computer. Create another profile —
            for example, one for a computer that only runs your home dashboard —
            and you can choose what each one holds.
          </span>
        ) : contents ? (
          <>
            <span className={`text-sm ${muted} max-w-prose`}>
              Ticked items are in {selected.name}. One dashboard or bot can be
              in several profiles; unticking takes it out of this one only.
            </span>
            {KINDS.map(({ kind, title }) => (
              <ContentsGroup
                key={`${selectedId}-${kind}`}
                title={title}
                items={contents[kind] || []}
                onToggle={onToggle(kind)}
                onTickAll={() => tickAll(kind)}
                busyKey={busyKey}
                startOpen={
                  kind === "dashboards" ||
                  (contents[kind] || []).length <= SEARCH_AFTER
                }
              />
            ))}
          </>
        ) : null}
      </div>
    );
  }

  const untickNoun =
    confirm?.type === "untick"
      ? KINDS.find((k) => k.kind === confirm.kind)?.noun || "item"
      : "";

  return (
    <>
      {error ? (
        <AlertBanner variant="error" size="compact" message={error} />
      ) : null}
      {notice ? (
        <AlertBanner
          variant="success"
          size="compact"
          message={notice}
          onClose={() => setNotice(null)}
        />
      ) : null}
      <SectionLayout
        listContent={listContent}
        detailContent={detailContent}
        emptyDetailMessage="Select a profile"
      />
      {/* Inside the Settings modal: mount confirms only while open, or
          they open beneath it. */}
      {saving ? (
        <SaveProfileModal
          appId={appId}
          profile={saving}
          onClose={() => setSaving(null)}
          onSaved={(res) => {
            setSaving(null);
            const parts = String(res.filePath || "").split(/[\\/]/);
            const file = parts.pop();
            const folder = parts.pop();
            const published = (res.published || []).map((p) => {
              const n = p.dashboardsSwitched || 0;
              return `${p.publishedAs} ${p.version}${
                n
                  ? ` (${n} ${n === 1 ? "dashboard" : "dashboards"} here now use it)`
                  : ""
              }`;
            });
            setNotice(
              `Saved "${file}"${folder ? ` in ${folder}` : ""}.${
                published.length
                  ? ` Published to your account: ${published.join(", ")}.`
                  : ""
              }`,
            );
            const problems = [];
            // Ticked to publish but it didn't: it's in the file instead.
            for (const p of res.notPublished || []) {
              const reason = String(p.error || "something went wrong")
                .split("\n")[0]
                .replace(/:$/, "");
              problems.push(
                `${p.package} wasn't published, so it's in the file instead: ${reason}.`,
              );
            }
            // Widgets that should have gone in but weren't found here.
            if (res.missingWidgets && res.missingWidgets.length) {
              problems.push(
                `These widgets couldn't be found on this computer and aren't in the file: ${res.missingWidgets.join(", ")}.`,
              );
            }
            if (problems.length) setError(problems.join(" "));
            loadProfiles();
          }}
        />
      ) : null}
      {confirm?.type === "delete" ? (
        <ConfirmationModal
          isOpen
          setIsOpen={() => setConfirm(null)}
          title="Delete profile"
          message={`Delete "${confirm.profile.name}"? Its dashboards, bots, folders and themes stay on this computer — they just won't be in this profile.`}
          confirmLabel="Delete profile"
          variant="danger"
          onConfirm={doDelete}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {confirm?.type === "switch" ? (
        <ConfirmationModal
          isOpen
          setIsOpen={() => setConfirm(null)}
          title={`Switch to ${selected?.name || "this profile"}`}
          message={`${confirm.running.length} bot${
            confirm.running.length === 1 ? " is" : "s are"
          } running. Switching stops ${
            confirm.running.length === 1 ? "it" : "them"
          } unless ${
            confirm.running.length === 1 ? "it's" : "they're"
          } also in ${selected?.name || "the new profile"}.`}
          confirmLabel="Switch"
          onConfirm={doSwitch}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {confirm?.type === "untick" ? (
        <ConfirmationModal
          isOpen
          setIsOpen={() => setConfirm(null)}
          title={`Take "${confirm.item.name}" out of ${selected?.name}`}
          message={`This ${untickNoun} isn't in any other profile, so it won't show anywhere. It stays on this computer, and you can tick it again here any time.`}
          confirmLabel="Take it out"
          onConfirm={() => setMembership(confirm.kind, confirm.item, false)}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
};
