import { connectionErrorText } from "./connectionErrorText";

describe("connectionErrorText", () => {
  test("refused: nothing listening at the host the user typed", () => {
    expect(
      connectionErrorText(
        "connect ECONNREFUSED 127.0.0.1:8080",
        "ws://localhost:8080/feed",
      ),
    ).toBe("Nothing is listening at localhost:8080. Is the server running?");
  });

  test("without a URL, the address from the message", () => {
    expect(connectionErrorText("connect ECONNREFUSED 127.0.0.1:8080")).toBe(
      "Nothing is listening at 127.0.0.1:8080. Is the server running?",
    );
  });

  test("not found, timeouts, resets, auth, 404, certificates", () => {
    const url = "wss://feed.example.com/live";
    expect(
      connectionErrorText("getaddrinfo ENOTFOUND feed.example.com", url),
    ).toBe("Couldn't find feed.example.com. Check the address.");
    expect(connectionErrorText("connect ETIMEDOUT 1.2.3.4:443", url)).toBe(
      "feed.example.com didn't answer in time.",
    );
    expect(connectionErrorText("socket hang up", url)).toBe(
      "The server closed the connection.",
    );
    expect(connectionErrorText("Unexpected server response: 401", url)).toBe(
      "The server refused the credentials.",
    );
    expect(connectionErrorText("Unexpected server response: 404", url)).toBe(
      "There's no WebSocket at that address. Check the path.",
    );
    expect(connectionErrorText("self-signed certificate", url)).toBe(
      "The server's certificate isn't trusted.",
    );
  });

  test("'timeout' inside other words isn't a timeout", () => {
    expect(connectionErrorText("runtime output was empty", "ws://x")).toBe(
      "runtime output was empty",
    );
    expect(
      connectionErrorText("Opening handshake has timed out", "ws://h:1"),
    ).toBe("h:1 didn't answer in time.");
  });

  test("anything else passes through", () => {
    expect(connectionErrorText("Server said no", "ws://x")).toBe(
      "Server said no",
    );
    expect(connectionErrorText(undefined)).toBe("");
  });
});
