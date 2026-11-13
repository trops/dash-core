import React, { useContext, useState } from "react";
import {
  Button,
  Button3,
  Checkbox,
  FontAwesomeIcon,
  Modal,
  StatusBadge,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  useStatusTokens,
} from "@trops/dash-react";
import { useKnownProviders } from "../../hooks/useKnownProviders";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import {
  candidatesFor,
  keepsConnection,
  livePin,
  normalizeType,
  pinWidgetProviders,
  providerKindLabel,
  providerPickRows,
  readsNow,
} from "./planChecklist";
import { reasonFor } from "../LeadWorkspace/WidgetWizard/widgetSpec";

/**
 * ProviderPick — which of the user's providers a widget reads from (widget
 * step by step, release 1). The user ticks; nothing is ticked for them.
 * The Planner's suggestions first, the rest of their providers one tap
 * away; a Claude connector shows, off, with why.
 */

const KIND_ICON = {
  connector: "link",
  mcp: "server",
  websocket: "tower-broadcast",
  credential: "key",
};

const KIND_STATE = { connector: "info", mcp: "neutral" };

/** One provider, as the Providers page shows it: icon, name, kind. */
export const ProviderLine = ({ row, children = null, compact = false }) => {
  const { muted, strong } = useConfigTokens();
  const statusTokens = useStatusTokens();
  return (
    <span className="flex-1 min-w-0 flex flex-row items-start gap-3">
      <FontAwesomeIcon
        icon={KIND_ICON[row.providerClass] || "key"}
        className={`h-4 w-4 mt-1 flex-shrink-0 ${muted}`}
      />
      <span className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="flex flex-row flex-wrap items-center gap-2">
          <span className={`text-sm font-medium ${row.off ? muted : strong}`}>
            {row.name}
          </span>
          <StatusBadge
            compact
            state={KIND_STATE[row.providerClass] || "closed"}
            label={row.kind || providerKindLabel(row)}
          />
          {row.isDefault ? (
            <StatusBadge compact state="closed" label="Default" />
          ) : null}
        </span>
        {row.reason && !compact ? (
          <span className={`text-xs ${muted}`}>{row.reason}</span>
        ) : null}
        {row.why && !compact ? (
          <span className={`text-xs ${statusTokens.warning.text}`}>
            {row.why}
          </span>
        ) : null}
        {children}
      </span>
    </span>
  );
};

/**
 * @param {{ suggested, others }} rows   providerPickRows
 * @param {string[]} [initial]           names ticked when it opens
 * @param {(rows) => void} onUse         the ticked providers
 * @param {string} [othersNote]          what "other" means here
 */
