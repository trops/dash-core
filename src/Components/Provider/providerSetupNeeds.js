/**
 * providerSetupNeeds.js — which of a widget's providers came with a loaded
 * profile and still need the user (dash-profiles): its key, a sign-in on
 * this Mac, or the user's OK before its program runs. Pure.
 */

/**
 * @param {{ type: string }[]} requiredProviders
 * @param {(type: string) => string|null} resolveName  the provider the
 *   widget uses for a type — the same resolution the widget runs with
 *   (utils/providerResolution.resolveProviderName), so nothing else is
 *   blamed for it
 * @param {object[]} registered  this Mac's providers (with needsSetup,
 *   needsSignIn, needsRunApproval when they came with a profile)
 * @returns {{ name, type, need: "run"|"signIn"|"key" }[]}
 */
export function providerSetupNeeds(
  requiredProviders = [],
  resolveName = () => null,
  registered = [],
) {
  const out = [];
  for (const req of requiredProviders || []) {
    const name = req ? resolveName(req.type) : null;
    const p = name
      ? (registered || []).find((x) => x && x.name === name) || null
      : null;
    if (!p) continue;
    const need = p.needsRunApproval
      ? "run"
      : p.needsSetup && !p.signedIn
        ? p.needsSignIn
          ? "signIn"
          : "key"
        : null;
    if (need && !out.some((o) => o.name === p.name)) {
      out.push({ name: p.name, type: p.type, need });
    }
  }
  return out;
}

/** What the widget says, and its button. */
export function setupNeedText({ name, need }) {
  if (need === "run") {
    return {
      title: `"${name}" needs your OK to run`,
      detail: "It came with your profile and runs a program on this Mac.",
      action: "Review",
    };
  }
  if (need === "signIn") {
    return {
      title: `Sign in for "${name}"`,
      detail: "Sign-ins stay on the Mac they were made on.",
      action: "Sign in",
    };
  }
  return {
    title: `Needs a key for "${name}"`,
    detail: "This provider came with your profile without its key.",
    action: "Add key",
  };
}
