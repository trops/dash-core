import { emptyProviderOption } from "./emptyProviderOption";

describe("emptyProviderOption (QA §4.6)", () => {
  test("names the type's default — also while another provider is picked", () => {
    expect(
      emptyProviderOption({ defaultName: "Work Slack", required: true }),
    ).toBe("— use default (Work Slack) —");
  });
  test("no default: select one (required) or none", () => {
    expect(emptyProviderOption({ defaultName: null, required: true })).toBe(
      "— select a provider —",
    );
    expect(emptyProviderOption({ defaultName: null, required: false })).toBe(
      "— none —",
    );
  });
});
