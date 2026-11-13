import React, { useEffect, useState } from "react";
import {
  Button,
  Button2,
  InputText,
  SegmentedControl,
  SelectInput,
  StatusBadge,
  useStatusTokens,
} from "@trops/dash-react";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { getWidgetPreviewRenderer } from "../../../utils/widgetPreviewRenderer";
import { providerLabel } from "../../Create/planChecklist";
import { TextLink } from "./TextLink";
import { AnswerPart, WizardAnswer } from "./WizardAnswer";

/**
 * The reuse steps' screens (the approved "A widget you already have goes
 * through its own steps"): Which one — the package's widgets, drawn live
 * from the installed bundle; Settings — its own, the Planner's value
 * first; Review — what goes in, part by part.
 */

/** The Planner's question for each reuse step, for its chat bubble. */
export function reuseQuestion(
  stage,
  { count = 0, pkgLabel = "", name = "", installed = true } = {},
) {
  if (stage === "which") {
    return {
      question: `You have ${count} widgets in ${pkgLabel || "this package"}. Which one should go in this cell?`,
      why: installed
        ? "They're installed already, so nothing needs building. Pick the one you like — or build a new one if none fits."
        : "They're in the registry — it's installed when you say yes. Pick the one you like — or build a new one if none fits.",
    };
  }
  if (stage === "settings") {
    return {
      question: `How should ${name || "it"} be set?`,
      why: "These are its own settings. My suggestion is first in each — pick what you want.",
    };
  }
  return {
    question: `Here's ${name || "your widget"}. Put it in?`,
    why: "Everything you chose, in one place. Change any part now; you'll see it run before it goes in the cell.",
  };
}

