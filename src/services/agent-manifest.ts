import { NPM_PACKAGE_NAME, PINNED_NPM_PACKAGE, SERVER_VERSION, DEFAULT_SCOPES } from "../constants.js";

export const AGENT_CLIENTS = ["generic", "claude", "cursor", "windsurf", "hermes", "openclaw"] as const;
export type AgentClientName = typeof AGENT_CLIENTS[number];

export const HERMES_DIRECT_TOOLS = [
  "mcp_fitbit_fitbit_agent_manifest", "mcp_fitbit_fitbit_connection_status", "mcp_fitbit_fitbit_daily_summary",
  "mcp_fitbit_fitbit_data_inventory", "mcp_fitbit_fitbit_get_heart_day", "mcp_fitbit_fitbit_get_heart_intraday",
  "mcp_fitbit_fitbit_get_sleep_day", "mcp_fitbit_fitbit_weekly_summary", "mcp_fitbit_fitbit_wellness_context"
];

const STANDARD_TOOLS = [
  "fitbit_agent_manifest", "fitbit_cache_status", "fitbit_capabilities",
  "fitbit_connection_status", "fitbit_daily_summary", "fitbit_data_inventory",
  "fitbit_demo", "fitbit_exchange_code", "fitbit_get_activity",
  "fitbit_get_activity_day", "fitbit_get_auth_url", "fitbit_get_breathing_rate_day",
  "fitbit_get_food_day", "fitbit_get_heart_day", "fitbit_get_heart_intraday",
  "fitbit_get_hrv_day", "fitbit_get_profile", "fitbit_get_sleep_day",
  "fitbit_get_spo2_day", "fitbit_get_water_day", "fitbit_get_weight_day",
  "fitbit_list_activities", "fitbit_list_devices", "fitbit_list_sleep",
  "fitbit_privacy_audit", "fitbit_quickstart", "fitbit_revoke_access",
  "fitbit_weekly_summary", "fitbit_wellness_context"
];

const RESOURCES = [
  "fitbit://agent-manifest", "fitbit://capabilities", "fitbit://inventory",
  "fitbit://latest/activity", "fitbit://profile", "fitbit://summary/daily",
  "fitbit://summary/weekly"
];

export function parseAgentClientName(value: string): AgentClientName {
  return AGENT_CLIENTS.includes(value as AgentClientName) ? value as AgentClientName : "generic";
}

