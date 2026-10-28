/**
 * What Settings › Profiles should open to, from the updates dialog: taken
 * once, and asking dispatches the event Settings listens for.
 */
import {
  openProfileSync,
  setProfileIntent,
  takeProfileIntent,
} from "./profileIntent";

describe("profileIntent", () => {
  it("is taken once", () => {
    setProfileIntent({ profileId: "mini", action: "save" });
    expect(takeProfileIntent()).toEqual({ profileId: "mini", action: "save" });
    expect(takeProfileIntent()).toBeNull();
    setProfileIntent({ action: "save" });
    expect(takeProfileIntent()).toBeNull();
    // The Welcome screen: pick one from the account (no profile yet).
    setProfileIntent({ action: "pick" });
    expect(takeProfileIntent()).toEqual({ action: "pick" });
  });

  it("asking opens Settings › Profiles", () => {
    const heard = jest.fn();
    window.addEventListener("dash:open-profile-sync", heard);
    openProfileSync({ profileId: "mini", action: "load", accountId: "a1" });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(takeProfileIntent()).toEqual({
      profileId: "mini",
      action: "load",
      accountId: "a1",
    });
    window.removeEventListener("dash:open-profile-sync", heard);
  });
});
