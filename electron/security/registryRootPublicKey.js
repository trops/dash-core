/**
 * registryRootPublicKey.js
 *
 * The Ed25519 public key for the dash-registry that this build of the
 * app trusts. Bundled as a constant so it ships inside the binary and
 * survives auto-updates; the matching private key never leaves the
 * registry's secrets store.
 *
 * Provisioned on the registry 2026-05-25 via
 *   dash-registry/scripts/init-publisher-root-key.mjs
 *
 * Rotation playbook lives in dash-registry/docs/SIGNING.md. To rotate:
 *   1. Ship a release that bundles BOTH the old and new public keys
 *      (TRUSTED_KEYS becomes an array).
 *   2. Once that release is widely installed, retire the old key here.
 */
const REGISTRY_ROOT_PUBLIC_KEY = "kYb36aQm7ldmNklmw7DciUV2FSvg945koBnohdiUtNk=";

/**
 * Allow overriding the trust anchor via env var for local dev / e2e
 * (e.g. when pointing dash-electron at a sandbox registry stack with
 * its own root key). Production builds resolve to the bundled value.
 */
function getRegistryRootPublicKey() {
  return process.env.DASH_REGISTRY_ROOT_PUBLIC_KEY || REGISTRY_ROOT_PUBLIC_KEY;
}

module.exports = {
  REGISTRY_ROOT_PUBLIC_KEY,
  getRegistryRootPublicKey,
};
