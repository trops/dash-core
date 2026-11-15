import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Button3,
  FontAwesomeIcon,
  InputText,
  Modal,
  SearchInput,
  SectionLabel,
  SegmentedControl,
  Switch,
  ThemeContext,
  getDashTokens,
  getStylesForItem,
  themeObjects,
  useStatusTokens,
} from "@trops/dash-react";
import { AppContext } from "../../../Context/App/AppContext";
import { ThemeModel } from "../../../Models/ThemeModel";
import { useConfigTokens } from "../../Dashboard/ConfigListRow";
import { ThemeColorDots } from "../ThemeColorDots";
import {
  generateHarmonyTheme,
  generateRandomHexTheme,
  getBrandPresets,
  getThemePresets,
} from "../../../utils/themeGenerator";
import { NewThemePreview } from "./NewThemePreview";
import {
  BASE_COLORS,
  BASE_COLOR_NAMES,
  GREY_COLORS,
  hexOrNull,
  siteName,
  COLORS_TITLE,
  COLOR_ROLES,
  GO_WITH,
  STARTS,
  STRENGTH_HELP,
  buildNewTheme,
  colorsOf,
  createProblem,
  fromRegistry,
  keepGreysGrey,
  newThemeKey,
} from "./newThemeDraft";

const STRENGTH_OPTIONS = [
  { value: "subtle", label: "Subtle" },
  { value: "balanced", label: "Balanced" },
  { value: "bold", label: "Bold" },
];
const VARIANTS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];
const PRESETS_SHOWN = 6;

// A chosen option: an accent outline on a soft accent fill.
const PICKED_STYLE = { borderColor: "var(--accent)" };
const pickLook = (on, hairline, accentSoft) =>
  on ? `border-2 ${accentSoft}` : `border ${hairline}`;

/** A color you can click: the color itself is the content. */
export const Swatch = ({ hex, selected, onClick, size = "h-6 w-6", label }) => (
  <button
    type="button"
    aria-label={label || `Pick ${BASE_COLOR_NAMES[hex] || hex}`}
    aria-pressed={selected ? "true" : "false"}
    onClick={onClick}
    className={`${size} rounded-md flex-shrink-0`}
    style={{
      backgroundColor: hex,
      boxShadow: selected ? "0 0 0 2px var(--bg), 0 0 0 4px var(--text)" : "",
    }}
  />
);

/** Paste a color: a hex box and Use. */
export const HexInput = ({ onUse, label = "Or paste a color" }) => {
  const { muted } = useConfigTokens();
  const [text, setText] = useState("");
  const hex = hexOrNull(text);
  const use = () => {
    if (!hex) return;
    onUse(hex);
    setText("");
  };
  return (
    <div className="flex flex-row items-center gap-2">
      <span className={`text-xs ${muted}`}>{label}</span>
      <div className="w-32">
        <InputText
          value={text}
          onChange={setText}
          placeholder="#8B5CF6"
          ariaLabel={label}
          height="h-8"
          padding="px-2 py-1"
        />
      </div>
      <Button3 title="Use" size="sm" disabled={!hex} onClick={use} />
    </div>
  );
};

