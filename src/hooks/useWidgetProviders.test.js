/**
 * useWidgetProviders — provider resolution chain.
 *
 * Pins the 3-layer chain documented in the hook header:
 *
 *   1. Widget-level binding   (layoutItem.selectedProviders[type])
 *   2. Workspace-level binding (workspace.selectedProviders[widgetId][type])
 *   3. App-default fallback   (any provider in AppContext.providers
 *                              flagged `isDefaultForType: true`)
 *   4. null — widget renders its own "no provider" empty state
 *
 * Layer 3 was missing for a long stretch — `useMcpProvider` had it but
 * `useWidgetProviders` (used by credential-class widgets) only did 1+2,
 * so the Settings → Providers "Use as default" toggle was a no-op for
 * every credential widget in the ecosystem. These tests guard against
 * regression. Don't drop the layer-3 cases without surfacing the
 * upstream UX impact first.
 */

import React from "react";
import { renderHook } from "@testing-library/react";
import { useWidgetProviders } from "./useWidgetProviders";
import { AppContext } from "../Context/App/AppContext";
import { WorkspaceContext } from "../Context/WorkspaceContext";
import { WidgetContext } from "../Context/WidgetContext";

// Builders make the per-test setup readable — each layer of the chain
// is one optional knob. Missing wrappers default to `undefined` so
// the hook hits its own null-guards (the resolution must work even
// when an outer context provider hasn't mounted yet).
function makeWrapper({ app, workspace, widget }) {
  return function Wrapper({ children }) {
    let tree = children;
    if (widget !== undefined) {
      tree = (
        <WidgetContext.Provider value={{ widgetData: widget }}>
          {tree}
        </WidgetContext.Provider>
      );
    }
    if (workspace !== undefined) {
      tree = (
        <WorkspaceContext.Provider value={{ workspaceData: workspace }}>
          {tree}
        </WorkspaceContext.Provider>
      );
    }
    if (app !== undefined) {
      tree = <AppContext.Provider value={app}>{tree}</AppContext.Provider>;
    }
    return tree;
  };
}

const ALGOLIA_DEFAULT = {
  name: "Algolia Default",
  type: "algolia",
  providerClass: "credential",
  isDefaultForType: true,
  credentials: { appId: "X", apiKey: "Y" },
};

const ALGOLIA_OTHER = {
  name: "Algolia Other",
  type: "algolia",
  providerClass: "credential",
  isDefaultForType: false,
  credentials: { appId: "A", apiKey: "B" },
};

