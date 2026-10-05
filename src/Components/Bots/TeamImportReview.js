import React, { useContext, useState } from "react";
import {
  Button,
  Button3,
  Checkbox,
  SectionLabel,
  SelectInput,
  ThemeContext,
} from "@trops/dash-react";

const POLICY_LABELS = {
  ask: "Ask before external actions",
  "ask-every": "Ask before every tool",
  allow: "Allow without prompting",
};

const MODEL_LABELS = {
  "claude-code": "Claude Code (CLI)",
  anthropic: "Anthropic",
  openai: "OpenAI",
  xai: "xAI",
};

const MEMORY_HINT = /team memory|memory_(get|set)/i;

function eventVerb(ev) {
  if (ev === "completed") return "completes";
  if (ev === "failed") return "fails";
  return `uses ${ev.replace(/^tool\./, "").replace(".", " ")}`;
}

/** "Agenda completes → Inbox runs" */
export function wiringText(w, names) {
  const from = names[w.on.role] || w.on.role;
  const to = names[w.role] || w.role;
  const ev = w.on.event;
  const what =
    ev === "completed"
      ? "completes"
      : ev === "failed"
        ? "fails"
        : `uses ${ev.replace(/^tool\./, "").replace(".", " ")}`;
  return `${from} ${what} → ${to} runs`;
}

/**
 * TeamImportReview — the one review screen before a `.team.json` is
 * installed into a dashboard (bot-teams TEAM-007, slice 1): the team, each
 * member with its providers (matched by type to the user's providers), and
 * how the members are wired. Nothing is created until Install.
 *
 * @param {{ fileName, manifest, plan }} preview  bots.previewTeamImport()
 * @param {(choices: { [role]: { [type]: string } }) => void} onInstall
 * @param {() => void} onCancel
 * @param {boolean} [installing]
 * @param {string} [error]
 */
