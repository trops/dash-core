import React, {
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Button,
  Button2,
  Button3,
  ButtonIcon,
  Card,
  InputText,
  MenuItem,
  Panel,
  Paragraph,
  ProgressBar,
  SubHeading3,
  Switch,
  Tabs,
  Tag,
  Tag2,
  Tag3,
  ThemeContext,
  getDashTokens,
} from "@trops/dash-react";
import { ThemeModel } from "../../../Models/ThemeModel";
import { ThemePartsStyle } from "../ThemePartsStyle";
import { DARK_BASE } from "../NewTheme/NewThemePreview";
import { partById } from "../../../utils/themeParts";

export const PREVIEW_SCOPE = "edit-theme-preview";

const ROWS = [
  ["9:30", "Team standup", Tag, "tag", "Work"],
  ["12:00", "Lunch with Sam", Tag2, "tag-2", "Personal"],
  ["2:00", "Dentist", Tag3, "tag-3", "Health"],
];

const noop = () => {};

/** A part you can point at and click. */
const P = ({ id, block = false, children }) =>
  block ? (
    <div data-part={id}>{children}</div>
  ) : (
    <span data-part={id} className="inline-flex">
      {children}
    </span>
  );

/**
 * The theme being edited on a small dashboard of real dash-react
 * components, scoped to this box (the app doesn't change until Save).
 * Point at a part to see what it is; click it to pick it.
 *
 * `onReadPart(el)` gets the picked part's element after each render, so the
 * side panel can show the colours it really has.
 */
