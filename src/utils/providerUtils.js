export const getUserConfigurableProviders = (providers) => {
  if (!providers) return [];
  return providers.filter((p) => p.providerClass !== "api");
};
