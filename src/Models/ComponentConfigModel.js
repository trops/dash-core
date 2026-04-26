/*
 "component": AnalyticsReportsWidget,
    "type":"widget",
    "workspace":"algolia-analytics",
    "canHaveChildren": false,
    "userConfig": {
        "report": { type: 'select', displayName: "Report Type", instructions: "Select the report from the list", options: [
            {
                value: '',
                displayName: 'User Select'
            },
            {
                value: 'top-searches',
                displayName: 'Top Searches'
            },
            {
                value: 'top-searches-count',
                displayName: 'Top Searches Count',
            },
            {
                value: 'no-results',
                displayName: 'No Results',
            },
            {
                value: 'query-analytics',
                displayName: 'Query Analytics',
            }
        ], required: false },
        "indexName": { type: "text", defaultValue: "dev_find_accelerator", instructions: "Type the name of the index you wish to search", options: [], displayName: "Index Name", required: true },
        "appId": { type: "text", defaultValue: process.env.REACT_APP_APP_ID, instructions: "Type the name of the appId", options: [], displayName: "App Id", required: true },
        "apiKey": { type: "secret", defaultValue: process.env.REACT_APP_ALGOLIA_KEY, instructions: "Type the api key for this appId", options: [], displayName: "Api Key", required: true },
    },
    "styles": {
        "backgroundColor": "bg-blue-900",
        "borderColor": "border-blue-900"
    },
    "events": ["fetchAnalyticsComplete"],
    "eventHandlers":['handleSearchChange','handleRefinementChange']
*/
/**
 * ComponentConfigModel
 * @param {object} o the data passed in to generate the model
 * @returns <ComponentConfigModel>Object
 */
export const ComponentConfigModel = (obj = {}) => {
  /**
   * id
   * The unique identifer for the component
   */
  obj.id = "id" in obj ? obj["id"] : null;

  /**
   * name
   * The name of the component for display purposes
   */
  obj.name = "name" in obj ? obj["name"] : "My Workspace";

  /**
   * type
   * The type of component (widget|workspace)
   */
  obj.type = "type" in obj ? obj["type"] : "workspace";

  obj.contexts = "contexts" in obj ? obj["contexts"] : [];

  /**
   * workspace
   * The workspace this component belongs to
   */
  obj.workspace = "workspace" in obj ? obj["workspace"] : "workspace-dash";

  /**
   * userConfig
   * Allow the end users to edit/input parameters into the edit widget layout panel
   */
  obj.userConfig = "userConfig" in obj ? obj["userConfig"] : {};

  /**
   * canHaveChildren
   * If the component is allowed to have child components
   */
  obj.canHaveChildren =
    "canHaveChildren" in obj ? obj["canHaveChildren"] : false;

  /**
   * events
   * The events that the component is emitting
   */
  obj.events = "events" in obj ? obj["events"] : [];

  /**
   * eventHandlers
   * The Names of the functions that are listened to in the component and can be handled inside the component
   */
  obj.eventHandlers = "eventHandlers" in obj ? obj["eventHandlers"] : [];

  /**
   * layout builder styles
   */
  obj.styles =
    "styles" in obj
      ? obj["styles"]
      : {
          backgroundColor: "bg-blue-800",
          borderColor: "border-blue-900",
        };

  obj.author = "author" in obj ? obj["author"] : null;
  obj.description = "description" in obj ? obj["description"] : null;
  obj.icon = "icon" in obj ? obj["icon"] : null;
  obj.package = "package" in obj ? obj["package"] : null;
  // Dedup providers by `type`. AI-built widget configs occasionally
  // ship `providers: [{type:"x"}, {type:"x"}]` — left alone, every
  // consumer (Providers tab, publish manifest, listener resolution)
  // doubles its per-widget rows. The Model is the single canonical
  // entry point for every widget config that gets registered, so
  // dedup here protects every downstream caller. Source-side fixes
  // (write-time + publish-time) keep the .dash.js text on disk
  // clean; this is the runtime-data backstop.
  if ("providers" in obj && Array.isArray(obj.providers)) {
    const seen = new Set();
    const cleaned = [];
    for (const p of obj.providers) {
      if (!p || typeof p !== "object" || !p.type) continue;
      if (seen.has(p.type)) continue;
      seen.add(p.type);
      cleaned.push(p);
    }
    obj.providers = cleaned;
  } else {
    obj.providers = [];
  }

  /**
   * notifications
   * Notification types this widget can emit.
   * Each entry: { key, displayName, description, defaultEnabled }
   */
  obj.notifications = "notifications" in obj ? obj["notifications"] : [];

  /**
   * scheduledTasks
   * Scheduled task handlers this widget exposes.
   * Each entry: { key, handler, displayName, description }
   */
  obj.scheduledTasks = "scheduledTasks" in obj ? obj["scheduledTasks"] : [];

  return obj;
};
