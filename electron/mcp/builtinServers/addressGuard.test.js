/**
 * addressGuard.test.js — Web Fetch refuses internal addresses (CAP-002 AC4).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isBlockedAddress } = require("./addressGuard");

describe("isBlockedAddress", () => {
  it("blocks loopback, private, link-local, CGNAT and other internal IPv4", () => {
    for (const ip of [
      "127.0.0.1",
      "127.255.1.2",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "198.18.0.1",
    ]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "140.82.112.3", "172.32.0.1", "100.128.0.1"]) {
      assert.equal(isBlockedAddress(ip), false, ip);
    }
  });

  it("blocks internal IPv6, including IPv4 hidden inside IPv6", () => {
    for (const ip of [
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.0.0.1",
    ]) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
  });

  it("allows public IPv6 and IPv4-mapped public addresses", () => {
    assert.equal(isBlockedAddress("2606:4700:4700::1111"), false);
    assert.equal(isBlockedAddress("::ffff:8.8.8.8"), false);
  });

  it("blocks anything that isn't a valid IP", () => {
    assert.equal(isBlockedAddress("not-an-ip"), true);
    assert.equal(isBlockedAddress(""), true);
    assert.equal(isBlockedAddress(undefined), true);
  });
});
