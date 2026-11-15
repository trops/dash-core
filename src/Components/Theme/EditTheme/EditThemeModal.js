import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Button,
  Button3,
  ButtonIcon3,
  ConfirmationModal,
  FontAwesomeIcon,
  InputText,
  Modal,
  SearchInput,
  SectionLabel,
  SegmentedControl,
  ThemeContext,
  deepCopy,
  getDashTokens,
  getStylesForItem,
  themeObjects,
  useStatusTokens,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { ThemeModel } from "../../../Models/ThemeModel";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { ThemeColorDots } from "../ThemeColorDots";
import { HexInput, Swatch } from "../NewTheme/NewThemeModal";
import {
  BASE_COLORS,
  GREY_COLORS,
  STRENGTH_HELP,
} from "../NewTheme/newThemeDraft";
import {
  CHANNELS,
  PART_GROUPS,
  SHADES,
  changedParts,
  changedProps,
  noneToken,
  partById,
  propValue,
  resetProp,
  setProp,
  tokenFor,
  tokenLabel,
} from "../../../utils/themeParts";
import { EditThemePreview } from "./EditThemePreview";

const STRENGTH_OPTIONS = [
  { value: "subtle", label: "Subtle" },
  { value: "balanced", label: "Balanced" },
  { value: "bold", label: "Bold" },
];
const VARIANTS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];
const SCOPES = [
  { value: "both", label: "Dark and Light" },
  { value: "dark", label: "Dark only" },
  { value: "light", label: "Light only" },
];
const SCOPE_VARIANTS = {
  both: ["dark", "light"],
  dark: ["dark"],
  light: ["light"],
};
const PICKED_STYLE = { borderColor: "var(--accent)" };
const strengthOf = (raw) =>
  STRENGTH_OPTIONS.some((o) => o.value === raw?.strength)
    ? raw.strength
    : "balanced";
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What the theme changes, counted the way the footer says it. */
export function countChanges(original, draft) {
  if (!original || !draft) return { total: 0, parts: [] };
  const parts = changedParts(original, draft);
  const colors = CHANNELS.filter((c) => original[c.key] !== draft[c.key]);
  const strength = strengthOf(original) !== strengthOf(draft) ? 1 : 0;
  const name =
    (draft.name || "").trim() && (draft.name || "").trim() !== original.name
      ? 1
      : 0;
  const inParts = parts.reduce((n, c) => n + c.props.length, 0);
  return {
    total: inParts + colors.length + strength + name,
    parts,
    colors,
  };
}

/** The colour a part really shows for a property, read off the preview. */
function shownColor(el, part, prop) {
  if (!el || prop.state || typeof window === "undefined") return null;
  const sels = prop.selector || part.selector;
  let target = el;
  if (sels) {
    target = sels.some((s) => el.matches(s))
      ? el
      : el.querySelector(sels.join(","));
    if (!target) return null;
  }
  const cs = window.getComputedStyle(target);
  const value =
    prop.css === "color"
      ? cs.color
      : prop.css === "border-color"
        ? cs.borderTopColor
        : cs.backgroundColor;
  return value && value !== "rgba(0, 0, 0, 0)" ? value : null;
}

const ChangedDot = () => {
  const status = useStatusTokens();
  return (
    <span
      className={`h-2 w-2 rounded-full ${status.warning.solidBg}`}
      aria-label="Changed"
    />
  );
};

const NavRow = ({
  icon,
  name,
  meta,
  on,
  onClick,
  dot = false,
  badge = null,
}) => {
  const { strong, muted } = useConfigTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const { accentSoft } = getDashTokens(currentTheme);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on ? "true" : "false"}
      style={on ? PICKED_STYLE : undefined}
      className={`w-full flex flex-row items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${
        on ? `border-2 ${accentSoft}` : "border border-transparent"
      }`}
    >
      {icon ? (
        <span className={`w-4 text-xs ${on ? "" : muted}`}>
          <FontAwesomeIcon icon={icon} />
        </span>
      ) : null}
      <span className={`flex-1 truncate text-sm ${strong}`}>{name}</span>
      {dot ? <ChangedDot /> : null}
      {badge}
      {meta ? <span className={`text-xs ${muted}`}>{meta}</span> : null}
    </button>
  );
};

