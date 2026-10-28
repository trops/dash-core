/**
 * Auto-save to the account: the choice (Manually by default), the time for
 * a daily save, when it was last saved, and why the last try didn't save.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AutoSaveSetting, autoSaveText } from "./AutoSaveSetting";

const appId = "@test/app";
const account = { accountId: "acc1", revision: 3, updatedOn: "laptop" };

function mount(profileExtra = {}, api = {}) {
  window.mainApi = {
    profiles: {
      setAutoSave: jest
        .fn()
        .mockImplementation((a, id, s) =>
          Promise.resolve({ success: true, autoSave: { ...s } }),
        ),
      ...api,
    },
  };
  const onChanged = jest.fn();
  render(
    <AutoSaveSetting
      appId={appId}
      profile={{ id: "mm", name: "Mac Mini", account, ...profileExtra }}
      onChanged={onChanged}
    />,
  );
  return { onChanged };
}

const select = () => screen.getByLabelText("Auto-save to your account");

afterEach(() => {
  delete window.mainApi;
});

describe("AutoSaveSetting", () => {
  test("Manually by default; choosing one saves it", async () => {
    const { onChanged } = mount();
    expect(select()).toHaveValue("manual");
    expect(
      screen.getByText("Saves only when you choose Save to my account."),
    ).toBeInTheDocument();
    fireEvent.change(select(), { target: { value: "changes" } });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(window.mainApi.profiles.setAutoSave).toHaveBeenCalledWith(
      appId,
      "mm",
      { mode: "changes", time: "09:00" },
    );
    expect(screen.getByText(/Nothing is published/)).toBeInTheDocument();
  });

  test("every day: a time, sent once it's a whole time", async () => {
    mount({ autoSave: { mode: "daily", time: "09:00" } });
    const time = screen.getByLabelText("Time");
    expect(time).toHaveValue("09:00");
    fireEvent.change(time, { target: { value: "18:30" } });
    await waitFor(() =>
      expect(window.mainApi.profiles.setAutoSave).toHaveBeenLastCalledWith(
        appId,
        "mm",
        { mode: "daily", time: "18:30" },
      ),
    );
  });

  test("when it was last saved, and why the last auto-save didn't save", () => {
    mount({
      account: { ...account, savedAt: "2026-10-28T09:00:00.000Z" },
      autoSave: {
        mode: "changes",
        last: {
          at: "2026-10-28T10:00:00.000Z",
          ok: false,
          error:
            "Your account has a newer copy, saved from another computer — open Check for updates to choose which to keep.",
        },
      },
    });
    expect(screen.getByTestId("profile-last-saved")).toHaveTextContent(
      "Last saved to your account: on laptop",
    );
    expect(
      screen.getByText(
        /The last auto-save didn't save: Your account has a newer copy/,
      ),
    ).toBeInTheDocument();
  });

  test("a refusal says why", async () => {
    mount(
      {},
      {
        setAutoSave: jest.fn().mockResolvedValue({
          success: false,
          error: "Save it to your account first — then it can save itself.",
        }),
      },
    );
    fireEvent.change(select(), { target: { value: "changes" } });
    expect(
      await screen.findByText(/Save it to your account first/),
    ).toBeInTheDocument();
    // Not changed: it still shows what it is.
    expect(select()).toHaveValue("manual");
  });

  test("autoSaveText", () => {
    expect(autoSaveText("daily")).toMatch(/next time Dash opens/);
  });
});