export function buildAgentManifest(client: AgentClientName = "generic") {
  return {
    project: "fitbit-mcp-unofficial",
    mcp_name: "io.github.davidmosiah/fitbitmcp",
    client,
    unofficial: true,
    package: {
      name: NPM_PACKAGE_NAME,
      version: SERVER_VERSION,
      install_command: `npx -y ${NPM_PACKAGE_NAME}`,
      pinned_install_command: `npx -y ${PINNED_NPM_PACKAGE}`,
      binary: "fitbit-mcp-server"
    },
    oauth: {
      provider: "Fitbit Web API",
      redirect_uri: "http://127.0.0.1:3000/callback",
      scopes: DEFAULT_SCOPES,
      token_storage: "~/.fitbit-mcp/tokens.json with 0600 permissions",
      secret_storage: "~/.fitbit-mcp/config.json or FITBIT_* environment variables; never print secrets"
    },
    recommended_first_calls: ["fitbit_quickstart", "fitbit_demo", "fitbit_connection_status", "fitbit_wellness_context", "fitbit_daily_summary"],
    standard_tools: STANDARD_TOOLS,
    resources: RESOURCES,
    hermes: {
      config_path: "~/.hermes/config.yaml",
      skill_path: "~/.hermes/skills/fitbit-mcp/SKILL.md",
      tool_name_prefix: "mcp_fitbit_",
      common_tool_names: HERMES_DIRECT_TOOLS,
      recommended_config: hermesConfigSnippet(),
      use_direct_tools: true,
      avoid_terminal_workarounds: true,
      no_gateway_restart_for_data_access: true,
      reload_after_config_change: "/reload-mcp or hermes mcp test fitbit",
      doctor_command: "npx -y fitbit-mcp-unofficial doctor --client hermes --json"
    },
    agent_rules: [
      "Call fitbit_connection_status and fitbit_data_inventory before Fitbit data tools.",
      "If setup is incomplete, guide the user through setup, auth and doctor instead of guessing token state.",
      "Treat Fitbit health data as sensitive. Do not expose raw payloads unless the user asks for raw mode.",
      "Intraday heart-rate data may require Fitbit app type/access; explain permission errors clearly.",
      "For Hermes, do not restart the gateway for normal Fitbit data access; reload MCP instead.",
      "Do not provide medical diagnosis or treatment instructions. Frame outputs as health/training context."
    ],
    troubleshooting: [
      { symptom: "missing FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET / FITBIT_REDIRECT_URI", action: "Run `fitbit-mcp-server setup` or set FITBIT_* env vars." },
      { symptom: "401 or expired token", action: "Run `fitbit-mcp-server auth` again; tokens refresh automatically when refresh_token is present." },
      { symptom: "intraday endpoint forbidden", action: "Use daily heart endpoint or confirm Fitbit app type/access for intraday data." },
      { symptom: "Hermes configured but tools unavailable", action: "Run `/reload-mcp` or `hermes mcp test fitbit`; do not restart gateway for normal reload." }
    ],
    links: {
      github: "https://github.com/davidmosiah/fitbitmcp",
      docs: "https://fitbitmcp.vercel.app/",
      npm: "https://www.npmjs.com/package/fitbit-mcp-unofficial",
      fitbit_apps: "https://dev.fitbit.com/apps",
      fitbit_api_docs: "https://dev.fitbit.com/build/reference/web-api/"
    }
  };
}

export function formatAgentManifestMarkdown(manifest: ReturnType<typeof buildAgentManifest>): string {
  return `# Fitbit MCP Agent Manifest

Unofficial: ${manifest.unofficial}
Package: \`${manifest.package.name}\` v${manifest.package.version}
Install: \`${manifest.package.install_command}\`
Pinned install: \`${manifest.package.pinned_install_command}\`

## OAuth
Provider: ${manifest.oauth.provider}
Redirect URI: \`${manifest.oauth.redirect_uri}\`
Scopes: \`${manifest.oauth.scopes.join(" ")}\`
Tokens: ${manifest.oauth.token_storage}

## First Calls
${manifest.recommended_first_calls.map((tool) => `- \`${tool}\``).join("\n")}

## Hermes
Config: \`${manifest.hermes.config_path}\`
Skill: \`${manifest.hermes.skill_path}\`
Reload: \`${manifest.hermes.reload_after_config_change}\`
Direct tools:
${manifest.hermes.common_tool_names.map((tool) => `- \`${tool}\``).join("\n")}

## Agent Rules
${manifest.agent_rules.map((rule) => `- ${rule}`).join("\n")}
`;
}

export function hermesConfigSnippet(): string {
  return `mcp_servers:\n  fitbit:\n    command: npx\n    args:\n      - -y\n      - ${PINNED_NPM_PACKAGE}\n    timeout: 120\n    connect_timeout: 60\n    sampling:\n      enabled: false`;
}

export function hermesSkillMarkdown(): string {
  return `# Fitbit MCP Skill

Use this skill whenever a user asks Hermes to inspect Fitbit activity, sleep, heart-rate, HRV, weight, nutrition, daily summaries or weekly summaries through the Fitbit MCP.

## Rules
- Start with \`mcp_fitbit_fitbit_connection_status\`.
- Prefer \`mcp_fitbit_fitbit_daily_summary\` and \`mcp_fitbit_fitbit_weekly_summary\` before low-level endpoint calls.
- Treat Fitbit data as sensitive. Do not request raw payloads unless the user explicitly asks.
- Do not diagnose or treat medical conditions.
- Reload MCP with \`/reload-mcp\` or \`hermes mcp test fitbit\`; do not restart the gateway for normal data access.
`;
}