describe("useWidgetProviders — 3-layer resolution", () => {
  test("layer 1 (widget-level) wins over everything", () => {
    const widget = {
      id: 42,
      providers: [{ type: "algolia", providerClass: "credential" }],
      selectedProviders: { algolia: "Algolia Other" },
    };
    const workspace = {
      selectedProviders: { 42: { algolia: "Algolia Default" } },
    };
    const app = {
      providers: {
        "Algolia Default": ALGOLIA_DEFAULT,
        "Algolia Other": ALGOLIA_OTHER,
      },
    };
    const { result } = renderHook(() => useWidgetProviders(), {
      wrapper: makeWrapper({ app, workspace, widget }),
    });
    expect(result.current.getProvider("algolia")).toBe(ALGOLIA_OTHER);
  });

  test("layer 2 (workspace-level) wins when widget-level is absent", () => {
    const widget = {
      id: 42,
      providers: [{ type: "algolia", providerClass: "credential" }],
      // no selectedProviders
    };
    const workspace = {
      selectedProviders: { 42: { algolia: "Algolia Other" } },
    };
    const app = {
      providers: {
        "Algolia Default": ALGOLIA_DEFAULT,
        "Algolia Other": ALGOLIA_OTHER,
      },
    };
    const { result } = renderHook(() => useWidgetProviders(), {
      wrapper: makeWrapper({ app, workspace, widget }),
    });
    expect(result.current.getProvider("algolia")).toBe(ALGOLIA_OTHER);
  });

  test("layer 3 (app default) kicks in when 1 and 2 are absent — the regression guard", () => {
    // The bug this whole test file exists to prevent: a widget with no
    // explicit binding should still resolve to the user's Settings →
    // Providers default. Before the fix, every credential widget
    // showed "no provider" even when a default was set.
    const widget = {
      id: 42,
      providers: [{ type: "algolia", providerClass: "credential" }],
    };
    const app = {
      providers: {
        "Algolia Default": ALGOLIA_DEFAULT,
        "Algolia Other": ALGOLIA_OTHER,
      },
    };
    const { result } = renderHook(() => useWidgetProviders(), {
      wrapper: makeWrapper({ app, widget }),
    });
    expect(result.current.hasProvider("algolia")).toBe(true);
    expect(result.current.getProvider("algolia")).toBe(ALGOLIA_DEFAULT);
  });

  test("layer 3 NOT applied when no provider is flagged default", () => {
    const widget = {
      id: 42,
      providers: [{ type: "algolia", providerClass: "credential" }],
    };
    const app = { providers: { "Algolia Other": ALGOLIA_OTHER } };
    const { result } = renderHook(() => useWidgetProviders(), {
      wrapper: makeWrapper({ app, widget }),
    });
    expect(result.current.hasProvider("algolia")).toBe(false);
    expect(result.current.getProvider("algolia")).toBe(null);
  });

  test("returns null when no providers are configured at all", () => {
    const widget = {
      id: 42,
      providers: [{ type: "algolia", providerClass: "credential" }],
    };
    const { result } = renderHook(() => useWidgetProviders(), {
      wrapper: makeWrapper({ app: { providers: {} }, widget }),
    });
    expect(result.current.hasProvider("algolia")).toBe(false);
  });

  test("layer 3 default matches by type — same type wrong default flag is ignored", () => {
    // Three algolia providers, only one flagged default. Only that one
    // is selected — the order of object keys must not be load-bearing.
    const widget = {
      id: 42,
      providers: [{ type: "algolia", providerClass: "credential" }],
    };
    const app = {
      providers: {
        "Algolia A": { ...ALGOLIA_OTHER, name: "Algolia A" },
        "Algolia Default": ALGOLIA_DEFAULT,
        "Algolia B": { ...ALGOLIA_OTHER, name: "Algolia B" },
      },
    };
    const { result } = renderHook(() => useWidgetProviders(), {
      wrapper: makeWrapper({ app, widget }),
    });
    expect(result.current.getProvider("algolia")).toBe(ALGOLIA_DEFAULT);
  });

  test("layer 3 respects provider type — different-type default is NOT used", () => {
    // A "slack default" doesn't satisfy an algolia widget. Type
    // matching is what makes layer 3 safe.
    const widget = {
      id: 42,
      providers: [{ type: "algolia", providerClass: "credential" }],
    };
    const app = {
      providers: {
        "Slack Default": {
          name: "Slack Default",
          type: "slack",
          providerClass: "mcp",
          isDefaultForType: true,
        },
      },
    };
    const { result } = renderHook(() => useWidgetProviders(), {
      wrapper: makeWrapper({ app, widget }),
    });
    expect(result.current.hasProvider("algolia")).toBe(false);
  });

  test("uuidString/uuid/id chain — workspace-level lookup works for uuidString-only widgets", () => {
    // The hook resolves the widget id from uuidString → uuid → id.
    // AI-built widgets typically only have `id`; manually-edited ones
    // may use `uuidString`. Both must hit the workspace-level binding.
    const widget = {
      uuidString: "abc-123",
      providers: [{ type: "algolia", providerClass: "credential" }],
    };
    const workspace = {
      selectedProviders: { "abc-123": { algolia: "Algolia Other" } },
    };
    const app = { providers: { "Algolia Other": ALGOLIA_OTHER } };
    const { result } = renderHook(() => useWidgetProviders(), {
      wrapper: makeWrapper({ app, workspace, widget }),
    });
    expect(result.current.getProvider("algolia")).toBe(ALGOLIA_OTHER);
  });

  test("returns empty providers when widget declares none", () => {
    const widget = { id: 42 }; // no providers[]
    const app = { providers: { "Algolia Default": ALGOLIA_DEFAULT } };
    const { result } = renderHook(() => useWidgetProviders(), {
      wrapper: makeWrapper({ app, widget }),
    });
    expect(result.current.providers).toEqual({});
    expect(result.current.hasProvider("algolia")).toBe(false);
  });
});
