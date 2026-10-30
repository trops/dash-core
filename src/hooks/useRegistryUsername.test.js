/**
 * useRegistryUsername (theme change leftovers): the stored username the
 * main process decides with, re-read when the window regains focus.
 */
import React from "react";
import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import {
  resetRegistryUsername,
  useRegistryUsername,
} from "./useRegistryUsername";

const Show = () => (
  <span data-testid="u">{useRegistryUsername() || "none"}</span>
);

afterEach(() => resetRegistryUsername());

test("signed in: the stored username; signed out after focus: none", async () => {
  const getStatus = jest
    .fn()
    .mockResolvedValueOnce({ authenticated: true, username: "me" })
    .mockResolvedValue({ authenticated: false });
  window.mainApi = { registryAuth: { getStatus } };
  render(<Show />);
  expect(await screen.findByText("me")).toBeInTheDocument();
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(await screen.findByText("none")).toBeInTheDocument();
});

test("no registry API: none", async () => {
  window.mainApi = {};
  render(<Show />);
  expect(await screen.findByText("none")).toBeInTheDocument();
});
