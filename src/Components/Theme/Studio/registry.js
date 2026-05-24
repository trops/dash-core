import React from "react";
import {
  Heading,
  Heading2,
  Heading3,
  SubHeading,
  SubHeading2,
  SubHeading3,
  Paragraph,
  Paragraph2,
  Paragraph3,
  Caption,
  Caption2,
  Caption3,
  Code,
  Code2,
  Code3,
  Button,
  Button2,
  Button3,
  ButtonIcon,
  ButtonIcon2,
  ButtonIcon3,
  Card,
  Card2,
  Card3,
  Tag,
  Tag2,
  Tag3,
  Toggle,
  Toggle2,
  Toggle3,
  InputText,
  TextArea,
  Checkbox,
  Switch,
  Slider,
  RadioGroup,
  SelectInput,
  SearchInput,
  Alert,
  Alert2,
  Alert3,
  AlertBanner,
  ProgressBar,
  ProgressBar2,
  ProgressBar3,
  Toast,
  Toast2,
  Toast3,
  MenuItem,
  MenuItem2,
  MenuItem3,
  Breadcrumbs,
  Breadcrumbs2,
  Breadcrumbs3,
  Panel,
  Panel2,
  Panel3,
  DashPanel,
  DashPanel2,
  DashPanel3,
  Divider,
  Divider2,
  Divider3,
  Tabs,
  Tabs2,
  Tabs3,
  Accordion,
  Accordion2,
  Accordion3,
  StatCard,
  DataList,
  EmptyState,
  Skeleton,
  StatusBadge,
} from "@trops/dash-react";

/**
 * Studio component registry — single source of truth for what the
 * preview canvas can render. LivePreview resolves an instance via
 * `REGISTRY[type]`, ComponentPalette enumerates entries to populate
 * the "+ Add Component" picker.
 *
 * Each entry: { Component, themeKey, label, category, render(props) }
 *
 * - `themeKey` matches `themeObjects.X` (lowercase string keys like
 *   "heading", "button", "card-2") so ComponentInspector can resolve
 *   tokens via `getStylesForItem(themeKey, theme)`.
 * - `render` returns the JSX so the registry handles required-prop
 *   defaults (Heading needs `title`, Toggle needs `enabled`/`setEnabled`)
 *   in one place.
 * - `category` groups entries in the palette ("Text", "Action",
 *   "Layout", "Feedback", "Input").
 */

const cardBlock = (CardComp) => (
  <CardComp>
    <CardComp.Header>
      <span className="font-bold">Card Title</span>
    </CardComp.Header>
    <CardComp.Body>Card content goes here.</CardComp.Body>
  </CardComp>
);

const panelBlock = (PanelComp) => (
  <PanelComp>
    <PanelComp.Header>
      <span className="font-bold">Panel</span>
    </PanelComp.Header>
    <PanelComp.Body>
      <div className="text-sm">Panel content.</div>
    </PanelComp.Body>
  </PanelComp>
);

const breadcrumbsTrail = [
  { label: "Home", onClick: () => {} },
  { label: "Dashboard", onClick: () => {} },
  { label: "Settings", onClick: () => {} },
];

