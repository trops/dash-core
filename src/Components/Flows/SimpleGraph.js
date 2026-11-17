import React, { useEffect, useState } from "react";
import { Button, FlowGraph } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { flowsApi } from "../../hooks/useFlows";

/**
 * SimpleGraph — a dashboard with no flows yet (frame 21): what each of its
 * bots reads and where its results show. Nothing here sends or changes
 * anything, so there's nothing to check; New flow starts one.
 */
export const SimpleGraph = ({ workspace, onNewFlow }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const [rows, setRows] = useState(null);
  const api = flowsApi();

  useEffect(() => {
    let live = true;
    if (!api) return undefined;
    api
      .simpleGraph(workspace.id)
      .then((r) => live && setRows((r && r.rows) || []));
    return () => {
      live = false;
    };
  }, [api, workspace.id]);

  const steps = [];
  const edges = [];
  const layout = [];
  (rows || []).forEach((r, i) => {
    const src = `src${i}`;
    const bot = `bot${i}`;
    const row = [src, bot];
    steps.push({
      id: src,
      kind: "source",
      name: r.source.name,
      note: r.source.note,
    });
    steps.push({ id: bot, kind: "bot", name: r.bot.name, note: r.bot.note });
    edges.push({ from: src, to: bot, kind: "next", label: "reads" });
    if (r.widget) {
      const w = `w${i}`;
      steps.push({
        id: w,
        kind: "widget",
        name: r.widget.name,
        note: r.widget.note,
        dashed: true,
      });
      edges.push({ from: bot, to: w, kind: "next", label: "result" });
      row.push(w);
    }
    layout.push(row);
  });

  return (
    <div
      className="flex-1 min-h-0 overflow-auto flex flex-col gap-4 p-4"
      data-testid="simple-graph"
    >
      {steps.length ? (
        <FlowGraph
          steps={steps}
          edges={edges}
          rows={layout}
          ariaLabel="This dashboard's bots"
        />
      ) : rows ? (
        <span className={`text-sm ${muted}`}>
          This dashboard has no bots yet.
        </span>
      ) : null}
      <div
        className={`flex flex-col items-start gap-2 p-4 rounded-lg border border-dashed max-w-3xl ${hairline}`}
      >
        <span className={`text-sm font-semibold ${strong}`}>No flows yet</span>
        <span className={`text-sm ${muted}`}>
          These bots read and show; nothing here sends or changes anything, so
          there's nothing to check. When you want work done end to end, with
          checks and your approval, make a flow.
        </span>
        <Button title="New flow" size="sm" onClick={onNewFlow} />
      </div>
    </div>
  );
};

export default SimpleGraph;
