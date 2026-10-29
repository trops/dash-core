import React, { useEffect, useState } from "react";
import {
  Button2,
  ButtonIcon,
  Card2,
  FontAwesomeIcon,
  SectionLabel,
  SelectInput,
  StatusBadge,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { describeEstimate } from "../../utils/planEstimate";
import {
  botDetails,
  isDone,
  isSkipped,
  pieceSource,
  providerChoices,
  removePiece,
  swapPiece,
} from "./planChecklist";
import { SwapPicker } from "./PlanChecklistDialogs";

/**
 * PlanParts — the plan's pieces, its Before building list and What to
 * expect, shared by Create's plan step and the lead workspace (lead-workspace
 * release 3a), so a plan reads the same wherever it shows.
 */

/**
 * Where each piece comes from, as a coloured pill above its name (design
 * guide rule 12: status is a word in a badge; screen audit, October 2026).
 */
const SOURCE = {
  yours: { label: "Yours", state: "success" },
  "ai-built": { label: "AI-built", state: "neutral" },
  registry: { label: "From the registry", state: "info" },
  new: { label: "New", state: "closed" },
  update: { label: "Update", state: "warning" },
};
const KIND_ICON = {
  bot: "robot",
  widget: "puzzle-piece",
  layout: "table-cells-large",
  theme: "palette",
};
const GROUPS = [
  ["bot", "Bots"],
  ["widget", "Widgets"],
  ["layout", "Layout"],
  ["theme", "Theme"],
];

/**
 * An option that means "let me type it" rather than an answer (the Planner
 * sometimes offers one): it focuses the question's field instead.
 */
export function isTypeItOption(option) {
  return /\b(type|write|enter)\b.*\b(it|my own|myself)\b|^other\b|something else/i.test(
    String(option || ""),
  );
}

/** The line under a piece's name: package · providers · notes, or for a
 * layout, what it is ("New dashboard layout"). */
export function pieceMeta(p) {
  const parts = [p.package, (p.providers || []).join(", "), p.notes].filter(
    Boolean,
  );
  if (parts.length) return parts.join(" · ");
  if (p.kind === "layout") {
    return p.source === "new" ? "New dashboard layout" : "Dashboard layout";
  }
  if (p.kind === "theme") return "One of your saved themes";
  return "";
}

/** A "can't" line in the plan's access list ("None can send email"). */
export function cannotLine(text) {
  return /\b(can't|cannot|can not|none can|no bot|won't|never)\b|^none\b|^no\b/i.test(
    String(text || ""),
  );
}

/**
 * A change's widget on the plan card (Phase 3): what it adds, what it keeps
 * and which files it touches.
 */
const EditPlanDetails = ({ piece, edit, muted }) => {
  const update = edit.mode === "update";
  const files = update
    ? `widgets/${edit.target.componentName}.js, widgets/${edit.target.componentName}.dash.js`
    : `A new widget — ${edit.target.componentName} isn't changed`;
  const keeps = (Array.isArray(piece.keeps) ? piece.keeps : []).filter(
    (k) => typeof k === "string" && k.trim(),
  );
  const rows = [
    ["Adds", typeof piece.adds === "string" ? piece.adds : piece.notes || ""],
    ["Keeps", keeps.join(" · ")],
    ["Files", files],
  ].filter(([, v]) => v);
  return (
    <div
      className="grid gap-x-3 gap-y-1 text-sm"
      style={{ gridTemplateColumns: "4.5rem minmax(0, 1fr)" }}
      data-testid="plan-edit-details"
    >
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <span className={muted}>{k}</span>
          <span>{v}</span>
        </React.Fragment>
      ))}
    </div>
  );
};

/**
 * A planned bot on the plan card (4d-2): Runs / Uses / Sends as a labelled
 * list in a recessed panel, and its full instructions behind a real button.
 */
