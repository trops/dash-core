import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  Button3,
  ButtonIcon,
  Heading2,
  RadioGroup,
  SectionLabel,
  Stepper,
  TextArea,
} from "@trops/dash-react";
import { ComponentManager } from "../../ComponentManager";
import { useConfigTokens } from "../Dashboard/ConfigListRow";
import { runTeamRole } from "../../utils/teamRoles";
import { deriveWidgetOwnership } from "../../utils/widgetOwnership";
import { toPlainText } from "../Bots/botConversation";
import { useRegistryAuthGate } from "../../hooks/useRegistryAuthGate";
import { CreatePlanStep } from "./CreatePlanStep";
import {
  EDIT_STEPS,
  editStepIndex,
  resolveEditComponent,
  holdsComponent,
  inPlaceProblem,
  widgetFacts,
  widgetUsage,
  usageText,
  researchRequest,
  editPlanRequest,
} from "./editCreate";

/**
 * CreateEdit — Create › Change <widget> (consolidation Phase 3, CRE-014):
 * every "Change with AI" door opens here on that widget. The Scout says
 * what it does now; the user picks where the change goes — into the widget
 * itself (theirs only: everywhere it's used changes) or a new widget (this
 * cell only) — and says what to change. Then the Planner plans it, the
 * Builder writes a draft, the Checker checks it, and the user previews it,
 * code and all, before anything is installed.
 *
 * @param {object} edit  from the door: { component, sourcePackage, itemId,
 *   workspaceId, scope, pageId, settings, providers, error }
 * @param {Array<object>} workspaces
 * @param {() => void} onClose
 */
