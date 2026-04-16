import React from "react";
import { Button, Paragraph } from "@trops/dash-react";

/**
 * RegistrySignInBanner — compact persistent banner shown above Discover
 * lists when the user is not signed in to the registry. Reminds them
 * that signing in surfaces private packages they own (or have been
 * granted access to).
 *
 * Props:
 *   visible  - whether to render. Pass false when authenticated or when
 *              auth status is still loading (so we don't flash).
 *   onSignIn - opens the auth modal.
 *   noun     - "widget" | "dashboard" | "theme" — used in the message.
 */
export function RegistrySignInBanner({ visible, onSignIn, noun = "package" }) {
  if (!visible) return null;
  return (
    <div className="flex-shrink-0 mx-4 mb-2 px-3 py-2 rounded-lg bg-amber-900/15 border border-amber-700/30 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <Paragraph className="text-xs text-amber-200 leading-snug">
          Sign in to the registry to also see your private {noun}s and ones
          granted to you.
        </Paragraph>
      </div>
      <Button
        title="Sign in"
        bgColor="bg-indigo-600"
        hoverBackgroundColor="hover:bg-indigo-500"
        textSize="text-xs"
        padding="py-1 px-3"
        onClick={onSignIn}
      />
    </div>
  );
}
