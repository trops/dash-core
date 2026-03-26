/**
 * promptHandlers.js
 *
 * MCP prompt handlers for the Dash MCP server.
 * Each handler returns a GetPromptResult with messages that guide the LLM
 * through a multi-step workflow using existing tools.
 */

async function handleBuildDashboard({ description, style }) {
  const styleHint =
    style === "minimal"
      ? "Keep it focused — only the most essential widgets (2-3 max)."
      : style === "monitoring"
        ? "Focus on status, metrics, and real-time data widgets."
        : "Include a comprehensive set of widgets for the use case.";

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I want to build a dashboard: ${description}${style ? `\n\nStyle preference: ${styleHint}` : ""}`,
        },
      },
      {
        role: "assistant",
        content: {
          type: "text",
          text: `I'll help you build that dashboard. Here's my plan:

1. **Search** for relevant widgets using search_widgets
2. **Check** your existing providers with list_providers
3. **Create** the dashboard with create_dashboard
4. **Add** the matching widgets with add_widget
5. **Configure** each widget with configure_widget
6. **Apply** a theme if desired

Let me start by searching for widgets that match your description and checking what providers you already have connected.`,
        },
      },
    ],
  };
}

async function handleDesignTheme({ brandName, primaryColor, url }) {
  let instruction;

  if (url) {
    instruction = `I'll extract brand colors from ${url} using create_theme_from_url, then apply the result.`;
  } else if (primaryColor) {
    const colorNote = primaryColor.startsWith("#")
      ? primaryColor
      : `the color "${primaryColor}" (I'll convert to hex)`;
    instruction = `I'll create a theme using ${colorNote} as the primary color. I'll choose complementary secondary and tertiary colors, then use create_theme.

Color roles:
- **Primary** → buttons, links, active states
- **Secondary** → backgrounds, cards, panels
- **Tertiary** → accents, badges, highlights`;
  } else if (brandName) {
    instruction = `I'll try to find ${brandName}'s brand colors. I can either:
- Extract from their website using create_theme_from_url
- Create from known brand colors using create_theme

Which approach would you prefer?`;
  } else {
    instruction = `I can create a theme in several ways:
1. **From a website URL** — extract brand colors automatically (create_theme_from_url)
2. **From specific colors** — provide hex values for primary, secondary, tertiary (create_theme)
3. **From a mood** — describe the feel you want and I'll suggest colors

What would you like to do?`;
  }

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I want to create a custom theme${brandName ? ` for ${brandName}` : ""}${primaryColor ? ` with primary color ${primaryColor}` : ""}${url ? ` based on ${url}` : ""}.`,
        },
      },
      {
        role: "assistant",
        content: {
          type: "text",
          text: instruction,
        },
      },
    ],
  };
}

async function handleSetupProvider({ service }) {
  const PROVIDER_GUIDES = {
    github: {
      name: "GitHub",
      type: "github",
      steps: `1. Go to github.com/settings/tokens
2. Generate a new token (classic) with scopes: repo, read:org
3. Copy the token (starts with ghp_)`,
      credentials: '{ token: "ghp_your_token_here" }',
    },
    slack: {
      name: "Slack",
      type: "slack",
      steps: `1. Go to api.slack.com/apps and create a new app
2. Install the app to your workspace
3. Copy the Bot Token (starts with xoxb-)
4. Find your Team ID in workspace settings`,
      credentials: '{ botToken: "xoxb-your-token", teamId: "T-your-team-id" }',
    },
    algolia: {
      name: "Algolia",
      type: "algolia",
      steps: `1. Go to your Algolia dashboard
2. Navigate to API Keys
3. Copy your Application ID and Search API Key`,
      credentials: '{ appId: "your-app-id", apiKey: "your-api-key" }',
    },
    notion: {
      name: "Notion",
      type: "notion",
      steps: `1. Go to notion.so/my-integrations
2. Create a new integration
3. Copy the Internal Integration Secret (starts with ntn_)`,
      credentials: '{ apiKey: "ntn_your_secret_here" }',
    },
    openai: {
      name: "OpenAI",
      type: "openai",
      steps: `1. Go to platform.openai.com/api-keys
2. Create a new secret key
3. Copy the key (starts with sk-)`,
      credentials: '{ apiKey: "sk-your-key-here" }',
    },
  };

  if (service && PROVIDER_GUIDES[service.toLowerCase()]) {
    const guide = PROVIDER_GUIDES[service.toLowerCase()];
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Help me connect ${guide.name} to Dash.`,
          },
        },
        {
          role: "assistant",
          content: {
            type: "text",
            text: `Here's how to set up ${guide.name}:

## Get Your Credentials
${guide.steps}

## Connect to Dash
Once you have your credentials, I'll use add_provider to configure it:
- **name**: "${guide.name}"
- **type**: "${guide.type}"
- **credentials**: ${guide.credentials}

Please share your credentials when ready and I'll set it up. (Credentials are encrypted at rest and never returned in API responses.)`,
          },
        },
      ],
    };
  }

  // No specific service — show available options
  const serviceList = Object.entries(PROVIDER_GUIDES)
    .map(([key, g]) => `- **${g.name}** (type: "${key}")`)
    .join("\n");

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Help me connect an external service to Dash.",
        },
      },
      {
        role: "assistant",
        content: {
          type: "text",
          text: `I can help you connect these services to Dash:

${serviceList}
- **Google Drive** (type: "google-drive")
- **Gmail** (type: "gmail")
- **Google Calendar** (type: "google-calendar")
- **Brave Search** (type: "brave-search")
- **Gong** (type: "gong")

Which service would you like to connect? I'll guide you through getting the credentials and configuring the provider.

You can also use list_providers to see what's already connected.`,
        },
      },
    ],
  };
}

module.exports = {
  handleBuildDashboard,
  handleDesignTheme,
  handleSetupProvider,
};
