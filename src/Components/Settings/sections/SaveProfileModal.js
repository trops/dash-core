import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AlertBanner,
  Button2,
  Button3,
  Button,
  Checkbox,
  Modal,
  ProgressBar,
  Switch,
  ThemeContext,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { useRegistryAuthGate } from "../../../hooks/useRegistryAuthGate";

const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** What the profile holds, e.g. "2 dashboards · 1 bot · 4 widgets". */
export function countsText(counts = {}) {
  return [
    plural(counts.dashboards || 0, "dashboard"),
    counts.bots ? plural(counts.bots, "bot") : null,
    counts.themes ? plural(counts.themes, "theme") : null,
    plural(counts.widgets || 0, "widget"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** When and where a profile was last saved, e.g. "on Mac Mini, Oct 27, 9:00 AM". */
export function savedWhenText({ updatedOn, updatedAt, savedAt } = {}) {
  const at = updatedAt || savedAt;
  const when = at
    ? new Date(at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  return [updatedOn ? `on ${updatedOn}` : null, when]
    .filter(Boolean)
    .join(", ");
}

/** Why a save to the account was refused, in a sentence. */
export function conflictText(conflict) {
  if (conflict.missing) {
    return "This profile isn't in your account any more. Save again to add it back as a new profile.";
  }
  const where = savedWhenText(conflict);
  return `Your account has a newer copy of this profile${
    where ? `, saved ${where}` : ""
  }. Load it from your account to use it here, or replace it with this computer's.`;
}

/** The "Saved" notice for the Profiles screen. */
export function savedNoticeText(res) {
  let text;
  if (res.account) {
    text = "Saved to your account.";
  } else {
    const parts = String(res.filePath || "").split(/[\\/]/);
    const file = parts.pop();
    const folder = parts.pop();
    text = `Saved "${file}"${folder ? ` in ${folder}` : ""}.`;
  }
  const published = (res.publishedWidgets || []).length;
  if (published) {
    text += ` Published ${plural(published, "widget")} first.`;
  }
  const unpublished = (res.unpublished || []).length;
  if (unpublished) {
    text += ` ${plural(unpublished, "widget")} went in at the version you last published.`;
  }
  if (res.secretsLeftOut) {
    text += ` ${plural(res.secretsLeftOut, "key")} typed into widgets ${
      res.secretsLeftOut === 1 ? "isn't" : "aren't"
    } included.`;
  }
  return text;
}

/** Items left out, said once the dialog has closed. */
export function leftOutText(res) {
  const list = res.leftOut || [];
  if (!list.length) return null;
  return `Not in the profile: ${list
    .map((l) => `${l.name} — ${String(l.reason || "").replace(/\.$/, "")}`)
    .join("; ")}.`;
}

/** A widget's short status in the list, e.g. "Not in the registry · used by Home". */
export function widgetStatusText(w) {
  if (!w.publishable) return w.note || "";
  const parts =
    w.action === "unpublished"
      ? [
          "Changes here not published",
          w.version ? `the profile has ${w.version}` : null,
        ]
      : [
          "Not in the registry",
          (w.dashboards || []).length
            ? `used by ${w.dashboards.join(", ")}`
            : "not on a dashboard",
        ];
  if (w.published) parts.push(`published as ${w.visibility || "private"}`);
  return parts.filter(Boolean).join(" · ");
}

/**
 * After a save with something left to publish, e.g. "9 published · 1 didn't ·
 * 2 need a look — these still show as missing on the other computer."
 */
export function savedSummaryText({
  published = 0,
  failed = 0,
  notYet = 0,
  needsLook = 0,
}) {
  const done = published ? `${published} published` : null;
  const left = [
    failed ? `${failed} didn't` : null,
    notYet ? `${notYet} not published yet` : null,
    needsLook
      ? `${needsLook} ${needsLook === 1 ? "needs" : "need"} a look`
      : null,
  ].filter(Boolean);
  if (!left.length) return done ? `${done}.` : "";
  const n = failed + notYet + needsLook;
  return `${[done, ...left].filter(Boolean).join(" · ")} — ${
    n === 1 ? "it still shows" : "these still show"
  } as missing on the other computer.`;
}

/** "algolia-search 1.0.0 private, … and 4 more" — what was just published. */
export function publishedText(list) {
  const shown = list
    .slice(0, 5)
    .map((p) =>
      [p.publishedAs || p.package, p.version, p.visibility]
        .filter(Boolean)
        .join(" "),
    );
  const more = list.length - shown.length;
  return `Published: ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}.`;
}

/**
 * Save a profile (dash-profiles v3): the setup — dashboards, folders,
 * themes, bots, app settings — goes in as it is, and each widget by the
 * version the registry has.
 *
 * Bulk publish: the user's own widgets the registry doesn't have (or not as
 * they are here) are listed with a checkbox — all checked — and their own
 * Private/Public switch. The one button publishes the checked ones, then
 * saves ("Publish 12 widgets and save"); with none checked it only saves,
 * and says what the other computer will miss. What didn't publish stays
 * checked, and the dialog stays open after the save to try again.
 *
 * Mounted only while open (it opens inside the Settings modal).
 */
export const SaveProfileModal = ({
  appId,
  profile,
  onClose,
  onSaved,
  // "file" (a .dashprofile) or "account" (kept in the registry account).
  to = "file",
  // Opened to replace the account's newer copy ("keep this computer's",
  // from the updates dialog): the revision that copy has.
  replaceRevision: replaceInitially = null,
}) => {
  const toAccount = to === "account";
  const { muted, strong, hairline } = useConfigTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const style = (key) =>
    getStylesForItem(key, currentTheme, { scrollable: false, grow: false }) ||
    {};
  const panelStyles = style(themeObjects.PANEL);
  const headerStyles = style(themeObjects.PANEL_HEADER);
  const footerStyles = style(themeObjects.SETTINGS_MODAL_FOOTER);
  const { ensureAuthed, authGate, isAuthGateOpen } = useRegistryAuthGate();
  const [options, setOptions] = useState({ bots: true, settings: true });
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // The widgets to publish (all of them, once the plan first arrives), and
  // each one's Private/Public choice.
  const [selected, setSelected] = useState(null);
  const [visibility, setVisibility] = useState({});
  // The publish run: { index, total, current }; Stop asked.
  const [run, setRun] = useState(null);
  const [stopping, setStopping] = useState(false);
  // How each widget's publish went in this dialog, by package.
  const [outcomes, setOutcomes] = useState({});
  // Widgets whose files mention this computer's folders: "Publish anyway".
  const [confirmed, setConfirmed] = useState(() => new Set());
  // Saved, with something left to publish: the dialog stays open.
  const [savedRes, setSavedRes] = useState(null);
  const [reload, setReload] = useState(0);
  // Published, then the file save was cancelled: said in the dialog.
  const [notSaved, setNotSaved] = useState(false);
  // 7. Closed mid-run (e.g. Settings closed from outside): the run stops.
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (running.current) {
        Promise.resolve(
          window.mainApi?.profiles?.stopPublishing?.(appId, profile.id),
        ).catch(() => {});
      }
    };
  }, [appId, profile.id]);
  // The account copy was removed: the next save adds it as new.
  const [asNew, setAsNew] = useState(false);
  // The newer account revision the user may choose to replace ("keep this
  // computer's") — set when a save was refused.
  const [replaceRevision, setReplaceRevision] = useState(replaceInitially);

  useEffect(() => {
    let alive = true;
    setPlan(null);
    Promise.resolve(
      window.mainApi?.profiles?.previewSave?.(appId, profile.id, options),
    )
      .then((res) => {
        if (!alive) return;
        if (res && res.success) setPlan(res);
        else setError(res?.error || "Couldn't read this profile.");
      })
      .catch(
        (e) => alive && setError(e?.message || "Couldn't read this profile."),
      );
    return () => {
      alive = false;
    };
  }, [appId, profile.id, options, reload]);

  const signIn = useCallback(async () => {
    const ok = await ensureAuthed({
      message: "Sign in to the registry to save this profile to your account.",
    });
    if (ok) setReload((n) => n + 1);
  }, [ensureAuthed]);

  const widgets = (plan && plan.widgets) || [];
  const attention = widgets.filter(
    (w) => w.action === "unpublished" || w.action === "not-in-registry",
  );
  const listed = widgets.filter((w) => w.action === "listed");
  const needsLook = attention.filter(
    (w) => outcomes[w.package]?.status === "needs-confirmation",
  );
  const toCheck = attention.filter(
    (w) => outcomes[w.package]?.status !== "needs-confirmation",
  );
  const publishable = toCheck.filter((w) => w.publishable);

  // Each widget is checked the first time it's offered (bulk publish) —
  // also one offered only after signing in, or after changing the options.
  const offered = useRef(new Set());
  const offerKey = publishable.map((w) => w.package).join("\n");
  useEffect(() => {
    if (!plan) return;
    const fresh = publishable
      .map((w) => w.package)
      .filter((p) => !offered.current.has(p));
    if (!fresh.length && selected !== null) return;
    for (const p of fresh) offered.current.add(p);
    setSelected((prev) => new Set([...(prev || []), ...fresh]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, offerKey]);

  const isSelected = (pkg) => !!selected && selected.has(pkg);
  const visOf = (w) =>
    visibility[w.package] || (w.visibility === "public" ? "public" : "private");
  const queue = [
    ...publishable.filter((w) => isSelected(w.package)),
    ...needsLook.filter((w) => confirmed.has(w.package)),
  ];
  const publicCount = queue.filter((w) => visOf(w) === "public").length;

  const needsSignIn = toAccount && plan && !plan.username;
  const blockers = (plan && plan.blockers) || [];
  const busy = saving || !!run;

  const toggle = (pkg, on) => {
    const next = new Set(selected || []);
    if (on) next.add(pkg);
    else next.delete(pkg);
    setSelected(next);
  };
  const setAll = (value) => {
    if (busy) return;
    const next = { ...visibility };
    for (const w of [...publishable, ...needsLook]) next[w.package] = value;
    setVisibility(next);
  };

  /** Publish the checked widgets, one run; what's left stays checked. */
  async function publishAll(list) {
    const api = window.mainApi?.profiles;
    const pkgs = list.map((w) => w.package);
    const vis = {};
    for (const w of list) vis[w.package] = visOf(w);
    const record = {};
    const note = (raw) => {
      if (!raw || !raw.package) return;
      // Published, but installing it here failed: it is published (trying
      // again would publish it twice); the reason stays as a warning.
      const entry =
        raw.status === "failed" && raw.published
          ? { ...raw, status: "published", warning: raw.error }
          : raw;
      record[entry.package] = entry;
      setOutcomes((prev) => ({ ...prev, [entry.package]: entry }));
    };
    setRun({ index: 0, total: pkgs.length, current: pkgs[0] });
    running.current = true;
    const off = api?.onPublishProgress?.((p) => {
      if (!p) return;
      if (p.status === "publishing") {
        setRun({ index: p.index, total: p.total, current: p.package });
      } else {
        note(p.result);
      }
    });
    let res;
    try {
      res = await api?.publishWidget?.(appId, profile.id, pkgs, {
        visibility: vis,
        confirmPersonalPaths: pkgs.filter((p) => confirmed.has(p)),
      });
    } catch (e) {
      res = { success: false, error: e?.message };
    } finally {
      if (typeof off === "function") off();
      running.current = false;
      if (alive.current) {
        setRun(null);
        setStopping(false);
      }
    }
    if (!alive.current) return { record, stopped: true, pkgs, failed: true };
    for (const entry of (res && res.results) || []) note(entry);
    // 4. The whole call failed (signed out, an error): every widget says
    // why, and nothing is saved.
    const failed = !res || res.success === false;
    if (failed) {
      const why = (res && res.error) || "Publishing didn't start.";
      for (const pkg of pkgs) {
        if (!record[pkg]) note({ package: pkg, status: "failed", error: why });
      }
      setError(why);
    }
    // Published ones leave the list; ones to look at move to their section;
    // what failed stays checked (also one confirmed before).
    const next = new Set(selected || []);
    for (const pkg of pkgs) {
      const status = record[pkg]?.status;
      if (status === "published" || status === "needs-confirmation") {
        next.delete(pkg);
      } else if (status === "failed") {
        next.add(pkg);
      }
    }
    setSelected(next);
    setConfirmed((prev) => {
      const after = new Set(prev);
      for (const pkg of pkgs) {
        if (record[pkg]?.status === "published") after.delete(pkg);
      }
      return after;
    });
    return { record, stopped: !!(res && res.stopped), pkgs, failed };
  }

  async function stop() {
    if (!run || stopping) return;
    setStopping(true);
    try {
      await window.mainApi?.profiles?.stopPublishing?.(appId, profile.id);
    } catch (_e) {
      // It finishes the run instead.
    }
  }

  async function writeSave() {
    const api = window.mainApi?.profiles;
    try {
      return toAccount
        ? await api?.saveToAccount?.(appId, profile.id, {
            ...options,
            asNew,
            replaceRevision,
          })
        : await api?.saveFile?.(appId, profile.id, options);
    } catch (e) {
      return { success: false, error: e?.message };
    }
  }

  async function go() {
    if (busy || !plan || needsSignIn || blockers.length) return;
    // Saved already and nothing checked: done.
    if (savedRes && !queue.length) {
      onSaved(savedRes);
      return;
    }
    setError(null);
    setNotSaved(false);
    let left = false;
    let fresh = {};
    if (queue.length) {
      const { record, stopped, pkgs, failed } = await publishAll(queue);
      if (failed) return;
      fresh = record;
      left =
        stopped ||
        pkgs.some((p) => !record[p] || record[p].status !== "published");
    }
    setSaving(true);
    const res = await writeSave();
    setSaving(false);
    const published = Object.values({ ...outcomes, ...fresh }).filter(
      (o) => o.status === "published",
    );
    if (res && res.success) {
      setAsNew(false);
      setReplaceRevision(null);
      const withPublished = { ...res, publishedWidgets: published };
      if (left || needsLook.some((w) => !confirmed.has(w.package))) {
        setSavedRes(withPublished);
        setReload((n) => n + 1);
        return;
      }
      onSaved(withPublished);
      return;
    }
    setReload((n) => n + 1);
    if (res && res.canceled) {
      if (published.length) setNotSaved(true);
      return;
    }
    if (res && res.conflict) {
      if (res.conflict.missing) setAsNew(true);
      else setReplaceRevision(res.conflict.revision);
      setError(conflictText(res.conflict));
      return;
    }
    setError(res?.error || "Couldn't save the profile.");
  }

  const option = (key, label) => (
    <Checkbox
      label={label}
      checked={options[key]}
      disabled={busy}
      onChange={(checked) => {
        setError(null);
        setOptions({ ...options, [key]: checked });
      }}
    />
  );
  const saveWord = toAccount ? "save" : "save…";
  // The dialog's button says what it will do (it can't be disabled).
  const confirmLabel = saving
    ? "Saving…"
    : run
      ? "Publishing…"
      : !plan
        ? "Checking…"
        : needsSignIn
          ? "Sign in first"
          : blockers.length
            ? "Fix the items above first"
            : queue.length
              ? `Publish ${plural(queue.length, "widget")} and ${
                  toAccount && asNew
                    ? "save as new"
                    : toAccount && replaceRevision != null
                      ? "replace the account's copy"
                      : saveWord
                }`
              : savedRes
                ? "Done"
                : toAccount
                  ? asNew
                    ? "Save as new to my account"
                    : replaceRevision != null
                      ? "Replace the account's copy"
                      : "Save to my account"
                  : "Save…";
  const close = () => {
    if (busy) return;
    if (savedRes) onSaved(savedRes);
    else onClose();
  };

  const publishedList = Object.values(outcomes).filter(
    (o) => o.status === "published",
  );
  const failedCount = Object.values(outcomes).filter(
    (o) => o.status === "failed",
  ).length;
  // Checked, not tried yet (after Stop).
  const notYet = toCheck.filter(
    (w) => w.publishable && isSelected(w.package) && !outcomes[w.package],
  ).length;
  const visSwitch = (w) => (
    <div className="flex flex-row items-center gap-2 shrink-0">
      <span className={visOf(w) === "public" ? strong : muted}>
        {visOf(w) === "public" ? "Public" : "Private"}
      </span>
      <Switch
        ariaLabel={`Public: ${w.package}`}
        checked={visOf(w) === "public"}
        onChange={(on) => {
          if (busy) return;
          setVisibility({
            ...visibility,
            [w.package]: on ? "public" : "private",
          });
        }}
      />
    </div>
  );

  return (
    <>
      <Modal
        isOpen
        // Not closed while publishing or saving (it would go on unseen).
        setIsOpen={close}
        // Wide enough for a row per widget with its switch (bulk publish).
        width="w-full max-w-2xl"
        height={toCheck.length || needsLook.length ? "h-5/6" : "h-auto"}
      >
        <div
          // Raised above the dimmed page, like dash-react's dialogs.
          className={`dr-modal-surface flex flex-col h-full rounded-lg overflow-clip border ${panelStyles.backgroundColor || ""} ${panelStyles.borderColor || ""}`}
        >
          <div
            className={`flex flex-row items-center p-4 border-b ${headerStyles.borderColor || ""} ${headerStyles.textColor || ""}`}
          >
            <span className="text-lg font-semibold">
              {toAccount
                ? `Save ${profile.name} to your account`
                : `Save ${profile.name}`}
            </span>
          </div>
          <div
            className={`flex-1 min-h-0 flex flex-col gap-4 p-4 text-sm overflow-y-auto ${strong}`}
            data-testid="save-profile"
          >
            <span className={`${muted} max-w-prose`}>
              {toAccount
                ? "Your setup — dashboards, folders, themes, bots and settings — is kept in your registry account as it is, with each widget by the version the registry has. Sign in on another computer and load it from your account to get the same setup. Keys and passwords typed into widgets are left out."
                : "Your setup — dashboards, folders, themes, bots and settings — goes in the file as it is, with each widget by the version the registry has. Load the file on another computer to get the same setup. Keys and passwords typed into widgets are left out."}
            </span>

            {needsSignIn ? (
              <div className="flex flex-col gap-2" data-testid="save-sign-in">
                <span>
                  Sign in to the registry to keep this profile in your account.
                </span>
                <div className="self-start">
                  <Button2 title="Sign in" size="sm" onClick={signIn} />
                </div>
              </div>
            ) : null}

            {savedRes ? (
              <AlertBanner
                variant="success"
                size="compact"
                message={`${toAccount ? "Saved to your account" : "Saved"}${
                  publishedList.length
                    ? `, with the ${plural(publishedList.length, "widget")} just published`
                    : ""
                }.`}
              />
            ) : null}

            {plan ? (
              <span data-testid="save-profile-counts">
                {countsText(plan.counts)}
              </span>
            ) : !error ? (
              <span className={muted}>Checking what goes in…</span>
            ) : null}

            <div className="flex flex-col gap-2">
              {option("bots", "Bots")}
              {option("settings", "App settings (theme, update check)")}
            </div>

            {blockers.length ? (
              <div className="flex flex-col gap-1" data-testid="save-blockers">
                <AlertBanner
                  variant="error"
                  size="compact"
                  message="Fix these before saving:"
                />
                {blockers.map((b) => (
                  <span key={b.key}>{`${b.name}: ${b.reason}`}</span>
                ))}
              </div>
            ) : null}

            {toCheck.length || needsLook.length ? (
              <div
                className={`flex flex-col gap-3 rounded-lg border p-3 ${hairline}`}
                data-testid="save-widgets"
              >
                <span className="font-medium">Widgets to publish</span>
                {run ? (
                  <div className="flex flex-col gap-2" data-testid="save-run">
                    <span>
                      {`Publishing ${run.index + 1} of ${run.total} — ${run.current} · then saving`}
                    </span>
                    <ProgressBar
                      size="sm"
                      value={(run.index / Math.max(1, run.total)) * 100}
                    />
                  </div>
                ) : savedRes ? (
                  <span data-testid="save-summary">
                    {savedSummaryText({
                      published: publishedList.length,
                      failed: failedCount,
                      notYet,
                      needsLook: needsLook.length,
                    })}
                  </span>
                ) : (
                  <span className={`${muted} max-w-prose`}>
                    {`${plural(toCheck.length, "widget")} ${
                      toCheck.length === 1 ? "isn't" : "aren't"
                    } in the registry as ${
                      toCheck.length === 1 ? "it is" : "they are"
                    } here — the other computer shows ${
                      toCheck.length === 1 ? "it" : "them"
                    } as missing until ${
                      toCheck.length === 1 ? "it's" : "they're"
                    } published.`}
                  </span>
                )}
                {publishable.length > 1 && !run && toCheck.length ? (
                  <div
                    className="flex flex-row flex-wrap items-center gap-2"
                    data-testid="save-bulk-tools"
                  >
                    <Button3
                      title="Select all"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        !busy &&
                        setSelected(new Set(publishable.map((w) => w.package)))
                      }
                    />
                    <Button3
                      title="Clear"
                      size="sm"
                      disabled={busy}
                      onClick={() => !busy && setSelected(new Set())}
                    />
                    <span className={muted}>
                      {`${publishable.filter((w) => isSelected(w.package)).length} of ${publishable.length} selected`}
                    </span>
                    <span className="flex-1" />
                    <span className={muted}>Set all:</span>
                    <Button3
                      title="Private"
                      size="sm"
                      ariaLabel="Set all private"
                      disabled={busy}
                      onClick={() => setAll("private")}
                    />
                    <Button3
                      title="Public"
                      size="sm"
                      ariaLabel="Set all public"
                      disabled={busy}
                      onClick={() => setAll("public")}
                    />
                  </div>
                ) : null}
                {publishable.length && !run && !savedRes && toCheck.length ? (
                  <span className={`${muted} max-w-prose`}>
                    New widgets start private. Ones already published start as
                    they are — change any of them here.
                  </span>
                ) : null}
                <div className="flex flex-col">
                  {toCheck.map((w) => {
                    const out = outcomes[w.package];
                    const running = run && run.current === w.package;
                    const failed = out && out.status === "failed";
                    return (
                      <div
                        key={w.package}
                        className={`flex flex-row items-start gap-3 py-2 border-b ${hairline}`}
                        data-testid={`save-widget-${w.package}`}
                      >
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                          {w.publishable ? (
                            <Checkbox
                              label={w.package}
                              checked={isSelected(w.package)}
                              disabled={busy}
                              onChange={(on) => toggle(w.package, on)}
                            />
                          ) : (
                            <span>{w.package}</span>
                          )}
                          <span
                            className={`${failed ? "text-red-400" : muted} max-w-prose`}
                          >
                            {running
                              ? "Publishing…"
                              : failed
                                ? `Didn't publish — ${out.error || "the registry refused it"}`
                                : out && out.status === "published"
                                  ? out.warning
                                    ? `Published as ${out.publishedAs || w.package} ${out.version || ""} — ${out.warning}`
                                    : `Published as ${out.publishedAs || w.package} ${out.version || ""}`
                                  : widgetStatusText(w)}
                          </span>
                        </div>
                        {w.publishable ? visSwitch(w) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : plan && !blockers.length ? (
              <span data-testid="save-all-listed">
                ✓ Every widget is in the registry as it is here — the other
                computer gets them all.
              </span>
            ) : null}

            {needsLook.length ? (
              <div
                className={`flex flex-col gap-3 rounded-lg border p-3 ${hairline}`}
                data-testid="save-confirm-paths"
              >
                <span className="font-medium">
                  {`${plural(needsLook.length, "widget")} ${
                    needsLook.length === 1 ? "mentions" : "mention"
                  } folders on this computer`}
                </span>
                {needsLook.map((w) => (
                  <div
                    key={w.package}
                    className="flex flex-row items-start gap-3"
                    data-testid={`save-look-${w.package}`}
                  >
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                      <span>{w.package}</span>
                      {(outcomes[w.package].findings || [])
                        .slice(0, 3)
                        .map((f, n) => (
                          <span key={n} className={muted}>
                            {f.file || f.path}
                            {f.match ? `: ${f.match}` : ""}
                          </span>
                        ))}
                      <Checkbox
                        label="Publish anyway"
                        checked={confirmed.has(w.package)}
                        disabled={busy}
                        onChange={(on) => {
                          const next = new Set(confirmed);
                          if (on) next.add(w.package);
                          else next.delete(w.package);
                          setConfirmed(next);
                        }}
                      />
                    </div>
                    {visSwitch(w)}
                  </div>
                ))}
                <span className={muted}>
                  Check each one — tick “Publish anyway” to publish it as it is.
                </span>
              </div>
            ) : null}

            {listed.length ? (
              <span className={muted} data-testid="save-listed">
                {`In the registry already: ${plural(listed.length, "widget")}.`}
              </span>
            ) : null}

            {publishedList.length ? (
              <span data-testid="save-published">
                {publishedText(publishedList)}
              </span>
            ) : null}

            {plan && plan.secretsLeftOut ? (
              <span className={`${muted} max-w-prose`}>
                {plan.secretsLeftOut === 1
                  ? "1 key typed into a widget isn't included"
                  : `${plan.secretsLeftOut} keys typed into widgets aren't included`}{" "}
                — the other computer asks for{" "}
                {plan.secretsLeftOut === 1 ? "it" : "them"}.
              </span>
            ) : null}

            {notSaved ? (
              <AlertBanner
                variant="warning"
                size="compact"
                message={`Published ${plural(publishedList.length, "widget")} — the profile isn't saved yet.`}
              />
            ) : null}
            {!error && replaceRevision != null ? (
              <AlertBanner
                variant="warning"
                size="compact"
                message="Your account has a newer copy of this profile. Saving replaces it with this computer's."
              />
            ) : null}
            {error ? (
              <AlertBanner variant="error" size="compact" message={error} />
            ) : null}
          </div>
          <div
            // The footer shares the dialog's surface; what the button will
            // do is said beside it.
            className={`flex flex-row items-center gap-3 px-4 py-3 border-t ${footerStyles.borderColor || ""}`}
          >
            <div className="flex-1 min-w-0 text-sm">
              {run ? (
                <span className={muted}>
                  {stopping
                    ? "Stopping after this widget, then saving with what's published."
                    : "Stop finishes this widget, then saves with what's published. The rest stay checked."}
                </span>
              ) : plan && !needsSignIn && !blockers.length ? (
                queue.length ? (
                  <span className={muted} data-testid="save-what">
                    {`Publishes the ${plural(queue.length, "checked widget")} (${[
                      queue.length - publicCount
                        ? `${queue.length - publicCount} private`
                        : null,
                      publicCount ? `${publicCount} public` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}), then saves.`}
                  </span>
                ) : toCheck.length && !savedRes ? (
                  <AlertBanner
                    variant="warning"
                    size="compact"
                    message={`Saves without publishing — ${plural(
                      toCheck.length,
                      "widget",
                    )} will show as missing on the other computer.`}
                  />
                ) : null
              ) : null}
            </div>
            {run ? (
              <Button2 title={stopping ? "Stopping…" : "Stop"} onClick={stop} />
            ) : (
              <Button2 title={savedRes ? "Close" : "Cancel"} onClick={close} />
            )}
            <Button title={confirmLabel} onClick={go} />
          </div>
        </div>
      </Modal>
      {/* Mounted only while open: a nested dialog opens beneath its Modal. */}
      {isAuthGateOpen ? authGate : null}
    </>
  );
};