export const CreateEdit = ({ edit, workspaces = [], onClose }) => {
  const { muted, strong, hairline } = useConfigTokens();
  const { ensureAuthed, authGate } = useRegistryAuthGate();

  // loading | ready | missing
  const [phase, setPhase] = useState("loading");
  const [target, setTarget] = useState(null);
  const [original, setOriginal] = useState(null);
  const [username, setUsername] = useState(null);
  const [mode, setMode] = useState(null);
  const [prompt, setPrompt] = useState(
    edit && edit.error ? "Fix the error so it works again." : "",
  );
  // The Scout: { status: looking | done | skipped, text }
  const [research, setResearch] = useState({ status: "looking", text: "" });
  // null = Describe; { request } = the Planner and the build.
  const [planning, setPlanning] = useState(null);
  const [planInfo, setPlanInfo] = useState(null);
  const [buildStatus, setBuildStatus] = useState(null);
  // What was made, once it's installed: { made, mode }.
  const [done, setDone] = useState(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Which widget, whose it is, and its code as it is now.
  useEffect(() => {
    const api = (typeof window !== "undefined" && window.mainApi) || {};
    (async () => {
      let installed = [];
      try {
        installed = (await api.widgets.list()) || [];
      } catch (_e) {
        installed = [];
      }
      const component = resolveEditComponent(
        edit.component,
        edit.sourcePackage,
        installed,
      );
      const pkg = component
        ? installed.find((w) => holdsComponent(w, component))
        : null;
      if (!alive.current) return;
      if (!component || !pkg) {
        setPhase("missing");
        return;
      }
      const config = ComponentManager.config(component) || {};
      const componentName = component.split(".").pop();
      const t = {
        component,
        componentName,
        // Its name as the Widgets page shows it ("To Do List").
        displayName:
          ((pkg.widgets || []).find((w) => w && w.name === componentName) || {})
            .displayName ||
          config.displayName ||
          config.label ||
          config.name ||
          componentName,
        package: pkg.name,
        config,
      };
      let name = null;
      try {
        const status = api.registryAuth && (await api.registryAuth.getStatus());
        if (status && status.authenticated) {
          const profile = await api.registryAuth.getProfile();
          name = (profile && profile.username) || null;
        }
      } catch (_e) {
        name = null;
      }
      let src = null;
      try {
        src = await api.widgets.readSources(pkg.name, componentName);
      } catch (_e) {
        src = null;
      }
      if (!alive.current) return;
      setUsername(name);
      setTarget(t);
      setOriginal(
        src && src.success
          ? { componentCode: src.componentCode, configCode: src.configCode }
          : null,
      );
      setPhase("ready");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const owner = target
    ? deriveWidgetOwnership({
        originalPackage: target.package,
        originalComponentName: target.component,
        registryUsername: username,
      }).isOwner
    : false;
  const aiBuilt = !!(target && /^@ai-built\//i.test(target.package));
  // Theirs, and a package that can change in place: in place by default.
  // Otherwise only a new widget (the main process holds the same rule).
  const blocked = target ? inPlaceProblem(target) : null;
  const inPlace = owner && !blocked;
  useEffect(() => {
    if (phase !== "ready") return;
    // Signing in can make it theirs: back to in place.
    setMode(inPlace ? "update" : "new");
  }, [phase, inPlace]);

  // The Scout says what it does now (once).
  useEffect(() => {
    if (phase !== "ready" || !target) return;
    runTeamRole("scout", researchRequest(target), {
      onText: (t) =>
        alive.current && setResearch({ status: "looking", text: t }),
    }).then((res) => {
      if (!alive.current) return;
      if (res.skipped || res.status === "failed") {
        setResearch({ status: "skipped", text: "" });
        return;
      }
      setResearch({ status: "done", text: res.output || "" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // The build's status, for the steps.
  const buildId = planInfo ? planInfo.buildId || null : null;
  useEffect(() => {
    setBuildStatus(buildId ? "running" : null);
    const bots = typeof window !== "undefined" ? window.mainApi?.bots : null;
    if (!buildId || !bots || !bots.onPlanBuild) return undefined;
    const id = bots.onPlanBuild((payload) => {
      if (payload && payload.buildId === buildId && payload.state) {
        setBuildStatus(payload.state.status || "running");
      }
    });
    return () => {
      if (id != null && bots.removeListener) bots.removeListener(id);
    };
  }, [buildId]);

  const ws = (workspaces || []).find(
    (w) =>
      w &&
      edit.workspaceId != null &&
      String(w.id) === String(edit.workspaceId),
  );
  // A change opened from a dashboard's cell (an item to swap a new widget into).
  const fromCell = edit.itemId != null && ws ? ws : null;
  const usedOn = target ? widgetUsage(workspaces, target.component) : [];
  const facts = target
    ? widgetFacts(target.config, {
        settings: edit.settings,
        providers: edit.providers,
      })
    : null;
  const name = target ? target.displayName : "the widget";

  // Closed before it's done (Close, Escape, Discard): nothing half-made is
  // left running.
  const running = useRef({ buildId: null, done: false });
  running.current = { buildId, done: !!done };
  useEffect(
    () => () => {
      const { buildId: id, done: finished } = running.current;
      const bots = window.mainApi && window.mainApi.bots;
      if (id && !finished && bots && bots.stopPlanBuild) {
        Promise.resolve(bots.stopPlanBuild(id)).catch(() => {});
      }
    },
    [],
  );
  const close = () => onClose();

  // "Edit the code yourself": the Widget Builder on this widget, by hand
  // (dash-electron hears dash:edit-widget-code), with this cell's settings
  // and connections when the change came from one. Create closes.
  const editByHand = () => {
    if (!target) return;
    window.dispatchEvent(
      new CustomEvent("dash:edit-widget-code", {
        detail: {
          widgetComponentName: target.component,
          sourcePackage: target.package,
          widgetId:
            edit.itemId != null
              ? edit.itemId
              : `${target.package}/${target.component}`,
          workspaceId: edit.workspaceId ?? null,
          // Its cell: a new widget saved from the builder takes its place.
          gridItemId: edit.gridItemId ?? null,
          cellNumber: edit.cellNumber ?? null,
          userPrefs: edit.settings || null,
          selectedProviders: edit.providers || null,
        },
      }),
    );
    onClose();
  };

  const send = () => {
    const text = String(prompt || "").trim();
    if (!text || !target || !mode) return;
    setPlanning({
      request: editPlanRequest(text, target, mode, {
        error: edit.error || "",
        usedOn,
      }),
      prompt: text,
    });
  };

  // Installed: in place, it reloads everywhere it runs; a new widget from a
  // cell is swapped in as an unsaved change (Save keeps it).
  const finish = (made) => {
    const m = made || {};
    if (mode === "update") {
      window.dispatchEvent(
        new CustomEvent("dash:widget-changed", {
          detail: { package: target.package, component: target.component },
        }),
      );
    } else if (fromCell && m.component) {
      window.dispatchEvent(
        new CustomEvent("dash:swap-widget-in-cell", {
          detail: {
            widgetComponentName: m.component,
            widgetId: edit.itemId,
            workspaceId: edit.workspaceId,
            pageId: edit.pageId ?? null,
            scope: edit.scope || "main",
          },
        }),
      );
    }
    window.dispatchEvent(new Event("dash:widgets-updated"));
    setDone({ made: m, mode });
  };

  const signIn = async () => {
    const ok = await ensureAuthed({
      message: `Sign in to the registry to change ${name} in place.`,
    });
    if (!ok) return;
    try {
      const profile = await window.mainApi.registryAuth.getProfile();
      setUsername((profile && profile.username) || null);
    } catch (_e) {
      // still signed out
    }
  };

  const title = done
    ? done.mode === "update"
      ? `${name} is updated`
      : "The new widget is ready"
    : `Change ${name}`;

  const describe = target ? (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl flex flex-col gap-5 px-6 py-8">
        <div
          className={`flex flex-col gap-2 rounded-lg border p-4 ${hairline}`}
          data-testid="edit-research"
        >
          <div className="flex flex-row items-baseline gap-2">
            <span className={`text-xs ${muted}`}>Scout</span>
            <span className={`text-base font-semibold ${strong}`}>
              What {name} does now
            </span>
          </div>
          <span
            className="text-sm whitespace-pre-wrap"
            role={research.status === "looking" ? "status" : undefined}
            data-testid="edit-research-text"
          >
            {research.status === "looking"
              ? toPlainText(research.text) || `Reading ${name}…`
              : research.status === "skipped"
                ? "The Scout isn't available right now — here's what Dash knows about it."
                : toPlainText(research.text)}
          </span>
          <div
            className="grid gap-x-3 gap-y-1 text-sm"
            style={{ gridTemplateColumns: "5.5rem minmax(0, 1fr)" }}
            data-testid="edit-facts"
          >
            {[
              ["Settings", facts.settings.join(" · ")],
              ["Uses", facts.uses.join(" · ")],
              ["Sends", facts.sends.join(", ")],
              [
                "Package",
                `${target.package}${
                  aiBuilt ? " · AI-built" : owner ? " · yours" : ""
                }`,
              ],
            ]
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <React.Fragment key={k}>
                  <span className={muted}>{k}</span>
                  <span>{v}</span>
                </React.Fragment>
              ))}
          </div>
        </div>

        {edit.error ? (
          <div className="flex flex-col gap-1" data-testid="edit-error">
            <SectionLabel text="What went wrong" />
            <span className="text-xs font-mono break-words">{edit.error}</span>
          </div>
        ) : null}

        <div
          className={`flex flex-col gap-2 rounded-lg border p-4 ${hairline}`}
          data-testid="edit-mode"
        >
          <SectionLabel text="Where the change goes" />
          {inPlace ? (
            <RadioGroup
              name="edit-mode"
              value={mode || "update"}
              onChange={(v) => setMode(v)}
              options={[
                {
                  value: "update",
                  label: (
                    <span className="flex flex-col">
                      <span className={`font-semibold ${strong}`}>
                        Update {name} everywhere
                      </span>
                      <span className={`text-xs ${muted}`}>
                        {usedOn.length
                          ? `Every place it's used changes: ${usageText(usedOn)}.`
                          : "It isn't on a dashboard yet."}
                      </span>
                    </span>
                  ),
                },
                {
                  value: "new",
                  label: (
                    <span className="flex flex-col">
                      <span className={`font-semibold ${strong}`}>
                        Save as a new widget
                      </span>
                      <span className={`text-xs ${muted}`}>
                        {fromCell
                          ? `${name} stays as it is; the new one replaces it in this cell only.`
                          : `${name} stays as it is; the new one is added to your widgets.`}
                      </span>
                    </span>
                  ),
                },
              ]}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <span className="text-sm">
                <span className={`font-semibold ${strong}`}>
                  Save as a new widget
                </span>
                {owner && blocked
                  ? ` — ${name} ${blocked}, so it stays as it is${
                      fromCell
                        ? "; the new one replaces it in this cell only"
                        : ""
                    }.`
                  : ` — ${name} isn't yours, so it stays as it is${
                      fromCell
                        ? "; the new one replaces it in this cell only"
                        : ""
                    }.`}
              </span>
              {!aiBuilt && !username ? (
                <div className="flex flex-row flex-wrap items-center gap-2">
                  <span className={`text-xs ${muted}`}>
                    Published it yourself? Sign in to change it in place.
                  </span>
                  <Button3
                    title={`Sign in to change ${name}`}
                    size="sm"
                    onClick={signIn}
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div
            className={`flex flex-col gap-2 rounded-lg border p-3 ${hairline}`}
          >
            <TextArea
              id="edit-prompt"
              aria-label="What should change?"
              value={prompt}
              onChange={setPrompt}
              placeholder="e.g. add a date filter, last 7 days by default"
              rows={3}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="flex flex-row items-center justify-end gap-2">
              <Button
                title="Send"
                onClick={send}
                disabled={!String(prompt || "").trim() || !mode}
              />
            </div>
          </div>
          <span className={`text-xs ${muted}`} data-testid="edit-hint">
            The Planner plans the change with you; you see it running before
            anything is installed.
          </span>
        </div>

        {/* The one Change door's other way (consolidation Phase 3P): by
            hand, in the Widget Builder — for your own widgets. */}
        {owner ? (
          <div className="flex flex-col gap-2" data-testid="edit-by-hand">
            <SectionLabel>Or change it without AI</SectionLabel>
            <div>
              <Button3 title="Edit the code yourself" onClick={editByHand} />
            </div>
            <span className={`text-xs ${muted}`}>
              Opens {name}'s code in the Widget Builder.
            </span>
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  // Changed in place: another change starts from the widget as it is now.
  const again = async () => {
    setDone(null);
    setPlanning(null);
    setPlanInfo(null);
    setPrompt("");
    try {
      const src = await window.mainApi.widgets.readSources(
        target.package,
        target.componentName,
      );
      if (alive.current && src && src.success) {
        setOriginal({
          componentCode: src.componentCode,
          configCode: src.configCode,
        });
      }
    } catch (_e) {
      // the last version read stays
    }
  };

  const doneScreen = done ? (
    <div className="flex-1 min-h-0 overflow-y-auto" data-testid="edit-done">
      <div
        className={`mx-auto w-full max-w-2xl mt-10 flex flex-col gap-3 rounded-lg border p-6 ${hairline}`}
      >
        <span className={`text-xs ${muted}`}>
          {done.mode === "update" ? `Change ${name}` : "Save as a new widget"}
        </span>
        <Heading2 title={title} padding={false} />
        <span className="text-sm">
          {done.mode === "update"
            ? `${name} has the change now${
                usedOn.length ? ` on ${usageText(usedOn)}` : ""
              }. Your settings and connections are kept.`
            : fromCell
              ? `It replaced ${name} on ${fromCell.name}, with the same settings and connection. ${name} itself didn't change.`
              : `It's in your widgets — add it to a dashboard from Edit. ${name} itself didn't change.`}
        </span>
        {done.mode === "new" && fromCell ? (
          <span className="text-sm font-semibold" data-testid="edit-done-save">
            Save the dashboard to keep it. Cancel puts {name} back.
          </span>
        ) : null}
        {done.mode === "update" && !aiBuilt ? (
          <span className={`text-xs ${muted}`}>
            To share it, publish a new version from Manage › Widgets.
          </span>
        ) : null}
        <div className="flex flex-row flex-wrap gap-2 pt-2">
          <Button title="Done" onClick={onClose} />
          {done.mode === "update" ? (
            <Button3 title="Change something else" onClick={again} />
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  const plan = planning && !done && target && (
    <CreatePlanStep
      key="edit"
      prompt={planning.prompt}
      edit={{
        target,
        mode,
        request: planning.request,
        usedOn: usageText(usedOn),
        cellLabel: fromCell ? `this cell on ${fromCell.name}` : "",
        inputs: {
          settings: edit.settings || null,
          providers: edit.providers || null,
        },
        original,
      }}
      onCellDone={finish}
      onDiscard={close}
      onState={setPlanInfo}
    />
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="create-edit">
      <div
        className={`dr-panel-head flex-shrink-0 flex flex-row items-center justify-between px-6 py-3 border-b ${hairline}`}
      >
        <div className={`flex items-center gap-3 ${strong}`}>
          {planning && !buildId && !done ? (
            <ButtonIcon
              icon="arrow-left"
              onClick={() => {
                setPlanning(null);
                setPlanInfo(null);
              }}
              ariaLabel="Back"
            />
          ) : null}
          <nav
            aria-label="Where you are"
            className="flex items-center gap-2 text-lg"
          >
            <span className={muted}>Create</span>
            <span className={muted} aria-hidden="true">
              ›
            </span>
            <span className="font-semibold">{title}</span>
          </nav>
        </div>
        <ButtonIcon icon="xmark" onClick={close} ariaLabel="Close" />
      </div>
      <div
        className={`flex-shrink-0 px-6 pt-3 border-b ${hairline}`}
        data-testid="create-edit-steps"
      >
        <Stepper
          activeStep={editStepIndex({
            plan: !!planning,
            buildStatus,
            done: !!done,
          })}
          showNavigation={false}
        >
          {EDIT_STEPS.map((label) => (
            <Stepper.Step key={label} label={label} />
          ))}
        </Stepper>
      </div>
      {authGate}
      {phase === "loading" ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <span className={`text-sm ${muted}`} role="status">
            Opening the widget…
          </span>
        </div>
      ) : phase === "missing" ? (
        <div
          className="flex-1 flex flex-col items-center justify-center gap-3 p-8"
          data-testid="edit-missing"
        >
          <span className={`text-sm ${strong}`}>
            That widget isn't installed here any more, so it can't be changed.
          </span>
          <Button3 title="Close" onClick={onClose} />
        </div>
      ) : (
        doneScreen || plan || describe
      )}
    </div>
  );
};

export default CreateEdit;
