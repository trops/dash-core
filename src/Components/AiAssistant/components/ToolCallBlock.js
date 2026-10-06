/**
 * ToolCallBlock
 *
 * Collapsible display of an MCP tool call and its result.
 */
import { useContext, useState } from "react";
import { Caption2, ThemeContext, useStatusTokens } from "@trops/dash-react";

export const ToolCallBlock = ({
  toolName,
  serverName,
  input,
  result,
  isError,
  isLoading,
}) => {
  const [expanded, setExpanded] = useState(false);
  const { currentTheme } = useContext(ThemeContext) || {};
  const statusTokens = useStatusTokens();
  const t = (key) => currentTheme?.[key] || "";

  const dotColor = isLoading
    ? `${statusTokens.warning.solidBg} animate-pulse`
    : isError
      ? statusTokens.error.solidBg
      : statusTokens.success.solidBg;
  const preBase = "p-1.5 rounded overflow-x-auto overflow-y-auto font-mono";
  const preNeutral = `${t("bg-primary-very-dark")} ${t("text-primary-medium")}`;

  return (
    <div
      className={`my-1.5 border rounded-md overflow-hidden text-xs ${t(
        "border-primary-dark",
      )}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 transition-colors text-left ${t(
          "bg-primary-dark",
        )} ${t("hover-bg-primary-dark")}`}
      >
        <span className={`inline-block w-2 h-2 rounded-full ${dotColor}`} />
        <span className={`font-mono ${t("text-secondary-medium")}`}>
          {toolName}
        </span>
        {serverName && <Caption2>via {serverName}</Caption2>}
        <Caption2 className="ml-auto">{expanded ? "▲" : "▼"}</Caption2>
      </button>
      {expanded && (
        <div className={`px-2.5 py-2 space-y-2 ${t("bg-primary-dark")}`}>
          {input && (
            <div>
              <Caption2 block className="mb-0.5">
                Input:
              </Caption2>
              <pre className={`${preBase} max-h-32 ${preNeutral}`}>
                {typeof input === "string"
                  ? input
                  : JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {result !== undefined && (
            <div>
              <Caption2 block className="mb-0.5">
                Result:
              </Caption2>
              <pre
                className={`${preBase} max-h-48 ${
                  isError
                    ? `${statusTokens.error.bg} ${statusTokens.error.text}`
                    : preNeutral
                }`}
              >
                {typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
          {isLoading && (
            <div className={`italic ${statusTokens.warning.icon}`}>
              Running...
            </div>
          )}
        </div>
      )}
    </div>
  );
};
