/**
 * draftPackage.js — is a widget package a Widget Builder draft?
 *
 * Drafts are in-progress widgets the Widget Builder saves as it goes, in
 * `@ai-built/draft-<draft id>/` (older ones: `@ai-built/<name>-draft-<shortId>/`).
 * They're registered like any widget so they can preview, but they belong
 * in Manage › Widgets (Resume / Delete), not in the sidebar or pickers.
 */

const DRAFT_DIR = /(?:^|\/)(draft-[A-Za-z0-9][A-Za-z0-9-]*)$/;
const LEGACY_DRAFT_DIR = /-draft-[A-Za-z0-9]+$/;

/** @param {string} pkg  a package name or its folder ("@ai-built/draft-…") */
export function isDraftPackage(pkg) {
  const name = String(pkg || "");
  return DRAFT_DIR.test(name) || LEGACY_DRAFT_DIR.test(name);
}

/** The draft's id for an id-keyed draft package, else null. */
export function draftIdOf(pkg) {
  const m = String(pkg || "").match(DRAFT_DIR);
  return m ? m[1] : null;
}
