import React, { useContext, useEffect, useRef, useState } from "react";
import { ThemeContext } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { registryDashboards } from "./workspaceStart";

/**
 * RegistryOutput — Start from › A dashboard from the registry, on the right
 * of a new Dash Lead conversation (lead-workspace release 6c, frame 42):
 * the registry's public dashboards, each with Use this. Picking one reads
 * its package and hands it to `onUse(dashboard, config)` — it becomes a
 * plan in the conversation; nothing is installed here. `onUse` may return
 * a promise of `{ error }`, shown on the row.
 */
export const RegistryOutput = ({ onUse }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const { currentTheme } = useContext(ThemeContext) || {};
  const link = `${(currentTheme && currentTheme["text-primary-medium"]) || ""} dr-role-accent`;
  // null: still looking; [] after an error or with none.
  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  // The one being read, and a package that couldn't be.
  const [reading, setReading] = useState(null);
  const [readError, setReadError] = useState(null);

  useEffect(() => {
    let alive = true;
    const registry =
      typeof window !== "undefined" && window.mainApi
        ? window.mainApi.registry
        : null;
    if (!registry || !registry.fetchIndex) {
      setFailed(true);
      setList([]);
      return undefined;
    }
    Promise.resolve(registry.fetchIndex())
      .then((index) => {
        if (alive) setList(registryDashboards(index));
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setList([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Gone (the user moved on): a read that ends afterwards does nothing.
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const use = (d) => {
    if (reading) return;
    const api =
      typeof window !== "undefined" && window.mainApi
        ? window.mainApi.dashboardConfig
        : null;
    const cant = { key: d.key, text: `${d.name} couldn't be read.` };
    setReadError(null);
    if (!api || !api.getPackageConfig) {
      setReadError(cant);
      return;
    }
    setReading(d.key);
    // Busy until its conversation is open (or it says why not): Use this
    // can't make two.
    Promise.resolve(api.getPackageConfig(d.packageName))
      .then((res) => {
        if (!alive.current) return null;
        if (!res || !res.success || !res.config) {
          setReadError(cant);
          return null;
        }
        return Promise.resolve(onUse(d, res.config)).then((out) => {
          if (alive.current && out && out.error)
            setReadError({ key: d.key, text: out.error });
        });
      })
      .catch(() => {
        if (alive.current) setReadError(cant);
      })
      .finally(() => {
        if (alive.current) setReading(null);
      });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="workspace-registry">
      <div className="flex flex-col gap-1">
        <span className={`text-xs ${muted}`}>Start from</span>
        <span className={`text-lg font-semibold ${strong}`}>
          Dashboards in the registry
        </span>
        <span className={`text-sm ${muted}`}>
          Pick one — the Dash Lead sets it up with its widgets and bots, and you
          can change what you like first
        </span>
      </div>
      {list === null ? (
        <span className={`text-sm ${muted}`} role="status">
          Looking in the registry…
        </span>
      ) : !list.length ? (
        <span className={`text-sm ${muted}`} role="status">
          {failed
            ? "The registry couldn't be reached. Try again later, or describe what you want in the box."
            : "There are no dashboards in the registry yet."}
        </span>
      ) : (
        <div className={`flex flex-col rounded-lg border ${hairline}`}>
          {list.map((d, i) => (
            <div
              key={d.key}
              className={`flex flex-row items-start gap-3 px-3 py-2.5 ${
                i < list.length - 1 ? `border-b ${hairline}` : ""
              }`}
              data-testid="workspace-registry-row"
            >
              <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className={`text-sm ${strong}`}>{d.name}</span>
                {d.sub ? (
                  <span className={`text-xs ${muted}`}>{d.sub}</span>
                ) : null}
                {readError && readError.key === d.key ? (
                  <span className={`text-xs ${strong}`} role="alert">
                    {readError.text}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => use(d)}
                disabled={!!reading}
                aria-label={`Use this: ${d.name}`}
                aria-busy={reading === d.key}
                className={`flex-shrink-0 text-xs ${link}`}
              >
                {reading === d.key ? "Reading…" : "Use this"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RegistryOutput;
