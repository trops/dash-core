import React, { useEffect, useMemo, useRef, useState } from "react";
import { WidgetContext } from "../../../Context/WidgetContext";
import { useMcpProvider } from "../../../hooks/useMcpProvider";

/**
 * Asks the provider for its tools once it's running — the app's own call
 * (useMcpProvider, internal: no widget permission, Issue or events). Draws
 * nothing; tells `onTools({ tools } | { error })`.
 */
// How long it waits for the provider before using its saved list.
export const LIVE_TOOLS_WAIT_MS = 15000;

const AskTools = ({ type, onTools }) => {
  const mcp = useMcpProvider(type, { internal: true });
  const told = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (told.current) return;
      told.current = true;
      onTools({ error: "it didn't answer in time" });
    }, LIVE_TOOLS_WAIT_MS);
    return () => clearTimeout(t);
  }, [onTools]);
  useEffect(() => {
    if (told.current) return;
    if (mcp.error) {
      told.current = true;
      onTools({ error: String(mcp.error) });
    } else if (mcp.isConnected) {
      told.current = true;
      onTools({ tools: Array.isArray(mcp.tools) ? mcp.tools : [] });
    }
  }, [mcp.isConnected, mcp.error, mcp.tools, onTools]);
  return null;
};

/**
 * The tools the wizard's provider really has, running — what each wizard
 * step is checked against before it's asked (askChecks). `pin`: { type,
 * name } of the provider it reads from, or null.
 * @returns {{ status: "none"|"reading"|"live"|"failed", tools, error?,
 *   reader }} — render `reader` (nothing shows) while it's wanted
 */
export function useLiveTools(pin) {
  const key = pin ? `${pin.type}::${pin.name}` : "";
  const [state, setState] = useState({ key: "", status: "reading", tools: [] });
  const onTools = useMemo(
    () => (r) =>
      setState(
        "error" in r
          ? {
              key,
              status: "failed",
              tools: [],
              error: r.error || "no reason given",
            }
          : {
              key,
              type: pin && pin.type,
              status: "live",
              tools: r.tools || [],
            },
      ),
    [key],
  );
  if (!pin) return { status: "none", tools: [], reader: null };
  const now = state.key === key ? state : { status: "reading", tools: [] };
  const reader =
    now.status === "reading" ? (
      <WidgetContext.Provider
        value={{
          widgetData: { selectedProviders: { [pin.type]: pin.name } },
          api: null,
        }}
      >
        <AskTools key={key} type={pin.type} onTools={onTools} />
      </WidgetContext.Provider>
    ) : null;
  return { ...now, reader };
}

export default useLiveTools;
