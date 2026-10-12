import React, { useContext, useEffect, useState } from "react";
import {
  Button,
  Button3,
  Modal,
  SectionLabel,
  ThemeContext,
  getStylesForItem,
  themeObjects,
} from "@trops/dash-react";
import { AppContext } from "../../Context/App/AppContext";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { ProvidersSection } from "../Settings/sections/ProvidersSection";
import { runTeamRole, extractMatches } from "../../utils/teamRoles";

/**
 * The Plan step's Before-building windows (create-entry CRE-003 AC3,
 * CRE-009 AC4; phase 4b): review an install's access, connect a provider
 * without leaving the plan, and swap a widget for another that shows the
 * same thing. None of them install or build anything.
 */

function usePanel() {
  const { currentTheme } = useContext(ThemeContext) || {};
  const panel = getStylesForItem(themeObjects.PANEL, currentTheme || {}, {
    grow: false,
  });
  return `${panel.backgroundColor || ""} ${panel.borderColor || ""} ${
    panel.textColor || ""
  }`;
}

/** A package's declared access, as lines: "gmail: search_messages, get_message". */
export function accessLines(permissions) {
  const mcp = (permissions && (permissions.mcp || permissions)) || {};
  const lines = [];
  for (const [server, block] of Object.entries(mcp)) {
    if (!block || typeof block !== "object") continue;
    const tools = Array.isArray(block.tools) ? block.tools : [];
    lines.push(
      `${server}: ${tools.length ? tools.join(", ") : "any of its tools"}`,
    );
    if (Array.isArray(block.readPaths) && block.readPaths.length) {
      lines.push(`  reads files in ${block.readPaths.join(", ")}`);
    }
    if (Array.isArray(block.writePaths) && block.writePaths.length) {
      lines.push(`  writes files in ${block.writePaths.join(", ")}`);
    }
  }
  return lines;
}

/**
 * Access from a registry listing: each widget's declared tools
 * (permissions) and the providers it uses.
 */
export function listingAccessLines(pkg) {
  const lines = [];
  for (const w of (pkg && pkg.widgets) || []) {
    for (const l of accessLines(w && w.permissions)) {
      if (!lines.includes(l)) lines.push(l);
    }
  }
  if (!lines.length) {
    const types = [
      ...new Set(
        [
          ...((pkg && pkg.providers) || []),
          ...((pkg && pkg.widgets) || []).flatMap(
            (w) => (w && w.providers) || [],
          ),
        ]
          .map((p) => p && p.type)
          .filter(Boolean),
      ),
    ];
    for (const t of types)
      lines.push(`${t}: uses this provider (tools not listed)`);
  }
  return lines;
}

/** Review & approve an install: what the package can access. */
export const InstallReviewDialog = ({ item, onApprove, onSkip, onClose }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const panel = usePanel();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    const registry = window.mainApi?.registry;
    if (!registry) {
      setState({ loading: false, error: "The registry isn't available." });
      return undefined;
    }
    // The package's own manifest first (needs a registry sign-in); else the
    // registry listing, which carries each widget's declared tools.
    (async () => {
      let manifestError = null;
      if (registry.fetchPackageManifest) {
        try {
          const res = await registry.fetchPackageManifest(item.package);
          if (res && !res.error) {
            return {
              loading: false,
              version: res.version,
              lines: accessLines(res.permissions),
            };
          }
          manifestError = (res && (res.message || res.error)) || null;
        } catch (err) {
          manifestError = err.message;
        }
      }
      if (registry.getPackage) {
        try {
          const pkg = await registry.getPackage(item.package);
          if (pkg) {
            return {
              loading: false,
              version: pkg.version,
              fromListing: true,
              lines: listingAccessLines(pkg),
            };
          }
        } catch (_e) {
          // fall through
        }
      }
      return { loading: false, error: manifestError || "not found" };
    })().then((next) => alive && setState(next));
    return () => {
      alive = false;
    };
  }, [item.package]);

  return (
    <Modal
      isOpen
      setIsOpen={(v) => !v && onClose()}
      width="w-1/2"
      height="h-auto"
    >
      <div
        data-testid="install-review"
        className={`flex flex-col gap-4 rounded-lg border p-6 ${panel} ${hairline}`}
      >
        <span className={`text-lg font-semibold ${strong}`}>{item.label}</span>
        <span className={`text-sm ${muted}`}>
          {item.package}
          {state.version ? ` · ${state.version}` : ""} — installed when you
          build, not now.
          {state.fromListing ? " (from the registry listing)" : ""}
        </span>
        <div className="flex flex-col gap-1">
          <SectionLabel text="What it can access" />
          {state.loading ? (
            <span className={`text-sm ${muted}`}>Reading the package…</span>
          ) : state.error ? (
            <span className="text-sm">
              Couldn&apos;t read what it asks for ({state.error}). You&apos;ll
              be asked again when it&apos;s installed.
            </span>
          ) : state.lines.length ? (
            state.lines.map((l, i) => (
              <span key={i} className="text-sm font-mono whitespace-pre">
                {l}
              </span>
            ))
          ) : (
            <span className="text-sm">
              Nothing — it doesn&apos;t use any of your providers.
            </span>
          )}
        </div>
        <div className="flex flex-row flex-wrap gap-2">
          <Button title="Approve" onClick={onApprove} />
          <Button3 title="Skip this piece" onClick={onSkip} />
          <Button3 title="Not now" onClick={onClose} />
        </div>
      </div>
    </Modal>
  );
};