const BotPlanDetails = ({ piece, muted, strong, open, onToggle }) => {
  const rows = botDetails(piece);
  return (
    <div
      className="flex flex-col gap-3 ml-7 rounded-md p-3"
      style={{ background: "var(--raised-2, transparent)" }}
      data-testid="plan-bot"
    >
      <dl
        className="gap-x-4 gap-y-1 text-sm"
        style={{
          display: "grid",
          gridTemplateColumns: "max-content minmax(0, 1fr)",
          margin: 0,
        }}
      >
        {rows.map((r) => (
          <React.Fragment key={r.label}>
            <dt className={`text-xs pt-0.5 ${muted}`}>{r.label}</dt>
            <dd
              className={strong}
              style={{ margin: 0, wordBreak: "break-word" }}
            >
              {r.value}
            </dd>
          </React.Fragment>
        ))}
      </dl>
      <div>
        <Button2
          size="sm"
          onClick={onToggle}
          ariaLabel={open ? "Hide instructions" : "Show instructions"}
        >
          <span className="inline-flex items-center gap-2">
            <FontAwesomeIcon
              icon={open ? "chevron-up" : "chevron-down"}
              className="h-3 w-3"
            />
            {open ? "Hide instructions" : "Show instructions"}
          </span>
        </Button2>
      </div>
      {open ? (
        <span
          className="text-sm whitespace-pre-wrap"
          data-testid="plan-bot-instructions"
        >
          {piece.instructions}
        </span>
      ) : null}
    </div>
  );
};

/** A titled group on the plan (design guide rule 3): a Card2 with a 14px title. */
export const PlanSection = ({ title, testId, children }) => {
  const { strong } = useConfigTokens();
  // The body takes the normal text color — a card can carry the theme's
  // accent text color otherwise.
  return (
    <Card2
      padding="p-4"
      rounded="rounded-lg"
      shadow=""
      className="flex flex-col gap-3"
      testId={testId}
    >
      <h3 className={`text-sm font-semibold ${strong}`} style={{ margin: 0 }}>
        {title}
      </h3>
      <div className={`flex flex-col gap-3 text-sm ${strong}`}>{children}</div>
    </Card2>
  );
};

/**
 * What the plan makes, grouped (Bots, Widgets, Layout, Theme): each piece
 * tagged by where it comes from, with Swap… and remove. `onEdit(plan, note)`
 * gets the changed plan and a note for the Planner ("removed Weather").
 *
 * @param {object} plan
 * @param {object|null} edit     a change to one widget (Create › Change)
 * @param {boolean} single       one widget (a cell, a change): no remove
 * @param {object|null} botMode  one bot: no remove
 * @param {object|null} target   the dashboard a plan changes
 */