export const TeamImportReview = ({
  preview,
  onInstall,
  onCancel,
  installing = false,
  error = null,
}) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const hairline = currentTheme["border-neutral-dark"] || "border-gray-700";
  const muted = currentTheme["text-neutral-medium"] || "text-gray-400";

  const { manifest, plan, fileName, source } = preview || {};
  const [choices, setChoices] = useState({});
  // Which bots to install (TEAM-007 slice 3b): all, until the user unticks.
  const [picked, setPicked] = useState(
    () => new Set(((manifest && manifest.members) || []).map((m) => m.role)),
  );
  if (!manifest || !plan) return null;

  const isBot = preview.kind === "bot";
  const isPartial = manifest.members.some((m) => !picked.has(m.role));
  const pickedRoles = manifest.members
    .map((m) => m.role)
    .filter((r) => picked.has(r));
  const toggle = (role, on) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(role);
      else next.delete(role);
      return next;
    });
  // What a split team loses: triggers from bots left out, and team memory
  // their teammates would have written.
  const dropped = manifest.wiring.filter(
    (w) => picked.has(w.role) && !picked.has(w.on.role),
  );
  const memoryRoles = isPartial
    ? manifest.members
        .filter(
          (m) =>
            picked.has(m.role) && MEMORY_HINT.test(m.embedded.instructions),
        )
        .map((m) => m.role)
    : [];

  const names = Object.fromEntries(
    manifest.members.map((m) => [m.role, m.embedded.name]),
  );
  const planOf = Object.fromEntries(plan.members.map((m) => [m.role, m]));

  const choose = (role, type, name) =>
    setChoices((prev) => ({
      ...prev,
      [role]: { ...(prev[role] || {}), [type]: name },
    }));

  const providerLine = (role, need) => {
    if (!need.options.length) {
      return (
        <span key={need.type} className="text-xs text-red-400">
          {`${need.type}: none set up — add one in Settings › Providers`}
        </span>
      );
    }
    if (need.options.length === 1) {
      return (
        <span key={need.type} className={`text-xs ${muted}`}>
          {`${need.type}: ${need.options[0]}`}
        </span>
      );
    }
    const value =
      (choices[role] && choices[role][need.type]) || need.chosen || "";
    return (
      <div key={need.type} className="max-w-sm flex flex-col gap-1">
        <SelectInput
          label={`${need.type} provider`}
          value={value}
          onChange={(v) => choose(role, need.type, v)}
          placeholder="Choose a provider…"
          options={need.options.map((o) => ({ value: o, label: o }))}
        />
        {value ? null : (
          <span className={`text-xs ${muted}`}>
            {`Not chosen — installs without ${need.type} (you can add it later in the bot's Settings).`}
          </span>
        )}
      </div>
    );
  };

  return (
    <section
      aria-label="Import team"
      className={`flex-1 min-w-0 min-h-0 flex flex-col rounded-xl border ${hairline}`}
    >
      <div className="px-5 pt-4 flex flex-col gap-1">
        <h2 className="text-lg font-semibold">
          {isBot
            ? `Install bot: ${manifest.name}`
            : `Import team: ${manifest.name}`}
        </h2>
        {manifest.description ? (
          <span className={`text-sm ${muted}`}>{manifest.description}</span>
        ) : null}
        {source ? (
          <span className={`text-xs ${muted}`}>
            {`From the registry: ${source.package} v${source.version}${source.author ? ` by ${source.author}` : ""}`}
          </span>
        ) : fileName ? (
          <span className={`text-xs ${muted}`}>{fileName}</span>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {dropped.length || memoryRoles.length ? (
          <div className="flex flex-col gap-1">
            <SectionLabel text="Installing only some of the team" />
            {dropped.map((w, i) => (
              <span key={`d${i}`} className="text-xs text-red-400">
                {`${names[w.role]} normally runs when ${names[w.on.role]} ${eventVerb(w.on.event)} — that trigger won't be set up.`}
              </span>
            ))}
            {memoryRoles.map((r) => (
              <span key={`m${r}`} className="text-xs text-red-400">
                {`${names[r]} shares results with its teammates through team memory — that hand-off won't work for the bots you left out.`}
              </span>
            ))}
          </div>
        ) : null}

        {manifest.wiring.some(
          (w) => picked.has(w.role) && picked.has(w.on.role),
        ) ? (
          <div className="flex flex-col gap-1">
            <SectionLabel text="How the team works together" />
            {manifest.wiring
              .filter((w) => picked.has(w.role) && picked.has(w.on.role))
              .map((w, i) => (
                <span key={i} className="text-sm">
                  {wiringText(w, names)}
                </span>
              ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          {isBot ? null : (
            <SectionLabel text={`Members · ${manifest.members.length}`} />
          )}
          {manifest.members.map(({ role, embedded: e }) => {
            const p = planOf[role] || { needs: [] };
            const policy =
              e.approvalPolicy && e.approvalPolicy !== "ask"
                ? `Asks before external actions (the file said: ${POLICY_LABELS[e.approvalPolicy] || e.approvalPolicy})`
                : "Asks before external actions";
            return (
              <div
                key={role}
                data-testid={`team-member-${e.name}`}
                className={`rounded-lg border p-3 flex flex-col gap-1.5 ${hairline} ${picked.has(role) ? "" : "opacity-50"}`}
              >
                {isBot ? (
                  <span className="text-sm font-medium">{e.name}</span>
                ) : (
                  <Checkbox
                    label={e.name}
                    checked={picked.has(role)}
                    onChange={(on) => toggle(role, on)}
                  />
                )}
                <span className={`text-xs ${muted}`}>
                  {e.instructions.length > 280
                    ? `${e.instructions.slice(0, 280)}…`
                    : e.instructions}
                </span>
                <span className={`text-xs ${muted}`}>
                  {[
                    e.schedules.length
                      ? `Schedule: ${e.schedules.map((s) => s.cron).join(", ")}`
                      : null,
                    `AI model: ${e.modelSource ? MODEL_LABELS[e.modelSource] || e.modelSource : "your default"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className={`text-xs ${muted}`}>{policy}</span>
                {p.needs.map((need) => providerLine(role, need))}
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={`flex flex-row flex-wrap items-center justify-between gap-3 px-5 py-3 border-t ${hairline}`}
      >
        <span className={`text-xs ${muted}`}>
          {error ||
            "Bots are added paused — nothing runs until you resume them."}
        </span>
        <div className="flex flex-row gap-2">
          <Button3 title="Cancel" size="sm" onClick={onCancel} />
          <Button
            title={
              isBot
                ? "Install bot"
                : isPartial
                  ? `Install ${pickedRoles.length} bot${pickedRoles.length === 1 ? "" : "s"}`
                  : "Install team"
            }
            size="sm"
            disabled={installing || pickedRoles.length === 0}
            onClick={() => onInstall(choices, isPartial ? pickedRoles : null)}
          />
        </div>
      </div>
    </section>
  );
};
