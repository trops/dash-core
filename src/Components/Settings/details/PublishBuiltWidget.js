import React, { useCallback, useEffect, useState } from "react";
import {
  AlertBanner,
  Button,
  Button2,
  Checkbox,
  RadioGroup,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { useRegistryAuthGate } from "../../../hooks/useRegistryAuthGate";

/** What publishing did, in a sentence or two. */
export function publishedText(res, packageName = null) {
  const name = `${res.publishedAs}${res.version ? ` ${res.version}` : ""}`;
  let text = `Published ${name} to your account (${
    res.visibility === "public" ? "public" : "private"
  }).`;
  const n = res.dashboardsSwitched || 0;
  if (n) {
    text += ` ${n === 1 ? "1 dashboard uses" : `${n} dashboards use`} it now.`;
  }
  if (packageName && res.publishedAs && res.publishedAs !== packageName) {
    text += ` ${packageName} stays installed — remove it from Widgets when you're ready.`;
  }
  return text;
}

/**
 * The Widget Builder's prompt after Install (dash-profiles v3): publish the
 * widget just built. Widgets are the only items a profile lists by
 * version, so publishing is how a widget gets to the user's other
 * computers. Private by default; a widget already public stays public
 * (making a package private hides every version, so that's the Widgets
 * page's job). The version is picked for them; an AI-built widget becomes
 * theirs and their dashboards switch to it.
 *
 * `onPublished(res)` after a publish (the Builder places the published
 * widget instead of the AI-built one).
 */
export const PublishBuiltWidget = ({ appId, packageName, onPublished }) => {
  const { muted, hairline } = useConfigTokens();
  const { ensureAuthed, authGate, isAuthGateOpen } = useRegistryAuthGate();
  const [plan, setPlan] = useState(null);
  const [reload, setReload] = useState(0);
  const [visibility, setVisibility] = useState("private");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // Files that mention this computer's folders: shown, then confirmed.
  const [findings, setFindings] = useState(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    let alive = true;
    setPlan(null);
    Promise.resolve(
      window.mainApi?.profiles?.planBuiltPublish?.(appId, packageName),
    )
      .then((res) => {
        if (!alive) return;
        setPlan(res || { success: false });
        if (res && res.success) setVisibility(res.visibility || "private");
      })
      .catch(() => alive && setPlan({ success: false }));
    return () => {
      alive = false;
    };
  }, [appId, packageName, reload]);

  const signIn = useCallback(async () => {
    const ok = await ensureAuthed({
      message: "Sign in to the registry to publish this widget.",
    });
    if (ok) setReload((n) => n + 1);
  }, [ensureAuthed]);

  const alreadyPublic = !!(plan && plan.exists && plan.visibility === "public");

  async function publish() {
    if (busy) return;
    if (findings && !confirmed) {
      setError('Tick "Publish anyway" to publish it with those files.');
      return;
    }
    setBusy(true);
    setError(null);
    let res;
    try {
      res = await window.mainApi?.profiles?.publishBuilt?.(appId, packageName, {
        visibility: alreadyPublic ? "public" : visibility,
        confirmPersonalPaths: confirmed,
      });
    } catch (e) {
      res = { success: false, error: e?.message };
    } finally {
      setBusy(false);
    }
    if (res && (res.success || res.published)) {
      // Published — even when installing it here failed (said below):
      // publishing again would only add another version.
      setFindings(null);
      setResult(res);
      if (!res.success) setError(res.error || null);
      if (res.dashboardsSwitched) {
        // Dashboards here now use the published widget: re-read them.
        window.dispatchEvent(new Event("dash:workspaces-changed"));
      }
      if (onPublished) onPublished(res);
      return;
    }
    if (res && res.status === "needs-confirmation") {
      setFindings(res.findings || []);
      return;
    }
    setError(res?.error || "Couldn't publish the widget.");
  }

  // Someone else's widget, or the plan failed quietly: nothing to offer.
  if (plan && plan.success && !plan.publishable && !plan.reason) return null;
  if (plan && plan.success && !plan.publishable && plan.why === "not-yours") {
    return null;
  }
  if (plan && !plan.success && !plan.signInRequired) return null;

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border p-4 max-w-md text-sm text-left ${hairline}`}
      data-testid="publish-built-widget"
    >
      {result ? (
        <span data-testid="publish-built-done">
          {publishedText(result, packageName)}
        </span>
      ) : (
        <>
          <span>
            Publish it? Publishing is how it gets to your other computers, and
            to anyone you share it with.
          </span>
          {!plan ? (
            <span className={muted}>Checking your account…</span>
          ) : plan.signInRequired ? (
            <div className="self-start">
              <Button2 title="Sign in to publish" size="sm" onClick={signIn} />
            </div>
          ) : !plan.publishable ? (
            <span className={muted} data-testid="publish-built-why">
              {plan.reason}
            </span>
          ) : (
            <>
              {alreadyPublic ? (
                <span className={muted} data-testid="publish-built-public">
                  It's public, so this version will be too. To make it private,
                  use the Widgets page — that hides every version, including
                  from people who installed it.
                </span>
              ) : (
                <>
                  <RadioGroup
                    label="Who can install it"
                    name="publish-built-visibility"
                    value={visibility}
                    onChange={setVisibility}
                    options={[
                      { value: "private", label: "Private — only you" },
                      {
                        value: "public",
                        label: "Public — anyone can install it",
                      },
                    ]}
                  />
                  {visibility === "public" ? (
                    <span className={muted}>
                      Anyone can find and install it. Each version you publish
                      stays in the registry.
                    </span>
                  ) : null}
                </>
              )}
              {plan.exists && plan.publishAs !== packageName ? (
                <span className={muted} data-testid="publish-built-exists">
                  {`Publishes as a new version of ${plan.publishAs}, already in your account.`}
                </span>
              ) : null}
              {findings ? (
                <div
                  className="flex flex-col gap-1"
                  data-testid="publish-built-paths"
                >
                  <span>Its files mention folders on this computer:</span>
                  {findings.slice(0, 5).map((f, n) => (
                    <span key={n} className={muted}>
                      {f.file || f.path}
                      {f.match ? `: ${f.match}` : ""}
                    </span>
                  ))}
                  <Checkbox
                    label="Publish anyway"
                    checked={confirmed}
                    onChange={(on) => {
                      setConfirmed(on);
                      setError(null);
                    }}
                  />
                </div>
              ) : null}
              <div className="self-start">
                <Button
                  title={busy ? "Publishing…" : "Publish to my account"}
                  size="sm"
                  onClick={publish}
                />
              </div>
            </>
          )}
        </>
      )}
      {error ? (
        <AlertBanner variant="error" size="compact" message={error} />
      ) : null}
      {/* Mounted only while open: a nested dialog opens beneath its Modal. */}
      {isAuthGateOpen ? authGate : null}
    </div>
  );
};
