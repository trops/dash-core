import { useCallback, useContext, useEffect, useState } from "react";
import { AppContext } from "../Context/App/AppContext";
import {
  aiBackendOptions,
  effectiveAiBackend,
  findAnthropicProvider,
} from "../Components/Create/aiBackend";

/**
 * The AI Dash builds with, for pickers outside Settings (the Create screen).
 * Reads and writes the same app setting as Settings › AI Assistant
 * (`settings.aiAssistant.preferredBackend`), so there is one choice.
 *
 * @returns {{ preferred, effective, options, cliAvailable, setPreferred }}
 *   effective — "claude-code" | "anthropic" | null (no AI set up)
 *   cliAvailable — null while checking
 */
export function useAiBackend() {
  const appContext = useContext(AppContext) || {};
  const settings = appContext.settings || {};
  const preferred =
    (settings.aiAssistant && settings.aiAssistant.preferredBackend) ||
    "claude-code";
  const hasAnthropic = !!findAnthropicProvider(appContext.providers);
  const [cliAvailable, setCliAvailable] = useState(null);

  useEffect(() => {
    let alive = true;
    const llm = typeof window !== "undefined" && window.mainApi?.llm;
    if (!llm || typeof llm.checkCliAvailable !== "function") {
      setCliAvailable(false);
      return undefined;
    }
    Promise.resolve(llm.checkCliAvailable())
      .then((r) => alive && setCliAvailable(!!(r && r.available)))
      .catch(() => alive && setCliAvailable(false));
    return () => {
      alive = false;
    };
  }, []);

  const setPreferred = useCallback(
    (value) => {
      if (!appContext.changeSettings) return;
      const current = appContext.settings || {};
      appContext.changeSettings({
        ...current,
        aiAssistant: {
          ...(current.aiAssistant || {}),
          preferredBackend: value,
        },
      });
    },
    [appContext],
  );

  return {
    preferred,
    effective: effectiveAiBackend({
      preferred,
      cliAvailable: !!cliAvailable,
      hasAnthropic,
    }),
    options: aiBackendOptions({ cliAvailable, hasAnthropic }),
    cliAvailable,
    setPreferred,
  };
}
