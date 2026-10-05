import React, { useContext, useEffect, useRef, useState } from "react";
import {
  Button3,
  SearchInput,
  SegmentedControl,
  ThemeContext,
} from "@trops/dash-react";

const TYPE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "bot", label: "Bots" },
  { value: "bot-team", label: "Teams" },
];

function api() {
  return typeof window !== "undefined" && window.mainApi
    ? window.mainApi.bots
    : null;
}

function summaryLine(p) {
  const n = (p.team && p.team.members && p.team.members.length) || 0;
  return [
    p.type === "bot-team" ? `Team · ${n} bot${n === 1 ? "" : "s"}` : "Bot",
    p.author ? `by ${p.author}` : null,
    p.version ? `v${p.version}` : null,
    p.visibility === "private" ? "private" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * RegistryBrowse — find bots and teams in the Dash registry (bot-teams
 * TEAM-007 slice 3b). Searches bot names, team member names and providers;
 * picking one opens it for review (nothing installs from here).
 *
 * @param {(packageRef: string) => void} onPick
 * @param {() => void} onClose
 */
export const RegistryBrowse = ({ onPick, onClose }) => {
  const { currentTheme = {} } = useContext(ThemeContext) || {};
  const hairline = currentTheme["border-neutral-dark"] || "border-gray-700";
  const muted = currentTheme["text-neutral-medium"] || "text-gray-400";

  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const seq = useRef(0);

  useEffect(() => {
    const bots = api();
    if (!bots || !bots.searchRegistry) return undefined;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const list = await bots.searchRegistry({
          query: query.trim(),
          type: type === "all" ? null : type,
        });
        if (mine !== seq.current) return;
        setError(null);
        setResults(Array.isArray(list) ? list : []);
      } catch (e) {
        if (mine !== seq.current) return;
        setError(e.message || String(e));
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, type]);

  return (
    <section
      aria-label="Find in registry"
      className={`flex-1 min-w-0 min-h-0 flex flex-col rounded-xl border ${hairline}`}
    >
      <div className="px-5 pt-4 flex flex-col gap-3">
        <div className="flex flex-row items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Find bots and teams</h2>
          <Button3 title="Close" size="sm" onClick={onClose} />
        </div>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search bots and teams"
        />
        <SegmentedControl
          ariaLabel="Package type"
          options={TYPE_OPTIONS}
          value={type}
          onChange={setType}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-2">
        {error ? (
          <span className="text-xs text-red-400">
            {`Couldn't search the registry: ${error}`}
          </span>
        ) : null}
        {results && !results.length && !error ? (
          <span className={`text-sm ${muted}`}>
            No bots or teams found. Try a bot name, a provider (like
            &quot;gmail&quot;), or a team member&apos;s name.
          </span>
        ) : null}
        {(results || []).map((p) => (
          <div
            key={p.ref}
            className={`rounded-lg border p-3 flex flex-row items-start justify-between gap-3 ${hairline}`}
          >
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-sm font-medium">{p.displayName}</span>
              <span className={`text-xs ${muted}`}>{summaryLine(p)}</span>
              {p.description ? (
                <span className={`text-xs ${muted}`}>{p.description}</span>
              ) : null}
              {p.team && p.team.members && p.team.members.length ? (
                <span className={`text-xs ${muted}`}>
                  {`Bots: ${p.team.members.map((m) => m.name).join(", ")}`}
                </span>
              ) : null}
              {p.providerTypes && p.providerTypes.length ? (
                <span className={`text-xs ${muted}`}>
                  {`Needs: ${p.providerTypes.join(", ")}`}
                </span>
              ) : null}
            </div>
            <Button3
              title="Review"
              ariaLabel={`Review ${p.displayName}`}
              size="sm"
              onClick={() => onPick(p.ref)}
            />
          </div>
        ))}
      </div>
    </section>
  );
};
