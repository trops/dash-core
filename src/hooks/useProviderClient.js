import { useMemo, useContext } from "react";
import { AppContext } from "../Context/App/AppContext";

function hashProvider(provider) {
  if (!provider) return null;
  const payload = JSON.stringify({
    name: provider.name,
    type: provider.type,
    credentials: provider.credentials,
  });
  // djb2 hash — not security-sensitive, just a cache key
  let hash = 5381;
  for (let i = 0; i < payload.length; i++) {
    hash = ((hash << 5) + hash + payload.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

export function useProviderClient(provider) {
  const { credentials } = useContext(AppContext);
  const dashboardAppId = credentials?.appId || "";

  const providerHash = useMemo(() => hashProvider(provider), [provider]);
  const providerName = provider?.name || "";

  return { providerHash, providerName, dashboardAppId };
}
