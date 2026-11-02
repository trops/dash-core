import React from "react";
import { AlertBanner, Button2 } from "@trops/dash-react";
import { openProviderSetup } from "./providerSetupEvent";
import { setupNeedText } from "./providerSetupNeeds";

/**
 * In place of a widget whose provider came with a loaded profile and still
 * needs the user (dash-profiles): which provider, what it needs, and the
 * button that opens it in front.
 *
 * @param {{ name, type, need }[]} needs  providerSetupNeeds(...)
 */
export const ProviderNeedsSetupNotice = ({ needs = [] }) => (
  <div className="flex flex-col gap-2 p-3" data-testid="provider-needs-setup">
    {needs.map((n) => {
      const t = setupNeedText(n);
      return (
        <AlertBanner
          key={n.name}
          variant="warning"
          size="compact"
          title={t.title}
          message={t.detail}
        >
          <span className="pt-2 block">
            <Button2
              title={t.action}
              size="sm"
              onClick={() =>
                openProviderSetup(n.name, { review: n.need === "run" })
              }
            />
          </span>
        </AlertBanner>
      );
    })}
  </div>
);

export default ProviderNeedsSetupNotice;