// The package's code, read once for its tiles.
const useBundle = (packageId, on) => {
  const [bundle, setBundle] = useState(null);
  useEffect(() => {
    if (!on || !packageId) return undefined;
    let live = true;
    const api = window.mainApi && window.mainApi.widgets;
    if (!api || !api.readBundle) return undefined;
    Promise.resolve(api.readBundle(packageId))
      .then((r) => {
        if (live && r && r.success && r.source) setBundle(r.source);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [packageId, on]);
  return bundle;
};

/**
 * One widget, drawn live in the sandbox at a small size — only one that
 * needs no connection (a tile never starts a server).
 */
const LiveFace = ({ Renderer, bundle, id, props, needsConnection }) => {
  const { muted, fieldBg } = useConfigTokens();
  const [failed, setFailed] = useState(false);
  const box = `h-32 rounded-lg overflow-hidden flex items-center justify-center ${fieldBg} dr-role-well`;
  if (!Renderer || needsConnection || failed || !bundle) {
    return (
      <div className={box} aria-hidden="true">
        <span className={`text-xs ${muted}`}>
          {needsConnection
            ? "Shown when you preview it"
            : !bundle && Renderer && !failed
              ? "Drawing…"
              : "No picture"}
        </span>
      </div>
    );
  }
  return (
    // Only a picture: clicks go to the tile.
    <div className={box} style={{ pointerEvents: "none" }} aria-hidden="true">
      <div className="w-full h-full">
        <Renderer
          bundleSource={bundle}
          componentName={String(id).split(".").pop()}
          declaredProviders={[]}
          widgetData={{
            providers: [],
            selectedProviders: {},
            userPrefs: null,
            uuidString: `reuse-${id}`,
          }}
          props={props}
          onError={() => setFailed(true)}
        />
      </div>
    </div>
  );
};

/**
 * Which one: each of the package's widgets as a tile; nothing picked for
 * the user (the Planner's suggestion is marked).
 */
export const ReuseWhich = ({
  ids,
  configOf,
  packageId,
  installed = true,
  picked = null,
  suggested = null,
  settings = {},
  onNext,
  onBuildNew,
  readOnly = false,
}) => {
  const { muted, strong, hairline, selectedBg } = useConfigTokens();
  const statusTokens = useStatusTokens();
  const [pick, setPick] = useState(picked);
  const Renderer = getWidgetPreviewRenderer();
  const bundle = useBundle(packageId, installed && !!Renderer);
  return (
    <WizardAnswer
      testId="reuse-which"
      actions={
        <Button
          title="Next: settings"
          disabled={readOnly || !pick}
          onClick={() => onNext(pick)}
        />
      }
    >
      <AnswerPart
        first
        title={`Your ${(configOf(ids[0]) || {}).package || ""} widgets`.replace(
          /\s+/g,
          " ",
        )}
        note={
          installed
            ? "already installed, nothing to build"
            : "from the registry"
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {ids.map((id) => {
            const c = configOf(id) || {};
            const on = pick === id;
            const needs = Array.isArray(c.providers) && c.providers.length > 0;
            return (
              <div
                key={id}
                role="radio"
                aria-checked={on}
                tabIndex={readOnly ? -1 : 0}
                data-testid="reuse-tile"
                className={`flex flex-col gap-2 rounded-xl border p-3 ${
                  on
                    ? `${selectedBg} ${statusTokens.info.accentBorder}`
                    : hairline
                } ${readOnly ? "" : "dr-clickable"}`}
                onClick={() => !readOnly && setPick(id)}
                onKeyDown={(e) => {
                  if (!readOnly && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    setPick(id);
                  }
                }}
              >
                <LiveFace
                  Renderer={installed ? Renderer : null}
                  bundle={bundle}
                  id={id}
                  props={settings}
                  needsConnection={needs}
                />
                <span className="flex flex-row items-center gap-2">
                  <span
                    className={`flex-1 min-w-0 truncate text-sm font-semibold ${strong}`}
                  >
                    {c.displayName || String(id).split(".").pop()}
                  </span>
                  {suggested === id ? (
                    <StatusBadge
                      compact
                      state="neutral"
                      label="Planner suggests"
                    />
                  ) : null}
                </span>
                {c.description ? (
                  <span className={`text-xs ${muted}`}>{c.description}</span>
                ) : null}
              </div>
            );
          })}
        </div>
        <span className={`text-xs ${muted}`}>
          {installed ? "Drawn live from the widget you have. " : ""}None of
          these is right?{" "}
          <TextLink
            title="Build a new one instead"
            disabled={readOnly}
            onClick={onBuildNew}
          />
        </span>
      </AnswerPart>
    </WizardAnswer>
  );
};

/**
 * Settings: each of its own, as choices (the Planner's suggestion first)
 * or a field to type in.
 */
export const ReuseSettings = ({
  fields,
  // What it reads from, when the user has several of the kind it needs.
  readsFrom = [],
  onNext,
  onBack,
  readOnly = false,
}) => {
  const { muted, strong } = useConfigTokens();
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.value])),
  );
  const set = (k, v) => setValues((cur) => ({ ...cur, [k]: v }));
  const [reads, setReads] = useState(() =>
    Object.fromEntries(
      readsFrom.filter((n) => n.selected).map((n) => [n.type, n.selected]),
    ),
  );
  const unpicked = readsFrom.some((n) => n.required && !reads[n.type]);
  return (
    <WizardAnswer
      testId="reuse-settings"
      actions={
        <>
          <Button
            title="Next: review"
            disabled={readOnly || unpicked}
            onClick={() => onNext(values, reads)}
          />
          {onBack ? (
            <Button2 title="Back" disabled={readOnly} onClick={onBack} />
          ) : null}
        </>
      }
    >
      {readsFrom.length ? (
        <AnswerPart
          first
          title="Reads from"
          note="your providers of the kind it's built for"
        >
          {readsFrom.map((n) => (
            <div
              key={n.type}
              className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1"
              data-testid="reuse-reads-from"
            >
              <span className={`w-48 flex-shrink-0 text-sm ${strong}`}>
                {providerLabel(n.type)}
              </span>
              {n.options.length <= 4 ? (
                <SegmentedControl
                  ariaLabel={`Which ${providerLabel(n.type)}`}
                  value={reads[n.type] || ""}
                  onChange={(v) =>
                    !readOnly && setReads((cur) => ({ ...cur, [n.type]: v }))
                  }
                  options={n.options.map((o) => ({ value: o, label: o }))}
                />
              ) : (
                <div className="w-64">
                  <SelectInput
                    label={`Which ${providerLabel(n.type)}`}
                    value={reads[n.type] || ""}
                    options={n.options.map((o) => ({ value: o, label: o }))}
                    onChange={(v) =>
                      !readOnly && setReads((cur) => ({ ...cur, [n.type]: v }))
                    }
                  />
                </div>
              )}
            </div>
          ))}
          {unpicked ? (
            <span className={`text-xs ${muted}`}>Pick which one first.</span>
          ) : null}
        </AnswerPart>
      ) : null}
      <AnswerPart
        first={!readsFrom.length}
        title="Its own settings"
        note="you can change them later too"
      >
        {fields.length ? (
          <div className="flex flex-col gap-3">
            {fields.map((f) => (
              <div
                key={f.key}
                className="flex flex-row flex-wrap items-center gap-x-4 gap-y-1"
                data-testid="reuse-setting"
              >
                <span className={`w-48 flex-shrink-0 text-sm ${strong}`}>
                  {f.label}
                </span>
                {f.kind === "choice" && f.options.length <= 4 ? (
                  <SegmentedControl
                    ariaLabel={f.label}
                    value={values[f.key]}
                    onChange={(v) => !readOnly && set(f.key, v)}
                    options={f.options}
                  />
                ) : f.kind === "choice" ? (
                  <div className="w-64">
                    <SelectInput
                      label={f.label}
                      value={values[f.key]}
                      options={f.options}
                      onChange={(v) => !readOnly && set(f.key, v)}
                    />
                  </div>
                ) : (
                  <div className="flex-1 min-w-48">
                    <InputText
                      height="h-8"
                      padding="px-2 py-1"
                      ariaLabel={f.label}
                      value={values[f.key]}
                      onChange={(v) =>
                        !readOnly && set(f.key, typeof v === "string" ? v : "")
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <span className={`text-sm ${muted}`}>
            It has no settings — it goes in as it is.
          </span>
        )}
      </AnswerPart>
    </WizardAnswer>
  );
};

/**
 * Review: what goes in, one row each, with Change; the plan's own buttons
 * (Yes, preview it) under it.
 *
 * @param {Array<{ key, label, value, chose?, change? }>} rows
 */
export const ReuseReview = ({
  rows,
  onStep,
  footer = null,
  // What stops it going in (a provider it needs that the user has none
  // of): said instead of Yes.
  blocked = null,
  // Installed already (else it comes from the registry on yes).
  installed = true,
  readOnly = false,
}) => {
  const { muted, strong, hairline } = useConfigTokens();
  const statusTokens = useStatusTokens();
  return (
    <WizardAnswer testId="reuse-review">
      <AnswerPart first title="As it will go in">
        <div className="flex flex-col">
          {rows.map((r, i) => (
            <div
              key={r.key}
              className={`flex flex-row flex-wrap items-center gap-3 py-2.5 ${
                i ? `border-t ${hairline}` : ""
              }`}
              data-testid="reuse-review-row"
            >
              <span
                className={`w-32 flex-shrink-0 text-sm font-semibold ${strong}`}
              >
                {r.label}
              </span>
              <span className={`flex-1 min-w-0 text-sm ${strong}`}>
                {r.value}
              </span>
              {r.chose ? (
                <StatusBadge compact state="success" label="You chose" />
              ) : null}
              {r.change && !readOnly ? (
                <Button2
                  size="sm"
                  title="Change"
                  ariaLabel={`Change ${r.label}`}
                  onClick={() => onStep(r.change)}
                />
              ) : null}
            </div>
          ))}
        </div>
      </AnswerPart>
      <div className="flex flex-col gap-2">
        {blocked ? (
          <span className={`text-sm ${statusTokens.warning.text}`}>
            {blocked}
          </span>
        ) : (
          <>
            {footer}
            <span className={`text-xs ${muted}`}>
              {installed
                ? "Nothing is built — it's yours already. "
                : "Nothing is built — it's installed from the registry when you say yes. "}
              You&apos;ll see it run before it goes in the cell.
            </span>
          </>
        )}
      </div>
    </WizardAnswer>
  );
};