export const EditThemePreview = ({
  theme,
  variant = "dark",
  selected = null,
  onSelect,
  onReadPart = null,
}) => {
  const parent = useContext(ThemeContext) || {};
  const app = getDashTokens(parent.currentTheme);
  const v = useMemo(
    () => (theme ? ThemeModel(theme)[variant] : null),
    [theme, variant],
  );
  const boxRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [marks, setMarks] = useState({ selected: null, hover: null });

  const place = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const base = box.getBoundingClientRect();
    const at = (id) => {
      if (!id) return null;
      const el = box.querySelector(`[data-part="${id}"]`);
      const target = el && (el.firstElementChild || el);
      if (!target) return null;
      const r = target.getBoundingClientRect();
      return {
        left: r.left - base.left,
        top: r.top - base.top,
        width: r.width,
        height: r.height,
        el: target,
      };
    };
    const s = at(selected);
    setMarks({ selected: s, hover: hover !== selected ? at(hover) : null });
    if (onReadPart) onReadPart(s ? s.el : null);
  }, [selected, hover, onReadPart]);

  useLayoutEffect(() => {
    place();
  }, [place, v]);

  if (!v) return null;
  const t = getDashTokens(v);
  const style = {
    ...(variant === "dark" ? DARK_BASE : {}),
    ...(v.cssVars || {}),
    background: "var(--bg)",
  };
  const partAt = (e) => {
    const el = e.target.closest && e.target.closest("[data-part]");
    return el && boxRef.current.contains(el)
      ? el.getAttribute("data-part")
      : null;
  };

  const ring = (m, strong) =>
    m ? (
      <span
        aria-hidden="true"
        className="absolute pointer-events-none rounded-lg"
        style={{
          left: m.left - 4,
          top: m.top - 4,
          width: m.width + 8,
          height: m.height + 8,
          boxShadow: `0 0 0 2px ${strong ? "var(--accent)" : "var(--hairline-strong)"}`,
        }}
      />
    ) : null;
  const label = (m, text) =>
    m ? (
      <span
        aria-hidden="true"
        className={`absolute pointer-events-none z-10 rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${app.surface} ${app.text}`}
        style={{
          left: m.left - 4,
          top: m.top + m.height + 8,
          borderColor: "var(--accent)",
        }}
      >
        {text}
      </span>
    ) : null;

  return (
    <div className="relative">
      <ThemeContext.Provider
        value={{ ...parent, currentTheme: v, theme: v, themeVariant: variant }}
      >
        <div
          ref={boxRef}
          data-mode={variant}
          data-own-theme={PREVIEW_SCOPE}
          data-testid="edit-theme-preview"
          className={`rounded-xl overflow-hidden border cursor-pointer ${t.hairline}`}
          style={style}
          onClickCapture={(e) => {
            const id = partAt(e);
            if (!id) return;
            e.preventDefault();
            e.stopPropagation();
            onSelect(id);
          }}
          onMouseOver={(e) => setHover(partAt(e))}
          onMouseLeave={() => setHover(null)}
        >
          <ThemePartsStyle variantModel={v} scope={PREVIEW_SCOPE} />
          <div
            className={`flex flex-row items-center gap-2 px-4 py-2.5 border-b ${t.hairline}`}
          >
            <P id="icon-buttons">
              <ButtonIcon
                icon="bars"
                ariaLabel="Menu"
                size="sm"
                onClick={noop}
              />
            </P>
            <span className={`text-sm font-semibold flex-1 ${t.text}`}>
              Morning
            </span>
            <P id="button-3">
              <Button3 title="Edit" size="sm" onClick={noop} />
            </P>
            <P id="button-2">
              <Button2 title="Share" size="sm" onClick={noop} />
            </P>
            <P id="button">
              <Button title="Add widget" size="sm" onClick={noop} />
            </P>
          </div>
          <div className="px-4 pt-2">
            <P id="tabs">
              <Tabs value="today" onValueChange={noop}>
                <Tabs.List>
                  <Tabs.Trigger value="today">Today</Tabs.Trigger>
                  <Tabs.Trigger value="week">This week</Tabs.Trigger>
                  <Tabs.Trigger value="done">Done</Tabs.Trigger>
                </Tabs.List>
              </Tabs>
            </P>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            <P id="card" block>
              <Card padding="p-3">
                <div className="flex flex-col">
                  <span className={`text-xs font-semibold pb-1 ${t.text}`}>
                    Calendar
                  </span>
                  {ROWS.map(([time, what, TagN, id, text]) => (
                    <div
                      key={time}
                      className={`flex flex-row items-center gap-2 py-1.5 border-t ${t.hairline}`}
                    >
                      <span className={`text-xs w-12 ${t.muted}`}>{time}</span>
                      <span className={`text-xs flex-1 ${t.text}`}>{what}</span>
                      <P id={id}>
                        <TagN
                          text={text}
                          textSize="text-xs"
                          padding="px-2 py-0.5"
                        />
                      </P>
                    </div>
                  ))}
                </div>
              </Card>
            </P>
            <Card padding="p-3">
              <div className="flex flex-col gap-2">
                <span className={`text-xs font-semibold ${t.text}`}>Inbox</span>
                <span className={`text-2xl font-semibold ${t.text}`}>12</span>
                <P id="progress" block>
                  <ProgressBar value={40} size="sm" />
                </P>
                <P id="text-box" block>
                  <InputText
                    value=""
                    onChange={noop}
                    placeholder="Search mail…"
                    ariaLabel="Search mail"
                    height="h-8"
                    padding="px-2 py-1"
                  />
                </P>
                <P id="alert" block>
                  <Alert message="2 messages couldn't send" padding="p-2" />
                </P>
              </div>
            </Card>
            <div className="col-span-2">
              <P id="panel" block>
                <Panel
                  height="h-auto"
                  scrollable={false}
                  grow={false}
                  defaultPadding="p-3"
                >
                  <div className="flex flex-row gap-4">
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                      <P id="headings" block>
                        <SubHeading3 title="Weekly plan" padding={false} />
                      </P>
                      <P id="body-text" block>
                        <Paragraph text="Three things to finish before Friday." />
                      </P>
                      <P id="switch">
                        <Switch label="Remind me" checked onChange={noop} />
                      </P>
                    </div>
                    <div className="flex flex-col w-40">
                      <P id="menu" block>
                        <MenuItem onClick={noop}>Open plan</MenuItem>
                      </P>
                      <MenuItem onClick={noop}>Share plan</MenuItem>
                    </div>
                  </div>
                </Panel>
              </P>
            </div>
          </div>
        </div>
      </ThemeContext.Provider>
      {ring(marks.hover, false)}
      {label(
        marks.hover,
        marks.hover && hover
          ? `${partById(hover)?.label || hover} · click to change`
          : "",
      )}
      {ring(marks.selected, true)}
      {label(marks.selected, partById(selected)?.label || "")}
    </div>
  );
};

export default EditThemePreview;