/**
 * Connect a provider without leaving the plan: the Providers screen, opened
 * on "add <type>", in a window over Create. Types in the MCP catalog open
 * the catalog with that server picked; anything else opens the credential
 * form with the type filled in.
 */
export const ConnectDialog = ({ item, onClose, onSkip = null }) => {
  const app = useContext(AppContext) || {};
  const panel = usePanel();
  const { hairline, muted } = useConfigTokens();
  // null while looking the type up in the MCP catalog.
  const [providerClass, setProviderClass] = useState(null);

  useEffect(() => {
    let alive = true;
    const getCatalog = window.mainApi?.mcp?.getCatalog;
    Promise.resolve(getCatalog ? getCatalog() : null)
      .then((res) => {
        const servers = (res && res.catalog) || [];
        const inCatalog = servers.some(
          (sv) =>
            sv &&
            (sv.id === item.providerType || sv.type === item.providerType),
        );
        if (alive) setProviderClass(inCatalog ? "mcp" : "credential");
      })
      .catch(() => alive && setProviderClass("credential"));
    return () => {
      alive = false;
    };
  }, [item.providerType]);
  return (
    <Modal
      isOpen
      setIsOpen={(v) => !v && onClose()}
      width="w-11/12"
      height="h-5/6"
    >
      <div
        data-testid="connect-dialog"
        className={`flex flex-col h-full w-full rounded-lg border overflow-clip ${panel} ${hairline}`}
      >
        <div
          className={`flex flex-row items-center justify-between px-6 py-3 border-b ${hairline}`}
        >
          <span className="text-lg font-semibold">{item.label}</span>
          <div className="flex flex-row items-center gap-2">
            {onSkip ? (
              <Button3 title="Build without it for now" onClick={onSkip} />
            ) : null}
            <Button3 title="Done" onClick={onClose} />
          </div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          {providerClass ? (
            <ProvidersSection
              dashApi={app.dashApi || null}
              credentials={app.credentials || null}
              initialCreateRequested
              initialProviderType={item.providerType}
              initialProviderClass={providerClass}
            />
          ) : (
            <span className={`p-6 text-sm ${muted}`}>Opening…</span>
          )}
        </div>
      </div>
    </Modal>
  );
};

/**
 * Swap… — the Scout looks for other widgets that can show the same thing;
 * Build new is always on offer.
 */
export const SwapPicker = ({ piece, onPick, onCancel }) => {
  const { muted, hairline, strong } = useConfigTokens();
  const [state, setState] = useState({ loading: true, matches: [] });

  useEffect(() => {
    let alive = true;
    runTeamRole(
      "scout",
      `Find widgets other than "${piece.name}" that could show the same thing: ${
        piece.notes || piece.name
      }. Search with search_library.`,
    ).then((res) => {
      if (!alive) return;
      if (res.skipped || res.status === "failed") {
        setState({
          loading: false,
          matches: [],
          note: res.reason || res.error,
        });
        return;
      }
      setState({ loading: false, matches: extractMatches(res.output) || [] });
    });
    return () => {
      alive = false;
    };
  }, [piece.name, piece.notes]);

  return (
    <div
      data-testid="swap-picker"
      className={`flex flex-col gap-2 rounded-lg border px-3 py-2 ${hairline}`}
    >
      <span className={`text-xs ${muted}`}>
        {state.loading
          ? "The Scout is looking for alternatives…"
          : state.note
            ? `Couldn't look: ${state.note}`
            : state.matches.length
              ? "Pick one, or build new"
              : "Nothing else fits — build new, or keep it"}
      </span>
      {state.matches
        .filter((m) => m.name !== piece.name)
        .map((m, i) => (
          <div key={i} className="flex flex-row items-center gap-2 text-sm">
            <span className={`text-xs uppercase tracking-wider ${muted}`}>
              {m.source === "Registry" ? "Registry · install" : m.source}
            </span>
            <span className={`flex-1 min-w-0 truncate ${strong}`}>
              {m.name}
            </span>
            <Button3 title="Use" size="sm" onClick={() => onPick(m)} />
          </div>
        ))}
      <div className="flex flex-row gap-2">
        <Button3
          title="Build new"
          size="sm"
          onClick={() =>
            onPick({ source: "New", name: piece.name, why: piece.notes })
          }
        />
        <Button3 title="Keep it" size="sm" onClick={onCancel} />
      </div>
    </div>
  );
};
