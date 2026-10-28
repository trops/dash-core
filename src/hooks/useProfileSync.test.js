/**
 * @jest-environment jsdom
 *
 * useProfileSync — the out-of-sync check: runs once with an appId, only
 * out-of-sync profiles come back, nothing on failure, and it checks again
 * after a sign-in.
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { useProfileSync } from "./useProfileSync";

afterEach(() => {
  delete window.mainApi;
});

const rows = [
  { profileId: "a", state: "in-sync" },
  { profileId: "b", state: "account-newer" },
  { profileId: "c", state: "both" },
];

describe("useProfileSync", () => {
  it("checks once and keeps only what needs something", async () => {
    const syncStatus = jest.fn(async () => ({ success: true, profiles: rows }));
    window.mainApi = { profiles: { syncStatus } };
    const { result } = renderHook(() => useProfileSync("@test/app"));
    await waitFor(() => expect(result.current.hasChecked).toBe(true));
    expect(result.current.profileUpdates.map((p) => p.profileId)).toEqual([
      "b",
      "c",
    ]);
    expect(syncStatus).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("dash:registry-auth-changed"));
    });
    await waitFor(() => expect(syncStatus).toHaveBeenCalledTimes(2));
  });

  it("a check that can't run shows nothing", async () => {
    window.mainApi = {
      profiles: {
        syncStatus: jest.fn(async () => ({
          success: false,
          unreachable: true,
        })),
      },
    };
    const { result } = renderHook(() => useProfileSync("@test/app"));
    await waitFor(() => expect(result.current.hasChecked).toBe(true));
    expect(result.current.profileUpdates).toEqual([]);
  });

  it("no app id or no bridge: done, nothing", async () => {
    const { result } = renderHook(() => useProfileSync("@test/app"));
    await waitFor(() => expect(result.current.hasChecked).toBe(true));
    expect(result.current.profileUpdates).toEqual([]);
  });
});
