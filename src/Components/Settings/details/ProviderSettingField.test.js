/**
 * ProviderSettingField — one renderer for provider settings (credentialSchema
 * fields): text, password, file, directory-list, plus number, toggle and
 * text-list for built-in providers like Web Fetch (bot-capabilities FR-C02a).
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  ProviderSettingField,
  validateSettingField,
  hasSettingValue,
} from "./ProviderSettingField";

const numberField = {
  key: "maxDownloadMb",
  displayName: "Max download size",
  type: "number",
  min: 1,
  max: 50,
  default: 10,
  unit: "MB",
  instructions: "Largest file Web Fetch will download.",
};
const toggleField = {
  key: "shrinkLargeImages",
  displayName: "Shrink large images",
  type: "toggle",
  default: true,
};
const listField = {
  key: "allowedSites",
  displayName: "Allowed sites",
  type: "text-list",
  placeholder: "cdn.example.com",
};

describe("ProviderSettingField", () => {
  it("number: shows the label, unit and instructions; reports typed values", () => {
    const onChange = jest.fn();
    render(
      <ProviderSettingField field={numberField} value="" onChange={onChange} />,
    );
    expect(screen.getByText("Max download size")).toBeInTheDocument();
    expect(screen.getByText(/MB/)).toBeInTheDocument();
    expect(
      screen.getByText("Largest file Web Fetch will download."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("10"), {
      target: { value: "25" },
    });
    expect(onChange).toHaveBeenCalledWith("25");
  });

  it("toggle: uses the default when unset and reports a boolean", () => {
    const onChange = jest.fn();
    render(
      <ProviderSettingField
        field={toggleField}
        value={undefined}
        onChange={onChange}
      />,
    );
    const sw = screen.getByRole("switch");
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('toggle: a saved "false" string reads as off', () => {
    render(
      <ProviderSettingField
        field={toggleField}
        value="false"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("text-list: edits rows and reports a comma-joined value", () => {
    const onChange = jest.fn();
    render(
      <ProviderSettingField
        field={listField}
        value="a.test"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Add"));
    const inputs = screen.getAllByPlaceholderText("cdn.example.com");
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[1], { target: { value: "*.b.test" } });
    expect(onChange).toHaveBeenLastCalledWith("a.test,*.b.test");
    fireEvent.click(screen.getAllByLabelText("Remove")[0]);
    expect(onChange).toHaveBeenLastCalledWith("*.b.test");
  });

  it("shows an error message", () => {
    render(
      <ProviderSettingField
        field={numberField}
        value="99"
        onChange={() => {}}
        error="Must be between 1 and 50"
      />,
    );
    expect(screen.getByText("Must be between 1 and 50")).toBeInTheDocument();
  });

  it("text: a secret field is a password input", () => {
    const { container } = render(
      <ProviderSettingField
        field={{ key: "apiKey", displayName: "API Key", type: "text" }}
        value="x"
        onChange={() => {}}
      />,
    );
    expect(container.querySelector("input")).toBeInTheDocument();
  });
});

describe("validateSettingField", () => {
  it("required text/number/list need a value; booleans never crash", () => {
    expect(
      validateSettingField({ ...numberField, required: true }, ""),
    ).toMatch(/required/);
    expect(
      validateSettingField({ key: "k", displayName: "K", required: true }, " "),
    ).toMatch(/required/);
    expect(validateSettingField(toggleField, false)).toBeNull();
    expect(
      validateSettingField({ ...toggleField, required: true }, false),
    ).toBeNull();
  });

  it("number: must be a number within range; empty is fine when optional", () => {
    expect(validateSettingField(numberField, "")).toBeNull();
    expect(validateSettingField(numberField, "25")).toBeNull();
    expect(validateSettingField(numberField, 25)).toBeNull();
    expect(validateSettingField(numberField, "abc")).toMatch(/number/);
    expect(validateSettingField(numberField, "0")).toMatch(/between 1 and 50/);
    expect(validateSettingField(numberField, "51")).toMatch(/between 1 and 50/);
  });

  it("directory-list: every path must be absolute", () => {
    const dirField = {
      key: "allowedPaths",
      displayName: "Allowed Directories",
      type: "directory-list",
    };
    expect(validateSettingField(dirField, "/a,/b")).toBeNull();
    expect(validateSettingField(dirField, "/a,~/b")).toMatch(/absolute path/);
  });
});

describe("hasSettingValue", () => {
  it("treats strings, numbers and booleans sensibly", () => {
    expect(hasSettingValue("  ")).toBe(false);
    expect(hasSettingValue("x")).toBe(true);
    expect(hasSettingValue(0)).toBe(true);
    expect(hasSettingValue(false)).toBe(true);
    expect(hasSettingValue(undefined)).toBe(false);
  });
});