const ChangedBadge = ({ text = "Changed" }) => {
  const status = useStatusTokens();
  return (
    <span
      className={`text-xs font-semibold rounded-md px-1.5 py-0.5 ${status.warning.bg} ${status.warning.text}`}
    >
      {text}
    </span>
  );
};

/** Frame 1: the four colors, each with its shades. */
const ColorsPane = ({ model, draft, onChange }) => {
  const { strong, muted, hairline } = useConfigTokens();
  const [editing, setEditing] = useState(null);
  const cv = model?.cssValue || {};
  return (
    <div className="flex flex-col gap-3" data-testid="colors-pane">
      <h3 className={`text-base font-semibold ${strong}`}>Colors</h3>
      <span className={`text-xs ${muted}`}>
        The four colors every part of the theme is made from. Change one and
        everything that uses it follows.
      </span>
      {CHANNELS.map((c) => (
        <div
          key={c.key}
          className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
        >
          <div className="flex flex-row items-center gap-2">
            <span
              className="h-7 w-7 rounded-md flex-shrink-0"
              style={{ backgroundColor: cv[`bg-${c.key}-500`] }}
            />
            <span className="flex flex-col flex-1 min-w-0">
              <span className={`text-sm font-semibold ${strong}`}>
                {c.name}
              </span>
              <span className={`text-xs ${muted}`}>{c.use}</span>
            </span>
            <Button3
              title={editing === c.key ? "Done" : "Change"}
              ariaLabel={`Change ${c.name}`}
              size="sm"
              onClick={() => setEditing(editing === c.key ? null : c.key)}
            />
          </div>
          <div className="flex flex-row gap-1">
            {SHADES.map((s) => (
              <span
                key={s.n}
                className="flex-1 h-3.5 rounded-sm"
                title={s.name}
                style={{ backgroundColor: cv[`bg-${c.key}-${s.n}`] }}
              />
            ))}
          </div>
          {editing === c.key ? (
            <div className="flex flex-col gap-2" data-testid="color-edit">
              <div className="flex flex-row flex-wrap gap-1.5">
                {(c.key === "neutral" ? GREY_COLORS : BASE_COLORS).map(
                  (hex) => (
                    <Swatch
                      key={hex}
                      hex={hex}
                      selected={draft[c.key] === hex}
                      onClick={() => onChange(c.key, hex)}
                    />
                  ),
                )}
              </div>
              <HexInput onUse={(hex) => onChange(c.key, hex)} />
            </div>
          ) : null}
        </div>
      ))}
      <span className={`text-xs ${muted}`}>
        Lightest → Darkest. Dash makes the shades from each color.
      </span>
    </div>
  );
};

const StrengthPane = ({ strength, onChange }) => {
  const { strong, muted } = useConfigTokens();
  return (
    <div className="flex flex-col gap-3" data-testid="strength-pane">
      <h3 className={`text-base font-semibold ${strong}`}>Strength</h3>
      <span className={`text-xs ${muted}`}>
        How much of the theme's color backgrounds and cards take.
      </span>
      <SegmentedControl
        ariaLabel="Strength"
        options={STRENGTH_OPTIONS}
        value={strength}
        onChange={onChange}
      />
      <span className={`text-xs ${muted}`}>{STRENGTH_HELP[strength]}</span>
    </div>
  );
};

