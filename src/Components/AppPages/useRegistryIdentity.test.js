import { renderHook, waitFor, act } from "@testing-library/react";
import { useRegistryIdentity, publishedId } from "./useRegistryIdentity";

function setup({ profile, packages } = {}) {
  window.mainApi = {
    registryAuth: {
      getProfile: jest.fn().mockResolvedValue(profile ?? null),
      getPackages: jest.fn().mockResolvedValue(packages ?? null),
    },
  };
  return window.mainApi.registryAuth;
}

afterEach(() => {
  delete window.mainApi;
});

describe("publishedId", () => {
  it("builds @scope/name from the registry's package record", () => {
    expect(publishedId({ scope: "trops", name: "slack" })).toBe("@trops/slack");
    expect(publishedId({ name: "@trops/slack" })).toBe("@trops/slack");
    expect(publishedId({ scope: "trops" })).toBeNull();
  });
});

describe("useRegistryIdentity (app-navigation NAV-012)", () => {
  it("knows who's signed in and what they've published", async () => {
    setup({
      profile: { username: "trops" },
      packages: {
        packages: [
          { scope: "trops", name: "slack", latestVersion: "1.2.0" },
          { scope: "trops", name: "gmail", version: "0.3.0" },
        ],
      },
    });
    const { result } = renderHook(() => useRegistryIdentity());
    await waitFor(() => expect(result.current.username).toBe("trops"));
    expect(result.current.signedIn).toBe(true);
    expect(result.current.publishedVersion("@trops/slack")).toBe("1.2.0");
    expect(result.current.publishedVersion("@trops/gmail")).toBe("0.3.0");
    expect(result.current.publishedVersion("@trops/nope")).toBeNull();
  });

  it("signed out: no username, nothing published", async () => {
    const api = setup({ profile: null, packages: null });
    const { result } = renderHook(() => useRegistryIdentity());
    await waitFor(() => expect(api.getProfile).toHaveBeenCalled());
    expect(result.current.username).toBeNull();
    expect(result.current.signedIn).toBe(false);
    expect(result.current.publishedVersion("@trops/slack")).toBeNull();
  });

  it("re-reads when the window regains focus (e.g. after signing in)", async () => {
    const api = setup({ profile: null });
    const { result } = renderHook(() => useRegistryIdentity());
    await waitFor(() => expect(api.getProfile).toHaveBeenCalledTimes(1));
    api.getProfile.mockResolvedValue({ username: "trops" });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current.username).toBe("trops"));
  });

  it("works without the registry API", () => {
    const { result } = renderHook(() => useRegistryIdentity());
    expect(result.current.username).toBeNull();
  });
});
