import React, { useContext, useMemo, useState } from "react";
import {
  Button,
  Button2,
  Button3,
  ButtonIcon2,
  FontAwesomeIcon,
  Switch,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import {
  createdFor,
  normalizeType,
  removePiece,
} from "../Create/planChecklist";
import {
  ConnectDialog,
  InstallReviewDialog,
} from "../Create/PlanChecklistDialogs";
import { PlanChecklistRows, isTypeItOption } from "../Create/PlanParts";
import {
  canBuild,
  isSettingsChange,
  changeStanding,
  isThemeChangeOnly,
  isThemeOnly,
  newTheme,
  themeChange,
  planLine,
  planName,
  planRows,
  planSubLine,
  whoAsks,
  yesLabel,
} from "./workspacePlan";
import { planTarget } from "../../utils/teamPlan";
import { planChanges, widgetChanges } from "./planChanges";
import { useDashboard } from "./useDashboard";
import { ThemePreview } from "../AppPages/ThemePreview";
import { ThemeModel } from "../../Models/ThemeModel";
import { generateCustomTheme } from "../../utils/themeGenerator";
import {
  hasEditorChanges,
  themeByName,
  themeOrigin,
} from "../../utils/themeStanding";
import { themeUseLine, useThemeUse } from "./useThemeUse";

/**
 * The plan in a workspace conversation (lead-workspace release 3a, frames 1,
 * 6): a card in the chat that opens it on the right, the reply choices
 * under the lead's answer, Before it builds, and the plan itself.
 */

/**
 * An output as a card (frame 1): an icon tile, its title and line, and what
 * kind of output it is. In the chat and in the right column's Outputs.
 */
export const OutputCard = ({
  icon = "table-cells-large",
  title,
  sub = "",
  kind = "",
  onClick,
  bordered = true,
  testId,
}) => {
  const { muted, strong, hairline, selectedBg, fieldBg } = useConfigTokens();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex flex-row items-center gap-3 rounded-xl px-4 py-3 text-left ${bordered ? `border ${hairline}` : ""} ${selectedBg} dr-role-surface`}
      data-testid={testId}
    >
      <span
        className={`flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-lg ${fieldBg} dr-role-well ${muted}`}
        aria-hidden="true"
      >
        <FontAwesomeIcon icon={icon} className="h-4 w-4" />
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className={`text-sm font-semibold truncate ${strong}`}>
          {title}
        </span>
        {sub ? <span className={`text-xs ${muted}`}>{sub}</span> : null}
      </span>
      {kind ? (
        <span className={`flex-shrink-0 text-xs ${muted}`}>{kind}</span>
      ) : null}
    </button>
  );
};

/**
 * The plan as a card in the conversation: opens it on the right. An earlier
 * plan (one the Planner has since changed) says so, and still opens.
 */
export const PlanCard = ({ plan, earlier = false, onOpen }) => {
  // Whose a changed theme is (theme change round): the card says remix.
  const { rawThemes } = useContext(ThemeContext) || {};
  const line = planLine(plan, { rawThemes });
  const change = isThemeChangeOnly(plan)
    ? changeStanding(plan, rawThemes)
    : null;
  return (
    <div
      className="self-start w-full max-w-md"
      data-testid="workspace-plan-card"
    >
      <OutputCard
        icon={
          isThemeOnly(plan) || isThemeChangeOnly(plan) ? "palette" : undefined
        }
        // A change to a dashboard the user has says so (frame 30); a new
        // theme, that it's a theme (theme round, frame 45); a theme change,
        // its changes or its remix (frames 49-50).
        title={
          planTarget(plan) || plan.widgetChange
            ? `${planName(plan)} — changes`
            : isThemeOnly(plan)
              ? `${planName(plan)} — theme`
              : isThemeChangeOnly(plan)
                ? change && change.origin
                  ? `${themeChange(plan).name} (remix) — theme`
                  : `${themeChange(plan).name} — changes`
                : planName(plan)
        }
        sub={earlier ? `${line} · changed since` : line}
        bordered={false}
        onClick={onOpen}
      />
    </div>
  );
};

/**
 * Under the lead's answer: the Planner's questions as taps, or — a plan
 * ready to go — Yes, build it / Change something.
 *
 * @param {(text) => void} onSend   sends a reply to the lead
 * @param {() => void} onBuild      Yes, build it (null while it starts)
 * @param {() => void} onChange     Change something (the reply box)
 * @param {boolean} sent            sent to the retired Create window (3a)
 */
export const PlanChoices = ({
  plan,
  check,
  sent = false,
  onSend,
  onBuild,
  onChange,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const { rawThemes } = useContext(ThemeContext) || {};
  // Several questions: picks per question, sent together.
  const [picks, setPicks] = useState({});
  const questions = (plan && plan.questions) || [];
  if (questions.length) {
    const answered = questions.filter((_q, i) => picks[i]).length;
    return (
      <div
        className="flex flex-col gap-3"
        data-testid="workspace-plan-questions"
      >
        {questions.map((q, i) => {
          const options = (Array.isArray(q.options) ? q.options : []).filter(
            Boolean,
          );
          return (
            <div
              key={i}
              className={`flex flex-col gap-2 rounded-lg border px-4 py-3 ${hairline}`}
            >
              <span className={`text-xs ${muted}`}>
                Planner · Dash team asks
              </span>
              <span className={`text-sm font-semibold ${strong}`}>
                {q.question}
              </span>
              {options.length ? (
                <div className="flex flex-row flex-wrap gap-2">
                  {options.map((o) => (
                    <ButtonIcon2
                      key={o}
                      text={o}
                      ariaPressed={picks[i] === o}
                      selected={picks[i] === o}
                      onClick={() => {
                        // "I'll type it" isn't an answer: the reply box.
                        if (isTypeItOption(o)) {
                          onChange();
                          return;
                        }
                        if (questions.length === 1) {
                          onSend(`${q.question} — ${o}`);
                          return;
                        }
                        setPicks((p) => ({ ...p, [i]: o }));
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {questions.length > 1 ? (
          <div className="flex flex-row items-center gap-3">
            <Button
              title="Send answers"
              disabled={!answered}
              onClick={() =>
                onSend(
                  questions
                    .map((q, i) =>
                      picks[i] ? `${q.question} — ${picks[i]}` : null,
                    )
                    .filter(Boolean)
                    .join("\n"),
                )
              }
            />
            <span className={`text-sm ${muted}`}>
              {answered} of {questions.length} answered
            </span>
          </div>
        ) : null}
        <span className={`text-xs ${muted}`}>
          Or type your own answer below.
        </span>
      </div>
    );
  }
  const errors = (check && check.errors) || [];
  if (errors.length) {
    return (
      <div className="flex flex-col gap-2" data-testid="workspace-plan-broken">
        <span className={`text-sm ${muted}`}>
          The plan has a few gaps, so it can&apos;t be built yet.
        </span>
        <div>
          <Button2
            title="Ask the Planner to fix it"
            onClick={() =>
              // The problems go to the lead, not into your message.
              onSend(
                "Please have the Planner fill the gaps in the plan.",
                `(What's missing, for the Planner:\n${errors
                  .map((e) => `- ${e}`)
                  .join("\n")})`,
              )
            }
          />
        </div>
      </div>
    );
  }
  if (sent) {
    return (
      <span className={`text-sm ${muted}`} data-testid="workspace-plan-sent">
        Sent to be built by an older version of Dash — ask here to build it
        again.
      </span>
    );
  }
  return (
    <div
      className="flex flex-row flex-wrap items-center gap-2"
      data-testid="workspace-plan-choices"
    >
      {onBuild ? (
        <>
          <Button title={yesLabel(plan, { rawThemes })} onClick={onBuild} />
          <Button2 title="Change something" onClick={onChange} />
        </>
      ) : (
        <span className={`text-sm ${muted}`}>Starting the build…</span>
      )}
    </div>
  );
};

/**
 * Before it builds (Create's checklist, frame 1): a box with each item on a
 * row — done or not, who asks, what — and its action beside it.
 *
 * @param {object} wp  useWorkspacePlan's result
 * @param {boolean} readOnly  the lead is answering: a new plan may come
 */
export const BeforeItBuilds = ({ wp, readOnly = false }) => {
  const [dialog, setDialog] = useState(null);
  const { strong } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const { plan, checklist, checks, have } = wp;
  if (!plan || !checklist.length) return null;
  const done = checklist.length - wp.open;
  return (
    <>
      <div
        className={`flex flex-col rounded-xl border overflow-hidden ${statusTokens.warning.accentBorder}`}
        data-testid="workspace-before"
      >
        <span className={`px-4 py-3 text-sm font-semibold ${strong}`}>
          Before it builds · {done} of {checklist.length} done
        </span>
        <PlanChecklistRows
          checklist={checklist}
          checks={checks}
          have={have}
          providers={wp.providers}
          rows
          readOnly={readOnly}
          who={whoAsks}
          onAction={(it) =>
            it.kind === "approve"
              ? wp.setCheck(it, "done")
              : setDialog({ kind: it.kind, item: it })
          }
          onPickProvider={wp.pickProvider}
        />
      </div>
      {/* Mounted only while open: a dialog inside the workspace's window. */}
      {dialog && dialog.kind === "install" ? (
        <InstallReviewDialog
          item={dialog.item}
          onApprove={() => {
            wp.setCheck(dialog.item, "approved");
            setDialog(null);
          }}
          onSkip={() => {
            const it = dialog.item;
            const piece = (plan.pieces || [])[it.pieceIndex];
            wp.edit(
              removePiece(plan, it.pieceIndex),
              `removed ${piece ? piece.name : it.package}`,
            );
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog && dialog.kind === "connect" ? (
        <ConnectDialog
          item={dialog.item}
          onSkip={() => {
            wp.setCheck(dialog.item, "skipped");
            setDialog(null);
          }}
          onClose={async (created) => {
            const it = dialog.item;
            setDialog(null);
            // A provider made in the window is the one this needed.
            const made = createdFor(created, it.providerType);
            if (made) wp.pickProvider(it, made);
            if (wp.refreshProviders) {
              try {
                await wp.refreshProviders();
              } catch (_e) {
                // the item stays open; it can be picked from the list
              }
            }
          }}
        />
      ) : null}
    </>
  );
};

/**
 * The plan, opened on the right (frame 6): what it makes, one row each, and
 * what still needs connecting. Changes are asked for in the chat (Change
 * something). The current plan has Yes, build it, so it can be built
 * whatever the chat ended on; an earlier one (`plan` given) is only shown.
 * Once it builds (release 3b), `buildLine` says where the build stands.
 * A plan for a dashboard the user has (release 3c, frame 30) shows what
 * changes: the dashboard now and after, and a row per change.
 */
export const PlanOutput = ({
  wp,
  plan: earlier = null,
  readOnly = false,
  onBuild = null,
  buildLine = null,
  leadName = "The Dash Lead",
  // A change to what one widget does (release 6c): in place or a new
  // widget, when it can go either way; signing in to change it in place.
  onWidgetMode = null,
  onSignIn = null,
  // A theme its build changed (theme change round): state.changedTheme.
  changedTheme = null,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const plan = earlier || wp.plan;
  const target = plan ? planTarget(plan) : null;
  const dashboard = useDashboard(target ? target.id : null);
  // Saved themes' names: which theme a new one replaces (frame 46).
  const { rawThemes } = useContext(ThemeContext) || {};
  // A change to a saved theme (theme change round): whose it is, where
  // it's used.
  const standing = plan ? changeStanding(plan, rawThemes) : null;
  // Once it's changed in place, the saved theme is the new one: Now is
  // its colors before the build.
  const changing =
    standing &&
    !standing.origin &&
    changedTheme &&
    !changedTheme.remix &&
    changedTheme.previous
      ? { ...standing, raw: { ...standing.raw, ...changedTheme.previous } }
      : standing;
  const themeUse = useThemeUse(
    changing && !changing.origin ? changing.key : null,
  );
  if (!plan) return null;
  const changeOnly = isThemeChangeOnly(plan);
  // Now and after only before it's built: once it is, the dashboard read
  // now already has what was added.
  // A change to one widget has its own rows, no grids (release 6c).
  const changes =
    target && !buildLine && !plan.widgetChange && !changeOnly
      ? planChanges(dashboard, plan, {
          themeName: (key) =>
            (rawThemes && rawThemes[key] && rawThemes[key].name) || null,
          standing: (name) => {
            const hit = themeByName(rawThemes, name);
            return hit ? { origin: themeOrigin(hit[1]) } : null;
          },
        })
      : null;
  const draws = !!(changes && changes.added && changes.now.length);
  const checklist = earlier ? [] : wp.checklist;
  // Connected for real — a connect skipped before building still needs it.
  const connected = (it) =>
    !!(wp.have && wp.have.has(normalizeType(it.providerType)));
  const planned = [
    ...planRows(plan, checklist, connected, {
      rawThemes,
      themeNow: changing ? changing.raw : null,
    }),
    // A change to a saved theme: where it shows, what stays, the credit.
    ...(changeOnly && changing
      ? [
          ...(changing.origin
            ? [
                {
                  main: `Credits ${changing.origin.author || "its author"}'s ${changing.raw.name} when you publish it`,
                  sub: `${changing.raw.name} stays as it is, and its updates still arrive`,
                },
              ]
            : [
                {
                  main: themeUseLine(themeUse)
                    ? `Used by ${themeUseLine(themeUse)}`
                    : "Not used yet",
                  sub: "Everything that uses it changes",
                },
              ]),
          ...(hasEditorChanges(changing.raw)
            ? [
                {
                  main: "Your changes from the theme editor stay",
                  sub: "Only its colors change",
                },
              ]
            : []),
        ]
      : []),
  ];
  // A change to one widget (release 6c, frame 40): what changes on it.
  const wc = widgetChanges(plan);
  // A change: what's added, what stays, then what to connect.
  const rows = wc
    ? [
        ...wc.rows.map((r) =>
          r.mark === "!"
            ? { ...r, warn: true }
            : r.mark === "~"
              ? { ...r, change: true }
              : r,
        ),
        ...planned.filter((r) => r.warn),
      ]
    : changes
      ? [
          // A cell plan that doesn't fit: each piece, flagged (release 6c).
          ...changes.rows.map((r) =>
            changes.fits === false ? { ...r, warn: true } : { ...r, add: true },
          ),
          ...(changes.cellOnly && changes.fits !== false
            ? [{ main: "Everything else — unchanged", sub: "" }]
            : !changes.added &&
                (plan.pieces || []).every((p) => p && p.kind === "theme")
              ? // Only its theme changes (theme round, frame 46).
                [{ main: "Its widgets, bots and layout — unchanged", sub: "" }]
              : draws && changes.unchanged.length
                ? [
                    {
                      main: `${changes.unchanged.join(", ")} — unchanged`,
                      sub: "",
                    },
                  ]
                : []),
          ...planned.filter((r) => r.warn),
        ]
      : planned;
  return (
    <div className="flex flex-col gap-4" data-testid="workspace-plan-output">
      <div className="flex flex-col gap-1">
        <span className={`text-xs ${muted}`}>
          {earlier
            ? "Planner · an earlier plan"
            : wc || changeOnly
              ? "Planner · the change"
              : target
                ? "Planner · the changes"
                : "Planner · the plan"}
        </span>
        <span className={`text-lg font-semibold ${strong}`}>
          {wc
            ? `${wc.name} — changes`
            : changeOnly
              ? changing && changing.origin
                ? (changedTheme && changedTheme.name) ||
                  `${themeChange(plan).name} (remix)`
                : `${themeChange(plan).name} — changes`
              : target
                ? `${target.name} — changes`
                : planName(plan)}
        </span>
        <span className={`text-sm ${muted}`}>
          {wc
            ? wc.fits
              ? "Nothing changes until you say yes"
              : `A change to ${wc.name} is only ${wc.name} — this plan has more`
            : plan.cell
              ? changes && changes.fits === false
                ? "A cell takes one widget — this plan has more"
                : "Only the cell you picked changes"
              : target && !changeOnly
                ? buildLine
                  ? `What changed on ${target.name}`
                  : "Nothing changes until you say yes"
                : buildLine && isThemeOnly(plan)
                  ? "Saved in your themes"
                  : buildLine && changeOnly
                    ? changing && changing.origin
                      ? "The remix is in your themes"
                      : "Changed — everything that uses it shows it"
                    : planSubLine(plan, checklist, { rawThemes }) ||
                      "Nothing to make yet"}
        </span>
      </div>
      {draws ? (
        <div
          className="grid grid-cols-2 gap-3"
          data-testid="workspace-plan-changes"
        >
          <ChangesGrid label="Now" rows={changes.now} cols={changes.cols} />
          <ChangesGrid label="After" rows={changes.after} cols={changes.cols} />
        </div>
      ) : null}
      {newTheme(plan) ? <ThemeLooks piece={newTheme(plan)} /> : null}
      {themeChange(plan) ? (
        <ThemeLooks
          piece={themeChange(plan)}
          was={changing ? changing.raw : null}
        />
      ) : null}
      {rows.length ? (
        <div
          className={`flex flex-col rounded-xl border overflow-hidden ${hairline}`}
          data-testid="workspace-plan-rows"
        >
          {rows.map((r, i) => (
            <div
              key={i}
              className={`flex flex-row items-start gap-3 px-4 py-3 text-sm ${i ? `border-t ${hairline}` : ""}`}
              data-testid="workspace-plan-row"
            >
              {r.swatch ? (
                // A theme's color: drawn in that color (theme round).
                <span
                  className={`inline-block flex-shrink-0 h-3 w-3 mt-1 rounded border ${hairline}`}
                  style={{ backgroundColor: r.swatch }}
                  aria-hidden="true"
                />
              ) : r.warn ? (
                <FontAwesomeIcon
                  icon="triangle-exclamation"
                  className={`h-3 w-3 mt-1 ${statusTokens.warning.icon}`}
                  aria-hidden="true"
                />
              ) : r.change ? (
                <span role="img" aria-label="Changed">
                  <FontAwesomeIcon
                    icon="arrows-rotate"
                    className={`h-3 w-3 mt-1 ${statusTokens.info.icon}`}
                  />
                </span>
              ) : r.add ? (
                <span role="img" aria-label="Added">
                  <FontAwesomeIcon
                    icon="plus"
                    className={`h-3 w-3 mt-1 ${statusTokens.success.icon}`}
                  />
                </span>
              ) : (
                <span
                  className={`inline-block flex-shrink-0 h-2.5 w-2.5 mt-1 rounded-full border ${hairline}`}
                  aria-hidden="true"
                />
              )}
              <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className={strong}>{r.main}</span>
                {r.sub ? (
                  <span className={`text-xs ${muted}`}>{r.sub}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {wc &&
      wc.fits &&
      !earlier &&
      !buildLine &&
      !readOnly &&
      !isSettingsChange(plan) &&
      (onWidgetMode || onSignIn) ? (
        <div
          className="flex flex-col gap-1"
          data-testid="workspace-plan-widget-mode"
        >
          {onWidgetMode ? (
            <>
              <Switch
                label={`Change ${wc.name} everywhere it's used`}
                checked={plan.widgetChange.mode === "update"}
                onChange={(on) => onWidgetMode(on ? "update" : "new")}
              />
              <span className={`text-xs ${muted}`}>
                Off: it's saved as a new widget, and ${wc.name} stays as it is.
              </span>
            </>
          ) : (
            <div className="flex flex-row flex-wrap items-center gap-2">
              <span className={`text-xs ${muted}`}>
                Published {wc.name} yourself? Sign in to change it in place.
              </span>
              <Button3 size="sm" title="Sign in" onClick={onSignIn} />
            </div>
          )}
        </div>
      ) : null}
      {earlier ? (
        <span className={`text-sm ${muted}`}>
          The Planner changed this plan since — the latest is under Outputs.
        </span>
      ) : buildLine ? (
        <span className={`text-sm ${muted}`} data-testid="workspace-plan-built">
          {buildLine}
        </span>
      ) : readOnly ? (
        <span className={`text-sm ${muted}`}>
          {leadName} is answering — the plan may change.
        </span>
      ) : wp.sent ? (
        <span className={`text-sm ${muted}`} data-testid="workspace-plan-sent">
          Sent to be built by an older version of Dash — ask here to build it
          again.
        </span>
      ) : onBuild && canBuild({ plan, check: wp.check }) ? (
        <div className="flex flex-col gap-2">
          <span className={`text-xs ${muted}`}>
            Want something different? Say so in the chat.
          </span>
          <div>
            <Button title={yesLabel(plan, { rawThemes })} onClick={onBuild} />
          </div>
        </div>
      ) : null}
    </div>
  );
};

/**
 * How a new theme looks (theme round, frames 45-46): Dash's theme generator
 * makes it from the plan's four colors — the same theme Yes, make it saves —
 * shown dark and light, side by side.
 */
export const ThemeLooks = ({ piece, was = null }) => {
  const { muted } = useConfigTokens();
  const c = (piece && piece.colors) || {};
  const theme = useMemo(() => {
    try {
      // A change keeps the theme's editor changes (theme change round).
      if (was) {
        return ThemeModel({
          ...was,
          primary: c.primary,
          secondary: c.secondary,
          tertiary: c.tertiary,
          neutral: c.neutral,
        });
      }
      const raw = generateCustomTheme(
        c.primary,
        c.secondary,
        c.tertiary,
        c.neutral,
      );
      return ThemeModel({ ...raw, name: piece.name });
    } catch (_e) {
      return null;
    }
  }, [c.primary, c.secondary, c.tertiary, c.neutral, piece.name, was]);
  const before = useMemo(() => {
    try {
      return was ? ThemeModel(was) : null;
    } catch (_e) {
      return null;
    }
  }, [was]);
  if (!theme) return null;
  // A change: now and after, each in dark and light (frame 49).
  const looks = before
    ? [
        ["Now · dark", before, "dark"],
        ["After · dark", theme, "dark"],
        ["Now · light", before, "light"],
        ["After · light", theme, "light"],
      ]
    : [
        ["Dark", theme, "dark"],
        ["Light", theme, "light"],
      ];
  return (
    <div className="grid grid-cols-2 gap-3" data-testid="workspace-theme-looks">
      {looks.map(([label, t, variant]) => (
        <div key={label} className="flex flex-col gap-1.5 min-w-0">
          <span className={`text-xs ${muted}`}>{label}</span>
          <ThemePreview theme={t} variant={variant} compact />
        </div>
      ))}
    </div>
  );
};

/**
 * A dashboard's grid, small (frame 30): each cell's widget, an added one in
 * the success colour, an empty one dashed.
 */
const ChangesGrid = ({ label, rows, cols }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  return (
    <div
      className="flex flex-col gap-1.5"
      role="group"
      aria-label={`${label}: the dashboard's cells`}
      data-testid="workspace-plan-grid"
    >
      <span className={`text-xs ${muted}`} aria-hidden="true">
        {label}
      </span>
      <div
        className={`grid gap-1 rounded-lg border p-1.5 ${hairline}`}
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {rows.flat().map((c) =>
          // A cell another one spans keeps its place, unseen.
          c.kind === "hidden" ? (
            <span key={c.key} aria-hidden="true" />
          ) : (
            <span
              key={c.key}
              data-testid="workspace-plan-tile"
              data-kind={c.kind}
              className={`truncate rounded-md px-1 py-2 text-center text-xs ${
                c.kind === "add"
                  ? `border ${statusTokens.success.accentBorder} ${statusTokens.success.icon}`
                  : c.kind === "keep"
                    ? `border ${hairline} ${strong}`
                    : `border border-dashed ${hairline}`
              }`}
            >
              {c.name || "\u00a0"}
              {c.kind === "add" ? (
                <span className="sr-only"> (added)</span>
              ) : c.kind === "empty" ? (
                <span className="sr-only">empty cell</span>
              ) : null}
            </span>
          ),
        )}
      </div>
    </div>
  );
};
