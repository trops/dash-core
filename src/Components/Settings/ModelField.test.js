import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ModelField } from "./ModelField";
import { KNOWN_TYPES } from "../../utils/userConfigValidation";

const MODELS = [
  {
    value: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    family: "sonnet",
    status: "current",
  },
  {
    value: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    family: "sonnet",
    status: "older",
  },
];

afterEach(() => {
  delete window.mainApi;
});

test("a widget's Model setting offers the one model list", async () => {
  window.mainApi = {
    llm: { listModels: jest.fn(async () => ({ models: MODELS })) },
  };
  const onChange = jest.fn();
  render(<ModelField value="claude-sonnet-4-20250514" onChange={onChange} />);
  const select = screen.getByLabelText("Model");
  await waitFor(() => expect(select).toHaveTextContent("Latest Sonnet"));
  // A retired model it's saved with still shows, so the field says what's saved.
  expect([...select.options].map((o) => o.textContent)).toContain("Sonnet 4");
  fireEvent.change(select, { target: { value: "latest:sonnet" } });
  expect(onChange).toHaveBeenCalledWith("latest:sonnet");
  expect(KNOWN_TYPES).toContain("model");
});
