import React, { useContext, useEffect, useState } from "react";
import {
  Button,
  Button3,
  InputText,
  Modal,
  SectionLabel,
  SegmentedControl,
  TextArea,
  ThemeContext,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { wiringText } from "./TeamImportReview";

const NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+)?$/;

const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private" },
  { value: "public", label: "Public" },
];

/** The registry's field rules (mirrors electron/bots/botPackage.js). */
export function publishFieldErrors({
  name,
  displayName,
  version,
  description,
}) {
  const errors = [];
  if (!NAME_RE.test(name || "") || name.length < 2 || name.length > 50) {
    errors.push(
      "Package name must be 2–50 lowercase letters, digits and dashes, starting with a letter.",
    );
  }
  if (!(displayName || "").trim() || displayName.length > 100) {
    errors.push("Name is required (at most 100 characters).");
  }
  if (!VERSION_RE.test(version || "")) {
    errors.push("Version must look like 1.0.0.");
  }
  if ((description || "").length > 500) {
    errors.push("Description must be at most 500 characters.");
  }
  return errors;
}

/**
 * PublishBotDialog — publish a bot or a dashboard's team to the Dash
 * registry (bot-teams TEAM-006 slice 3a). Shows exactly what will be
 * published — every bot's full instructions — because instructions can hold
 * personal details; visibility defaults to Private.
 *
 * @param {boolean} open
 * @param {object} preview  bots.previewPublish() result
 * @param {(meta) => void} onPublish  meta: { displayName, name, version, description, visibility }
 * @param {() => void} onClose
 * @param {boolean} [publishing]
 * @param {object} [result]  { package, version, visibility } after success
 * @param {string} [error]
 */
export const PublishBotDialog = ({
  open,
  preview,
  onPublish,
  onClose,
  publishing = false,
  result = null,
  error = null,
}) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const hairline = currentTheme["border-neutral-dark"] || "border-gray-700";
  const muted = currentTheme["text-neutral-medium"] || "text-gray-400";
  // The Modal is only a frame — the panel brings the theme's background.
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  const suggested = (preview && preview.suggested) || {};
  const [fields, setFields] = useState(suggested);
  useEffect(() => {
    setFields((preview && preview.suggested) || {});
  }, [preview]);
  const set = (key) => (value) => setFields((f) => ({ ...f, [key]: value }));

  if (!preview) return null;
  const isTeam = preview.kind === "team";
  const pkg = preview.pkg || {};
  const bots = isTeam ? (pkg.members || []).map((m) => m.embedded) : [pkg.bot];
  const names = isTeam
    ? Object.fromEntries(pkg.members.map((m) => [m.role, m.embedded.name]))
    : {};
  const fieldErrors = publishFieldErrors(fields);

  return (
    <Modal
      isOpen={open}
      setIsOpen={(o) => !o && onClose()}
      width="w-2/3"
      height="h-5/6"
    >
      <div
        className={`flex flex-col h-full min-h-0 rounded-lg border ${hairline} ${panel.backgroundColor || "bg-gray-900"} ${panel.textColor || "text-gray-200"}`}
      >
        <div className="px-6 pt-5 pb-3 flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            {isTeam
              ? "Publish team to the registry"
              : "Publish bot to the registry"}
          </h2>
          {preview.last ? (
            <span className={`text-xs ${muted}`}>
              {`Last published: ${preview.last.name} v${preview.last.version}`}
            </span>
          ) : null}
        </div>

        {result ? (
          <div className="px-6 py-6 flex flex-col gap-3">
            <span className="text-sm">
              {`Published ${result.package} v${result.version} (${result.visibility}).`}
            </span>
            {result.visibility === "private" ? (
              <span className={`text-xs ${muted}`}>
                Only you can see and install it until you publish a version as
                Public.
              </span>
            ) : null}
            <div className="flex flex-row justify-end">
              <Button title="Done" size="sm" onClick={onClose} />
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 flex flex-col gap-4">
              <div className="flex flex-col gap-3">
                <InputText
                  label="Name"
                  value={fields.displayName || ""}
                  onChange={set("displayName")}
                />
                <div className="flex flex-col gap-1">
                  <InputText
                    label="Package name"
                    value={fields.name || ""}
                    onChange={set("name")}
                  />
                  <span className={`text-xs ${muted}`}>
                    {`${preview.username || "you"}/${fields.name || ""}`}
                  </span>
                </div>
                <InputText
                  label="Version"
                  value={fields.version || ""}
                  onChange={set("version")}
                />
                <TextArea
                  label="Description"
                  value={fields.description || ""}
                  onChange={set("description")}
                  rows={2}
                />
                <div className="flex flex-col gap-1">
                  <SectionLabel text="Visibility" />
                  <SegmentedControl
                    ariaLabel="Visibility"
                    options={VISIBILITY_OPTIONS}
                    value={fields.visibility || "private"}
                    onChange={set("visibility")}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <SectionLabel text="What will be published" />
                <span className={`text-xs ${muted}`}>
                  {`The instructions below are published as written — check them for personal details (names, file paths, email addresses) before choosing Public. Credentials, permissions, memory and run history are never included.`}
                </span>
                {isTeam && pkg.wiring && pkg.wiring.length ? (
                  <div className="flex flex-col gap-0.5">
                    {pkg.wiring.map((w, i) => (
                      <span key={i} className="text-sm">
                        {wiringText(w, names)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {bots.map((b, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border p-3 flex flex-col gap-1 ${hairline}`}
                  >
                    <span className="text-sm font-medium">{b.name}</span>
                    <span className="text-xs whitespace-pre-wrap">
                      {b.instructions}
                    </span>
                    {(b.providers || []).length ? (
                      <span className={`text-xs ${muted}`}>
                        {`Needs: ${b.providers.map((p) => p.type).join(", ")}`}
                      </span>
                    ) : null}
                  </div>
                ))}
                {preview.notIncluded && preview.notIncluded.length ? (
                  <div className={`text-xs flex flex-col gap-0.5 ${muted}`}>
                    <span>Not included:</span>
                    {preview.notIncluded.map((n, i) => (
                      <span key={i}>{`· ${n}`}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div
              className={`flex flex-row flex-wrap items-center justify-between gap-3 px-6 py-3 border-t ${hairline}`}
            >
              <span className="text-xs text-red-400">
                {error || fieldErrors[0] || ""}
              </span>
              <div className="flex flex-row gap-2">
                <Button3 title="Cancel" size="sm" onClick={onClose} />
                <Button
                  title={publishing ? "Publishing…" : "Publish"}
                  size="sm"
                  disabled={publishing || fieldErrors.length > 0}
                  onClick={() =>
                    onPublish({
                      displayName: fields.displayName,
                      name: fields.name,
                      version: fields.version,
                      description: fields.description || "",
                      visibility:
                        fields.visibility === "public" ? "public" : "private",
                    })
                  }
                />
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