export const REGISTRY = {
  // Text — Tier 1
  heading: {
    label: "Heading",
    themeKey: "heading",
    category: "Text",
    render: () => <Heading title="Heading" />,
  },
  subheading: {
    label: "Subheading",
    themeKey: "subheading",
    category: "Text",
    render: () => <SubHeading title="Subheading" />,
  },
  paragraph: {
    label: "Paragraph",
    themeKey: "paragraph",
    category: "Text",
    render: () => (
      <Paragraph text="The quick brown fox jumps over the lazy dog." />
    ),
  },

  // Text — Tier 2
  "heading-2": {
    label: "Heading 2",
    themeKey: "heading-2",
    category: "Text",
    render: () => <Heading2 title="Heading 2" />,
  },
  "subheading-2": {
    label: "Subheading 2",
    themeKey: "subheading-2",
    category: "Text",
    render: () => <SubHeading2 title="Subheading 2" />,
  },
  "paragraph-2": {
    label: "Paragraph 2",
    themeKey: "paragraph-2",
    category: "Text",
    render: () => <Paragraph2 text="Tier 2 paragraph copy." />,
  },

  // Text — Tier 3
  "heading-3": {
    label: "Heading 3",
    themeKey: "heading-3",
    category: "Text",
    render: () => <Heading3 title="Heading 3" />,
  },
  "subheading-3": {
    label: "Subheading 3",
    themeKey: "subheading-3",
    category: "Text",
    render: () => <SubHeading3 title="Subheading 3" />,
  },
  "paragraph-3": {
    label: "Paragraph 3",
    themeKey: "paragraph-3",
    category: "Text",
    render: () => <Paragraph3 text="Tier 3 paragraph copy." />,
  },

  // Action
  button: {
    label: "Button",
    themeKey: "button",
    category: "Action",
    render: () => <Button title="Button" />,
  },
  "button-2": {
    label: "Button 2",
    themeKey: "button-2",
    category: "Action",
    render: () => <Button2 title="Button 2" />,
  },
  "button-3": {
    label: "Button 3",
    themeKey: "button-3",
    category: "Action",
    render: () => <Button3 title="Button 3" />,
  },
  "button-icon": {
    label: "Button Icon",
    themeKey: "button-icon",
    category: "Action",
    render: () => <ButtonIcon icon="pencil" text="Edit" />,
  },
  "button-icon-2": {
    label: "Button Icon 2",
    themeKey: "button-icon-2",
    category: "Action",
    render: () => <ButtonIcon2 icon="pencil" text="Edit" />,
  },
  "button-icon-3": {
    label: "Button Icon 3",
    themeKey: "button-icon-3",
    category: "Action",
    render: () => <ButtonIcon3 icon="pencil" text="Edit" />,
  },

  // Layout
  card: {
    label: "Card",
    themeKey: "card",
    category: "Layout",
    render: () => cardBlock(Card),
  },
  "card-2": {
    label: "Card 2",
    themeKey: "card-2",
    category: "Layout",
    render: () => cardBlock(Card2),
  },
  "card-3": {
    label: "Card 3",
    themeKey: "card-3",
    category: "Layout",
    render: () => cardBlock(Card3),
  },
  panel: {
    label: "Panel",
    themeKey: "panel",
    category: "Layout",
    render: () => panelBlock(Panel),
  },
  "panel-2": {
    label: "Panel 2",
    themeKey: "panel-2",
    category: "Layout",
    render: () => panelBlock(Panel2),
  },
  "panel-3": {
    label: "Panel 3",
    themeKey: "panel-3",
    category: "Layout",
    render: () => panelBlock(Panel3),
  },

  // Feedback
  tag: {
    label: "Tag",
    themeKey: "tag",
    category: "Feedback",
    render: () => <Tag text="Tag" />,
  },
  "tag-2": {
    label: "Tag 2",
    themeKey: "tag-2",
    category: "Feedback",
    render: () => <Tag2 text="Tag 2" />,
  },
  "tag-3": {
    label: "Tag 3",
    themeKey: "tag-3",
    category: "Feedback",
    render: () => <Tag3 text="Tag 3" />,
  },
  alert: {
    label: "Alert",
    themeKey: "alert",
    category: "Feedback",
    render: () => <Alert title="Alert" message="Heads up." />,
  },
  "alert-2": {
    label: "Alert 2",
    themeKey: "alert-2",
    category: "Feedback",
    render: () => <Alert2 title="Alert 2" message="Heads up." />,
  },
  "alert-3": {
    label: "Alert 3",
    themeKey: "alert-3",
    category: "Feedback",
    render: () => <Alert3 title="Alert 3" message="Heads up." />,
  },
  toast: {
    label: "Toast",
    themeKey: "toast",
    category: "Feedback",
    render: () => (
      <Toast title="Toast" message="Action completed successfully." />
    ),
  },
  "toast-2": {
    label: "Toast 2",
    themeKey: "toast-2",
    category: "Feedback",
    render: () => (
      <Toast2 title="Toast 2" message="Action completed successfully." />
    ),
  },
  "toast-3": {
    label: "Toast 3",
    themeKey: "toast-3",
    category: "Feedback",
    render: () => (
      <Toast3 title="Toast 3" message="Action completed successfully." />
    ),
  },
  "progress-bar": {
    label: "Progress Bar",
    themeKey: "progress-bar",
    category: "Feedback",
    render: () => <ProgressBar value={65} />,
  },
  "progress-bar-2": {
    label: "Progress Bar 2",
    themeKey: "progress-bar-2",
    category: "Feedback",
    render: () => <ProgressBar2 value={50} />,
  },
  "progress-bar-3": {
    label: "Progress Bar 3",
    themeKey: "progress-bar-3",
    category: "Feedback",
    render: () => <ProgressBar3 value={35} />,
  },

  // Input
  "input-text": {
    label: "Input Text",
    themeKey: "input-text",
    category: "Input",
    render: () => <InputText placeholder="Enter text" />,
  },
  toggle: {
    label: "Toggle",
    themeKey: "toggle",
    category: "Input",
    render: () => (
      <Toggle text="Toggle option" enabled={true} setEnabled={() => {}} />
    ),
  },

  // Navigation
  "menu-item": {
    label: "Menu Item",
    themeKey: "menu-item",
    category: "Navigation",
    render: () => <MenuItem>Menu Item</MenuItem>,
  },
  breadcrumbs: {
    label: "Breadcrumbs",
    themeKey: "breadcrumbs",
    category: "Navigation",
    render: () => <Breadcrumbs items={breadcrumbsTrail} />,
  },
  "breadcrumbs-2": {
    label: "Breadcrumbs 2",
    themeKey: "breadcrumbs-2",
    category: "Navigation",
    render: () => <Breadcrumbs2 items={breadcrumbsTrail} />,
  },
  "breadcrumbs-3": {
    label: "Breadcrumbs 3",
    themeKey: "breadcrumbs-3",
    category: "Navigation",
    render: () => <Breadcrumbs3 items={breadcrumbsTrail} />,
  },
  "menu-item-2": {
    label: "Menu Item 2",
    themeKey: "menu-item-2",
    category: "Navigation",
    render: () => <MenuItem2>Menu Item 2</MenuItem2>,
  },
  "menu-item-3": {
    label: "Menu Item 3",
    themeKey: "menu-item-3",
    category: "Navigation",
    render: () => <MenuItem3>Menu Item 3</MenuItem3>,
  },

  // Text — Caption (small descriptive text)
  caption: {
    label: "Caption",
    themeKey: "caption",
    category: "Text",
    render: () => <Caption text="Caption — small descriptive text." />,
  },
  "caption-2": {
    label: "Caption 2",
    themeKey: "caption-2",
    category: "Text",
    render: () => <Caption2 text="Caption 2 — secondary tier." />,
  },
  "caption-3": {
    label: "Caption 3",
    themeKey: "caption-3",
    category: "Text",
    render: () => <Caption3 text="Caption 3 — tertiary tier." />,
  },

  // Text — Code (monospace inline)
  code: {
    label: "Code",
    themeKey: "code",
    category: "Text",
    render: () => <Code>npm run dev</Code>,
  },
  "code-2": {
    label: "Code 2",
    themeKey: "code-2",
    category: "Text",
    render: () => <Code2>npm run build</Code2>,
  },
  "code-3": {
    label: "Code 3",
    themeKey: "code-3",
    category: "Text",
    render: () => <Code3>npm test</Code3>,
  },

  // Layout — Divider
  divider: {
    label: "Divider",
    themeKey: "divider",
    category: "Layout",
    render: () => (
      <div className="py-2">
        <Divider />
      </div>
    ),
  },
  "divider-2": {
    label: "Divider 2",
    themeKey: "divider-2",
    category: "Layout",
    render: () => (
      <div className="py-2">
        <Divider2 />
      </div>
    ),
  },
  "divider-3": {
    label: "Divider 3",
    themeKey: "divider-3",
    category: "Layout",
    render: () => (
      <div className="py-2">
        <Divider3 />
      </div>
    ),
  },

  // Layout — DashPanel (panel variant used by Dash app surfaces)
  "dash-panel": {
    label: "Dash Panel",
    themeKey: "dash-panel",
    category: "Layout",
    render: () => (
      <DashPanel>
        <DashPanel.Header title="Dash Panel" />
        <DashPanel.Body>
          <div className="p-2 text-sm">Dash Panel content.</div>
        </DashPanel.Body>
      </DashPanel>
    ),
  },
  "dash-panel-2": {
    label: "Dash Panel 2",
    themeKey: "dash-panel-2",
    category: "Layout",
    render: () => (
      <DashPanel2>
        <DashPanel2.Header title="Dash Panel 2" />
        <DashPanel2.Body>
          <div className="p-2 text-sm">Dash Panel 2 content.</div>
        </DashPanel2.Body>
      </DashPanel2>
    ),
  },
  "dash-panel-3": {
    label: "Dash Panel 3",
    themeKey: "dash-panel-3",
    category: "Layout",
    render: () => (
      <DashPanel3>
        <DashPanel3.Header title="Dash Panel 3" />
        <DashPanel3.Body>
          <div className="p-2 text-sm">Dash Panel 3 content.</div>
        </DashPanel3.Body>
      </DashPanel3>
    ),
  },

  // Navigation — Tabs
  tabs: {
    label: "Tabs",
    themeKey: "tabs",
    category: "Navigation",
    render: () => (
      <Tabs defaultValue="one">
        <Tabs.List>
          <Tabs.Trigger value="one">One</Tabs.Trigger>
          <Tabs.Trigger value="two">Two</Tabs.Trigger>
          <Tabs.Trigger value="three">Three</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="one">
          <div className="p-2 text-sm">First tab content.</div>
        </Tabs.Content>
        <Tabs.Content value="two">
          <div className="p-2 text-sm">Second tab content.</div>
        </Tabs.Content>
        <Tabs.Content value="three">
          <div className="p-2 text-sm">Third tab content.</div>
        </Tabs.Content>
      </Tabs>
    ),
  },
  "tabs-2": {
    label: "Tabs 2",
    themeKey: "tabs-2",
    category: "Navigation",
    render: () => (
      <Tabs2 defaultValue="one">
        <Tabs2.List>
          <Tabs2.Trigger value="one">One</Tabs2.Trigger>
          <Tabs2.Trigger value="two">Two</Tabs2.Trigger>
        </Tabs2.List>
        <Tabs2.Content value="one">
          <div className="p-2 text-sm">First.</div>
        </Tabs2.Content>
        <Tabs2.Content value="two">
          <div className="p-2 text-sm">Second.</div>
        </Tabs2.Content>
      </Tabs2>
    ),
  },
  "tabs-3": {
    label: "Tabs 3",
    themeKey: "tabs-3",
    category: "Navigation",
    render: () => (
      <Tabs3 defaultValue="one">
        <Tabs3.List>
          <Tabs3.Trigger value="one">One</Tabs3.Trigger>
          <Tabs3.Trigger value="two">Two</Tabs3.Trigger>
        </Tabs3.List>
        <Tabs3.Content value="one">
          <div className="p-2 text-sm">First.</div>
        </Tabs3.Content>
        <Tabs3.Content value="two">
          <div className="p-2 text-sm">Second.</div>
        </Tabs3.Content>
      </Tabs3>
    ),
  },

  // Navigation — Accordion
  accordion: {
    label: "Accordion",
    themeKey: "accordion",
    category: "Navigation",
    render: () => (
      <Accordion>
        <Accordion.Item value="a">
          <Accordion.Trigger>Section A</Accordion.Trigger>
          <Accordion.Content>Content for section A.</Accordion.Content>
        </Accordion.Item>
        <Accordion.Item value="b">
          <Accordion.Trigger>Section B</Accordion.Trigger>
          <Accordion.Content>Content for section B.</Accordion.Content>
        </Accordion.Item>
      </Accordion>
    ),
  },
  "accordion-2": {
    label: "Accordion 2",
    themeKey: "accordion-2",
    category: "Navigation",
    render: () => (
      <Accordion2>
        <Accordion2.Item value="a">
          <Accordion2.Trigger>Section A</Accordion2.Trigger>
          <Accordion2.Content>Content for section A.</Accordion2.Content>
        </Accordion2.Item>
        <Accordion2.Item value="b">
          <Accordion2.Trigger>Section B</Accordion2.Trigger>
          <Accordion2.Content>Content for section B.</Accordion2.Content>
        </Accordion2.Item>
      </Accordion2>
    ),
  },
  "accordion-3": {
    label: "Accordion 3",
    themeKey: "accordion-3",
    category: "Navigation",
    render: () => (
      <Accordion3>
        <Accordion3.Item value="a">
          <Accordion3.Trigger>Section A</Accordion3.Trigger>
          <Accordion3.Content>Content for section A.</Accordion3.Content>
        </Accordion3.Item>
        <Accordion3.Item value="b">
          <Accordion3.Trigger>Section B</Accordion3.Trigger>
          <Accordion3.Content>Content for section B.</Accordion3.Content>
        </Accordion3.Item>
      </Accordion3>
    ),
  },

  // Input — additional tiers + form controls
  "toggle-2": {
    label: "Toggle 2",
    themeKey: "toggle-2",
    category: "Input",
    render: () => (
      <Toggle2 text="Toggle 2" enabled={true} setEnabled={() => {}} />
    ),
  },
  "toggle-3": {
    label: "Toggle 3",
    themeKey: "toggle-3",
    category: "Input",
    render: () => (
      <Toggle3 text="Toggle 3" enabled={false} setEnabled={() => {}} />
    ),
  },
  textarea: {
    label: "Text Area",
    themeKey: "textarea",
    category: "Input",
    render: () => <TextArea placeholder="Enter multi-line text…" />,
  },
  checkbox: {
    label: "Checkbox",
    themeKey: "checkbox",
    category: "Input",
    render: () => (
      <Checkbox label="Accept terms" checked={true} onChange={() => {}} />
    ),
  },
  switch: {
    label: "Switch",
    themeKey: "switch",
    category: "Input",
    render: () => (
      <Switch label="Enable feature" checked={true} onChange={() => {}} />
    ),
  },
  slider: {
    label: "Slider",
    themeKey: "slider",
    category: "Input",
    render: () => (
      <Slider label="Volume" value={50} min={0} max={100} onChange={() => {}} />
    ),
  },
  radio: {
    label: "Radio Group",
    themeKey: "radio",
    category: "Input",
    render: () => (
      <RadioGroup
        label="Pick one"
        name="example-radio"
        value="b"
        onChange={() => {}}
        options={[
          { value: "a", label: "Option A" },
          { value: "b", label: "Option B" },
          { value: "c", label: "Option C" },
        ]}
      />
    ),
  },
  "select-menu": {
    label: "Select",
    themeKey: "select-menu",
    category: "Input",
    render: () => (
      <SelectInput
        label="Select"
        value="b"
        onChange={() => {}}
        options={[
          { value: "a", label: "First" },
          { value: "b", label: "Second" },
          { value: "c", label: "Third" },
        ]}
      />
    ),
  },
  "search-input": {
    label: "Search Input",
    themeKey: "search-input",
    category: "Input",
    render: () => (
      <SearchInput placeholder="Search…" value="" onChange={() => {}} />
    ),
  },

  // Feedback — additional
  "alert-banner": {
    label: "Alert Banner",
    themeKey: "alert-banner",
    category: "Feedback",
    render: () => (
      <AlertBanner
        variant="info"
        title="Heads up"
        message="A banner-style alert for top-of-page notices."
      />
    ),
  },
  "status-badge": {
    label: "Status Badge",
    themeKey: "status-badge",
    category: "Feedback",
    render: () => <StatusBadge state="success" label="Active" />,
  },
  skeleton: {
    label: "Skeleton",
    themeKey: "skeleton",
    category: "Feedback",
    render: () => (
      <div className="flex flex-col gap-2">
        <Skeleton height="h-4" />
        <Skeleton height="h-4" width="w-3/4" />
        <Skeleton height="h-4" width="w-1/2" />
      </div>
    ),
  },

  // Composite
  "stat-card": {
    label: "Stat Card",
    themeKey: "stat-card",
    category: "Layout",
    render: () => (
      <StatCard
        label="Monthly Active Users"
        value="12,483"
        change="+8.2%"
        trend="up"
        helpText="vs. last month"
      />
    ),
  },
  "data-list": {
    label: "Data List",
    themeKey: "data-list",
    category: "Layout",
    render: () => (
      <DataList>
        <DataList.Item label="Status">Active</DataList.Item>
        <DataList.Item label="Region">us-west-1</DataList.Item>
        <DataList.Item label="Owner">Daisy</DataList.Item>
      </DataList>
    ),
  },
  "empty-state": {
    label: "Empty State",
    themeKey: "empty-state",
    category: "Feedback",
    render: () => (
      <EmptyState
        title="Nothing here yet"
        description="Add an item to get started."
      />
    ),
  },
};

export function getRegistryEntry(type) {
  return REGISTRY[type] || null;
}
