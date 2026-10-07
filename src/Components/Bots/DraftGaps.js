import React, { useContext, useState } from "react";
import {
  Button3,
  Tag3,
  ThemeContext,
  useStatusTokens,
} from "@trops/dash-react";
import { AddProviderDialog } from "./AddProviderDialog";

/**
 * DraftGaps — what a lead's draft can't do yet, with the providers its
 * find_providers search suggested for each gap (bot-capabilities CAP-004 AC2,
 * CAP-005). Best tier first, one action per suggestion:
 *   - Use       — the user already has it: turn it on for this draft
 *   - Add       — built into Dash: that catalog entry's form, in a dialog
 *   - Install   — vetted: the existing install confirmation dialog
 *   - Install…  — community: the custom MCP form, pre-filled, in a dialog,
 *                 with an "unverified" warning showing exactly what will run
 * All of them open over the draft review, so its unsaved edits are kept.
 * Nothing installs without the user's click and confirmation.
 *
 * @param {Array<{ need: string, suggestions: object[] }>} gaps  draft.gaps
 * @param {object[]} toolSources      the user's providers (listToolSources)
 * @param {string[]} selectedServers  providers already on in the form
 * @param {(providerName: string) => void} onUse
 */

const TIER_LABEL = {
  installed: "Installed",
  "built-in": "Built into Dash",
  vetted: "Vetted",
  community: "Community · unverified",
};

const lower = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();

/**
 * What to offer for a suggestion, given the user's current providers:
 * { kind: "use", providerName } once they have it, else its install kind.
 */
export function gapActionFor(suggestion, toolSources = []) {
  const install = (suggestion && suggestion.install) || null;
  if (!install) return { kind: "none" };
  const sources = Array.isArray(toolSources) ? toolSources : [];
  let have = null;
  if (install.kind === "use") {
    have = sources.find((s) => s.name === install.providerName) || null;
  } else if (install.kind === "catalog" || install.kind === "vetted") {
    have = sources.find((s) => s.type && s.type === install.catalogId) || null;
  } else if (install.kind === "custom") {
    have = sources.find((s) => lower(s.name) === lower(install.name)) || null;
  }
  if (have) return { kind: "use", providerName: have.name };
  if (install.kind === "use") return { kind: "none" };
  return { kind: install.kind };
}

/** What the Add/Install dialog should open for a suggestion (else null). */
function dialogRequestFor(suggestion) {
  const install = suggestion.install;
  if (install.kind === "catalog") return { catalogId: install.catalogId };
  if (install.kind === "custom") {
    return {
      custom: {
        name: install.name || suggestion.name,
        mcpConfig: install.mcpConfig,
        credentialSchema: install.credentialSchema || {},
        warning: `Unverified: this runs third-party code on your computer — ${suggestion.runs}${
          suggestion.sourceUrl ? ` (source: ${suggestion.sourceUrl})` : ""
        }. It comes from the public MCP Registry and hasn't been reviewed by Dash. Only add it if you trust it.`,
      },
    };
  }
  return null;
}

// Vetted servers use the existing install confirmation (already a dialog).
function startVettedInstall(suggestion) {
  const install = suggestion.install;
  if (install.kind === "vetted") {
    window.dispatchEvent(
      new CustomEvent("dash:install-known-external", {
        detail: { id: install.catalogId },
      }),
    );
  }
}

export const DraftGaps = ({
  gaps = [],
  toolSources = [],
  selectedServers = [],
  onUse,
}) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const status = useStatusTokens();
  // The Add/Install dialog's request, or null when closed.
  const [adding, setAdding] = useState(null);
  const hairline = currentTheme["border-primary-dark"] || "";
  // Same muted tone as the draft banner above.
  const muted = currentTheme["text-neutral-medium"] || "";
  const Muted = ({ children, className = "" }) => (
    <span className={`text-xs ${muted} ${className}`}>{children}</span>
  );
  const list = Array.isArray(gaps) ? gaps.filter((g) => g && g.need) : [];
  if (!list.length) return null;

  return (
    <div className="flex flex-col gap-3" data-testid="draft-gaps">
      <Muted>
        What this bot can&apos;t do yet — the lead found these providers.
        Nothing is added until you choose it.
      </Muted>
      {list.map((gap) => (
        <div
          key={gap.need}
          className={`flex flex-col gap-2 rounded-lg border px-3 py-2 ${hairline}`}
        >
          <span className="text-sm font-medium">{gap.need}</span>
          {!gap.suggestions || !gap.suggestions.length ? (
            <Muted>No provider found — add one yourself in Providers.</Muted>
          ) : null}
          {(gap.suggestions || []).map((s) => {
            const action = gapActionFor(s, toolSources);
            const isOn =
              action.kind === "use" &&
              (selectedServers || []).includes(action.providerName);
            return (
              <div
                key={s.id}
                className="flex flex-row items-start justify-between gap-3"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex flex-row flex-wrap items-center gap-2">
                    <span className="text-sm">{s.name}</span>
                    <Tag3
                      text={TIER_LABEL[s.tier] || s.tier}
                      className={
                        s.tier === "community" ? status.warning.text : ""
                      }
                    />
                  </div>
                  {s.description ? <Muted>{s.description}</Muted> : null}
                  {s.runs && s.runs !== TIER_LABEL[s.tier] ? (
                    <Muted className="font-mono break-all">{s.runs}</Muted>
                  ) : null}
                  {s.credentials && s.credentials.length ? (
                    <Muted>Needs: {s.credentials.join(", ")}</Muted>
                  ) : null}
                  {s.sourceUrl ? (
                    <Muted className="break-all">Source: {s.sourceUrl}</Muted>
                  ) : null}
                </div>
                <div className="shrink-0">
                  {isOn ? (
                    <Muted>On</Muted>
                  ) : action.kind === "use" ? (
                    <Button3
                      title={`Use ${action.providerName}`}
                      size="xs"
                      onClick={() => onUse && onUse(action.providerName)}
                    />
                  ) : action.kind === "catalog" ? (
                    <Button3
                      title={`Add ${s.name}`}
                      size="xs"
                      onClick={() => setAdding(dialogRequestFor(s))}
                    />
                  ) : action.kind === "vetted" ? (
                    <Button3
                      title={`Install ${s.name}`}
                      size="xs"
                      onClick={() => startVettedInstall(s)}
                    />
                  ) : action.kind === "custom" ? (
                    <Button3
                      title={`Install ${s.name}…`}
                      size="xs"
                      onClick={() => setAdding(dialogRequestFor(s))}
                    />
                  ) : (
                    <Muted>Can&apos;t be installed from Dash</Muted>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <AddProviderDialog request={adding} onClose={() => setAdding(null)} />
    </div>
  );
};

export default DraftGaps;