const Step = ({ n, title, children, last = false }) => {
  const { strong, hairline, accent } = useConfigTokens();
  return (
    <section
      className={`flex flex-col gap-2.5 px-5 py-3 ${last ? "" : `border-b ${hairline}`}`}
    >
      <h3
        className={`flex flex-row items-center gap-2 text-sm font-semibold ${strong}`}
      >
        <span
          className={`h-5 w-5 rounded-full border flex items-center justify-center text-xs font-bold ${accent} ${hairline}`}
        >
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
};

/** Registry search: themes others made. */
const RegistryPick = ({ picked, onPick }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const { accentSoft } = getDashTokens(currentTheme);
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ loading: true, list: [], error: null });
  useEffect(() => {
    let live = true;
    const search = window.mainApi?.registry?.searchThemes;
    if (!search) {
      setState({ loading: false, list: [], error: "unavailable" });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const result = await search(query || "", {});
        if (live) {
          setState({
            loading: false,
            list: (result && result.packages) || [],
            error: null,
          });
        }
      } catch (err) {
        if (live) {
          setState({
            loading: false,
            list: [],
            error: (err && err.message) || "search failed",
          });
        }
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  const keyOf = (p) => `${p.scope || ""}/${p.name}`;
  return (
    <div className="flex flex-col gap-2">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search themes others made…"
      />
      {state.error ? (
        <span className={`text-xs ${muted}`}>
          {state.error === "unavailable"
            ? "The registry isn't available here."
            : `Couldn't search the registry: ${state.error}`}
        </span>
      ) : state.loading && !state.list.length ? (
        <span className={`text-xs ${muted}`}>Searching…</span>
      ) : !state.list.length ? (
        <span className={`text-xs ${muted}`}>
          No themes match. Try another word.
        </span>
      ) : (
        <div className="flex flex-col gap-1.5" data-testid="registry-results">
          {state.list.slice(0, 5).map((p) => {
            const on = picked === keyOf(p);
            return (
              <button
                key={keyOf(p)}
                type="button"
                aria-pressed={on ? "true" : "false"}
                onClick={() => onPick(p, keyOf(p))}
                style={on ? PICKED_STYLE : undefined}
                className={`w-full text-left rounded-lg px-3 py-2 flex flex-row items-center gap-3 ${pickLook(
                  on,
                  hairline,
                  accentSoft,
                )}`}
              >
                <ThemeColorDots colors={p.colors} theme={p} size="h-3 w-3" />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className={`text-sm font-semibold truncate ${strong}`}>
                    {p.displayName || p.name}
                  </span>
                  <span className={`text-xs truncate ${muted}`}>
                    {p.author ? `by ${p.author}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <span className={`text-xs ${muted}`}>
        Its colors and name fill in. Change anything before you create it.
      </span>
    </div>
  );
};

/**
 * New theme (theme round, canvas page "New theme (proposed)"): one window,
 * four steps top to bottom — Start from, Colors, Strength, Name — with a
 * live preview of how dashboards will look. Nothing is saved until Create
 * theme; then the window closes and the Themes page shows the new theme.
 *
 * @param {{ open: boolean, onClose: () => void,
 *   onCreated?: (made: {key: string, name: string, usedForApp: boolean,
 *     previousAppKey: string|null}) => void }} props
 */
export const NewThemeModal = ({ open, onClose, onCreated = null }) => {
  const {
    currentTheme,
    themes,
    rawThemes,
    themeKey: appThemeKey,
    themeVariant,
    changeCurrentTheme,
    changeThemesForApplication,
  } = useContext(ThemeContext) || {};
  const { dashApi, credentials } = useContext(AppContext) || {};
  const { muted, strong, hairline, accent } = useConfigTokens();
  const { accentSoft } = getDashTokens(currentTheme);
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {});
  const status = useStatusTokens();

  const [start, setStart] = useState("preset");
  const [colors, setColors] = useState(null);
  const [picked, setPicked] = useState(null);
  const [allPresets, setAllPresets] = useState(false);
  const [base, setBase] = useState("#8b5cf6");
  const [goWith, setGoWith] = useState("complementary");
  const [url, setUrl] = useState("");
  const [site, setSite] = useState({ busy: false, found: null, error: null });
  const [editing, setEditing] = useState(null);
  const [strength, setStrength] = useState("balanced");
  const [name, setName] = useState("");
  const nameTouched = useRef(false);
  const [useForApp, setUseForApp] = useState(true);
  const siteAsk = useRef(0);
  // Made and to be the app theme: switch once the app has it (switching
  // before the saved list arrives builds the theme from nothing).
  const [pendingApp, setPendingApp] = useState(null);
  useEffect(() => {
    if (pendingApp && rawThemes && rawThemes[pendingApp]) {
      if (changeCurrentTheme) changeCurrentTheme(pendingApp);
      setPendingApp(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingApp, rawThemes]);
  const [remixedFrom, setRemixedFrom] = useState(null);
  const [variant, setVariant] = useState(themeVariant || "dark");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // A fresh window each time it opens.
  useEffect(() => {
    if (!open) return;
    // Opens on the first preset, so the preview shows a theme at once.
    const first = getThemePresets()[0];
    setStart("preset");
    setColors(first ? colorsOf(first) : null);
    setPicked(first ? first.name : null);
    setAllPresets(false);
    setUrl("");
    setSite({ busy: false, found: null, error: null });
    setEditing(null);
    setStrength("balanced");
    setName(first ? first.name : "");
    nameTouched.current = false;
    setUseForApp(true);
    siteAsk.current += 1;
    setRemixedFrom(null);
    setVariant(themeVariant || "dark");
    setSaving(false);
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const suggestName = (n) => {
    if (!nameTouched.current) setName(n || "");
  };

  const fromColor = (hex, how) => {
    setColors(colorsOf(generateHarmonyTheme(hex, how)));
  };
  const shuffle = () => {
    setColors(keepGreysGrey(colorsOf(generateRandomHexTheme())));
  };

  const chooseStart = (value) => {
    if (value === start) return;
    setStart(value);
    // A name Dash filled in belongs to the old start; an answer still on
    // its way from a website is for the old start too.
    if (!nameTouched.current) setName("");
    siteAsk.current += 1;
    setSite({ busy: false, found: null, error: null });
    setPicked(null);
    setEditing(null);
    setRemixedFrom(null);
    setColors(null);
    if (value === "color") fromColor(base, goWith);
    if (value === "random") shuffle();
  };

  const getSiteColors = () => {
    const address = url.trim();
    if (!address || !dashApi) return;
    siteAsk.current += 1;
    const ask = siteAsk.current;
    const current = () => ask === siteAsk.current;
    setSite({ busy: true, found: null, error: null });
    const fail = (message) =>
      current() && setSite({ busy: false, found: null, error: message });
    dashApi.extractThemeFromUrl(
      address,
      (e, result) => {
        if (!current()) return;
        const palette = result && result.data && result.data.palette;
        if (!result || !result.success || !palette || !palette.length) {
          fail(
            (result && result.error && result.error.message) ||
              "No colors found on that page.",
          );
          return;
        }
        // Dash picks which found color does which job.
        dashApi.mapPaletteToTheme(
          palette,
          {},
          (e2, mapped) => {
            if (!current()) return;
            const theme = (mapped && mapped.theme) || mapped;
            const c = colorsOf(theme);
            if (!c) {
              fail("Couldn't turn those colors into a theme.");
              return;
            }
            setColors(c);
            setSite({ busy: false, found: palette.length, error: null });
            suggestName(siteName(address));
          },
          (e2, err) => fail((err && err.message) || String(err)),
        );
      },
      (e, err) =>
        fail(
          (err && (err.message || (err.error && err.error.message))) ||
            "Couldn't read that page.",
        ),
    );
  };

  const draft = useMemo(() => {
    const c = colorsOf(colors);
    return c ? { name: name || "New theme", ...c, strength } : null;
  }, [colors, name, strength]);
  const swatchOf = useMemo(() => {
    const vars = draft ? ThemeModel(draft).dark.cssVars || {} : {};
    return (role) => vars[`--${role}-500`];
  }, [draft]);

  const problem = createProblem({ colors, name });
  const canCreate = !problem && !saving && !!dashApi && !!credentials;

  const create = () => {
    if (!canCreate) return;
    const key = newThemeKey(themes);
    const theme = buildNewTheme({ key, colors, name, strength, remixedFrom });
    const previousAppKey = appThemeKey || null;
    setSaving(true);
    setSaveError(null);
    dashApi.saveTheme(
      credentials.appId,
      key,
      theme,
      (e, message) => {
        if (message && message.themes && changeThemesForApplication) {
          changeThemesForApplication(message.themes);
        }
        const usedForApp = useForApp;
        if (usedForApp) setPendingApp(key);
        setSaving(false);
        if (onCreated) {
          onCreated({ key, name: theme.name, usedForApp, previousAppKey });
        }
        onClose();
      },
      (e, err) => {
        setSaving(false);
        setSaveError(
          `Couldn't save the theme: ${(err && err.message) || String(err)}`,
        );
      },
    );
  };

  const describe = () => {
    onClose();
    window.dispatchEvent(
      new CustomEvent("dash:open-workspace", {
        detail: {
          key: "role:dashlead",
          making: { kind: "theme", from: "themes" },
        },
      }),
    );
  };

  const presets = [...getThemePresets(), ...getBrandPresets()];
  const shownPresets = allPresets ? presets : presets.slice(0, PRESETS_SHOWN);
  const editRole = COLOR_ROLES.find((r) => r.key === editing);

  return (
    <Modal
      isOpen={open}
      setIsOpen={(v) => {
        if (!v) onClose();
      }}
      width="w-11/12"
      height="h-5/6"
    >
      <div
        className={`dr-chat-shell flex flex-col h-full w-full rounded-xl overflow-hidden border ${panel.backgroundColor || ""} ${panel.borderColor || ""} ${panel.textColor || ""}`}
        data-testid="new-theme"
      >
        <div
          className={`flex flex-row items-center gap-3 px-5 py-4 border-b ${hairline}`}
        >
          <div className="flex flex-col flex-1 min-w-0">
            <h2 className={`text-base font-semibold ${strong}`}>New theme</h2>
            <span className={`text-xs ${muted}`}>
              Four steps, top to bottom. The preview on the right is how your
              dashboards will look.
            </span>
          </div>
          <Button3 title="✕" ariaLabel="Close" size="sm" onClick={onClose} />
        </div>

        <div className="flex flex-row flex-1 min-h-0">
          <div
            className={`w-1/2 flex flex-col overflow-y-auto border-r ${hairline}`}
          >
            <Step n={1} title="Start from">
              <div
                className="grid grid-cols-5 gap-2"
                role="group"
                aria-label="Start from"
              >
                {STARTS.map((s) => {
                  const on = s.value === start;
                  return (
                    <button
                      key={s.value}
                      type="button"
                      aria-label={s.label}
                      aria-pressed={on ? "true" : "false"}
                      onClick={() => chooseStart(s.value)}
                      style={on ? PICKED_STYLE : undefined}
                      className={`text-left rounded-lg px-2.5 py-2 flex flex-col gap-1 ${pickLook(
                        on,
                        hairline,
                        accentSoft,
                      )}`}
                    >
                      <FontAwesomeIcon
                        icon={s.icon}
                        className={`h-3.5 w-3.5 ${on ? accent : muted}`}
                      />
                      <span
                        className={`text-sm font-semibold whitespace-nowrap ${strong}`}
                      >
                        {s.label}
                      </span>
                      <span className={`text-xs ${muted}`}>{s.sub}</span>
                    </button>
                  );
                })}
              </div>
              <span className={`text-xs ${muted}`}>
                Or{" "}
                <button
                  type="button"
                  onClick={describe}
                  className={`font-semibold ${accent}`}
                >
                  describe it to the Dash Lead
                </button>
              </span>
            </Step>

            <Step n={2} title={COLORS_TITLE[start]}>
              {start === "preset" ? (
                <div className="grid grid-cols-3 gap-1.5" data-testid="presets">
                  {shownPresets.map((p) => {
                    const on = picked === p.name;
                    return (
                      <button
                        key={p.name}
                        type="button"
                        aria-pressed={on ? "true" : "false"}
                        onClick={() => {
                          setPicked(p.name);
                          setColors(colorsOf(p));
                          suggestName(p.name);
                        }}
                        style={on ? PICKED_STYLE : undefined}
                        className={`text-left rounded-lg px-2.5 py-2 flex flex-col gap-1.5 ${pickLook(
                          on,
                          hairline,
                          accentSoft,
                        )}`}
                      >
                        <ThemeColorDots theme={p} size="h-3 w-3" />
                        <span className={`text-xs truncate ${strong}`}>
                          {p.name}
                        </span>
                      </button>
                    );
                  })}
                  {!allPresets && presets.length > PRESETS_SHOWN ? (
                    <button
                      type="button"
                      onClick={() => setAllPresets(true)}
                      className={`text-xs font-semibold text-left px-2.5 ${accent}`}
                    >
                      {`More presets (${presets.length - PRESETS_SHOWN})`}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {start === "color" ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-row flex-wrap gap-1.5">
                    {BASE_COLORS.map((hex) => (
                      <Swatch
                        key={hex}
                        hex={hex}
                        selected={base === hex}
                        onClick={() => {
                          setBase(hex);
                          fromColor(hex, goWith);
                        }}
                      />
                    ))}
                  </div>
                  <HexInput
                    onUse={(hex) => {
                      setBase(hex);
                      fromColor(hex, goWith);
                    }}
                  />
                  <div className="flex flex-row items-center gap-3">
                    <span className={`text-xs ${muted}`}>The other colors</span>
                    <SegmentedControl
                      ariaLabel="The other colors"
                      options={GO_WITH}
                      value={goWith}
                      onChange={(how) => {
                        setGoWith(how);
                        fromColor(base, how);
                      }}
                    />
                  </div>
                </div>
              ) : null}

              {start === "random" ? (
                <div className="flex flex-row items-center gap-3">
                  <Button3
                    title="↻ Shuffle again"
                    size="sm"
                    onClick={shuffle}
                  />
                  <span className={`text-xs ${muted}`}>
                    Greys stay grey; only your main, second and highlight colors
                    change.
                  </span>
                </div>
              ) : null}

              {start === "website" ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-row items-center gap-2">
                    <div className="flex-1">
                      <InputText
                        value={url}
                        onChange={setUrl}
                        placeholder="https://www.example.com"
                        ariaLabel="Website address"
                      />
                    </div>
                    <Button3
                      title={site.busy ? "Getting colors…" : "Get colors"}
                      size="sm"
                      disabled={site.busy || !url.trim()}
                      onClick={getSiteColors}
                    />
                  </div>
                  <span className={`text-xs ${muted}`}>
                    {site.error
                      ? site.error
                      : site.found
                        ? `Found ${site.found} colors on the site — Dash picked the four below. Click one to swap it.`
                        : "Paste a website's address and Dash finds its colors."}
                  </span>
                </div>
              ) : null}

              {start === "registry" ? (
                <RegistryPick
                  picked={picked}
                  onPick={(pkg, key) => {
                    const made = fromRegistry(pkg);
                    if (!made || !made.colors) return;
                    setPicked(key);
                    setColors(made.colors);
                    setRemixedFrom(made.remixedFrom);
                    if (made.strength) setStrength(made.strength);
                    suggestName(made.name);
                  }}
                />
              ) : null}

              {draft ? (
                <div className="flex flex-col gap-2" data-testid="four-colors">
                  <div className="grid grid-cols-4 gap-2">
                    {COLOR_ROLES.map((r) => {
                      const on = editing === r.key;
                      return (
                        <button
                          key={r.key}
                          type="button"
                          aria-label={`Change ${r.name}`}
                          aria-pressed={on ? "true" : "false"}
                          onClick={() => setEditing(on ? null : r.key)}
                          style={on ? PICKED_STYLE : undefined}
                          className={`text-left rounded-lg p-2 flex flex-row items-center gap-2 ${pickLook(
                            on,
                            hairline,
                            accentSoft,
                          )}`}
                        >
                          <span
                            className="h-7 w-7 rounded-md flex-shrink-0"
                            style={{ backgroundColor: swatchOf(r.key) }}
                          />
                          <span className="flex flex-col min-w-0">
                            <span className={`text-xs font-semibold ${strong}`}>
                              {r.name}
                            </span>
                            <span className={`text-xs truncate ${muted}`}>
                              {r.use}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {editRole ? (
                    <div
                      className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
                      data-testid="color-edit"
                    >
                      <span className={`text-xs font-semibold ${strong}`}>
                        {`${editRole.name} — ${editRole.use.toLowerCase()}`}
                      </span>
                      <div className="flex flex-row flex-wrap gap-1.5">
                        {(editing === "neutral"
                          ? GREY_COLORS
                          : BASE_COLORS
                        ).map((hex) => (
                          <Swatch
                            key={hex}
                            hex={hex}
                            selected={swatchOf(editing) === hex}
                            onClick={() =>
                              setColors((c) => ({
                                ...colorsOf(c),
                                [editing]: hex,
                              }))
                            }
                          />
                        ))}
                      </div>
                      <HexInput
                        onUse={(hex) =>
                          setColors((c) => ({ ...colorsOf(c), [editing]: hex }))
                        }
                      />
                    </div>
                  ) : (
                    <span className={`text-xs ${muted}`}>
                      Click a color to change it.
                    </span>
                  )}
                </div>
              ) : null}
            </Step>

            <Step n={3} title="Strength">
              <div className="flex flex-row items-center gap-3">
                <SegmentedControl
                  ariaLabel="Strength"
                  options={STRENGTH_OPTIONS}
                  value={strength}
                  onChange={setStrength}
                />
                <span className={`text-xs flex-1 ${muted}`}>
                  {STRENGTH_HELP[strength]}
                </span>
              </div>
            </Step>

            <Step n={4} title="Name it" last>
              <InputText
                value={name}
                onChange={(v) => {
                  nameTouched.current = true;
                  setName(v);
                }}
                placeholder="Theme name"
                ariaLabel="Theme name"
              />
              {draft && problem ? (
                <span
                  className={`text-xs ${status.error.icon}`}
                  data-testid="name-needed"
                >
                  {problem}
                </span>
              ) : null}
              <Switch
                label="Use it for the app now"
                checked={useForApp}
                onChange={(on) => setUseForApp(!!on)}
              />
            </Step>
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-3 px-5 py-4 overflow-y-auto">
            <div className="flex flex-row items-center justify-between gap-3">
              <SectionLabel
                text={`Preview · ${
                  STRENGTH_OPTIONS.find((o) => o.value === strength).label
                }`}
              />
              <SegmentedControl
                ariaLabel="Preview variant"
                options={VARIANTS}
                value={variant}
                onChange={setVariant}
              />
            </div>
            {draft ? (
              <NewThemePreview theme={draft} variant={variant} />
            ) : (
              <div
                className={`rounded-xl border p-8 text-center text-sm ${hairline} ${muted}`}
              >
                Pick colors and the preview shows here.
              </div>
            )}
            <span className={`text-xs ${muted}`}>
              Every dashboard and widget built from Dash components takes these
              colors. Switch Dark / Light to check both.
            </span>
          </div>
        </div>

        <div
          className={`flex flex-row items-center gap-2 px-5 py-3 border-t ${hairline}`}
        >
          <span
            className={`text-xs flex-1 ${muted}`}
            data-testid="new-theme-note"
          >
            {saveError ||
              (draft && problem) ||
              "Nothing is saved until you create it."}
          </span>
          <Button3 title="Cancel" onClick={onClose} />
          <Button
            title={saving ? "Creating…" : "Create theme"}
            disabled={!canCreate}
            tooltip={problem || undefined}
            onClick={create}
          />
        </div>
      </div>
    </Modal>
  );
};

export default NewThemeModal;
