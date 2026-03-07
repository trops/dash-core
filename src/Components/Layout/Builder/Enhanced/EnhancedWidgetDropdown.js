/**
 * EnhancedWidgetDropdown
 *
 * Mac Finder-style widget selector with three-column navigation.
 * Features:
 * - Three-column layout: Source | Widget List | Details
 * - Advanced filtering: Search, Author, Provider
 * - Large modal interface (80vw x 90vh)
 * - Theme-aware using dash-react components
 * - Registry integration with two-level browsing (packages + widgets)
 */

import React, {
  useState,
  useContext,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  ThemeContext,
  Modal,
  Panel,
  Panel3,
  Button,
  Heading,
  Heading3,
  SubHeading3,
  Paragraph,
  Menu3,
  MenuItem3,
  SearchInput,
  Stepper,
  FormLabel,
  InputText,
  Tag,
  FontAwesomeIcon,
} from "@trops/dash-react";
import { ComponentManager } from "../../../../ComponentManager";
import { WidgetIcon } from "./WidgetIcon";
import { AppContext } from "../../../../Context/App/AppContext";
import { ProviderForm } from "../../../Provider/ProviderForm";
import { ToolSelector } from "../../../Settings/details/ToolSelector";
import { deriveFormFields } from "../../../../utils/mcpUtils";

