/**
 * ToolCallBlock
 *
 * One MCP tool call in a chat, drawn with dash-react's ChatToolCall: status
 * dot, tool name, where it ran, and a disclosure with the input and result.
 */
import { Caption2, ChatToolCall, useStatusTokens } from "@trops/dash-react";

const pretty = (v) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

export const ToolCallBlock = ({
  toolName,
  serverName,
  input,
  result,
  isError,
  isLoading,
}) => {
  const statusTokens = useStatusTokens();
  const status = isLoading ? "running" : isError ? "error" : "done";
  const hasDetails = input !== undefined || result !== undefined;
  const pre = "p-1.5 rounded overflow-auto font-mono text-xs";
  return (
    <ChatToolCall
      name={toolName}
      source={serverName ? `via ${serverName}` : null}
      status={status}
    >
      {hasDetails ? (
        <div className="space-y-2">
          {input !== undefined && input !== null && input !== "" ? (
            <div>
              <Caption2 block className="mb-0.5">
                Input:
              </Caption2>
              <pre className={`${pre} max-h-32`}>{pretty(input)}</pre>
            </div>
          ) : null}
          {result !== undefined ? (
            <div>
              <Caption2 block className="mb-0.5">
                Result:
              </Caption2>
              <pre
                className={`${pre} max-h-48 ${
                  isError
                    ? `${statusTokens.error.bg} ${statusTokens.error.text}`
                    : ""
                }`}
              >
                {pretty(result)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </ChatToolCall>
  );
};
