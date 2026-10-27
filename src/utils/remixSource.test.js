import { remixSourceOf, remixCreditText } from "./remixSource";
import { allowRemixOption } from "../Components/Settings/details/AllowRemixOption";

describe("remixSourceOf (what Duplicate keeps)", () => {
  it("something installed from the registry", () => {
    expect(
      remixSourceOf({
        registryRef: {
          package: "@trops/sales",
          version: "1.0.0",
          origin: "installed",
        },
      }),
    ).toEqual({ package: "@trops/sales", version: "1.0.0" });
    expect(
      remixSourceOf({
        version: "0.2.0",
        _registryMeta: { source: "registry", packageName: "trops/ocean" },
      }),
    ).toEqual({ package: "trops/ocean", version: "0.2.0" });
    expect(
      remixSourceOf({
        _dashboardConfig: {
          registryPackage: "trops/kitchen-sink",
          installedVersion: "1.0.0",
        },
      }),
    ).toEqual({ package: "trops/kitchen-sink", version: "1.0.0" });
  });

  it("a copy of a copy keeps the same original", () => {
    expect(
      remixSourceOf({
        remixedFrom: { package: "@trops/sales", version: "1.0.0" },
      }),
    ).toEqual({ package: "@trops/sales", version: "1.0.0" });
  });

  it("the user's own work has nothing to credit", () => {
    expect(remixSourceOf({ name: "Mine" })).toBeNull();
    expect(
      remixSourceOf({
        registryRef: { package: "@bob/x", origin: "published" },
      }),
    ).toBeNull();
    expect(
      remixSourceOf({
        _registryMeta: { packageName: "bob/x", lastPublishedVersion: "1.0.0" },
      }),
    ).toBeNull();
    expect(
      remixSourceOf({
        _dashboardConfig: {
          registryPackage: "x",
          registryScope: "bob",
          version: "1.0.0",
        },
      }),
    ).toBeNull();
  });
});

describe("remixCreditText", () => {
  it("names the original and its author, and the first original", () => {
    expect(
      remixCreditText({
        name: "kitchen-sink",
        displayName: "Kitchen Sink",
        author: "trops",
      }),
    ).toBe("Remix of Kitchen Sink by trops");
    expect(
      remixCreditText({
        name: "sink-plus",
        displayName: "Sink Plus",
        author: "Alice",
        root: {
          name: "kitchen-sink",
          displayName: "Kitchen Sink",
          author: "trops",
        },
      }),
    ).toBe("Remix of Sink Plus by Alice · originally Kitchen Sink by trops");
    expect(remixCreditText(null)).toBeNull();
  });
});

describe("allowRemixOption", () => {
  it("is sent only when the user chose", () => {
    expect(allowRemixOption(null)).toEqual({});
    expect(allowRemixOption(false)).toEqual({ allowRemix: false });
    expect(allowRemixOption(true)).toEqual({ allowRemix: true });
  });
});