export const EnhancedWidgetDropdown = ({
  isOpen,
  onClose,
  onSelectWidget,
  workspaceType = null,
}) => {
  const { currentTheme } = useContext(ThemeContext);
  const {
    providers: availableProviders = {},
    dashApi,
    credentials,
    refreshProviders,
  } = useContext(AppContext);

  // State management
  const [selectedSource, setSelectedSource] = useState("Installed"); // "Installed" | "Discover"
  const [selectedWidget, setSelectedWidget] = useState(null);
  const [widgets, setWidgets] = useState([]);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAuthor, setSelectedAuthor] = useState("all");
  const [selectedProvider, setSelectedProvider] = useState("all");

  // Phase 2: Provider and userConfig state
  const [selectedProviders, setSelectedProviders] = useState({});
  const [userConfigValues, setUserConfigValues] = useState({});

  // Phase 3: Recent widgets state
  const [recentWidgets, setRecentWidgets] = useState([]);

  // Inline provider creation state
  const [inlineCreateType, setInlineCreateType] = useState(null);
  const [inlineCreateSchema, setInlineCreateSchema] = useState({});
  const [inlineCreateError, setInlineCreateError] = useState(null);
  const [isCreatingProvider, setIsCreatingProvider] = useState(false);

  // MCP catalog for inline stepper creation
  const [mcpCatalog, setMcpCatalog] = useState([]);
  const [inlineCatalogEntry, setInlineCatalogEntry] = useState(null);

  // Inline MCP stepper state
  const [inlineWizardStep, setInlineWizardStep] = useState(0);
  const [inlineCredentialData, setInlineCredentialData] = useState({});
  const [inlineProviderName, setInlineProviderName] = useState("");
  const [inlineFormErrors, setInlineFormErrors] = useState({});
  const [inlineTestResult, setInlineTestResult] = useState(null);
  const [inlineIsTesting, setInlineIsTesting] = useState(false);
  const [inlineAuthResult, setInlineAuthResult] = useState(null);
  const [inlineIsAuthorizing, setInlineIsAuthorizing] = useState(false);
  const [inlineSelectedTools, setInlineSelectedTools] = useState(null);

  // Installed widget grouping
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  // Registry state
  const [isLoadingRegistry, setIsLoadingRegistry] = useState(false);
  const [registryError, setRegistryError] = useState(null);
  const [registryPackages, setRegistryPackages] = useState([]);
  const [registryViewMode, setRegistryViewMode] = useState("packages"); // "packages" | "widgets"
  const [expandedPackages, setExpandedPackages] = useState(new Set());
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState(null);

  // Phase 3: Recent Widgets - localStorage functions
  const loadRecentWidgets = () => {
    try {
      const stored = localStorage.getItem("recentWidgets");
      const recentData = stored ? JSON.parse(stored) : [];

      // Get widget details from ComponentManager
      const allWidgets = ComponentManager.map();
      const enrichedRecent = recentData
        .slice(0, 5) // Show top 5
        .map((entry) => {
          const widget = allWidgets[entry.widgetKey];
          if (!widget) return null; // Widget no longer exists
          return {
            key: entry.widgetKey,
            ...widget,
            savedProviders: entry.providers || {},
            savedUserConfig: entry.userConfig || {},
            timestamp: entry.timestamp,
          };
        })
        .filter(Boolean); // Remove null entries

      setRecentWidgets(enrichedRecent);
      console.log(
        "[EnhancedWidgetDropdown] Loaded recent widgets:",
        enrichedRecent,
      );
    } catch (error) {
      console.error(
        "[EnhancedWidgetDropdown] Error loading recent widgets:",
        error,
      );
      setRecentWidgets([]);
    }
  };

  const saveToRecent = (widget, providers, userConfig) => {
    try {
      const stored = localStorage.getItem("recentWidgets");
      const recent = stored ? JSON.parse(stored) : [];

      // Create new entry
      const newEntry = {
        widgetKey: widget.key,
        timestamp: Date.now(),
        providers: providers || {},
        userConfig: userConfig || {},
      };

      // Remove existing entry for this widget (if any) and add new one at front
      const updated = [
        newEntry,
        ...recent.filter((r) => r.widgetKey !== widget.key),
      ].slice(0, 10); // Keep max 10

      localStorage.setItem("recentWidgets", JSON.stringify(updated));
      console.log("[EnhancedWidgetDropdown] Saved to recent:", newEntry);

      // Reload recent widgets to update UI
      loadRecentWidgets();
    } catch (error) {
      console.error("[EnhancedWidgetDropdown] Error saving to recent:", error);
    }
  };

  const handleRecentClick = (recentWidget) => {
    console.log(
      "[EnhancedWidgetDropdown] Recent widget clicked:",
      recentWidget,
    );
    setSelectedWidget(recentWidget);
    setSelectedProviders(recentWidget.savedProviders || {});
    setUserConfigValues(recentWidget.savedUserConfig || {});
    // Reset inline provider creation form
    setInlineCreateType(null);
    setInlineCreateSchema({});
    setInlineCreateError(null);
  };

  // Fetch MCP catalog for inline stepper creation
  useEffect(() => {
    if (isOpen && dashApi && mcpCatalog.length === 0) {
      dashApi.mcpGetCatalog(
        (event, result) => setMcpCatalog(result?.catalog || []),
        () => {},
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, dashApi]);

  // Fetch widgets when modal opens
  useEffect(() => {
    if (isOpen) {
      loadWidgets();
      loadRecentWidgets(); // Phase 3: Load recent widgets
      // Reset filters when modal opens
      setSearchQuery("");
      setSelectedAuthor("all");
      setSelectedProvider("all");
      setExpandedGroups(new Set()); // Start with all groups collapsed
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const loadRegistryWidgets = useCallback(async () => {
    setIsLoadingRegistry(true);
    setRegistryError(null);
    try {
      const result = await window.mainApi.registry.search(searchQuery, {});
      setRegistryPackages(result.packages || []);

      // Flatten all widgets from all packages for the widget list
      const flatWidgets = [];
      for (const pkg of result.packages || []) {
        for (const widget of pkg.widgets || []) {
          flatWidgets.push({
            key: `${pkg.name}/${widget.name}`,
            name: widget.displayName || widget.name,
            description: widget.description || "",
            icon: widget.icon || null,
            providers: widget.providers || [],
            isRegistry: true,
            packageName: pkg.name,
            packageDisplayName: pkg.displayName || pkg.name,
            packageVersion: pkg.version,
            packageAuthor: pkg.author || "",
            packageDescription: pkg.description || "",
            packageTags: pkg.tags || [],
            packageCategory: pkg.category || "",
            downloadUrl: pkg.downloadUrl || "",
            repository: pkg.repository || "",
            publishedAt: pkg.publishedAt || "",
            packageWidgets: pkg.widgets || [],
          });
        }
      }
      setWidgets(flatWidgets);
    } catch (error) {
      console.error("[EnhancedWidgetDropdown] Registry error:", error);
      setRegistryError(error.message || "Failed to load registry");
      setWidgets([]);
      setRegistryPackages([]);
    } finally {
      setIsLoadingRegistry(false);
    }
  }, [searchQuery]);

  const loadWidgets = useCallback(() => {
    if (selectedSource === "Installed") {
      // Get widgets from ComponentManager
      const allWidgets = ComponentManager.map();
      const widgetList = Object.keys(allWidgets)
        .map((key) => ({
          key,
          ...allWidgets[key],
        }))
        .filter((widget) => widget.type === "widget");

      setWidgets(widgetList);
      setRegistryPackages([]);
      console.log("[EnhancedWidgetDropdown] Loaded widgets:", widgetList);
    } else {
      loadRegistryWidgets();
    }
  }, [selectedSource, loadRegistryWidgets]);

  // Get unique authors from widgets
  const getUniqueAuthors = () => {
    const authors = new Set();
    widgets.forEach((widget) => {
      const author =
        widget.packageAuthor || widget.author || widget.workspace || "Unknown";
      authors.add(author);
    });
    return Array.from(authors).sort();
  };

  // Get unique providers from widgets
  const getUniqueProviders = () => {
    const providers = new Set();
    providers.add("none"); // For widgets without providers
    widgets.forEach((widget) => {
      if (widget.providers && widget.providers.length > 0) {
        widget.providers.forEach((provider) => {
          providers.add(provider.type);
        });
      }
    });
    return Array.from(providers).sort();
  };

  // Filter widgets based on search, author, and provider
  const getFilteredWidgets = () => {
    const filtered = widgets.filter((widget) => {
      // Search filter
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        (widget.name || "").toLowerCase().includes(searchLower) ||
        (widget.description || "").toLowerCase().includes(searchLower) ||
        (widget.key || "").toLowerCase().includes(searchLower) ||
        (widget.packageName || "").toLowerCase().includes(searchLower) ||
        (widget.packageTags || []).some((t) =>
          t.toLowerCase().includes(searchLower),
        );

      // Author filter
      const widgetAuthor =
        widget.packageAuthor || widget.author || widget.workspace || "Unknown";
      const matchesAuthor =
        selectedAuthor === "all" || widgetAuthor === selectedAuthor;

      // Provider filter
      let matchesProvider = true;
      if (selectedProvider !== "all") {
        if (selectedProvider === "none") {
          matchesProvider = !widget.providers || widget.providers.length === 0;
        } else {
          matchesProvider =
            widget.providers &&
            widget.providers.some((p) => p.type === selectedProvider);
        }
      }

      return matchesSearch && matchesAuthor && matchesProvider;
    });

    // Sort alphabetically by name
    return filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  };

  const filteredWidgets = getFilteredWidgets();

  // Set of installed package names for "Installed" badge in Discover mode
  const installedPackageNames = useMemo(() => {
    const names = new Set();
    const map = ComponentManager.map();
    Object.values(map).forEach((widget) => {
      if (widget._sourcePackage) names.add(widget._sourcePackage);
    });
    return names;
  }, [widgets]);

  // Group installed widgets by package > author > "Other"
  const groupedInstalledWidgets = useMemo(() => {
    if (selectedSource !== "Installed") return {};
    const groups = {};
    filteredWidgets.forEach((widget) => {
      const group = widget.package || widget.author || "Other";
      if (!groups[group]) groups[group] = [];
      groups[group].push(widget);
    });
    return groups;
  }, [filteredWidgets, selectedSource]);

  const installedGroupNames = useMemo(
    () => Object.keys(groupedInstalledWidgets).sort(),
    [groupedInstalledWidgets],
  );

  const toggleGroup = (groupName) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  // Group filtered widgets by package (for package view in Discover)
  const getGroupedByPackage = () => {
    const groups = {};
    filteredWidgets.forEach((widget) => {
      const pkgName = widget.packageName || "unknown";
      if (!groups[pkgName]) {
        groups[pkgName] = {
          name: pkgName,
          displayName: widget.packageDisplayName || pkgName,
          author: widget.packageAuthor || "",
          version: widget.packageVersion || "",
          description: widget.packageDescription || "",
          widgets: [],
        };
      }
      groups[pkgName].widgets.push(widget);
    });
    return Object.values(groups);
  };

  // Refresh widget list when installed widgets change
  useEffect(() => {
    const handleWidgetsUpdated = () => {
      if (isOpen && selectedSource === "Installed") {
        loadWidgets();
      }
    };
    window.addEventListener("dash:widgets-updated", handleWidgetsUpdated);
    return () =>
      window.removeEventListener("dash:widgets-updated", handleWidgetsUpdated);
  }, [isOpen, selectedSource, loadWidgets]);

  // Load widgets when source changes
  useEffect(() => {
    if (isOpen) {
      loadWidgets();
      setSelectedWidget(null);
      setSelectedPackage(null);
      // Clear filters when switching sources
      setSearchQuery("");
      setSelectedAuthor("all");
      setSelectedProvider("all");
      setRegistryError(null);
      setInstallError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSource]);

  // Reload registry when search changes (debounced)
  useEffect(() => {
    if (selectedSource === "Discover" && isOpen) {
      const timer = setTimeout(() => {
        loadRegistryWidgets();
      }, 300);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const handleWidgetSelect = (widget) => {
    setSelectedWidget(widget);
    setSelectedPackage(widget.isRegistry ? widget.packageName : null);
    // Reset provider and config state when selecting a new widget
    setSelectedProviders({});
    setUserConfigValues({});
    // Reset inline provider creation form
    setInlineCreateType(null);
    setInlineCreateSchema({});
    setInlineCreateError(null);
    setInstallError(null);
  };

  const handlePackageSelect = (pkg) => {
    // Select the first widget of the package to show detail
    if (pkg.widgets && pkg.widgets.length > 0) {
      handleWidgetSelect(pkg.widgets[0]);
    }
    setSelectedPackage(pkg.name);
  };

  const togglePackageExpand = (pkgName) => {
    setExpandedPackages((prev) => {
      const next = new Set(prev);
      if (next.has(pkgName)) {
        next.delete(pkgName);
      } else {
        next.add(pkgName);
      }
      return next;
    });
  };

  const handleProviderSelect = (providerType, providerName) => {
    if (providerName === "__create_new__") {
      const providerReq = selectedWidget.providers.find(
        (p) => p.type === providerType,
      );

      // Look up full catalog entry for MCP providers
      const catalogEntry = mcpCatalog.find((s) => s.id === providerType);

      setInlineCreateType(providerType);
      setInlineCreateSchema(
        catalogEntry?.credentialSchema || providerReq?.credentialSchema || {},
      );
      setInlineCreateError(null);

      // Initialize stepper state for MCP providers
      if (catalogEntry) {
        setInlineCatalogEntry(catalogEntry);
        setInlineProviderName(catalogEntry.name);
        setInlineCredentialData({});
        setInlineFormErrors({});
        setInlineWizardStep(0);
        setInlineTestResult(null);
        setInlineAuthResult(null);
        setInlineSelectedTools(null);
      } else {
        setInlineCatalogEntry(null);
      }
    } else {
      // Normal provider selection - also close any open inline form
      setInlineCreateType(null);
      setInlineCreateSchema({});
      setInlineCreateError(null);
      setSelectedProviders({
        ...selectedProviders,
        [providerType]: providerName,
      });
    }
  };

  const handleInlineProviderSubmit = (formData) => {
    const providerType = inlineCreateType;
    const providerName = formData.name;
    const providerCredentials = formData.credentials;

    console.log(
      `[EnhancedWidgetDropdown] Creating provider inline: ${providerName} (${providerType})`,
    );

    setIsCreatingProvider(true);
    setInlineCreateError(null);

    dashApi.saveProvider(
      credentials.appId,
      providerName,
      {
        providerType: providerType,
        credentials: providerCredentials,
      },
      (event, result) => {
        console.log(
          "[EnhancedWidgetDropdown] Provider saved successfully:",
          result,
        );

        // Refresh AppContext providers so the new provider appears everywhere
        if (refreshProviders) {
          refreshProviders();
        }

        // Auto-select the newly created provider
        setSelectedProviders((prev) => ({
          ...prev,
          [providerType]: providerName,
        }));

        // Collapse the inline form
        setInlineCreateType(null);
        setInlineCreateSchema({});
        setIsCreatingProvider(false);
      },
      (event, error) => {
        console.error(
          "[EnhancedWidgetDropdown] Failed to save provider:",
          error,
        );
        setInlineCreateError(
          `Failed to create provider: ${error?.message || "Unknown error"}`,
        );
        setIsCreatingProvider(false);
      },
    );
  };

  const handleInlineProviderCancel = () => {
    setInlineCreateType(null);
    setInlineCreateSchema({});
    setInlineCreateError(null);
    setInlineCatalogEntry(null);
    setInlineWizardStep(0);
    setInlineCredentialData({});
    setInlineProviderName("");
    setInlineFormErrors({});
    setInlineTestResult(null);
    setInlineAuthResult(null);
    setInlineSelectedTools(null);
    setInlineIsTesting(false);
    setInlineIsAuthorizing(false);
  };

  // ── Inline MCP Stepper Handlers ──

  const inlineFormFields = useMemo(() => {
    if (!inlineCatalogEntry?.mcpConfig) return [];
    return deriveFormFields(
      inlineCatalogEntry.mcpConfig,
      inlineCatalogEntry.credentialSchema || {},
    );
  }, [inlineCatalogEntry]);

  const inlineHasAuth = !!inlineCatalogEntry?.authCommand;
  const inlineWizardSteps = inlineHasAuth
    ? ["configure", "authorize", "testTools"]
    : ["configure", "testTools"];
  const inlineTotalSteps = inlineWizardSteps.length;
  const inlineCurrentStepType = inlineWizardSteps[inlineWizardStep];

  const inlineValidateForm = () => {
    const errors = {};
    if (!inlineProviderName?.trim()) {
      errors.providerName = "Provider name is required";
    }
    inlineFormFields.forEach((field) => {
      if (field.required && !inlineCredentialData[field.key]?.trim()) {
        errors[field.key] = `${field.displayName} is required`;
      }
    });
    setInlineFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const inlineHandleCredentialChange = (fieldName, value) => {
    setInlineCredentialData((prev) => ({ ...prev, [fieldName]: value }));
    if (inlineFormErrors[fieldName] && value?.trim()) {
      setInlineFormErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    }
  };

  const inlineHandleWizardStepChange = (newStep) => {
    if (newStep < inlineWizardStep) {
      setInlineWizardStep(newStep);
      return;
    }
    if (inlineCurrentStepType === "configure" && newStep > inlineWizardStep) {
      if (!inlineValidateForm()) return;
    }
    if (inlineCurrentStepType === "authorize" && newStep > inlineWizardStep) {
      if (!inlineAuthResult?.success) return;
    }
    setInlineWizardStep(newStep);
  };

  const inlineHandleTestConnection = () => {
    if (!dashApi || !inlineCatalogEntry?.mcpConfig) return;

    setInlineIsTesting(true);
    setInlineTestResult(null);

    const testName = `__test__${inlineCatalogEntry.id}`;

    dashApi.mcpStartServer(
      testName,
      inlineCatalogEntry.mcpConfig,
      inlineCredentialData,
      (event, result) => {
        if (result.error) {
          setInlineTestResult({ success: false, message: result.message });
          setInlineIsTesting(false);
          return;
        }

        setInlineTestResult({
          success: true,
          tools: result.tools || [],
          message: `Connected! Found ${(result.tools || []).length} tools.`,
        });

        setInlineSelectedTools((result.tools || []).map((t) => t.name));

        dashApi.mcpStopServer(
          testName,
          () => {},
          () => {},
        );
        setInlineIsTesting(false);
      },
      (event, err) => {
        setInlineTestResult({
          success: false,
          message: err?.message || "Connection failed",
        });
        setInlineIsTesting(false);
      },
    );
  };

  const inlineHandleAuthorize = () => {
    if (
      !dashApi ||
      !inlineCatalogEntry?.mcpConfig ||
      !inlineCatalogEntry?.authCommand
    )
      return;

    setInlineIsAuthorizing(true);
    setInlineAuthResult(null);

    dashApi.mcpRunAuth(
      inlineCatalogEntry.mcpConfig,
      inlineCredentialData,
      inlineCatalogEntry.authCommand,
      (event, result) => {
        if (result.error) {
          setInlineAuthResult({ success: false, message: result.message });
        } else {
          setInlineAuthResult({ success: true, message: "Authorized!" });
        }
        setInlineIsAuthorizing(false);
      },
      (event, err) => {
        setInlineAuthResult({
          success: false,
          message: err?.message || "Authorization failed",
        });
        setInlineIsAuthorizing(false);
      },
    );
  };

  const inlineHandleSave = () => {
    if (!inlineCatalogEntry || !inlineValidateForm()) return;

    const providerType = inlineCreateType;
    const providerName = inlineProviderName.trim();

    setIsCreatingProvider(true);
    setInlineCreateError(null);

    dashApi.saveProvider(
      credentials.appId,
      providerName,
      {
        providerType,
        credentials: inlineCredentialData,
        providerClass: "mcp",
        mcpConfig: inlineCatalogEntry.mcpConfig,
        allowedTools: inlineSelectedTools,
      },
      (event, result) => {
        console.log(
          "[EnhancedWidgetDropdown] MCP Provider saved successfully:",
          result,
        );

        if (refreshProviders) {
          refreshProviders();
        }

        setSelectedProviders((prev) => ({
          ...prev,
          [providerType]: providerName,
        }));

        // Reset stepper state
        setInlineCreateType(null);
        setInlineCreateSchema({});
        setInlineCatalogEntry(null);
        setIsCreatingProvider(false);
        setInlineWizardStep(0);
        setInlineCredentialData({});
        setInlineProviderName("");
        setInlineFormErrors({});
        setInlineTestResult(null);
        setInlineAuthResult(null);
        setInlineSelectedTools(null);
      },
      (event, error) => {
        console.error(
          "[EnhancedWidgetDropdown] Failed to save MCP provider:",
          error,
        );
        setInlineCreateError(
          `Failed to create provider: ${error?.message || "Unknown error"}`,
        );
        setIsCreatingProvider(false);
      },
    );
  };

  const handleConfigChange = (key, value) => {
    setUserConfigValues({ ...userConfigValues, [key]: value });
  };

  // Install a package from the registry
  const handleInstallPackage = async () => {
    if (!selectedWidget || !selectedWidget.isRegistry) return;

    setIsInstalling(true);
    setInstallError(null);

    try {
      const { packageName, downloadUrl, packageVersion } = selectedWidget;

      // Resolve version placeholder in download URL
      const resolvedUrl = downloadUrl
        .replace(/\{version\}/g, packageVersion)
        .replace(/\{name\}/g, packageName);

      console.log(
        `[EnhancedWidgetDropdown] Installing package: ${packageName} from ${resolvedUrl}`,
      );

      await window.mainApi.widgets.install(packageName, resolvedUrl);

      console.log(
        `[EnhancedWidgetDropdown] Package ${packageName} installed successfully`,
      );

      // Switch to Installed tab after successful install
      setSelectedSource("Installed");
      setSelectedWidget(null);
      setSelectedPackage(null);
    } catch (error) {
      console.error("[EnhancedWidgetDropdown] Install error:", error);
      setInstallError(error.message || "Failed to install package");
    } finally {
      setIsInstalling(false);
    }
  };

  // CRITICAL: Button State Validation
  const isAddButtonEnabled = () => {
    if (!selectedWidget) return false;

    // For registry widgets, enabled unless already installed
    if (selectedWidget.isRegistry) {
      return !installedPackageNames.has(selectedWidget.packageName);
    }

    // Check providers: all required providers must be selected
    const hasRequiredProviders = selectedWidget.providers
      ? selectedWidget.providers
          .filter((p) => p.required === true)
          .every(
            (p) =>
              selectedProviders[p.type] && selectedProviders[p.type] !== "",
          )
      : true; // If no providers, this check passes

    // Check userConfig: all required fields must be filled
    const hasRequiredConfig = selectedWidget.userConfig
      ? Object.entries(selectedWidget.userConfig)
          .filter(([key, config]) => config.required === true)
          .every(
            ([key, config]) =>
              userConfigValues[key] && userConfigValues[key] !== "",
          )
      : true; // If no userConfig, this check passes

    return hasRequiredProviders && hasRequiredConfig;
  };

  const handleAddWidget = () => {
    if (selectedWidget && isAddButtonEnabled()) {
      if (selectedWidget.isRegistry) {
        handleInstallPackage();
        return;
      }

      // Phase 3: Save to recent widgets
      saveToRecent(selectedWidget, selectedProviders, userConfigValues);

      onSelectWidget({
        ...selectedWidget,
        selectedProviders, // Pass to parent
        userConfigValues, // Pass to parent
      });
      onClose();
    }
  };

  if (!isOpen) return null;

  // Render the widget list for Discover mode
  const renderDiscoverList = () => {
    if (isLoadingRegistry) {
      return (
        <div className="flex items-center justify-center h-full p-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-3"></div>
            <Paragraph className="text-gray-400">Loading registry...</Paragraph>
          </div>
        </div>
      );
    }

    if (registryError) {
      return (
        <div className="p-6 text-center">
          <Paragraph className="text-red-400 mb-3">{registryError}</Paragraph>
          <Button
            title="Retry"
            bgColor="bg-gray-700"
            hoverBackgroundColor="hover:bg-gray-600"
            textSize="text-sm"
            padding="py-1 px-3"
            onClick={loadRegistryWidgets}
          />
        </div>
      );
    }

    if (registryPackages.length === 0) {
      return (
        <div className="p-8 text-center">
          <Heading3>No packages found</Heading3>
          <Paragraph className="mt-2 text-gray-500">
            {searchQuery
              ? "Try a different search term."
              : "The registry is empty."}
          </Paragraph>
        </div>
      );
    }

    if (registryViewMode === "packages") {
      // Package view: show packages as expandable groups
      const groups = getGroupedByPackage();
      return (
        <Menu3 scrollable={true} padding={true} height="h-full">
          {groups.map((group) => (
            <div key={group.name} className="mb-1 space-y-1">
              <MenuItem3
                onClick={() => {
                  handlePackageSelect(group);
                  togglePackageExpand(group.name);
                }}
                selected={selectedPackage === group.name}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs text-gray-500">
                      {expandedPackages.has(group.name) ? "\u25BC" : "\u25B6"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {group.displayName}
                      </div>
                      <div className="text-xs text-gray-500">
                        {group.widgets.length} widget
                        {group.widgets.length !== 1 ? "s" : ""} &middot; v
                        {group.version}
                      </div>
                    </div>
                    {installedPackageNames.has(group.name) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 flex-shrink-0">
                        Installed
                      </span>
                    )}
                  </div>
                </div>
              </MenuItem3>
              {expandedPackages.has(group.name) &&
                group.widgets.map((widget) => (
                  <MenuItem3
                    key={widget.key}
                    onClick={() => handleWidgetSelect(widget)}
                    selected={selectedWidget?.key === widget.key}
                  >
                    <div className="flex items-center gap-2 pl-6 w-full">
                      <WidgetIcon
                        icon={widget.icon}
                        className="h-4 w-4 opacity-60 flex-shrink-0"
                        fallback="puzzle-piece"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {widget.name}
                        </div>
                        {widget.description && (
                          <div className="text-xs opacity-50 truncate">
                            {widget.description}
                          </div>
                        )}
                        {widget.providers?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {widget.providers.map((p) => (
                              <span
                                key={p.type}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300"
                              >
                                {p.type}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </MenuItem3>
                ))}
            </div>
          ))}
        </Menu3>
      );
    }

    // Flat widget view
    return (
      <Menu3 scrollable={true} padding={true} height="h-full">
        {filteredWidgets.map((widget) => (
          <MenuItem3
            key={widget.key}
            onClick={() => handleWidgetSelect(widget)}
            selected={selectedWidget?.key === widget.key}
          >
            <div className="flex items-center gap-2 w-full">
              <WidgetIcon
                icon={widget.icon}
                className="h-4 w-4 opacity-60 flex-shrink-0"
                fallback="puzzle-piece"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {widget.name}
                </div>
                {widget.description && (
                  <div className="text-xs opacity-50 truncate">
                    {widget.description}
                  </div>
                )}
                {widget.providers?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {widget.providers.map((p) => (
                      <span
                        key={p.type}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300"
                      >
                        {p.type}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {installedPackageNames.has(widget.packageName) && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                    Installed
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  {widget.packageDisplayName}
                </span>
              </div>
            </div>
          </MenuItem3>
        ))}
      </Menu3>
    );
  };

  // Render the detail panel for a registry widget
  const renderRegistryDetail = () => {
    if (!selectedWidget || !selectedWidget.isRegistry) return null;

    return (
      <div className="flex-1 overflow-y-auto min-h-0 p-4 w-full">
        {/* Package Header */}
        <div className="mb-2">
          <div className="flex items-center space-x-2 mb-1">
            <WidgetIcon
              icon={selectedWidget.icon}
              className="h-6 w-6 text-white/70"
            />
            <h3 className="text-xl font-bold text-white">
              {selectedWidget.packageDisplayName}
            </h3>
          </div>
          <div className="flex items-center space-x-3 pl-10">
            <span className="text-sm text-gray-400">
              by {selectedWidget.packageAuthor || "Unknown"}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded ${currentTheme["bg-primary-medium"]} text-gray-300`}
            >
              v{selectedWidget.packageVersion}
            </span>
            {installedPackageNames.has(selectedWidget.packageName) && (
              <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400">
                Installed
              </span>
            )}
          </div>
        </div>

        <hr className={`my-2 ${currentTheme["border-primary-medium"]}`} />

        {/* Description */}
        {selectedWidget.packageDescription && (
          <div className="mb-2">
            <Paragraph padding="py-2" className="text-sm">
              {selectedWidget.packageDescription}
            </Paragraph>
          </div>
        )}

        {/* Tags */}
        {selectedWidget.packageTags &&
          selectedWidget.packageTags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {selectedWidget.packageTags.map((tag) => (
                <span
                  key={tag}
                  className={`text-xs px-2 py-0.5 rounded ${currentTheme["bg-primary-medium"]} text-gray-400`}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

        {/* Included Widgets */}
        <div className="mb-2">
          <Paragraph
            padding={false}
            className="text-xs font-semibold text-gray-400 mb-1.5"
          >
            INCLUDED WIDGETS
          </Paragraph>
          <div className="space-y-2">
            {(selectedWidget.packageWidgets || []).map((w, idx) => (
              <div
                key={idx}
                className={`p-3 rounded ${currentTheme["bg-primary-medium"]}`}
              >
                <div className="text-sm font-medium text-white">
                  {w.displayName || w.name}
                </div>
                {w.description && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    {w.description}
                  </div>
                )}
                {w.providers && w.providers.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {w.providers.map((p, pidx) => (
                      <span
                        key={pidx}
                        className="text-xs px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400"
                      >
                        {p.type}
                        {p.required ? " *" : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Repository Link */}
        {selectedWidget.repository && (
          <div className="mb-2">
            <Paragraph
              padding={false}
              className="text-xs font-semibold text-gray-400 mb-1"
            >
              REPOSITORY
            </Paragraph>
            <Paragraph
              padding={false}
              className="text-sm text-blue-400 break-all"
            >
              {selectedWidget.repository}
            </Paragraph>
          </div>
        )}

        {/* Install Error */}
        {installError && (
          <div className="mt-3 p-2 rounded bg-red-900/30 border border-red-700">
            <p className="text-xs text-red-400">{installError}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      setIsOpen={onClose}
      width={"w-11/12 xl:w-5/6"}
      height="h-5/6"
    >
      <Panel direction="col" padding={false}>
        <div className={`flex flex-col w-full h-full overflow-clip`}>
          <div className="flex flex-col w-full h-full overflow-clip">
            {/* Main Content Area */}
            <div className="flex flex-row w-full flex-1 min-h-0 space-x-4 overflow-clip p-6">
              {/* Left Side: Title and Description (1/3) - Hidden on small screens */}
              <div className="hidden lg:flex flex-col flex-shrink h-full rounded font-medium text-gray-400 w-1/3">
                <div className="flex flex-col rounded p-6 py-10 space-y-4">
                  <Heading title={"Add Widget to Dashboard"} padding={false} />
                  <SubHeading3
                    title={
                      selectedSource === "Discover"
                        ? "Browse the widget registry to discover and install community-contributed widget packages."
                        : "Browse and select widgets to add to your dashboard. Widgets provide specialized functionality like analytics, notifications, and integrations."
                    }
                    padding={false}
                  />
                </div>
              </div>

              {/* Right Side: Two-Column Widget Selector - Full width on small screens, 2/3 on large */}
              <div className="flex flex-col w-full lg:w-2/3 h-full overflow-hidden">
                {/* Filters */}
                <div className="flex flex-col gap-3 mb-4 px-2">
                  {/* Top row: Tab toggle + Search */}
                  <div className="flex flex-row items-center gap-3">
                    {/* Installed / Discover pill toggle */}
                    <div className="flex bg-white/5 rounded-md p-0.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setSelectedSource("Installed")}
                        className={`px-3 py-1.5 rounded text-sm transition-colors ${
                          selectedSource === "Installed"
                            ? "bg-white/10 font-medium opacity-90"
                            : "opacity-50 hover:opacity-70"
                        }`}
                      >
                        Installed
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSource("Discover")}
                        className={`px-3 py-1.5 rounded text-sm transition-colors ${
                          selectedSource === "Discover"
                            ? "bg-white/10 font-medium opacity-90"
                            : "opacity-50 hover:opacity-70"
                        }`}
                      >
                        Discover
                      </button>
                    </div>

                    {/* Search */}
                    <SearchInput
                      value={searchQuery}
                      onChange={setSearchQuery}
                      placeholder={
                        selectedSource === "Discover"
                          ? "Search packages and widgets..."
                          : "Search widgets..."
                      }
                      className="flex-1"
                      inputClassName="py-1.5 text-sm"
                    />
                  </div>

                  {/* Bottom row: Secondary filters */}
                  <div className="flex flex-row items-center gap-2">
                    {/* Author Filter */}
                    <select
                      value={selectedAuthor}
                      onChange={(e) => setSelectedAuthor(e.target.value)}
                      className={`px-2 py-1 rounded text-xs bg-transparent border ${currentTheme["border-primary-medium"] || "border-gray-700"} ${currentTheme["text-primary-light"] || "text-gray-300"} focus:outline-none appearance-none cursor-pointer`}
                    >
                      <option value="all">All Authors</option>
                      {getUniqueAuthors().map((author) => (
                        <option key={author} value={author}>
                          {author}
                        </option>
                      ))}
                    </select>

                    {/* Provider Filter - Only show for Installed */}
                    {selectedSource === "Installed" && (
                      <select
                        value={selectedProvider}
                        onChange={(e) => setSelectedProvider(e.target.value)}
                        className={`px-2 py-1 rounded text-xs bg-transparent border ${currentTheme["border-primary-medium"] || "border-gray-700"} ${currentTheme["text-primary-light"] || "text-gray-300"} focus:outline-none appearance-none cursor-pointer`}
                      >
                        <option value="all">All Providers</option>
                        {getUniqueProviders().map((provider) => (
                          <option key={provider} value={provider}>
                            {provider === "none" ? "No Providers" : provider}
                          </option>
                        ))}
                      </select>
                    )}

                    {/* View Mode Toggle - Only for Discover */}
                    {selectedSource === "Discover" && (
                      <select
                        value={registryViewMode}
                        onChange={(e) => setRegistryViewMode(e.target.value)}
                        className={`px-2 py-1 rounded text-xs bg-transparent border ${currentTheme["border-primary-medium"] || "border-gray-700"} ${currentTheme["text-primary-light"] || "text-gray-300"} focus:outline-none appearance-none cursor-pointer`}
                      >
                        <option value="packages">Packages</option>
                        <option value="widgets">Widgets</option>
                      </select>
                    )}
                  </div>
                </div>

                <div className="flex flex-row h-full overflow-hidden">
                  {/* Column 1: Widget List (50%) */}
                  <div
                    className={`w-1/2 border-r ${currentTheme["border-primary-medium"]} flex flex-col overflow-hidden p-2`}
                  >
                    {/* Widget List - Scrollable */}
                    <div className="flex-1 overflow-y-auto w-full h-full">
                      {selectedSource === "Discover" ? (
                        renderDiscoverList()
                      ) : filteredWidgets.length === 0 ? (
                        // No Widgets Found
                        <div className="p-8 text-center h-full w-full">
                          <Paragraph className="text-gray-500">
                            {widgets.length === 0
                              ? "No widgets found"
                              : "No widgets match the current filters"}
                          </Paragraph>
                        </div>
                      ) : (
                        // Widget List using Menu3/MenuItem3
                        <Menu3 scrollable={true} padding={true} height="h-full">
                          {/* Recent Widgets Section */}
                          {recentWidgets.length > 0 &&
                            selectedSource === "Installed" && (
                              <div className="mb-3 space-y-1">
                                <div
                                  className={`px-3 py-1 mb-1 border-b ${currentTheme["border-primary-medium"]}`}
                                >
                                  <Paragraph
                                    padding={false}
                                    className="text-xs font-semibold text-gray-400"
                                  >
                                    RECENT
                                  </Paragraph>
                                </div>
                                {recentWidgets.map((widget) => (
                                  <MenuItem3
                                    key={`recent-${widget.key}`}
                                    onClick={() => handleRecentClick(widget)}
                                    selected={
                                      selectedWidget?.key === widget.key
                                    }
                                  >
                                    <div className="flex items-center gap-2 w-full">
                                      <WidgetIcon
                                        icon={widget.icon}
                                        className="h-4 w-4 opacity-60 flex-shrink-0"
                                        fallback="puzzle-piece"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium truncate">
                                          {widget.name}
                                        </div>
                                        {widget.description && (
                                          <div className="text-xs opacity-50 truncate">
                                            {widget.description}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </MenuItem3>
                                ))}
                              </div>
                            )}

                          {/* Grouped Widget List */}
                          {installedGroupNames.map((groupName) => (
                            <div key={groupName} className="mb-1 space-y-1">
                              <button
                                type="button"
                                onClick={() => toggleGroup(groupName)}
                                className={`flex items-center gap-1.5 w-full px-2 py-1.5 text-xs font-semibold text-gray-400 hover:text-gray-300 transition-colors`}
                              >
                                <span className="text-[10px] opacity-60">
                                  {expandedGroups.has(groupName)
                                    ? "\u25BC"
                                    : "\u25B6"}
                                </span>
                                {groupName}
                                <span className="opacity-40 ml-auto">
                                  {groupedInstalledWidgets[groupName].length}
                                </span>
                              </button>
                              {expandedGroups.has(groupName) &&
                                groupedInstalledWidgets[groupName].map(
                                  (widget) => (
                                    <MenuItem3
                                      key={widget.key}
                                      onClick={() => handleWidgetSelect(widget)}
                                      selected={
                                        selectedWidget?.key === widget.key
                                      }
                                    >
                                      <div className="flex items-center gap-2 w-full">
                                        <WidgetIcon
                                          icon={widget.icon}
                                          className="h-4 w-4 opacity-60 flex-shrink-0"
                                          fallback="puzzle-piece"
                                        />
                                        <div className="flex-1 min-w-0">
                                          <div className="text-sm font-medium truncate">
                                            {widget.name}
                                          </div>
                                          {widget.description && (
                                            <div className="text-xs opacity-50 truncate">
                                              {widget.description}
                                            </div>
                                          )}
                                          {widget.providers?.length > 0 && (
                                            <div className="flex flex-wrap gap-1 mt-0.5">
                                              {widget.providers.map((p) => (
                                                <span
                                                  key={p.type}
                                                  className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300"
                                                >
                                                  {p.type}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </MenuItem3>
                                  ),
                                )}
                            </div>
                          ))}
                        </Menu3>
                      )}
                    </div>

                    {/* Widget Count Indicator */}
                    <div
                      className={`px-4 py-2 border-t ${currentTheme["border-primary-medium"]} ${currentTheme["bg-primary-medium"]}`}
                    >
                      <Paragraph
                        padding={false}
                        className="text-sm text-gray-400"
                      >
                        {selectedSource === "Discover"
                          ? `${registryPackages.length} package${
                              registryPackages.length !== 1 ? "s" : ""
                            } \u00B7 ${filteredWidgets.length} widget${
                              filteredWidgets.length !== 1 ? "s" : ""
                            }`
                          : `${filteredWidgets.length} of ${
                              widgets.length
                            } widget${widgets.length !== 1 ? "s" : ""}`}
                      </Paragraph>
                    </div>
                  </div>

                  {/* Column 2: Widget Details / Configure & Add (50%) */}
                  <div className="h-full w-1/2 flex flex-col overflow-hidden min-h-0 p-2">
                    <Panel3
                      padding={true}
                      className="w-full flex flex-col overflow-auto min-h-0"
                    >
                      {selectedWidget ? (
                        selectedWidget.isRegistry ? (
                          // Registry Widget Details
                          renderRegistryDetail()
                        ) : (
                          // Installed Widget Details
                          <div className="flex-1 overflow-y-auto min-h-0 p-4 w-full">
                            {/* Widget Header */}
                            <div className="mb-2">
                              <div className="flex items-center space-x-2 mb-1">
                                <WidgetIcon
                                  icon={selectedWidget.icon}
                                  className="h-6 w-6 text-white/70"
                                />
                                <h3 className="text-xl font-bold text-white">
                                  {selectedWidget.name}
                                </h3>
                              </div>
                              <div className="text-sm text-gray-400 pl-10">
                                by{" "}
                                {selectedWidget.author ||
                                  selectedWidget.workspace ||
                                  "Unknown"}
                              </div>
                            </div>

                            <hr
                              className={`my-2 ${currentTheme["border-primary-medium"]}`}
                            />

                            {/* Description */}
                            {selectedWidget.description && (
                              <div className="mb-2">
                                <Paragraph padding="py-2" className="text-sm">
                                  {selectedWidget.description}
                                </Paragraph>
                              </div>
                            )}

                            {/* Required Providers - PHASE 2: Interactive Selection */}
                            {selectedWidget.providers &&
                              selectedWidget.providers.length > 0 && (
                                <div className="mb-2">
                                  <Paragraph
                                    padding={false}
                                    className="text-xs font-semibold text-gray-400 mb-2"
                                  >
                                    REQUIRED PROVIDERS
                                  </Paragraph>
                                  <div className="space-y-2">
                                    {selectedWidget.providers.map(
                                      (providerReq, idx) => {
                                        // Get available providers of this type
                                        const providersOfType = Object.values(
                                          availableProviders,
                                        ).filter(
                                          (p) => p.type === providerReq.type,
                                        );

                                        return (
                                          <div key={idx} className="space-y-1">
                                            <label className="text-sm font-medium">
                                              {providerReq.type}
                                              {providerReq.required && (
                                                <span className="text-red-400 ml-1">
                                                  *
                                                </span>
                                              )}
                                            </label>
                                            <select
                                              value={
                                                selectedProviders[
                                                  providerReq.type
                                                ] || ""
                                              }
                                              onChange={(e) =>
                                                handleProviderSelect(
                                                  providerReq.type,
                                                  e.target.value,
                                                )
                                              }
                                              className={`w-full px-3 py-2 rounded text-sm ${currentTheme["bg-primary-medium"]} ${currentTheme["text-primary-light"]} ${currentTheme["border-primary-medium"]} border`}
                                            >
                                              <option value="">
                                                -- Select Provider --
                                              </option>
                                              {providersOfType.map((p) => (
                                                <option
                                                  key={p.name}
                                                  value={p.name}
                                                >
                                                  {p.name}
                                                </option>
                                              ))}
                                              <option value="__create_new__">
                                                + Create New {providerReq.type}
                                              </option>
                                            </select>
                                            {providerReq.required &&
                                              !selectedProviders[
                                                providerReq.type
                                              ] &&
                                              inlineCreateType !==
                                                providerReq.type && (
                                                <p className="text-xs text-red-400">
                                                  Required
                                                </p>
                                              )}

                                            {/* Inline Provider Creation Form */}
                                            {inlineCreateType ===
                                              providerReq.type && (
                                              <div
                                                className={`mt-3 p-3 rounded border ${currentTheme["border-primary-medium"]} ${currentTheme["bg-primary-dark"]}`}
                                              >
                                                <p className="text-xs font-semibold text-gray-400 mb-2">
                                                  CREATE NEW{" "}
                                                  {providerReq.type.toUpperCase()}{" "}
                                                  PROVIDER
                                                </p>

                                                {inlineCreateError && (
                                                  <div className="mb-3 p-2 rounded bg-red-900/30 border border-red-700">
                                                    <p className="text-xs text-red-400">
                                                      {inlineCreateError}
                                                    </p>
                                                  </div>
                                                )}

                                                {inlineCatalogEntry ? (
                                                  /* MCP Provider: Stepper-based creation */
                                                  <div className="space-y-3">
                                                    <Stepper
                                                      activeStep={
                                                        inlineWizardStep
                                                      }
                                                      onStepChange={
                                                        inlineHandleWizardStepChange
                                                      }
                                                      showNavigation={false}
                                                      className="flex-1 min-h-0 flex flex-col"
                                                    >
                                                      {/* Step 1: Configure */}
                                                      <Stepper.Step
                                                        label="Configure"
                                                        description="Name & credentials"
                                                      >
                                                        <div className="space-y-4 pb-2">
                                                          {/* MCP Connection Info */}
                                                          <div className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-2">
                                                            <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
                                                              MCP Server
                                                              Connection
                                                            </p>
                                                            <div className="space-y-1 text-sm">
                                                              <div className="flex gap-2">
                                                                <span className="opacity-50 w-20 shrink-0">
                                                                  Transport:
                                                                </span>
                                                                <Tag
                                                                  text={
                                                                    inlineCatalogEntry
                                                                      .mcpConfig
                                                                      ?.transport ===
                                                                    "streamable_http"
                                                                      ? "Streamable HTTP"
                                                                      : "stdio"
                                                                  }
                                                                />
                                                              </div>
                                                              {inlineCatalogEntry
                                                                .mcpConfig
                                                                ?.transport !==
                                                                "streamable_http" && (
                                                                <div className="flex gap-2">
                                                                  <span className="opacity-50 w-20 shrink-0">
                                                                    Command:
                                                                  </span>
                                                                  <code className="text-xs bg-white/5 px-2 py-0.5 rounded">
                                                                    {
                                                                      inlineCatalogEntry
                                                                        .mcpConfig
                                                                        ?.command
                                                                    }{" "}
                                                                    {(
                                                                      inlineCatalogEntry
                                                                        .mcpConfig
                                                                        ?.args ||
                                                                      []
                                                                    ).join(" ")}
                                                                  </code>
                                                                </div>
                                                              )}
                                                            </div>
                                                          </div>

                                                          {/* Provider Name */}
                                                          <div className="flex flex-col gap-1">
                                                            <FormLabel
                                                              label="Provider Name"
                                                              required={true}
                                                            />
                                                            <InputText
                                                              value={
                                                                inlineProviderName
                                                              }
                                                              onChange={(
                                                                value,
                                                              ) => {
                                                                setInlineProviderName(
                                                                  value,
                                                                );
                                                                if (
                                                                  inlineFormErrors.providerName &&
                                                                  value?.trim()
                                                                ) {
                                                                  setInlineFormErrors(
                                                                    (prev) => {
                                                                      const next =
                                                                        {
                                                                          ...prev,
                                                                        };
                                                                      delete next.providerName;
                                                                      return next;
                                                                    },
                                                                  );
                                                                }
                                                              }}
                                                              placeholder="Enter provider name"
                                                            />
                                                            {inlineFormErrors.providerName && (
                                                              <p className="text-xs text-red-400">
                                                                {
                                                                  inlineFormErrors.providerName
                                                                }
                                                              </p>
                                                            )}
                                                          </div>

                                                          {/* Credential Fields */}
                                                          {inlineFormFields.length >
                                                            0 && (
                                                            <>
                                                              <div className="border-t border-white/10 pt-3">
                                                                <p className="text-xs font-semibold opacity-40 uppercase tracking-wider">
                                                                  {inlineCatalogEntry
                                                                    .mcpConfig
                                                                    ?.transport ===
                                                                  "streamable_http"
                                                                    ? "Server Configuration"
                                                                    : "Authentication"}
                                                                </p>
                                                              </div>

                                                              {inlineFormFields.map(
                                                                (field) => (
                                                                  <div
                                                                    key={
                                                                      field.key
                                                                    }
                                                                    className="flex flex-col gap-1"
                                                                  >
                                                                    <FormLabel
                                                                      label={
                                                                        field.displayName
                                                                      }
                                                                      required={
                                                                        field.required
                                                                      }
                                                                    />
                                                                    {field.instructions && (
                                                                      <p className="text-xs opacity-50">
                                                                        {
                                                                          field.instructions
                                                                        }
                                                                      </p>
                                                                    )}
                                                                    <div className="flex gap-2">
                                                                      <div className="flex-1">
                                                                        <InputText
                                                                          type={
                                                                            field.secret
                                                                              ? "password"
                                                                              : "text"
                                                                          }
                                                                          value={
                                                                            inlineCredentialData[
                                                                              field
                                                                                .key
                                                                            ] ||
                                                                            ""
                                                                          }
                                                                          onChange={(
                                                                            value,
                                                                          ) =>
                                                                            inlineHandleCredentialChange(
                                                                              field.key,
                                                                              value,
                                                                            )
                                                                          }
                                                                          placeholder={
                                                                            field.type ===
                                                                            "file"
                                                                              ? "Select a file..."
                                                                              : `Enter ${field.displayName.toLowerCase()}`
                                                                          }
                                                                        />
                                                                      </div>
                                                                      {field.type ===
                                                                        "file" && (
                                                                        <button
                                                                          onClick={async () => {
                                                                            const filepath =
                                                                              await window.mainApi.dialog.chooseFile(
                                                                                true,
                                                                                [
                                                                                  "json",
                                                                                ],
                                                                              );
                                                                            if (
                                                                              filepath
                                                                            )
                                                                              inlineHandleCredentialChange(
                                                                                field.key,
                                                                                filepath,
                                                                              );
                                                                          }}
                                                                          className="px-3 py-1.5 text-sm rounded bg-white/10 hover:bg-white/20 transition-colors"
                                                                        >
                                                                          Browse
                                                                        </button>
                                                                      )}
                                                                    </div>
                                                                    {inlineFormErrors[
                                                                      field.key
                                                                    ] && (
                                                                      <p className="text-xs text-red-400">
                                                                        {
                                                                          inlineFormErrors[
                                                                            field
                                                                              .key
                                                                          ]
                                                                        }
                                                                      </p>
                                                                    )}
                                                                  </div>
                                                                ),
                                                              )}
                                                            </>
                                                          )}
                                                        </div>
                                                      </Stepper.Step>

                                                      {/* Step 2: Authorize (conditional) */}
                                                      {inlineHasAuth && (
                                                        <Stepper.Step
                                                          label="Authorize"
                                                          description="OAuth authentication"
                                                        >
                                                          <div className="space-y-4 pb-2">
                                                            <div className="flex flex-col items-center justify-center py-6 space-y-3">
                                                              <p className="text-sm opacity-60 text-center max-w-md">
                                                                This server
                                                                requires OAuth
                                                                authorization.
                                                                Click the button
                                                                below to open a
                                                                browser window
                                                                and complete the
                                                                authentication
                                                                flow.
                                                              </p>
                                                              <Button
                                                                title={
                                                                  inlineIsAuthorizing
                                                                    ? "Authorizing..."
                                                                    : "Authorize"
                                                                }
                                                                onClick={
                                                                  inlineHandleAuthorize
                                                                }
                                                                size="sm"
                                                              />
                                                            </div>
                                                            {inlineAuthResult && (
                                                              <div
                                                                className={`p-3 rounded-lg text-sm ${
                                                                  inlineAuthResult.success
                                                                    ? "bg-green-900/30 border border-green-700 text-green-300"
                                                                    : "bg-red-900/30 border border-red-700 text-red-300"
                                                                }`}
                                                              >
                                                                <div className="flex items-center gap-2">
                                                                  <FontAwesomeIcon
                                                                    icon={
                                                                      inlineAuthResult.success
                                                                        ? "circle-check"
                                                                        : "circle-exclamation"
                                                                    }
                                                                  />
                                                                  <span>
                                                                    {
                                                                      inlineAuthResult.message
                                                                    }
                                                                  </span>
                                                                </div>
                                                              </div>
                                                            )}
                                                          </div>
                                                        </Stepper.Step>
                                                      )}

                                                      {/* Step 3: Test & Tools */}
                                                      <Stepper.Step
                                                        label="Test & Tools"
                                                        description="Verify & select tools"
                                                      >
                                                        <div className="space-y-3 pb-2">
                                                          <div className="flex items-center gap-3">
                                                            <Button
                                                              title={
                                                                inlineIsTesting
                                                                  ? "Fetching..."
                                                                  : "Fetch Tools"
                                                              }
                                                              onClick={
                                                                inlineHandleTestConnection
                                                              }
                                                              size="sm"
                                                            />
                                                            {inlineTestResult && (
                                                              <span
                                                                className={`text-sm ${inlineTestResult.success ? "text-green-400" : "text-red-400"}`}
                                                              >
                                                                <FontAwesomeIcon
                                                                  icon={
                                                                    inlineTestResult.success
                                                                      ? "circle-check"
                                                                      : "circle-exclamation"
                                                                  }
                                                                  className="mr-1"
                                                                />
                                                                {
                                                                  inlineTestResult.message
                                                                }
                                                              </span>
                                                            )}
                                                          </div>
                                                          {inlineTestResult?.success &&
                                                            inlineTestResult
                                                              .tools?.length >
                                                              0 &&
                                                            inlineSelectedTools && (
                                                              <ToolSelector
                                                                tools={
                                                                  inlineTestResult.tools
                                                                }
                                                                selectedTools={
                                                                  inlineSelectedTools
                                                                }
                                                                onSelectionChange={
                                                                  setInlineSelectedTools
                                                                }
                                                              />
                                                            )}
                                                          {!inlineTestResult && (
                                                            <div className="text-center py-6 opacity-50 text-sm">
                                                              Click &quot;Fetch
                                                              Tools&quot; to
                                                              test the
                                                              connection and
                                                              discover available
                                                              tools.
                                                            </div>
                                                          )}
                                                        </div>
                                                      </Stepper.Step>
                                                    </Stepper>

                                                    {/* Stepper Footer */}
                                                    <div className="flex flex-row items-center pt-3 border-t border-white/10">
                                                      <div className="flex flex-row gap-2">
                                                        {inlineWizardStep ===
                                                          0 && (
                                                          <Button
                                                            title="Cancel"
                                                            onClick={
                                                              handleInlineProviderCancel
                                                            }
                                                            size="sm"
                                                          />
                                                        )}
                                                        {inlineWizardStep >
                                                          0 && (
                                                          <Button
                                                            title="Back"
                                                            onClick={() =>
                                                              setInlineWizardStep(
                                                                inlineWizardStep -
                                                                  1,
                                                              )
                                                            }
                                                            size="sm"
                                                          />
                                                        )}
                                                      </div>
                                                      <div className="flex-1 text-center">
                                                        <span className="text-xs opacity-40">
                                                          Step{" "}
                                                          {inlineWizardStep + 1}{" "}
                                                          of {inlineTotalSteps}
                                                        </span>
                                                      </div>
                                                      <div className="flex flex-row gap-2">
                                                        {inlineCurrentStepType ===
                                                          "configure" && (
                                                          <Button
                                                            title="Next"
                                                            onClick={() =>
                                                              inlineHandleWizardStepChange(
                                                                inlineWizardStep +
                                                                  1,
                                                              )
                                                            }
                                                            size="sm"
                                                          />
                                                        )}
                                                        {inlineCurrentStepType ===
                                                          "authorize" && (
                                                          <Button
                                                            title="Next"
                                                            onClick={() =>
                                                              inlineHandleWizardStepChange(
                                                                inlineWizardStep +
                                                                  1,
                                                              )
                                                            }
                                                            disabled={
                                                              !inlineAuthResult?.success
                                                            }
                                                            size="sm"
                                                          />
                                                        )}
                                                        {inlineCurrentStepType ===
                                                          "testTools" && (
                                                          <Button
                                                            title={
                                                              isCreatingProvider
                                                                ? "Saving..."
                                                                : "Save MCP Server"
                                                            }
                                                            onClick={
                                                              inlineHandleSave
                                                            }
                                                            size="sm"
                                                          />
                                                        )}
                                                      </div>
                                                    </div>
                                                  </div>
                                                ) : (
                                                  /* Credential Provider: flat form fallback */
                                                  <ProviderForm
                                                    credentialSchema={
                                                      inlineCreateSchema
                                                    }
                                                    onSubmit={
                                                      handleInlineProviderSubmit
                                                    }
                                                    onCancel={
                                                      handleInlineProviderCancel
                                                    }
                                                    submitLabel={
                                                      isCreatingProvider
                                                        ? "Creating..."
                                                        : "Create Provider"
                                                    }
                                                    providerType={
                                                      providerReq.type
                                                    }
                                                  />
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      },
                                    )}
                                  </div>
                                </div>
                              )}

                            {/* Configuration Options - PHASE 2: Interactive Inputs */}
                            {selectedWidget.userConfig &&
                              Object.keys(selectedWidget.userConfig).length >
                                0 && (
                                <div className="mb-2">
                                  <Paragraph
                                    padding={false}
                                    className="text-xs font-semibold text-gray-400 mb-2"
                                  >
                                    CONFIGURATION
                                  </Paragraph>
                                  <div className="space-y-2">
                                    {Object.entries(
                                      selectedWidget.userConfig,
                                    ).map(([key, config]) => (
                                      <div key={key} className="space-y-1">
                                        <label className="text-sm font-medium">
                                          {config.displayName || key}
                                          {config.required && (
                                            <span className="text-red-400 ml-1">
                                              *
                                            </span>
                                          )}
                                        </label>

                                        {config.type === "text" && (
                                          <input
                                            type="text"
                                            placeholder={
                                              config.defaultValue || ""
                                            }
                                            value={userConfigValues[key] || ""}
                                            onChange={(e) =>
                                              handleConfigChange(
                                                key,
                                                e.target.value,
                                              )
                                            }
                                            className={`w-full px-3 py-2 rounded text-sm ${currentTheme["bg-primary-medium"]} ${currentTheme["text-primary-light"]} ${currentTheme["border-primary-medium"]} border`}
                                          />
                                        )}

                                        {config.type === "select" && (
                                          <select
                                            value={
                                              userConfigValues[key] ||
                                              config.defaultValue ||
                                              ""
                                            }
                                            onChange={(e) =>
                                              handleConfigChange(
                                                key,
                                                e.target.value,
                                              )
                                            }
                                            className={`w-full px-3 py-2 rounded text-sm ${currentTheme["bg-primary-medium"]} ${currentTheme["text-primary-light"]} ${currentTheme["border-primary-medium"]} border`}
                                          >
                                            {config.options &&
                                              config.options.map((opt) => {
                                                const optValue =
                                                  typeof opt === "object"
                                                    ? opt.value
                                                    : opt;
                                                const optLabel =
                                                  typeof opt === "object"
                                                    ? opt.displayName ||
                                                      opt.value
                                                    : opt;
                                                return (
                                                  <option
                                                    key={optValue}
                                                    value={optValue}
                                                  >
                                                    {optLabel}
                                                  </option>
                                                );
                                              })}
                                          </select>
                                        )}

                                        {config.instructions && (
                                          <p className="text-xs text-gray-400">
                                            {config.instructions}
                                          </p>
                                        )}

                                        {config.required &&
                                          !userConfigValues[key] && (
                                            <p className="text-xs text-red-400">
                                              Required
                                            </p>
                                          )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                          </div>
                        )
                      ) : (
                        // Empty State
                        <div className="flex-1 flex items-center justify-center">
                          <Panel3 padding={true}>
                            <Paragraph className="text-gray-500 text-center">
                              {selectedSource === "Discover"
                                ? "Select a package to view details"
                                : "Select a widget to view details"}
                            </Paragraph>
                          </Panel3>
                        </div>
                      )}
                    </Panel3>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-row justify-between bg-gray-900 p-4 rounded-br rounded-bl border-t border-gray-800">
              <div className="flex flex-row text-lg text-gray-600 items-center font-bold px-4">
                {selectedSource === "Discover"
                  ? "Browse and install widget packages from the registry."
                  : "Select a widget from the list to view details and add it to your dashboard."}
              </div>
              <div className="flex flex-row space-x-2">
                <Button
                  title={"Cancel"}
                  bgColor={"bg-gray-800"}
                  textSize={"text-lg"}
                  padding={"py-2 px-4"}
                  onClick={onClose}
                />
                <Button
                  title={
                    selectedWidget?.isRegistry
                      ? isInstalling
                        ? "Installing..."
                        : installedPackageNames.has(selectedWidget.packageName)
                          ? "Already Installed"
                          : "Install Package"
                      : "Add to Dashboard"
                  }
                  bgColor={"bg-gray-800"}
                  hoverBackgroundColor={
                    isAddButtonEnabled() && !isInstalling
                      ? selectedWidget?.isRegistry
                        ? "hover:bg-blue-700"
                        : "hover:bg-green-700"
                      : ""
                  }
                  textSize={"text-lg"}
                  padding={"py-2 px-4"}
                  onClick={handleAddWidget}
                  disabled={!isAddButtonEnabled() || isInstalling}
                />
              </div>
            </div>
          </div>
        </div>
      </Panel>
    </Modal>
  );
};
