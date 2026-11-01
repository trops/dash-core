import React, { useContext, useEffect, useState } from "react";
import {
  ThemeContext,
  Modal,
  Button2,
  Tabs3,
  CodeEditorVS,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { useConfigTokens } from "./ConfigListRow";
import { builtText } from "./useWidgetSources";

/**
 * View code (approved mockups: widget side panel frame 5, widget versions
 * frame 4): the code a widget runs now, file by file, with its version and
 * when it was built, and Copy. Read only — changing it is Change's job.
 *
 * @param {boolean} isOpen
 * @param {() => void} onClose
 * @param {string} name     the widget's name
 * @param {object} sources  useWidgetSources(…)
 */
export const WidgetCodeModal = ({ isOpen, onClose, name, sources }) => {
  const { currentTheme } = useContext(ThemeContext);
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });
  const { muted, hairline } = useConfigTokens();
  const files = (sources && sources.files) || [];
  const [open, setOpen] = useState(files[0] ? files[0].name : "");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (files.length && !files.some((f) => f.name === open)) {
      setOpen(files[0].name);
    }
  }, [files, open]);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  if (!isOpen) return null;
  const shown = files.find((f) => f.name === open) || files[0] || null;
  const copy = () => {
    if (!shown) return;
    const done = () => setCopied(true);
    try {
      const p =
        navigator.clipboard && navigator.clipboard.writeText
          ? navigator.clipboard.writeText(shown.code)
          : null;
      if (p && p.then) p.then(done, () => {});
      else done();
    } catch (_e) {
      // nothing to copy to
    }
  };
  return (
    <Modal
      isOpen={isOpen}
      setIsOpen={(v) => {
        if (!v) onClose();
      }}
      width="w-11/12 max-w-5xl"
      height="h-5/6"
    >
      <div
        role="dialog"
        aria-label={`${name} code`}
        className={`flex flex-col h-full w-full rounded-lg overflow-clip border ${
          panelStyles.backgroundColor || ""
        } ${panelStyles.borderColor || ""} ${panelStyles.textColor || ""}`}
      >
        <div
          className={`flex-shrink-0 flex flex-row items-center gap-3 px-5 py-4 border-b ${hairline}`}
        >
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <span className="text-base font-semibold truncate">
              {name}
              {sources && sources.version ? ` · v${sources.version}` : ""}
            </span>
            <span className={`text-xs ${muted}`}>
              {["The code running now", builtText(sources && sources.builtAt)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <Button2
            title={copied ? "Copied" : "Copy"}
            onClick={copy}
            disabled={!shown}
          />
          <Button2 title="Close" onClick={onClose} />
        </div>
        {sources && sources.loading ? (
          <span className={`px-5 py-4 text-sm ${muted}`}>
            Reading its code…
          </span>
        ) : !shown ? (
          <span className={`px-5 py-4 text-sm ${muted}`}>
            {(sources && sources.error) ||
              "Its code isn't on this computer (a widget built into Dash, or one without its source)."}
          </span>
        ) : (
          <Tabs3
            value={shown.name}
            onValueChange={setOpen}
            backgroundColor="bg-transparent"
            className="flex flex-col flex-1 min-h-0 border-0"
          >
            <Tabs3.List className="mx-5 mt-3 self-start">
              {files.map((f) => (
                <Tabs3.Trigger key={f.name} value={f.name}>
                  {f.name}
                </Tabs3.Trigger>
              ))}
            </Tabs3.List>
            {files.map((f) => (
              <Tabs3.Content
                key={f.name}
                value={f.name}
                className="flex flex-col flex-1 min-h-0 px-5 pt-3 pb-5"
              >
                <div className="flex flex-col flex-1 min-h-0">
                  <CodeEditorVS
                    code={f.code}
                    language="javascript"
                    readOnly={true}
                    onChange={() => {}}
                    minimapEnabled={false}
                    padding="p-0"
                  />
                </div>
              </Tabs3.Content>
            ))}
          </Tabs3>
        )}
      </div>
    </Modal>
  );
};

export default WidgetCodeModal;
