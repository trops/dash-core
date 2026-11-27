import React, { useEffect, useState } from "react";
import {
  Button,
  Button3,
  RadioGroup,
  SelectInput,
  TextArea,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { WHO, newCheck } from "./checksView";

/**
 * AddCheckScreen (DASH-110) — adding a check to a bot, in its checks
 * window:
 *
 *   1. Who decides: automatic (the default), a bot reviews, or you approve.
 *   2. Suggested checks for this bot, labelled In repo, Built in, Ships
 *      with Dash or Registry. One click adds one, inputs filled from the
 *      team's settings.
 *   3. Describe it: the team's lead drafts a .dash/checks file. It shows a
 *      plain summary and the code. Try it must pass on the bot's last run
 *      and fail, saying why, on a bad sample before it can be saved.
 *   4. Save it to the repo (by a PR; the team's copy runs until it's
 *      merged), or for this team only.
 */

const botsApi = () =>
  (typeof window !== "undefined" && window.mainApi && window.mainApi.bots) ||
  null;

export const SOURCE_LABELS = {
  repo: "In repo",
  "built-in": "Built in",
  dash: "Ships with Dash",
  registry: "Registry",
};

// Who decides (DASH-127): the same choices as the checks window's.
export const WHO_OPTIONS = WHO.map(({ value, label }) => ({ value, label }));

/** Can this draft be saved? Only once Try it passed on it, as it is now. */
export function canSave(draft, tried) {
  return !!(draft && tried && tried.ok && tried.for === draft.code);
}

/**
 * @param {boolean} [canReview]  another bot on the team can review (else
 *   "A bot reviews" isn't offered: it's you)
 */
export const AddCheckScreen = ({ bot, onAdd, onCancel, canReview = true }) => {
  const whoOptions = canReview
    ? WHO_OPTIONS
    : WHO_OPTIONS.filter((o) => o.value !== "reviewer");
  const { muted, hairline, fieldBg, strong } = useConfigTokens();
  const [who, setWho] = useState("rule");
  const [suggested, setSuggested] = useState(null);
  const [repos, setRepos] = useState([]);
  const [ask, setAsk] = useState("");
  const [draft, setDraft] = useState(null);
  const [tried, setTried] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [where, setWhere] = useState("repo");
  const [repo, setRepo] = useState("");

  useEffect(() => {
    const api = botsApi();
    if (!api || !api.suggestChecks || !bot) {
      setSuggested([]);
      return;
    }
    Promise.resolve(api.suggestChecks(bot.id))
      .then((r) => {
        setSuggested((r && r.suggestions) || []);
        const rs = (r && r.repos) || [];
        setRepos(rs);
        if (rs.length) setRepo(rs[0].key);
        if (!rs.length) setWhere("team");
      })
      .catch(() => setSuggested([]));
  }, [bot && bot.id]);

  const run = async (what, fn) => {
    setBusy(what);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e && e.message) || String(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const draftIt = () =>
    run("draft", async () => {
      const r = await botsApi().draftCheck(bot.id, ask);
      if (r && r.error) throw new Error(r.error);
      setDraft(r);
      setTried(null);
    });

  const tryIt = () =>
    run("try", async () => {
      const r = await botsApi().tryCheck(bot.id, draft);
      if (r && r.error) throw new Error(r.error);
      setTried({ ...r, for: draft.code });
    });

  const save = () =>
    run("save", async () => {
      const r = await botsApi().saveCheck(bot.id, {
        draft,
        where,
        repo: where === "repo" ? repo : null,
        addStep: false,
      });
      if (r && r.error) throw new Error(r.error);
      onAdd(r.step);
    });

  if (who !== "rule") {
    return (
      <div className="flex flex-col gap-3" data-testid="add-check-screen">
        <RadioGroup value={who} onChange={setWho} options={whoOptions} />
        <div className="flex flex-row gap-2">
          <Button
            title="Add it"
            size="sm"
            onClick={() => onAdd(newCheck(who))}
          />
          <Button3 title="Cancel" size="sm" onClick={onCancel} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="add-check-screen">
      <RadioGroup value={who} onChange={setWho} options={whoOptions} />

      <div className="flex flex-col gap-2" data-testid="suggested-checks">
        <span className={`text-sm font-semibold ${strong}`}>
          Suggested for {bot.name}
        </span>
        {suggested === null ? (
          <span className={`text-xs ${muted}`}>Looking…</span>
        ) : null}
        {(suggested || []).slice(0, 8).map((s) => (
          <div
            key={s.id}
            className={`flex flex-row items-center gap-2 p-2 rounded-md border ${hairline} ${fieldBg}`}
          >
            <span
              className={`text-xs px-1.5 py-0.5 rounded border ${hairline} ${muted}`}
            >
              {SOURCE_LABELS[s.source] || s.source}
            </span>
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="text-sm truncate">{s.label}</span>
              <span className={`text-xs truncate ${muted}`}>{s.why}</span>
            </span>
            <Button3 title="Add" size="sm" onClick={() => onAdd(s.step)} />
          </div>
        ))}
        {suggested && !suggested.length ? (
          <span className={`text-xs ${muted}`}>
            Nothing to suggest yet: describe one below.
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-2" data-testid="describe-check">
        <span className={`text-sm font-semibold ${strong}`}>
          Or describe it
        </span>
        <TextArea
          label="What should it prove?"
          value={ask}
          rows={3}
          placeholder="e.g. every acceptance item in the handoff has a test"
          onChange={setAsk}
        />
        <div>
          <Button
            title={busy === "draft" ? "Writing…" : "Write it"}
            size="sm"
            onClick={busy || !ask.trim() ? undefined : draftIt}
          />
        </div>
        {draft ? (
          <div className="flex flex-col gap-2" data-testid="check-draft">
            <span className="text-sm">{draft.summary}</span>
            <pre
              className={`m-0 p-3 rounded-md text-xs font-mono whitespace-pre-wrap max-h-64 overflow-auto ${fieldBg}`}
            >{`.dash/checks/${draft.file}\n\n${draft.code}`}</pre>
            <div>
              <Button
                title={busy === "try" ? "Trying…" : "Try it"}
                size="sm"
                onClick={busy ? undefined : tryIt}
              />
            </div>
          </div>
        ) : null}
        {tried ? (
          <div className="flex flex-col gap-1 text-xs" data-testid="try-result">
            <span>{`On the bot's last run: ${tried.good && tried.good.pass ? "passes" : "fails"} — ${(tried.good && tried.good.reason) || ""}`}</span>
            <span>{`On a bad sample: ${tried.bad && tried.bad.pass ? "passes" : "fails"} — ${(tried.bad && tried.bad.reason) || ""}`}</span>
            <span className="font-semibold">
              {tried.ok ? "It works: you can save it." : tried.problem}
            </span>
          </div>
        ) : null}
        {canSave(draft, tried) ? (
          <div className="flex flex-col gap-2" data-testid="save-check">
            <RadioGroup
              value={where}
              onChange={setWhere}
              options={[
                ...(repos.length
                  ? [
                      {
                        value: "repo",
                        label:
                          "Save it to the repo (opens a PR; this team's copy runs until it's merged)",
                      },
                    ]
                  : []),
                { value: "team", label: "This team only" },
              ]}
            />
            {where === "repo" && repos.length > 1 ? (
              <SelectInput
                label="Repo"
                value={repo}
                options={repos.map((r) => ({ value: r.key, label: r.slug }))}
                onChange={setRepo}
              />
            ) : null}
            <div>
              <Button
                title={busy === "save" ? "Saving…" : "Save the check"}
                size="sm"
                onClick={busy ? undefined : save}
              />
            </div>
          </div>
        ) : null}
      </div>
      {error ? <span className="text-xs">{error}</span> : null}
      <div>
        <Button3 title="Cancel" size="sm" onClick={onCancel} />
      </div>
    </div>
  );
};

export default AddCheckScreen;
