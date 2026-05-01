import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { buildAgentManifest, formatAgentManifestMarkdown } from "../services/agent-manifest.js";
import { buildCapabilities } from "../services/capabilities.js";
import { getConfig } from "../services/config.js";
import { applyPrivacy, resolvePrivacyMode } from "../services/privacy.js";
import { buildDailySummary, buildWeeklySummary, formatSummaryMarkdown } from "../services/summary.js";
import { FitbitClient } from "../services/fitbit-client.js";

function textResource(uri: URL, text: string, mimeType = "text/markdown"): ReadResourceResult {
  return { contents: [{ uri: uri.toString(), mimeType, text }] };
}

async function profileResource(uri: URL) {
  const config = getConfig();
  const endpoint = "/1/user/-/profile.json";
  const data = applyPrivacy(endpoint, await new FitbitClient(config).get(endpoint), resolvePrivacyMode(config));
  return textResource(uri, JSON.stringify({ endpoint, data }, null, 2), "application/json");
}

async function latestActivityResource(uri: URL) {
  const config = getConfig();
  const endpoint = "/1/user/-/activities/list.json";
  const result = await new FitbitClient(config).list(endpoint, { limit: 1 });
  const data = applyPrivacy(endpoint, { records: result.records }, resolvePrivacyMode(config));
  return textResource(uri, JSON.stringify(data, null, 2), "application/json");
}

async function dailySummaryResource(uri: URL) {
  const summary = await buildDailySummary(new FitbitClient(getConfig()), { days: 7, timezone: "UTC" });
  return textResource(uri, formatSummaryMarkdown(summary));
}

async function weeklySummaryResource(uri: URL) {
  const summary = await buildWeeklySummary(new FitbitClient(getConfig()), { days: 7, compare_days: 7, timezone: "UTC" });
  return textResource(uri, formatSummaryMarkdown(summary));
}

export function registerFitbitResources(server: McpServer): void {
  server.registerResource("fitbit_capabilities", "fitbit://capabilities", { title: "Fitbit MCP Capabilities", description: "Static capabilities, API boundary, privacy modes and recommended agent workflow.", mimeType: "application/json" }, async (uri) => textResource(uri, JSON.stringify(buildCapabilities(), null, 2), "application/json"));
  server.registerResource("fitbit_agent_manifest", "fitbit://agent-manifest", { title: "Fitbit Agent Manifest", description: "Machine-readable install and operating instructions for AI agents.", mimeType: "text/markdown" }, async (uri) => textResource(uri, formatAgentManifestMarkdown(buildAgentManifest("generic"))));
  server.registerResource("fitbit_profile", "fitbit://profile", { title: "Fitbit Profile", description: "Authenticated Fitbit profile using the configured privacy mode.", mimeType: "application/json" }, profileResource);
  server.registerResource("fitbit_latest_activity", "fitbit://latest/activity", { title: "Latest Fitbit Activity", description: "Most recent Fitbit activity log in the configured privacy mode.", mimeType: "application/json" }, latestActivityResource);
  server.registerResource("fitbit_daily_summary", "fitbit://summary/daily", { title: "Fitbit Daily Summary", description: "Daily Fitbit health summary built from API data.", mimeType: "text/markdown" }, dailySummaryResource);
  server.registerResource("fitbit_weekly_summary", "fitbit://summary/weekly", { title: "Fitbit Weekly Summary", description: "Weekly Fitbit health review built from API data.", mimeType: "text/markdown" }, weeklySummaryResource);
}
