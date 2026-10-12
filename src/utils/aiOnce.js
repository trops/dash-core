/**
 * aiOnce.js — ask the user's AI one question and get its text answer back
 * (create-entry phase 5c: Type Auto and Type Theme).
 *
 * Uses the same streaming chat channel as the Widget Builder
 * (window.mainApi.llm.sendMessage), with no tools, its own system prompt and
 * no session to resume, on the AI the user picked (Claude Code or the
 * Anthropic API). Resolves with the answer's text; rejects with a plain
 * message when there's no AI, it fails, or it takes too long.
 */
import { findAnthropicProvider } from "../Components/Create/aiBackend";

let seq = 0;

/** The text of a completed message's content (string or blocks). */
export function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

/**
 * @param {{ system: string, prompt: string, backend: "claude-code"|"anthropic"|null,
 *   providers?: object, model?: string, timeoutMs?: number, llm?: object }} req
 * @returns {Promise<string>}
 */
export function aiOnce({
  system,
  prompt,
  backend,
  providers = {},
  model,
  timeoutMs = 90000,
  llm = typeof window !== "undefined" && window.mainApi
    ? window.mainApi.llm
    : null,
}) {
  if (!llm || typeof llm.sendMessage !== "function") {
    return Promise.reject(new Error("No AI is available here."));
  }
  if (!backend) return Promise.reject(new Error("No AI is set up."));
  const entry =
    backend === "anthropic" ? findAnthropicProvider(providers) : null;
  const apiKey =
    entry && entry[1] && entry[1].credentials
      ? entry[1].credentials.apiKey
      : null;
  if (backend === "anthropic" && !apiKey) {
    return Promise.reject(new Error("The Anthropic provider has no API key."));
  }

  const requestId = `once-${Date.now()}-${++seq}`;
  return new Promise((resolve, reject) => {
    let text = "";
    const ids = [];
    let timer = null;
    const done = (fn, value) => {
      if (timer) clearTimeout(timer);
      for (const id of ids) {
        try {
          llm.removeStreamListener(id);
        } catch (_e) {
          // already gone
        }
      }
      fn(value);
    };
    ids.push(
      llm.onStreamDelta((d) => {
        if (d && d.requestId === requestId && typeof d.text === "string") {
          text += d.text;
        }
      }),
      llm.onStreamComplete((d) => {
        if (!d || d.requestId !== requestId) return;
        done(resolve, (text || contentText(d.content)).trim());
      }),
      llm.onStreamError((d) => {
        if (!d || d.requestId !== requestId) return;
        done(reject, new Error((d && d.error) || "The AI didn't answer."));
      }),
    );
    timer = setTimeout(() => {
      try {
        llm.abortRequest(requestId);
      } catch (_e) {
        // nothing to abort
      }
      done(reject, new Error("The AI took too long to answer."));
    }, timeoutMs);
    Promise.resolve(
      llm.sendMessage(requestId, {
        backend,
        apiKey: apiKey || undefined,
        model,
        messages: [{ role: "user", content: String(prompt || "") }],
        tools: [],
        toolServerMap: {},
        systemPrompt: system,
        replaceSystemPrompt: true,
        disableTools: true,
        maxToolRounds: 1,
      }),
    ).catch((err) =>
      done(reject, new Error((err && err.message) || "The AI didn't answer.")),
    );
  });
}

/** The first {...} JSON object in an answer (fenced or not), or null. */
export function firstJson(text) {
  const s = String(text || "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fenced ? fenced[1] : s;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch (_e) {
    return null;
  }
}
