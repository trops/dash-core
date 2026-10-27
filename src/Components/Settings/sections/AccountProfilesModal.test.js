/**
 * Load from the account: the list of profiles kept there, loading one
 * (handed to the Load dialog) and removing one (asked first).
 */
import React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { AccountProfilesModal, accountRowMeta } from "./AccountProfilesModal";
import { conflictText, savedNoticeText } from "./SaveProfileModal";

jest.mock("../../../hooks/useRegistryAuthGate", () => ({
  useRegistryAuthGate: () => ({
    ensureAuthed: jest.fn(async () => true),
    authGate: null,
    isAuthGateOpen: false,
  }),
}));

const appId = "@test/app";
const profiles = [
  {
    id: "a1",
    name: "Mac Mini",
    revision: 3,
    updatedOn: "laptop",
    updatedAt: "2026-10-27T09:00:00.000Z",
    linkedTo: { id: "p-x", name: "Mac Mini" },
  },
  {
    id: "a2",
    name: "Work",
    revision: 1,
    updatedOn: null,
    updatedAt: null,
    linkedTo: null,
  },
];

function mockApi(extra = {}) {
  window.mainApi = {
    profiles: {
      listAccount: jest.fn(async () => ({ success: true, profiles })),
      previewLoadFromAccount: jest.fn(async () => ({
        success: true,
        token: "pl_1",
      })),
      deleteFromAccount: jest.fn(async () => ({ success: true })),
      ...extra,
    },
  };
  return window.mainApi.profiles;
}

afterEach(() => {
  delete window.mainApi;
});

describe("AccountProfilesModal", () => {
  it("lists the account's profiles and hands the picked one's preview on", async () => {
    const api = mockApi();
    const onPreview = jest.fn();
    render(
      <AccountProfilesModal
        appId={appId}
        onClose={() => {}}
        onPreview={onPreview}
      />,
    );
    await screen.findByText("Work");
    expect(screen.getByText(/On this computer: Mac Mini/)).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByTestId("account-profile-a2")).getByRole("button"),
    );
    fireEvent.click(screen.getByText("Load…"));
    await waitFor(() =>
      expect(onPreview).toHaveBeenCalledWith({ success: true, token: "pl_1" }),
    );
    expect(api.previewLoadFromAccount).toHaveBeenCalledWith(appId, "a2");
  });

  it("removing asks first", async () => {
    const api = mockApi();
    render(
      <AccountProfilesModal
        appId={appId}
        onClose={() => {}}
        onPreview={() => {}}
      />,
    );
    await screen.findByText("Work");
    fireEvent.click(
      within(screen.getByTestId("account-profile-a1")).getByRole("button"),
    );
    fireEvent.click(screen.getByText("Remove from my account…"));
    expect(api.deleteFromAccount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() =>
      expect(api.deleteFromAccount).toHaveBeenCalledWith(appId, "a1"),
    );
  });

  it("signed out: asks to sign in", async () => {
    mockApi({
      listAccount: jest.fn(async () => ({
        success: false,
        signInRequired: true,
      })),
    });
    render(
      <AccountProfilesModal
        appId={appId}
        onClose={() => {}}
        onPreview={() => {}}
      />,
    );
    expect(
      await screen.findByText(/Sign in to the registry to see your profiles/),
    ).toBeInTheDocument();
  });
});

describe("wording", () => {
  it("says where and when, and why a save was refused", () => {
    expect(accountRowMeta(profiles[1])).toBe("");
    expect(accountRowMeta(profiles[0])).toMatch(
      /^Saved on laptop, .* · On this computer: Mac Mini$/,
    );
    expect(conflictText({ missing: true })).toMatch(
      /isn't in your account any more/,
    );
    expect(
      conflictText({ revision: 4, updatedOn: "laptop", updatedAt: null }),
    ).toBe(
      "Your account has a newer copy of this profile, saved on laptop. Load it from your account to use it here, or replace it with this computer's.",
    );
    expect(
      savedNoticeText({
        account: { revision: 2 },
        published: [],
        secretsLeftOut: 1,
      }),
    ).toBe("Saved to your account. 1 key typed into widgets isn't included.");
  });
});
