/**
 * useWidgetRegistryVersion.test.js
 *
 * Pins the contract that any consumer of the widget registry can
 * subscribe via this hook and get a counter that increments when the
 * `dash:widgets-updated` window event fires. The hook is the single
 * source of truth for "the registry changed" notifications across
 * the app — sidebar, settings, dropdowns, dependencies tab, etc.
 *
 * Relies on @testing-library/react. The test environment doesn't
 * dispatch real window events without a DOM, but jsdom (the default
 * jest environment) does, so this is straightforward.
 */

import { renderHook, act } from "@testing-library/react";
import { useWidgetRegistryVersion } from "./useWidgetRegistryVersion";

function fireUpdate() {
  window.dispatchEvent(new Event("dash:widgets-updated"));
}

describe("useWidgetRegistryVersion", () => {
  test("returns 0 on initial render", () => {
    const { result } = renderHook(() => useWidgetRegistryVersion());
    expect(result.current).toBe(0);
  });

  test("increments when dash:widgets-updated fires", () => {
    const { result } = renderHook(() => useWidgetRegistryVersion());
    act(() => fireUpdate());
    expect(result.current).toBe(1);
    act(() => fireUpdate());
    expect(result.current).toBe(2);
  });

  test("does not increment on unrelated events", () => {
    const { result } = renderHook(() => useWidgetRegistryVersion());
    act(() => window.dispatchEvent(new Event("some-other-event")));
    act(() => window.dispatchEvent(new Event("dash:widget-installed")));
    expect(result.current).toBe(0);
  });

  test("multiple consumers all see the same bump from one dispatch", () => {
    const { result: a } = renderHook(() => useWidgetRegistryVersion());
    const { result: b } = renderHook(() => useWidgetRegistryVersion());
    act(() => fireUpdate());
    expect(a.current).toBe(1);
    expect(b.current).toBe(1);
  });

  test("removes its listener on unmount — no leaks", () => {
    // Spy on add/remove to confirm lifecycle. With many surfaces
    // mounting/unmounting (modals, settings panels), a leaked
    // listener would silently grow and re-fire stale state.
    const addSpy = jest.spyOn(window, "addEventListener");
    const removeSpy = jest.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useWidgetRegistryVersion());
    const addedHandler = addSpy.mock.calls.find(
      (c) => c[0] === "dash:widgets-updated",
    )?.[1];
    expect(addedHandler).toBeDefined();
    unmount();
    const removed = removeSpy.mock.calls.find(
      (c) => c[0] === "dash:widgets-updated" && c[1] === addedHandler,
    );
    expect(removed).toBeDefined();
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
