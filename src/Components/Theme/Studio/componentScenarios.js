import React from "react";
import {
  Panel,
  Panel2,
  Panel3,
  Card,
  Card2,
  Card3,
  Alert,
  Alert2,
  Alert3,
  Button,
  Button2,
  Button3,
  Tag,
  Tag2,
  Tag3,
  Heading,
  Heading2,
  Heading3,
  SubHeading,
  SubHeading2,
  SubHeading3,
  Paragraph,
  Paragraph2,
  Paragraph3,
} from "@trops/dash-react";
import { REGISTRY } from "./registry";

/**
 * componentScenarios — per-component preview compositions.
 *
 * Renders the selected component (just that one — variants are
 * already separate entries in the components list) across a few
 * realistic contexts so the user can see how the component reads
 * against panels, cards, and sibling primitives at the same tier.
 */

const TIER_OF = (type) => {
  if (/-2$/.test(type)) return 2;
  if (/-3$/.test(type)) return 3;
  return 1;
};

const PANEL_BY_TIER = { 1: Panel, 2: Panel2, 3: Panel3 };
const CARD_BY_TIER = { 1: Card, 2: Card2, 3: Card3 };
const ALERT_BY_TIER = { 1: Alert, 2: Alert2, 3: Alert3 };
const BUTTON_BY_TIER = { 1: Button, 2: Button2, 3: Button3 };
const TAG_BY_TIER = { 1: Tag, 2: Tag2, 3: Tag3 };
const HEADING_BY_TIER = { 1: Heading, 2: Heading2, 3: Heading3 };
const SUBHEADING_BY_TIER = { 1: SubHeading, 2: SubHeading2, 3: SubHeading3 };
const PARAGRAPH_BY_TIER = { 1: Paragraph, 2: Paragraph2, 3: Paragraph3 };

const CONTAINER_BASES = new Set(["panel", "card"]);
const baseOf = (type) => (type ? type.replace(/-[23]$/, "") : "");

/**
 * Return the scenarios that make sense for a given component type.
 * Container components (panel/card variants) skip "Inside Panel" /
 * "Inside Card" since wrapping a container in another container
 * doesn't communicate anything useful; they get a "With Content"
 * scenario instead.
 */
export function renderScenariosFor(type) {
  if (!type) return [];
  const entry = REGISTRY[type];
  if (!entry) return [];
  const tier = TIER_OF(type);
  const base = baseOf(type);
  const isContainer = CONTAINER_BASES.has(base);

  const PanelComp = PANEL_BY_TIER[tier];
  const CardComp = CARD_BY_TIER[tier];
  const AlertComp = ALERT_BY_TIER[tier];
  const ButtonComp = BUTTON_BY_TIER[tier];
  const TagComp = TAG_BY_TIER[tier];
  const HeadingComp = HEADING_BY_TIER[tier];
  const SubHeadingComp = SUBHEADING_BY_TIER[tier];
  const ParagraphComp = PARAGRAPH_BY_TIER[tier];

  const scenarios = [];

  scenarios.push({
    id: "alone",
    label: "Alone",
    content: <div className="p-2">{entry.render()}</div>,
  });

  if (isContainer) {
    // Containers get filled with content instead of being nested.
    const Container =
      base === "panel" ? PanelComp : base === "card" ? CardComp : null;
    if (Container) {
      scenarios.push({
        id: "with-content",
        label: "With Content",
        content: (
          <Container>
            {Container.Header && (
              <Container.Header>
                <HeadingComp title={`${entry.label} Title`} padding={false} />
              </Container.Header>
            )}
            <Container.Body>
              <div className="flex flex-col gap-2 p-2">
                <SubHeadingComp title="A subheading" padding={false} />
                <ParagraphComp text="Body copy fills the container at the matching tier." />
                <div className="flex flex-row gap-2">
                  <ButtonComp title="Primary action" />
                  <TagComp text="Tag" />
                </div>
              </div>
            </Container.Body>
          </Container>
        ),
      });
    }
  } else {
    scenarios.push({
      id: "inside-panel",
      label: "Inside Panel",
      content: (
        <PanelComp>
          <PanelComp.Body>
            <div className="p-2">{entry.render()}</div>
          </PanelComp.Body>
        </PanelComp>
      ),
    });

    scenarios.push({
      id: "inside-card",
      label: "Inside Card",
      content: (
        <CardComp>
          <CardComp.Body>
            <div className="p-2">{entry.render()}</div>
          </CardComp.Body>
        </CardComp>
      ),
    });

    scenarios.push({
      id: "with-siblings",
      label: "With Sibling Primitives",
      content: (
        <PanelComp>
          <PanelComp.Header>
            <span className="text-xs uppercase font-bold text-gray-500 tracking-wider">
              Tier {tier} surface
            </span>
          </PanelComp.Header>
          <PanelComp.Body>
            <div className="flex flex-col gap-2 p-2">
              <div className="border-2 border-yellow-500 rounded p-1">
                {entry.render()}
              </div>
              <HeadingComp title={`Tier ${tier} heading`} padding={false} />
              <SubHeadingComp title="Subheading" padding={false} />
              <ParagraphComp text="Sibling paragraph at the same tier." />
              <div className="flex flex-row gap-2">
                <ButtonComp title="Action" />
                <TagComp text="Tag" />
              </div>
              <AlertComp title="Status" message="Sibling alert for context." />
            </div>
          </PanelComp.Body>
        </PanelComp>
      ),
    });
  }

  return scenarios;
}
