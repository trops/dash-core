import { providerSetupNeeds, setupNeedText } from "./providerSetupNeeds";

const registered = [
  { name: "Algolia John G Demos", type: "algolia", needsSetup: true },
  { name: "Algolia Prod", type: "algolia", isDefaultForType: true },
  { name: "Drive", type: "google-drive", needsSetup: true, needsSignIn: true },
  { name: "Files", type: "filesystem", needsRunApproval: true },
];

describe("providerSetupNeeds", () => {
  test("the provider the widget resolves to — nothing else is blamed", () => {
    expect(
      providerSetupNeeds(
        [{ type: "algolia" }],
        () => "Algolia John G Demos",
        registered,
      ),
    ).toEqual([{ name: "Algolia John G Demos", type: "algolia", need: "key" }]);
    // Resolves to a set-up one, or to none: nothing to say.
    expect(
      providerSetupNeeds(
        [{ type: "algolia" }],
        () => "Algolia Prod",
        registered,
      ),
    ).toEqual([]);
    expect(
      providerSetupNeeds([{ type: "algolia" }], () => null, registered),
    ).toEqual([]);
  });

  test("a sign-in, a program waiting for the OK, or nothing it uses", () => {
    expect(
      providerSetupNeeds(
        [{ type: "google-drive" }, { type: "filesystem" }, { type: "slack" }],
        (t) => ({ "google-drive": "Drive", filesystem: "Files" })[t] || null,
        registered,
      ),
    ).toEqual([
      { name: "Drive", type: "google-drive", need: "signIn" },
      { name: "Files", type: "filesystem", need: "run" },
    ]);
  });

  test("signed in counts as set up", () => {
    expect(
      providerSetupNeeds([{ type: "google-drive" }], () => "Drive", [
        {
          name: "Drive",
          type: "google-drive",
          needsSetup: true,
          needsSignIn: true,
          signedIn: true,
        },
      ]),
    ).toEqual([]);
  });

  test("what the widget says, and its button", () => {
    expect(setupNeedText({ name: "A", need: "key" })).toMatchObject({
      title: 'Needs a key for "A"',
      action: "Add key",
    });
    expect(setupNeedText({ name: "A", need: "signIn" }).action).toBe("Sign in");
    expect(setupNeedText({ name: "A", need: "run" }).action).toBe("Review");
  });
});
