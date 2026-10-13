import React, { useState } from "react";
import { Button2, Card2, StatusBadge } from "@trops/dash-react";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { previewBoxes, hasSamples } from "./planPreview";

/**
 * PlanSketch — the plan's dashboard sketched with made-up sample data
 * (create-entry PRD CRE-003 AC6, phase 5d). Boxes sit where the build will
 * put them; every box carries a "Sample" pill so nothing reads as live. In
 * the narrow dock (`compact`) the boxes stack in one column. A titled card
 * of its own (design guide rule 3); the boxes are shaded, not bordered —
 * a picture, not cards in a card.
 */
export const PlanSketch = ({ plan, compact = false }) => {
  const { muted, strong } = useConfigTokens();
  const [open, setOpen] = useState(true);
  const preview = previewBoxes(plan);
  if (!preview.boxes.length) return null;
  const samples = hasSamples(preview);

  return (
    <Card2
      padding="p-4"
      rounded="rounded-lg"
      shadow=""
      className="flex flex-col gap-3"
      testId="plan-preview"
    >
      <div className="flex flex-row items-center gap-2">
        <h3
          className={`flex-1 text-sm font-semibold ${strong}`}
          style={{ margin: 0 }}
        >
          Preview with sample data
        </h3>
        <Button2
          size="sm"
          title={open ? "Hide preview" : "Show preview"}
          onClick={() => setOpen((o) => !o)}
        />
      </div>
      {open ? (
        <div className={`flex flex-col gap-2 ${strong}`}>
          {/* Inline grid: the app's prebuilt CSS has no arbitrary columns. */}
          <div
            className="gap-2"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${compact ? 1 : preview.cols}, minmax(0, 1fr))`,
            }}
          >
            {preview.boxes.map((b) => (
              <div
                key={b.key}
                className="flex flex-col gap-1 rounded-md px-3 py-2"
                style={{ background: "var(--raised-2, rgba(127,127,127,.08))" }}
                data-testid="plan-preview-box"
              >
                <div className="flex flex-row items-center gap-2">
                  <span
                    className={`flex-1 min-w-0 truncate text-sm font-semibold ${strong}`}
                  >
                    {b.title}
                  </span>
                  <StatusBadge state="neutral" label="Sample" />
                </div>
                {b.lines.length ? (
                  b.lines.map((line, i) => (
                    <span key={i} className="text-sm truncate" title={line}>
                      {line}
                    </span>
                  ))
                ) : (
                  <span className={`text-sm ${muted}`}>
                    {b.note || "No sample yet."}
                  </span>
                )}
              </div>
            ))}
          </div>
          {!samples ? (
            <span className={`text-sm ${muted}`}>
              The Planner hasn't added sample data to this plan yet.
            </span>
          ) : null}
        </div>
      ) : null}
    </Card2>
  );
};

export default PlanSketch;
