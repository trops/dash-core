import React, { useState } from "react";
import { Button3, SectionLabel } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { previewBoxes, hasSamples } from "./planPreview";

/**
 * PlanSketch — the plan's dashboard sketched with made-up sample data
 * (create-entry PRD CRE-003 AC6, phase 5d). Boxes sit where the build will
 * put them; every box says "Sample" so nothing reads as live.
 */
export const PlanSketch = ({ plan }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const [open, setOpen] = useState(true);
  const preview = previewBoxes(plan);
  if (!preview.boxes.length) return null;
  const samples = hasSamples(preview);

  return (
    <div className="flex flex-col gap-2" data-testid="plan-preview">
      <div className="flex flex-row items-center gap-2">
        <div className="flex-1">
          <SectionLabel text="Preview · sample data" />
        </div>
        <Button3
          size="sm"
          title={open ? "Hide" : "Show"}
          onClick={() => setOpen((o) => !o)}
        />
      </div>
      {open ? (
        <>
          {/* Inline grid: the app's prebuilt CSS has no arbitrary columns. */}
          <div
            className="gap-2"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${preview.cols}, minmax(0, 1fr))`,
            }}
          >
            {preview.boxes.map((b) => (
              <div
                key={b.key}
                className={`flex flex-col gap-1 rounded-lg border px-3 py-2 ${hairline}`}
                data-testid="plan-preview-box"
              >
                <div className="flex flex-row items-center gap-2">
                  <span
                    className={`flex-1 min-w-0 truncate text-xs font-semibold ${strong}`}
                  >
                    {b.title}
                  </span>
                  <span className={`text-xs ${muted}`}>Sample</span>
                </div>
                {b.lines.length ? (
                  b.lines.map((line, i) => (
                    <span key={i} className="text-xs truncate">
                      {line}
                    </span>
                  ))
                ) : (
                  <span className={`text-xs ${muted}`}>
                    {b.note || "No sample yet."}
                  </span>
                )}
              </div>
            ))}
          </div>
          {!samples ? (
            <span className={`text-xs ${muted}`}>
              The Planner hasn't added sample data to this plan yet.
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

export default PlanSketch;
