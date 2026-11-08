import { approvalPreview } from "./approvalPreview";

describe("approvalPreview", () => {
  it("Bash: the command, with what it says it's for", () => {
    expect(
      approvalPreview({
        toolName: "Bash",
        input: { command: "date +%Y-%m-%d", description: "Get today's date" },
      }),
    ).toEqual({
      label: "Command",
      text: "date +%Y-%m-%d",
      note: "Get today's date",
    });
  });

  it("file tools: the file; web tools: the address", () => {
    expect(
      approvalPreview({
        toolName: "Write",
        input: { file_path: "/tmp/notes.md", content: "x".repeat(5000) },
      }),
    ).toEqual({ label: "File it writes", text: "/tmp/notes.md", note: null });
    expect(
      approvalPreview({
        toolName: "WebFetch",
        input: { url: "https://example.com", prompt: "summarize" },
      }).text,
    ).toBe("https://example.com");
  });

  it("any other tool: the values it sends, one per line, long ones cut", () => {
    const p = approvalPreview({
      toolName: "mcp__claude_ai_Gmail__send_message",
      input: {
        to: "someone@example.com",
        body: "y".repeat(500),
        cc: "",
        labels: ["a", "b"],
      },
    });
    expect(p.label).toBe("With");
    const lines = p.text.split("\n");
    expect(lines[0]).toBe("to: someone@example.com");
    expect(lines[1].length).toBeLessThanOrEqual(306);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(lines[2]).toBe('labels: ["a","b"]');
    expect(lines).toHaveLength(3);
  });

  it("nothing to show: null", () => {
    expect(approvalPreview({ toolName: "Bash" })).toBeNull();
    expect(approvalPreview({ toolName: "x", input: {} })).toBeNull();
    expect(approvalPreview(null)).toBeNull();
  });
});