export const PlanPieces = ({
  plan,
  edit = null,
  single = false,
  botMode = null,
  target = null,
  readOnly = false,
  onEdit,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  // The piece being swapped, and bots whose full instructions show.
  const [swapIndex, setSwapIndex] = useState(null);
  const [openBots, setOpenBots] = useState([]);
  // A new plan (the Planner's answer, or an edit) closes an open Swap.
  useEffect(() => {
    setSwapIndex(null);
  }, [plan]);
  const pieces = (plan && plan.pieces) || [];
  return (
    <PlanSection
      title={
        edit
          ? "What changes"
          : target && !botMode
            ? "What it adds"
            : "What it makes"
      }
      testId="plan-pieces"
    >
      {GROUPS.map(([kind, label]) => {
        const group = pieces.filter((p) => p && p.kind === kind);
        if (!group.length) return null;
        return (
          <div key={kind} className="flex flex-col">
            <SectionLabel text={label} />
            {group.map((p, gi) => {
              const index = pieces.indexOf(p);
              const src = pieceSource(p);
              const base = SOURCE[src] || {
                label: src,
                state: "neutral",
              };
              const source = edit
                ? edit.mode === "update"
                  ? { label: "Change", state: "warning" }
                  : { label: "New widget", state: "closed" }
                : src === "new"
                  ? { ...base, label: `New ${p.kind}` }
                  : base;
              const meta = pieceMeta(p);
              return (
                <div
                  key={index}
                  className={`flex flex-col gap-2 py-3 ${gi ? `border-t ${hairline}` : ""}`}
                  data-testid="plan-piece"
                >
                  <div className="flex flex-row items-start gap-3">
                    <FontAwesomeIcon
                      icon={KIND_ICON[p.kind] || "puzzle-piece"}
                      className={`h-4 w-4 mt-6 flex-shrink-0 ${muted}`}
                    />
                    <div className="flex-1 min-w-0 flex flex-col items-start gap-1">
                      <StatusBadge state={source.state} label={source.label} />
                      <span className={`text-sm font-medium ${strong}`}>
                        {p.name}
                      </span>
                      {meta ? (
                        <span className={`text-xs ${muted}`}>{meta}</span>
                      ) : null}
                    </div>
                    {readOnly ? null : (
                      <div className="dr-row-actions flex flex-row items-center gap-1 flex-shrink-0 pt-5">
                        {p.kind === "widget" && !edit ? (
                          <Button2
                            title="Swap…"
                            size="sm"
                            onClick={() => setSwapIndex(index)}
                          />
                        ) : null}
                        {single || botMode ? null : (
                          // A cell's plan is this one widget (a bot plan,
                          // this one bot): Swap, not remove.
                          <ButtonIcon
                            icon="xmark"
                            ariaLabel={`Remove ${p.name} from the plan`}
                            onClick={() =>
                              onEdit(
                                removePiece(plan, index),
                                `removed ${p.name}`,
                              )
                            }
                          />
                        )}
                      </div>
                    )}
                  </div>
                  {edit && p.kind === "widget" ? (
                    <EditPlanDetails piece={p} edit={edit} muted={muted} />
                  ) : null}
                  {p.kind === "bot" && p.source === "new" ? (
                    <BotPlanDetails
                      piece={p}
                      muted={muted}
                      strong={strong}
                      open={openBots.includes(index)}
                      onToggle={() =>
                        setOpenBots((o) =>
                          o.includes(index)
                            ? o.filter((x) => x !== index)
                            : [...o, index],
                        )
                      }
                    />
                  ) : null}
                  {swapIndex === index ? (
                    <SwapPicker
                      piece={p}
                      onCancel={() => setSwapIndex(null)}
                      onPick={(m) => {
                        setSwapIndex(null);
                        onEdit(
                          swapPiece(plan, index, m),
                          m.source === "New"
                            ? `build ${p.name} new`
                            : `swapped ${p.name} for ${m.name}`,
                        );
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </PlanSection>
  );
};

/**
 * Before building's items, one row each: done or to do, and what to press
 * (Review & approve, Connect new, OK) — or one of the user's providers.
 *
 * @param {(item) => void} onAction       the item's button
 * @param {(item, provider) => void} onPickProvider
 * @param {(item) => string} [who]        who's asking, above the item
 */
export const PlanChecklistRows = ({
  checklist,
  checks,
  have,
  providers,
  compact = false,
  onAction,
  onPickProvider,
  who = null,
  readOnly = false,
  rows = false,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  return (
    <>
      {checklist.map((it) => {
        const skipped = isSkipped(it, checks, have);
        const done = isDone(it, checks, have) && !skipped;
        // The user's providers that could stand in, closest first.
        const choices =
          it.kind === "connect"
            ? providerChoices(providers, it.providerType)
            : [];
        const picker = choices.length ? (
          <div className="w-full" data-testid="checklist-use-provider">
            <SelectInput
              label="Or use one you have"
              value=""
              onChange={(name) => {
                const p = choices.find((x) => x.name === name);
                if (p) onPickProvider(it, p);
              }}
              options={[
                { value: "", label: "Pick a provider…" },
                ...choices.map((p) => ({
                  value: p.name,
                  label: p.type ? `${p.name} · ${p.type}` : p.name,
                })),
              ]}
            />
          </div>
        ) : null;
        if (rows) {
          // The lead workspace's Before it builds (frame 1): a mark, who
          // asks, what and its detail, the action on the same line.
          return (
            <div
              key={it.id}
              className={`flex flex-row items-start gap-3 px-4 py-3 border-t text-sm ${hairline}`}
              data-testid="checklist-item"
            >
              {done ? (
                <FontAwesomeIcon
                  icon="check"
                  className={`h-3 w-3 mt-1 ${statusTokens.success.icon}`}
                  aria-label="Done"
                />
              ) : (
                // A hollow ring: still to do (frame 1's ○).
                <span
                  role="img"
                  aria-label="To do"
                  className={`inline-block flex-shrink-0 h-2.5 w-2.5 mt-1 rounded-full border ${hairline}`}
                />
              )}
              <span className="flex-1 min-w-0 flex flex-col items-start gap-1">
                {who ? (
                  <span
                    className={`flex flex-row items-center gap-1.5 text-xs ${muted}`}
                    data-testid="checklist-who"
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${statusTokens.success.solidBg}`}
                      aria-hidden="true"
                    />
                    {who(it)}
                  </span>
                ) : null}
                <span className={done ? muted : strong}>{it.label}</span>
                {it.package || skipped ? (
                  <span
                    className={`text-xs ${muted}`}
                    data-testid={skipped ? "checklist-skipped" : undefined}
                  >
                    {skipped ? "Skipped — what needs it waits" : it.package}
                  </span>
                ) : null}
                {done || readOnly ? null : picker}
              </span>
              {done || readOnly ? null : (
                <Button2
                  title={
                    it.kind === "install"
                      ? "Review"
                      : it.kind === "connect"
                        ? "Connect"
                        : "OK"
                  }
                  size="sm"
                  onClick={() => onAction(it)}
                />
              )}
            </div>
          );
        }
        return (
          <div
            key={it.id}
            className={`flex ${
              compact ? "flex-col items-stretch" : "flex-row items-center"
            } gap-3 text-sm py-1`}
            data-testid="checklist-item"
          >
            <span className="flex-1 min-w-0 flex flex-col items-start gap-1">
              {who ? (
                <span
                  className={`text-xs ${muted}`}
                  data-testid="checklist-who"
                >
                  {who(it)}
                </span>
              ) : null}
              <StatusBadge
                state={done ? "success" : "neutral"}
                label={done ? "Done" : "To do"}
              />
              <span className={done ? muted : strong}>{it.label}</span>
              {it.package ? (
                <span className={`text-xs ${muted}`}>{it.package}</span>
              ) : null}
              {skipped ? (
                <span
                  className={`text-xs ${muted}`}
                  data-testid="checklist-skipped"
                >
                  {" "}
                  · skipped — what needs it waits
                </span>
              ) : null}
            </span>
            {done || readOnly ? null : (
              <div
                className={`flex flex-col gap-2 ${
                  compact ? "items-start" : "items-end"
                }`}
              >
                <Button2
                  title={
                    it.kind === "install"
                      ? "Review & approve"
                      : it.kind === "connect"
                        ? "Connect new"
                        : "OK"
                  }
                  size="sm"
                  onClick={() => onAction(it)}
                />
                {choices.length ? (
                  <div className={compact ? "w-full" : "w-56"}>{picker}</div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};

/** What to expect: what it can and can't do, how we'll know it works, cost. */
export const PlanExpect = ({ plan, botMode = null, estimate = null }) => {
  const { muted } = useConfigTokens();
  const statusTokens = useStatusTokens();
  return (
    <PlanSection title="What to expect" testId="plan-expect">
      {botMode ? (
        <span className="text-sm" data-testid="plan-expect-bot">
          It's checked, then saved paused. Nothing runs until you try it or turn
          it on.
        </span>
      ) : null}
      {(plan.access || []).length ? (
        <div className="flex flex-col gap-1" data-testid="plan-access">
          <SectionLabel text="What it can and can't do" />
          {plan.access.map((a, i) => {
            const cant = cannotLine(a);
            return (
              <span key={i} className="flex flex-row items-start gap-2 text-sm">
                <FontAwesomeIcon
                  icon={cant ? "ban" : "check"}
                  className={`h-3.5 w-3.5 mt-1 flex-shrink-0 ${cant ? muted : statusTokens.success.icon}`}
                  aria-label={cant ? "Can't" : "Can"}
                />
                <span>{a}</span>
              </span>
            );
          })}
        </div>
      ) : null}

      {(plan.checks || []).length ? (
        <div className="flex flex-col gap-1">
          <SectionLabel text="How we'll know it works" />
          <ul
            className="flex flex-col gap-1 text-sm"
            style={{
              margin: 0,
              paddingLeft: "1.1rem",
              listStyle: "disc",
            }}
          >
            {plan.checks.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-1" data-testid="plan-estimate">
        <SectionLabel text="Estimated cost" />
        <span className="text-sm">
          {botMode
            ? // Dash checks and saves it — no AI (2c-1).
              "To build: nothing — Dash checks and saves it, no AI"
            : `To build: ${describeEstimate(estimate)}`}
        </span>
        {plan.estimate && plan.estimate.running ? (
          <span className="text-sm">To run: {plan.estimate.running}</span>
        ) : null}
      </div>
    </PlanSection>
  );
};
