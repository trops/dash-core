import React, { useState, useContext } from "react";
import {
  Button,
  Sidebar,
  SettingsModal,
  SubHeading,
  SubHeading2,
  ThemeContext,
  getStylesForItem,
  themeObjects,
  FontAwesomeIcon,
} from "@trops/dash-react";
import { GeneralSection } from "./sections/GeneralSection";
import { AccountSection } from "./sections/AccountSection";
import { NotificationsSection } from "./sections/NotificationsSection";
import { McpServerSection } from "./sections/McpServerSection";
import { AiAssistantSection } from "./sections/AiAssistantSection";
import { PrivacySecuritySection } from "./sections/PrivacySecuritySection";

// True settings only. Dashboards, Folders, Providers, Bots, Widgets and
// Themes are Manage pages in the left nav (app-navigation PRD NAV-004);
// `openAppSettings` in DashboardStage sends those sections to their page.
const SECTIONS = [
  { key: "general", label: "General", icon: "cog" },
  { key: "account", label: "Account", icon: "circle-user" },
  { key: "notifications", label: "Notifications", icon: "bell" },
  { key: "mcp-server", label: "MCP Server", icon: "server" },
  { key: "ai-assistant", label: "AI Assistant", icon: "wand-magic-sparkles" },
  {
    key: "privacy-security",
    label: "Privacy & Security",
    icon: "shield-halved",
  },
];

export const AppSettingsModal = ({
  isOpen,
  setIsOpen,
  initialSection = "general",
  workspaces = [],
  authStatus = "loading",
  authProfile = null,
  onSignIn = null,
  onSignOut = null,
  onProfileUpdated = null,
}) => {
  const [activeSection, setActiveSection] = useState(initialSection);
  const { currentTheme } = useContext(ThemeContext);

  // Sync initialSection when modal opens with a different section
  React.useEffect(() => {
    if (isOpen) {
      setActiveSection(initialSection);
    }
  }, [isOpen, initialSection]);

  const activeDef =
    SECTIONS.find((s) => s.key === activeSection) || SECTIONS[0];
  const panelStyles = getStylesForItem(themeObjects.PANEL, currentTheme, {
    grow: false,
  });

  return (
    <SettingsModal isOpen={isOpen} setIsOpen={setIsOpen}>
      <SettingsModal.Title>
        <SubHeading title="Settings" padding={false} />
      </SettingsModal.Title>

      <SettingsModal.Sidebar>
        <Sidebar.Content>
          {SECTIONS.map((section) => {
            const isActive = activeDef.key === section.key;
            return (
              <Sidebar.Item
                key={section.key}
                icon={
                  <FontAwesomeIcon
                    icon={section.icon}
                    className="h-3.5 w-3.5"
                  />
                }
                active={isActive}
                onClick={() => setActiveSection(section.key)}
                className={isActive ? "bg-white/10 opacity-100" : ""}
              >
                {section.label}
              </Sidebar.Item>
            );
          })}
        </Sidebar.Content>
      </SettingsModal.Sidebar>

      <SettingsModal.Header border={true} padding="px-4 py-3">
        <SubHeading2 title={activeDef.label} padding={false} />
      </SettingsModal.Header>

      <SettingsModal.Body
        scrollable={false}
        padding="p-0"
        className="flex flex-col min-h-0"
      >
        {activeDef.key === "account" && (
          <div
            className={`flex-1 overflow-y-auto p-6 ${
              panelStyles.textColor || "text-gray-200"
            }`}
          >
            <AccountSection
              authStatus={authStatus}
              authProfile={authProfile}
              onSignIn={onSignIn}
              onSignOut={onSignOut}
              onProfileUpdated={onProfileUpdated}
            />
          </div>
        )}
        {activeDef.key === "general" && (
          <div
            className={`flex-1 overflow-y-auto p-6 ${
              panelStyles.textColor || "text-gray-200"
            }`}
          >
            <GeneralSection />
          </div>
        )}
        {activeDef.key === "notifications" && (
          <NotificationsSection workspaces={workspaces} />
        )}
        {activeDef.key === "mcp-server" && (
          <div
            className={`flex-1 overflow-y-auto p-6 ${
              panelStyles.textColor || "text-gray-200"
            }`}
          >
            <McpServerSection />
          </div>
        )}
        {activeDef.key === "ai-assistant" && (
          <div
            className={`flex-1 overflow-y-auto p-6 ${
              panelStyles.textColor || "text-gray-200"
            }`}
          >
            <AiAssistantSection />
          </div>
        )}
        {activeDef.key === "privacy-security" && (
          <div
            className={`flex-1 flex flex-col min-h-0 ${
              panelStyles.textColor || "text-gray-200"
            }`}
          >
            <PrivacySecuritySection />
          </div>
        )}
      </SettingsModal.Body>

      <SettingsModal.Footer>
        <div className="flex justify-end">
          <Button title="Done" onClick={() => setIsOpen(false)} />
        </div>
      </SettingsModal.Footer>
    </SettingsModal>
  );
};