export const ProviderPick = ({
  rows,
  initial = [],
  onUse,
  othersNote = "not found for this. Pick one and the Planner says whether it can do it.",
  readOnly = false,
  // The primary button's words for what's ticked (default Use this / Use
  // these N), and a Cancel beside it (a window).
  actionLabel = null,
  onCancel = null,
  // A widget reads one provider of each kind: ticking another of the same
  // kind swaps it (bots can use several).
  onePerKind = true,
}) => {
  const { muted, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const [ticked, setTicked] = useState(() => new Set(initial));
  const [showOthers, setShowOthers] = useState(
    () =>
      !(rows.suggested || []).length ||
      (rows.others || []).some((r) => initial.includes(r.name)),
  );
  const all = [...(rows.suggested || []), ...(rows.others || [])];
  const picked = all.filter((r) => ticked.has(r.name) && !r.off);
  const kindOf = (name) => {
    const r = all.find((x) => x.name === name);
    return r ? normalizeType(r.type) : "";
  };
  const toggle = (name, on) =>
    setTicked((cur) => {
      const next = new Set(cur);
      if (on) {
        const kind = kindOf(name);
        if (onePerKind && kind) {
          for (const n of next) if (kindOf(n) === kind) next.delete(n);
        }
        next.add(name);
      } else next.delete(name);
      return next;
    });
  // Two of a kind on the list: say a widget reads one of them.
  const kinds = (rows.suggested || [])
    .filter((r) => !r.off)
    .map((r) => normalizeType(r.type));
  const twins = onePerKind && kinds.some((k, i) => k && kinds.indexOf(k) !== i);
  const rowOf = (r, compact = false) => {
    const on = ticked.has(r.name) && !r.off;
    return (
      <div
        key={r.name}
        className={`flex flex-row items-start gap-2 rounded-lg border ${compact ? "px-2 py-1" : "px-3 py-2"} ${on ? statusTokens.info.accentBorder : hairline} ${r.off ? "opacity-60" : ""}`}
        data-testid="provider-pick-row"
        data-ticked={on ? "true" : "false"}
      >
        <Checkbox
          checked={on}
          disabled={r.off || readOnly}
          onChange={(v) => toggle(r.name, v)}
          aria-label={`Use ${r.name}`}
        />
        <ProviderLine row={r} compact={compact} />
      </div>
    );
  };
  const others = rows.others || [];
  return (
    <div className="flex flex-col gap-2" data-testid="provider-pick">
      {(rows.suggested || []).map((r) => rowOf(r))}
      {others.length ? (
        showOthers ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-row items-center justify-between gap-2">
              <span className={`text-xs ${muted}`}>
                Your other compatible providers — {othersNote}
              </span>
              <Button3
                size="sm"
                title="Hide"
                onClick={() => setShowOthers(false)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {others.map((r) => rowOf(r, true))}
            </div>
          </div>
        ) : (
          <div>
            <Button3
              size="sm"
              title={`Show other compatible providers (${others.length})`}
              onClick={() => setShowOthers(true)}
            />
          </div>
        )
      ) : null}
      {twins ? (
        <span className={`text-xs ${muted}`}>
          A widget reads one of each kind — ticking another of the same kind
          swaps it.
        </span>
      ) : null}
      <span className={`text-xs ${muted}`}>
        Need one that isn&apos;t listed? Add it on the Providers page — this
        conversation keeps your place.
      </span>
      {readOnly ? null : (
        <div
          className={`flex flex-row items-center gap-3 ${onCancel ? "justify-end" : ""}`}
        >
          {onCancel ? <Button3 title="Cancel" onClick={onCancel} /> : null}
          <Button
            title={
              actionLabel
                ? actionLabel(picked)
                : picked.length > 1
                  ? `Use these ${picked.length}`
                  : "Use this"
            }
            disabled={!picked.length}
            onClick={() => onUse(picked)}
          />
          {onCancel ? null : (
            <span className={`text-xs ${muted}`}>
              {!picked.length
                ? "Pick at least one"
                : picked.length > 1
                  ? "A new widget shows them together"
                  : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Choose — or change — what one planned widget reads from, in a window:
 * its kind of provider first, the rest of the user's one tap away. The
 * plan is pinned to the pick; nothing is built.
 *
 * @param {object} plan
 * @param {number} index           the widget piece
 * @param {(plan, note) => void} onEdit
 */
export const ChooseProviderDialog = ({
  plan,
  index,
  onEdit,
  onClose,
  onDone = null,
  // The names the user picked in this conversation, and where a pick goes.
  picked = [],
  onPicked = null,
  // Where the change goes to be planned again (the Planner, with its
  // words); without it the plan just takes the pick.
  onReplan = null,
}) => {
  // providers.json + what the app loaded: never empty by mistake.
  const known = useKnownProviders();
  const { muted, strong, hairline } = useConfigTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme || {}, {
    grow: false,
  });
  const piece = ((plan && plan.pieces) || [])[index];
  if (!piece) return null;
  const types = (Array.isArray(piece.providers) ? piece.providers : []).map(
    normalizeType,
  );
  // Found by the app: each kind's providers, and ones whose tools match.
  const suggested = [];
  for (const t of types) {
    for (const n of candidatesFor(t, known)) {
      if (!suggested.includes(n)) suggested.push(n);
    }
  }
  const reasons = {};
  for (const n of suggested) reasons[n] = reasonFor(n, types, known);
  const rows = providerPickRows(known, suggested, { reasons });
  // Ticked: only what the user already picked for it — never the AI's pick.
  const mine = (picked || []).map((n) => String(n).toLowerCase());
  const pinned = readsNow(piece, known).filter((n) =>
    mine.includes(n.toLowerCase()),
  );
  return (
    <Modal
      isOpen
      setIsOpen={(v) => !v && onClose()}
      width="w-1/2"
      height="h-auto"
    >
      <div
        data-testid="choose-provider"
        className={`flex flex-col gap-4 rounded-lg border p-6 ${panel.backgroundColor || ""} ${panel.textColor || ""} ${hairline}`}
      >
        <span className={`text-lg font-semibold ${strong}`}>
          What should {piece.name} read from?
        </span>
        <span className={`text-sm ${muted}`}>
          Pick what it reads from — more than one kind shows them together.
          Changing this changes the plan; nothing is built until you say yes.
        </span>
        <ProviderPick
          rows={rows}
          initial={pinned}
          othersNote="not found for this. Pick one and the Planner says whether it can do it."
          actionLabel={
            onReplan
              ? (chosen) =>
                  chosen.length === 1
                    ? `Re-plan with ${chosen[0].name}`
                    : chosen.length
                      ? `Re-plan with these ${chosen.length}`
                      : "Re-plan"
              : null
          }
          onCancel={onClose}
          onUse={(chosen) => {
            const { plan: next, note } = pinWidgetProviders(
              plan,
              index,
              chosen,
            );
            if (onReplan && note) {
              // The Planner plans again with it; the plan takes it now.
              onEdit(next, null);
              const names = chosen.map((p) => p.name).join(" and ");
              onReplan(
                `${piece.name} reads from ${names} now — the user changed it. Plan it again with ${names} (their saved tools) and say what changes.`,
                `Read from ${names}`,
              );
            } else if (note) onEdit(next, note);
            if (onPicked) onPicked(chosen.map((p) => p.name));
            (onDone || onClose)();
          }}
        />
      </div>
    </Modal>
  );
};

/**
 * Under a planned widget: what it reads from, by name — or that the user
 * still has to choose. Change opens ChooseProviderDialog.
 */
export const ReadsFrom = ({
  piece,
  onChange = null,
  picked = null,
  changeHint = "",
}) => {
  // providers.json + what the app loaded: never empty by mistake.
  const known = useKnownProviders();
  const { muted } = useConfigTokens();
  const types = (Array.isArray(piece && piece.providers) ? piece.providers : [])
    .map(normalizeType)
    .filter(Boolean);
  if (!types.length) return null;
  const list = (
    Array.isArray(known) ? known : Object.values(known || {})
  ).filter((p) => p && p.name && p.providerClass !== "connector");
  const mine = Array.isArray(picked)
    ? picked.map((n) => String(n).toLowerCase())
    : null;
  const lines = types.map((type) => {
    const found = livePin(piece, type, known);
    // Only the user's own pick counts (when this screen knows them).
    const pin =
      found && (!mine || mine.includes(found.name.toLowerCase()))
        ? found
        : null;
    if (mine && !pin) {
      const usable = candidatesFor(type, known).filter((n) =>
        list.some((p) => p.name === n),
      );
      if (usable.length) {
        return { key: type, missing: "choose", count: usable.length };
      }
    }
    const same = list.filter((p) => normalizeType(p.type) === type);
    const p = pin || (same.length === 1 ? same[0] : null);
    if (p) {
      return {
        key: type,
        row: {
          name: p.name,
          providerClass: p.providerClass,
          kind: providerKindLabel(p),
          reason: pin
            ? reasonFor(p.name, types, known)
            : "Your only one of this kind",
        },
      };
    }
    return {
      key: type,
      missing: same.length > 1 ? "choose" : "connect",
      count: same.length,
    };
  });
  return (
    <div className="flex flex-col gap-1 w-full" data-testid="plan-reads-from">
      <span className={`text-xs font-semibold ${muted}`}>Reads from</span>
      {lines.map((l) =>
        l.row ? (
          <ProviderLine key={l.key} row={l.row} />
        ) : (
          <span
            key={l.key}
            className="text-sm"
            data-testid="plan-reads-from-missing"
          >
            {l.missing === "choose"
              ? `Choose — you have ${l.count} that can do this`
              : "Not connected yet"}
          </span>
        ),
      )}
      {onChange && !keepsConnection(piece) ? (
        <div className="flex flex-row items-center gap-2">
          <Button3
            size="sm"
            title={
              lines.some((l) => l.missing === "choose") ? "Choose" : "Change"
            }
            onClick={onChange}
          />
          {changeHint ? (
            <span className={`text-xs ${muted}`}>{changeHint}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