/** Pick from the theme's colors: 4 colors × 5 shades, and None. */
const ShadePicker = ({ model, prop, value, onPick }) => {
  const { muted, hairline } = useConfigTokens();
  const cv = model?.cssValue || {};
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-lg border p-3 ${hairline}`}
      data-testid="shade-picker"
    >
      <span className={`text-xs ${muted}`}>Pick from the theme's colors</span>
      {CHANNELS.map((c) => (
        <div key={c.key} className="flex flex-row items-center gap-1.5">
          <span className={`text-xs w-16 ${muted}`}>{c.name}</span>
          {SHADES.map((s) => {
            const token = tokenFor(prop, c.key, s.n);
            return (
              <Swatch
                key={s.n}
                hex={cv[`bg-${c.key}-${s.n}`]}
                size="h-6 w-8"
                label={`${c.name} · ${s.name}`}
                selected={value === token}
                onClick={() => onPick(token)}
              />
            );
          })}
        </div>
      ))}
      <div className="flex flex-row items-center gap-2">
        <span className={`text-xs flex-1 ${muted}`}>Lightest → Darkest</span>
        {prop.none ? (
          <Button3
            title={prop.css === "border-color" ? "No outline" : "No fill"}
            size="sm"
            onClick={() => onPick(noneToken(prop))}
          />
        ) : null}
      </div>
    </div>
  );
};

/** Frames 2, 3, 5: one part, in plain words. */
const PartPane = ({
  part,
  original,
  draft,
  model,
  variant,
  scope,
  onScope,
  partEl,
  onSet,
  onReset,
}) => {
  const { strong, muted, hairline, accent } = useConfigTokens();
  const [picking, setPicking] = useState(null);
  useEffect(() => setPicking(null), [part.id]);
  const changed = changedProps(original, draft, part);
  const cv = model?.cssValue || {};
  return (
    <div className="flex flex-col gap-3" data-testid="part-pane">
      <div className="flex flex-row items-center gap-2">
        <h3 className={`text-base font-semibold flex-1 ${strong}`}>
          {part.label}
        </h3>
        {changed.length ? (
          <ChangedBadge text={plural(changed.length, "change")} />
        ) : null}
      </div>
      <span className={`text-xs ${muted}`}>{part.about}</span>
      <div className="flex flex-row items-center gap-2">
        <span className={`text-xs whitespace-nowrap ${muted}`}>
          Change it in
        </span>
        <SegmentedControl
          ariaLabel="Change it in"
          options={SCOPES}
          value={scope}
          onChange={onScope}
        />
      </div>
      {part.props.map((prop) => {
        const value = propValue(draft, part, prop, variant);
        const isChanged = changed.includes(prop);
        const swatch = value ? cv[value] : shownColor(partEl, part, prop);
        const open = picking === prop.id;
        return (
          <div key={prop.id} className="flex flex-col gap-1.5">
            <div
              className={`flex flex-row items-center gap-2 rounded-lg ${
                open ? "border-2" : "border"
              } ${hairline} px-2.5 py-2`}
              style={open ? PICKED_STYLE : undefined}
            >
              <button
                type="button"
                className="flex flex-col flex-1 min-w-0 text-left"
                aria-label={`${prop.label}: ${value ? tokenLabel(value) : "From the theme"}`}
                aria-expanded={open ? "true" : "false"}
                onClick={() => setPicking(open ? null : prop.id)}
              >
                <span className={`text-xs font-semibold ${strong}`}>
                  {prop.label}
                </span>
                <span className={`text-xs ${muted}`}>
                  {value ? tokenLabel(value) : "From the theme"}
                  {isChanged ? " (changed)" : ""}
                </span>
              </button>
              {isChanged ? (
                <Button3
                  title="Reset"
                  ariaLabel={`Reset ${prop.label}`}
                  size="sm"
                  onClick={() => onReset(prop)}
                />
              ) : null}
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => setPicking(open ? null : prop.id)}
                className={`h-6 w-6 rounded-md border flex-shrink-0 ${hairline}`}
                style={{ backgroundColor: swatch || "transparent" }}
              />
            </div>
            {open ? (
              <ShadePicker
                model={model}
                prop={prop}
                value={value}
                onPick={(token) => onSet(prop, token)}
              />
            ) : null}
          </div>
        );
      })}
      {changed.length ? (
        <button
          type="button"
          className={`self-start text-xs font-semibold ${accent}`}
          onClick={() => onReset(null)}
        >
          {`Reset ${part.label} to the theme`}
        </button>
      ) : null}
    </div>
  );
};

/**
 * Edit theme — one window: a dashboard preview you click to pick a part,
 * the part's colors in plain words on the right, every part listed by
 * group on the left. Nothing is saved until Save changes (theme rounds,
 * "Edit theme (proposed)").
 */
export const EditThemeModal = ({ open, themeKey, onClose, onSaved = null }) => {
  const { rawThemes, changeThemesForApplication, themeVariant, currentTheme } =
    useContext(ThemeContext) || {};
  const { dashApi, credentials } = useContext(AppContext) || {};
  const { strong, muted, hairline } = useConfigTokens();
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const [original, setOriginal] = useState(null);
  const [draft, setDraft] = useState(null);
  const [view, setView] = useState("colors");
  const [variant, setVariant] = useState(themeVariant || "dark");
  const [scope, setScope] = useState("both");
  const [openGroups, setOpenGroups] = useState([]);
  const [query, setQuery] = useState("");
  const [partRead, setPartRead] = useState({ el: null, tick: 0 });
  const [leaving, setLeaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Opened on a theme: start from what's saved, once per open.
  useEffect(() => {
    if (!open) {
      setOriginal(null);
      setDraft(null);
      return;
    }
    if (original || !themeKey || !rawThemes?.[themeKey]) return;
    const raw = deepCopy(rawThemes[themeKey]);
    setOriginal(raw);
    setDraft(deepCopy(raw));
    setView("colors");
    setVariant(themeVariant || "dark");
    setScope("both");
    setOpenGroups([]);
    setQuery("");
    setLeaving(false);
    setSaveError(null);
  }, [open, themeKey, rawThemes, original, themeVariant]);

  const model = useMemo(
    () => (draft ? ThemeModel(draft)[variant] : null),
    [draft, variant],
  );
  const changes = useMemo(
    () => countChanges(original, draft),
    [original, draft],
  );
  const part = partById(view);
  const readPart = useCallback(
    (el) => setPartRead((r) => ({ el, tick: r.tick + 1 })),
    [],
  );

  const pick = (id) => {
    setView(id);
    const p = partById(id);
    if (p) setOpenGroups((g) => (g.includes(p.group) ? g : [...g, p.group]));
  };
  const chooseScope = (s) => {
    setScope(s);
    if (s !== "both") setVariant(s);
  };
  const close = () => {
    if (changes.total > 0) setLeaving(true);
    else onClose();
  };
  const save = () => {
    if (!draft || !dashApi || !credentials || saving) return;
    const theme = {
      ...draft,
      name: (draft.name || "").trim() || original.name,
    };
    setSaving(true);
    setSaveError(null);
    dashApi.saveTheme(
      credentials.appId,
      themeKey,
      theme,
      (e, message) => {
        setSaving(false);
        if (message?.themes) changeThemesForApplication(message.themes);
        if (onSaved) onSaved(themeKey);
        onClose();
      },
      () => {
        setSaving(false);
        setSaveError(
          "Couldn't save the theme. Your changes are still here — try Save again.",
        );
      },
    );
  };

  const q = query.trim().toLowerCase();
  const groups = PART_GROUPS.map((g) => ({
    ...g,
    parts: q
      ? g.parts.filter(
          (p) =>
            p.label.toLowerCase().includes(q) ||
            g.name.toLowerCase().includes(q),
        )
      : g.parts,
  })).filter((g) => g.parts.length);
  const changedIds = changes.parts.map((c) => c.part.id);
  const onlyPart =
    changes.parts.length === 1 &&
    changes.total === changes.parts[0].props.length
      ? changes.parts[0].part
      : null;
  const leaveMessage = `You changed ${plural(changes.total, "thing")}${
    onlyPart ? ` in ${onlyPart.label}` : ""
  }. They'll be lost.`;
  // What the part's changes really cover, from what's stored.
  const modeName = (m) => (m === "dark" ? "Dark" : "Light");
  const changedIn = part
    ? ["dark", "light"].filter((m) =>
        part.props.some(
          (p) =>
            propValue(original, part, p, m) !== propValue(draft, part, p, m),
        ),
      )
    : [];
  const scopeNote =
    changedIn.length === 1
      ? changedIn[0] === variant
        ? `Showing ${modeName(variant)}: this part's changes are for ${modeName(variant)} only.`
        : `Showing ${modeName(variant)}: this part's changes are for ${modeName(changedIn[0])} only, so ${modeName(variant)} keeps the theme's ${part.label}.`
      : "This is how your dashboards look. Point at anything to see what it is; click it to change it.";

  return (
    <Modal
      isOpen={open}
      setIsOpen={(v) => {
        if (!v) close();
      }}
      width="w-11/12"
      height="h-5/6"
    >
      <div
        className={`dr-chat-shell flex flex-col h-full w-full rounded-xl overflow-hidden border ${panel.backgroundColor || ""} ${panel.borderColor || ""} ${panel.textColor || ""}`}
        data-testid="edit-theme"
      >
        <div
          className={`flex flex-row items-center gap-3 px-5 py-3 border-b ${hairline}`}
        >
          <div className="flex flex-col flex-1 min-w-0 gap-1">
            <div className="flex flex-row items-center gap-3">
              <h2 className={`text-base font-semibold ${strong}`}>
                Edit theme
              </h2>
              <div className="w-56">
                <InputText
                  value={draft?.name || ""}
                  onChange={(name) => setDraft((d) => ({ ...d, name }))}
                  placeholder="Theme name"
                  ariaLabel="Theme name"
                  height="h-8"
                  padding="px-2 py-1"
                />
              </div>
              <ThemeColorDots theme={draft} size="h-3 w-3" />
            </div>
            <span className={`text-xs ${muted}`}>
              Click anything in the preview to change it. Changes show right
              away; nothing is saved until you save.
            </span>
          </div>
          {/* Quiet, like the other row actions: the icon in the text colour. */}
          <span className="dr-row-actions">
            <ButtonIcon3
              icon="xmark"
              ariaLabel="Close"
              className="h-7 w-7"
              onClick={close}
            />
          </span>
        </div>

        {draft || rawThemes?.[themeKey] ? (
          draft && (
            <div className="flex flex-row flex-1 min-h-0">
              <div
                className={`w-64 flex-shrink-0 flex flex-col gap-1 px-3 py-3 overflow-y-auto border-r ${hairline}`}
              >
                <SectionLabel text="Theme" />
                <NavRow
                  icon="palette"
                  name="Colors"
                  on={view === "colors"}
                  dot={changes.colors.length > 0}
                  onClick={() => setView("colors")}
                />
                <NavRow
                  icon="sliders"
                  name="Strength"
                  meta={
                    STRENGTH_OPTIONS.find((o) => o.value === strengthOf(draft))
                      .label
                  }
                  on={view === "strength"}
                  dot={strengthOf(draft) !== strengthOf(original)}
                  onClick={() => setView("strength")}
                />
                <div className="pt-3">
                  <SectionLabel text="Components" />
                </div>
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder="Find a component…"
                />
                {groups.map((g) => {
                  const isOpen = q || openGroups.includes(g.name);
                  const anyChanged = g.parts.some((p) =>
                    changedIds.includes(p.id),
                  );
                  return (
                    <div key={g.name} className="flex flex-col">
                      <button
                        type="button"
                        aria-expanded={isOpen ? "true" : "false"}
                        onClick={() =>
                          setOpenGroups((o) =>
                            o.includes(g.name)
                              ? o.filter((n) => n !== g.name)
                              : [...o, g.name],
                          )
                        }
                        className="flex flex-row items-center gap-2 px-2.5 py-1.5 text-left"
                      >
                        <span className={`w-4 text-xs ${muted}`}>
                          <FontAwesomeIcon
                            icon={isOpen ? "chevron-down" : "chevron-right"}
                          />
                        </span>
                        <span
                          className={`flex-1 text-sm font-semibold ${strong}`}
                        >
                          {g.name}
                        </span>
                        {anyChanged ? <ChangedDot /> : null}
                        <span className={`text-xs ${muted}`}>
                          {g.parts.length}
                        </span>
                      </button>
                      {isOpen
                        ? g.parts.map((p) => (
                            <div key={p.id} className="pl-6">
                              <NavRow
                                name={p.label}
                                on={view === p.id}
                                badge={
                                  changedIds.includes(p.id) ? (
                                    <ChangedBadge />
                                  ) : null
                                }
                                onClick={() => pick(p.id)}
                              />
                            </div>
                          ))
                        : null}
                    </div>
                  );
                })}
                {groups.length === 0 ? (
                  <span className={`text-xs px-2.5 ${muted}`}>
                    No component matches.
                  </span>
                ) : null}
              </div>

              <div className="flex-1 min-w-0 flex flex-col gap-3 px-5 py-4 overflow-y-auto">
                <div className="flex flex-row items-center justify-between gap-3">
                  <SectionLabel
                    text={`Preview · ${
                      STRENGTH_OPTIONS.find(
                        (o) => o.value === strengthOf(draft),
                      ).label
                    }`}
                  />
                  <SegmentedControl
                    ariaLabel="Preview variant"
                    options={VARIANTS}
                    value={variant}
                    onChange={setVariant}
                  />
                </div>
                <EditThemePreview
                  theme={draft}
                  variant={variant}
                  selected={part ? part.id : null}
                  onSelect={pick}
                  onReadPart={readPart}
                />
                <span className={`text-xs ${muted}`} data-testid="preview-note">
                  {scopeNote}
                </span>
              </div>

              <div
                className={`w-96 flex-shrink-0 flex flex-col px-5 py-4 overflow-y-auto border-l ${hairline}`}
              >
                {view === "colors" ? (
                  <ColorsPane
                    model={model}
                    draft={draft}
                    onChange={(channel, hex) =>
                      setDraft((d) => ({ ...d, [channel]: hex }))
                    }
                  />
                ) : view === "strength" ? (
                  <StrengthPane
                    strength={strengthOf(draft)}
                    onChange={(strength) =>
                      setDraft((d) => ({ ...d, strength }))
                    }
                  />
                ) : part ? (
                  <PartPane
                    part={part}
                    original={original}
                    draft={draft}
                    model={model}
                    variant={variant}
                    scope={scope}
                    onScope={chooseScope}
                    partEl={partRead.el}
                    onSet={(prop, token) =>
                      setDraft((d) =>
                        setProp(d, part, prop, token, SCOPE_VARIANTS[scope]),
                      )
                    }
                    onReset={(prop) =>
                      setDraft((d) =>
                        resetProp(
                          d,
                          original,
                          part,
                          prop,
                          SCOPE_VARIANTS[scope],
                        ),
                      )
                    }
                  />
                ) : null}
              </div>
            </div>
          )
        ) : (
          <div
            className={`flex-1 flex items-center justify-center text-sm ${muted}`}
          >
            This theme isn't here any more.
          </div>
        )}

        <div
          className={`flex flex-row items-center gap-2 px-5 py-3 border-t ${hairline}`}
        >
          <span
            className={`text-xs flex-1 ${muted}`}
            data-testid="edit-theme-note"
          >
            {saveError ||
              (changes.total
                ? `${plural(changes.total, "change")} not saved yet.`
                : "No changes yet.")}
          </span>
          <Button3 title="Cancel" onClick={close} />
          <Button
            title={saving ? "Saving…" : "Save changes"}
            disabled={!changes.total || saving}
            onClick={save}
          />
        </div>
      </div>
      {leaving ? (
        <ConfirmationModal
          isOpen={true}
          setIsOpen={(v) => {
            if (!v) setLeaving(false);
          }}
          title="Leave without saving?"
          message={leaveMessage}
          confirmLabel="Leave without saving"
          cancelLabel="Keep editing"
          variant="danger"
          onCancel={() => setLeaving(false)}
          onConfirm={() => {
            setLeaving(false);
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
};

export default EditThemeModal;
