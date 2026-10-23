import React, { useEffect, useState } from "react";
import {
  Button3,
  ConfirmationModal,
  ListRow,
  SectionLabel,
} from "@trops/dash-react";
import { recentStatus } from "./recentRows";
import { draftAge } from "./createRouting";
import { planRemoveCopy } from "./PlanMenu";

/** How many unfinished plans the start screen lists. */
export const UNFINISHED_LIMIT = 5;

// Saved but never built, a build still running or waiting for a
// connection, one that stopped part-way (it offers Continue building), or
// one that finished with problems. Cleanly built work isn't listed — it's
// Recently created in the dashboard's Add list.
const UNFINISHED = new Set([
  "draft",
  "building",
  "waiting",
  "stopped",
  "interrupted",
  "problems",
]);
// A build began: what it built stays when the plan is forgotten.
const STARTED = new Set([
  "building",
  "waiting",
  "stopped",
  "interrupted",
  "problems",
]);

const ms = (t) => (typeof t === "number" ? t : Date.parse(t) || 0);

/**
 * The unfinished plans among the saved ones, newest first:
 * { id, title, status, updatedAt (ms), started } — `started` when a build
 * began (its confirm says what it built stays).
 */
export function unfinishedPlans(plans = [], limit = UNFINISHED_LIMIT) {
  return (plans || [])
    .filter(
      (p) =>
        p &&
        p.id &&
        p.kind !== "question" &&
        UNFINISHED.has(p.status || "draft"),
    )
    .map((p) => ({
      id: p.id,
      title: p.title || "Untitled plan",
      status: recentStatus(p),
      updatedAt: ms(p.updatedAt),
      started: STARTED.has(p.status),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/** The saved plans, kept current while mounted. */
function useSavedPlans() {
  const [plans, setPlans] = useState([]);
  useEffect(() => {
    let alive = true;
    const bots = window.mainApi && window.mainApi.bots;
    if (!bots || !bots.listCreateRecent) return undefined;
    const load = () =>
      Promise.resolve(bots.listCreateRecent())
        .then((l) => alive && Array.isArray(l) && setPlans(l))
        .catch(() => {});
    load();
    const id = bots.onCreateRecent ? bots.onCreateRecent(load) : null;
    return () => {
      alive = false;
      if (id != null && bots.removeListener) bots.removeListener(id);
    };
  }, []);
  return plans;
}

/**
 * Create's start screen: plans you didn't finish, with **Continue** (reopens
 * the plan as it was left — a stopped build offers Continue building) and
 * **Discard** (or **Forget** once it built something — the plan's "…"
 * menu's words, and its confirm). Renders
 * nothing when there are none.
 */
export const UnfinishedPlans = ({ onContinue }) => {
  const plans = useSavedPlans();
  const [confirming, setConfirming] = useState(null);
  const rows = unfinishedPlans(plans);
  if (!rows.length) return null;
  const copy = confirming
    ? planRemoveCopy({ title: confirming.title, built: confirming.started })
    : null;
  const forget = async (row) => {
    const bots = window.mainApi && window.mainApi.bots;
    if (!bots || !bots.removeCreateRecent) return;
    try {
      await bots.removeCreateRecent(row.id);
    } catch (_e) {
      // It stays listed; try again.
    }
  };
  return (
    <section className="flex flex-col gap-1" data-testid="create-unfinished">
      <SectionLabel text="Unfinished" />
      {rows.map((row) => (
        <ListRow
          key={row.id}
          testId="unfinished-row"
          icon="table-cells-large"
          title={row.title}
          meta={`${row.status} · ${draftAge(row.updatedAt)}`}
          ariaLabel={`${row.title} · ${row.status}`}
          onClick={() => onContinue(row)}
          trailing={
            <span className="inline-flex items-center gap-1">
              <Button3
                size="sm"
                title="Continue"
                ariaLabel={`Continue ${row.title}`}
                onClick={() => onContinue(row)}
              />
              <Button3
                size="sm"
                title={row.started ? "Forget" : "Discard"}
                ariaLabel={`${row.started ? "Forget" : "Discard"} ${row.title}`}
                onClick={() => setConfirming(row)}
              />
            </span>
          }
        />
      ))}
      {copy ? (
        <ConfirmationModal
          isOpen
          setIsOpen={(v) => !v && setConfirming(null)}
          variant="danger"
          title={copy.title}
          message={copy.message}
          confirmLabel={copy.action}
          cancelLabel="Keep it"
          onConfirm={() => {
            const row = confirming;
            setConfirming(null);
            forget(row);
          }}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </section>
  );
};

export default UnfinishedPlans;
