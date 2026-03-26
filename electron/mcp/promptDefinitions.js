/**
 * promptDefinitions.js
 *
 * MCP prompt definitions for the Dash MCP server.
 * Prompts are guided entry points that LLM clients display as suggested actions.
 * Each prompt returns structured messages the LLM uses to execute multi-step workflows.
 */

const dashPrompts = [
  {
    name: "build-dashboard",
    description:
      "Build a new dashboard step by step. Helps you find widgets, create a dashboard, and populate it.",
    args: {
      description: {
        description:
          "Describe the dashboard you want (e.g., 'a DevOps dashboard with Slack and GitHub')",
        required: true,
      },
      style: {
        description:
          "Dashboard style: 'minimal' (few key widgets), 'detailed' (comprehensive), or 'monitoring' (status-focused)",
        required: false,
      },
    },
  },
  {
    name: "design-theme",
    description:
      "Create a custom color theme for Dash. Choose from brand colors, a website URL, or describe a mood.",
    args: {
      brandName: {
        description:
          "Brand or company name to theme around (e.g., 'Stripe', 'My Company')",
        required: false,
      },
      primaryColor: {
        description:
          "Primary color as a hex value (e.g., '#3b82f6') or color name (e.g., 'blue')",
        required: false,
      },
      url: {
        description:
          "Website URL to extract brand colors from (e.g., 'https://stripe.com')",
        required: false,
      },
    },
  },
  {
    name: "setup-provider",
    description:
      "Connect an external service (Slack, GitHub, Algolia, etc.) to Dash. Guides you through getting credentials and configuring the provider.",
    args: {
      service: {
        description:
          "Service to connect (e.g., 'slack', 'github', 'algolia', 'notion', 'openai')",
        required: false,
      },
    },
  },
];

module.exports = { dashPrompts };
