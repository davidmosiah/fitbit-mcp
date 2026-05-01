import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  AgentManifestInputSchema,
  AgentManifestOutputSchema,
  AuthUrlInputSchema,
  AuthUrlOutputSchema,
  CacheStatusOutputSchema,
  CapabilitiesOutputSchema,
  CollectionInputSchema,
  CollectionOutputSchema,
  ConnectionStatusInputSchema,
  ConnectionStatusOutputSchema,
  DailySummaryInputSchema,
  EndpointDataOutputSchema,
  ExchangeCodeInputSchema,
  ExchangeCodeOutputSchema,
  IdInputSchema,
  PrivacyAuditOutputSchema,
  RevokeAccessOutputSchema,
  ResponseFormatSchema,
  ResponseOnlyInputSchema,
  SimpleReadInputSchema,
  SummaryOutputSchema,
  WeeklySummaryInputSchema
} from "../schemas/common.js";
import { buildPrivacyAudit } from "../services/audit.js";
import { buildAgentManifest, formatAgentManifestMarkdown } from "../services/agent-manifest.js";
import { buildCapabilities } from "../services/capabilities.js";
import { buildConnectionStatus } from "../services/connection-status.js";
import { getConfig } from "../services/config.js";
import { bulletList, formatCollection, makeError, makeResponse } from "../services/format.js";
import { applyPrivacy, resolvePrivacyMode } from "../services/privacy.js";
import { buildDailySummary, buildWeeklySummary, formatSummaryMarkdown } from "../services/summary.js";
import { FitbitClient } from "../services/fitbit-client.js";

const DateReadInputSchema = z.object({
  date: z.string().default("today").describe("Date as yyyy-MM-dd or today."),
  privacy_mode: SimpleReadInputSchema.shape.privacy_mode,
  response_format: ResponseFormatSchema
}).strict();

const HeartIntradayInputSchema = z.object({
  date: z.string().default("today").describe("Date as yyyy-MM-dd or today."),
  detail_level: z.enum(["1sec", "1min", "5min", "15min"]).default("1min"),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Optional HH:mm start time."),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Optional HH:mm end time."),
  privacy_mode: SimpleReadInputSchema.shape.privacy_mode,
  response_format: ResponseFormatSchema
}).strict();

function client(): FitbitClient {
  return new FitbitClient(getConfig());
}

function registerCollectionTool(server: McpServer, name: string, title: string, endpoint: string, description: string): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: CollectionInputSchema.shape,
      outputSchema: CollectionOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        const config = getConfig();
        const privacyMode = resolvePrivacyMode(config, params.privacy_mode);
        const result = await new FitbitClient(config).list(endpoint, params);
        const records = applyPrivacy(endpoint, { records: result.records }, privacyMode) as { records: unknown[] };
        const output = {
          endpoint,
          privacy_mode: privacyMode,
          count: records.records.length,
          records: records.records,
          next_page: result.next_page,
          has_more: Boolean(result.next_page),
          pages_fetched: result.pages_fetched
        };
        return makeResponse(output, params.response_format, formatCollection(title, records.records, output));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );
}

function registerDateTool(server: McpServer, name: string, title: string, endpointBuilder: (date: string) => string, description: string): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: DateReadInputSchema.shape,
      outputSchema: EndpointDataOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        const config = getConfig();
        const privacyMode = resolvePrivacyMode(config, params.privacy_mode);
        const endpoint = endpointBuilder(params.date);
        const data = applyPrivacy(endpoint, await new FitbitClient(config).get(endpoint), privacyMode);
        return makeResponse({ endpoint, privacy_mode: privacyMode, data }, params.response_format, bulletList(title, { endpoint, data: JSON.stringify(data) }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );
}

function registerGetByIdTool(server: McpServer, name: string, title: string, endpointBuilder: (id: string | number) => string, description: string): void {
  server.registerTool(
    name,
    {
      title,
      description,
      inputSchema: IdInputSchema.shape,
      outputSchema: EndpointDataOutputSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (params) => {
      try {
        const config = getConfig();
        const privacyMode = resolvePrivacyMode(config, params.privacy_mode);
        const endpoint = endpointBuilder(params.id);
        const data = applyPrivacy(endpoint, await new FitbitClient(config).get(endpoint), privacyMode);
        return makeResponse({ endpoint, privacy_mode: privacyMode, data }, params.response_format, bulletList(title, { endpoint, data: JSON.stringify(data) }));
      } catch (error) {
        return makeError((error as Error).message);
      }
    }
  );
}

export function registerFitbitTools(server: McpServer): void {
  server.registerTool("fitbit_agent_manifest", {
    title: "Fitbit Agent Manifest",
    description: "Machine-readable install, runtime and client guidance for AI agents. Does not call Fitbit or expose secrets.",
    inputSchema: AgentManifestInputSchema.shape,
    outputSchema: AgentManifestOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ client: targetClient, response_format }) => {
    const manifest = buildAgentManifest(targetClient);
    return makeResponse(manifest, response_format, formatAgentManifestMarkdown(manifest));
  });

  server.registerTool("fitbit_capabilities", {
    title: "Fitbit MCP Capabilities",
    description: "Explain supported Fitbit data, privacy boundaries, recommended agent workflow and project links.",
    inputSchema: ResponseOnlyInputSchema.shape,
    outputSchema: CapabilitiesOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const capabilities = buildCapabilities();
    return makeResponse(capabilities, response_format, bulletList("Fitbit MCP Capabilities", {
      project: capabilities.project,
      unofficial: capabilities.unofficial,
      api_boundary: capabilities.api_boundary.source,
      recommended_first_tools: "fitbit_connection_status, fitbit_daily_summary, fitbit_weekly_summary",
      docs: capabilities.links.docs
    }));
  });

  server.registerTool("fitbit_get_auth_url", {
    title: "Get Fitbit OAuth URL",
    description: "Generate a Fitbit OAuth authorization URL. Use this first when no local token exists.",
    inputSchema: AuthUrlInputSchema.shape,
    outputSchema: AuthUrlOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (params) => {
    try {
      const config = getConfig();
      const url = new FitbitClient(config).authUrl(params.state, params.scopes);
      const output = { auth_url: url, redirect_uri: config.redirectUri, scopes: params.scopes?.length ? params.scopes : config.scopes, next_step: "Open auth_url, approve access, then pass the returned code or full redirect URL to fitbit_exchange_code." };
      return makeResponse(output, params.response_format, bulletList("Fitbit OAuth URL", output));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("fitbit_exchange_code", {
    title: "Exchange Fitbit OAuth Code",
    description: "Exchange a Fitbit OAuth authorization code for local tokens. Tokens are stored locally with 0600 permissions and are never returned.",
    inputSchema: ExchangeCodeInputSchema.shape,
    outputSchema: ExchangeCodeOutputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (params) => {
    try {
      const result = await client().exchangeCode(params.code);
      const output = { ...result, note: "Token values were stored locally and intentionally omitted from this response." };
      return makeResponse(output, params.response_format, bulletList("Fitbit OAuth Exchange", output));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("fitbit_get_profile", {
    title: "Get Fitbit Profile",
    description: "Get the authenticated Fitbit user profile. Requires profile scope.",
    inputSchema: SimpleReadInputSchema.shape,
    outputSchema: EndpointDataOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ response_format, privacy_mode }) => {
    try {
      const config = getConfig();
      const endpoint = "/1/user/-/profile.json";
      const privacyMode = resolvePrivacyMode(config, privacy_mode);
      const data = applyPrivacy(endpoint, await new FitbitClient(config).get(endpoint), privacyMode);
      return makeResponse({ endpoint, privacy_mode: privacyMode, data }, response_format, bulletList("Fitbit Profile", data as Record<string, unknown>));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("fitbit_list_devices", {
    title: "List Fitbit Devices",
    description: "List devices connected to the authenticated Fitbit account. Requires settings scope.",
    inputSchema: SimpleReadInputSchema.shape,
    outputSchema: EndpointDataOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async ({ response_format, privacy_mode }) => {
    try {
      const config = getConfig();
      const endpoint = "/1/user/-/devices.json";
      const privacyMode = resolvePrivacyMode(config, privacy_mode);
      const data = applyPrivacy(endpoint, await new FitbitClient(config).get(endpoint), privacyMode);
      return makeResponse({ endpoint, privacy_mode: privacyMode, data }, response_format, bulletList("Fitbit Devices", { data: JSON.stringify(data) }));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  registerCollectionTool(server, "fitbit_list_activities", "Fitbit Activity Logs", "/1/user/-/activities/list.json", "List Fitbit activity logs. Supports before/after cursor, pagination and privacy modes. Requires activity scope.");
  registerCollectionTool(server, "fitbit_list_sleep", "Fitbit Sleep Logs", "/1.2/user/-/sleep/list.json", "List Fitbit sleep logs. Supports before/after cursor, pagination and privacy modes. Requires sleep scope.");

  registerGetByIdTool(server, "fitbit_get_activity", "Fitbit Activity", (id) => `/1/user/-/activities/${id}.json`, "Get detailed Fitbit activity log by id. Requires activity scope.");

  registerDateTool(server, "fitbit_get_activity_day", "Fitbit Daily Activity", (date) => `/1/user/-/activities/date/${date}.json`, "Get daily activity summary, goals and distances for a date. Requires activity scope.");
  registerDateTool(server, "fitbit_get_sleep_day", "Fitbit Daily Sleep", (date) => `/1.2/user/-/sleep/date/${date}.json`, "Get sleep logs and stages for a date. Requires sleep scope.");
  registerDateTool(server, "fitbit_get_heart_day", "Fitbit Daily Heart Rate", (date) => `/1/user/-/activities/heart/date/${date}/1d.json`, "Get daily heart-rate zones and resting heart rate. Requires heartrate scope.");
  registerDateTool(server, "fitbit_get_hrv_day", "Fitbit Daily HRV", (date) => `/1/user/-/hrv/date/${date}.json`, "Get HRV summary for a date when available. Requires heartrate scope and supported device/data.");
  registerDateTool(server, "fitbit_get_breathing_rate_day", "Fitbit Daily Breathing Rate", (date) => `/1/user/-/br/date/${date}.json`, "Get breathing-rate summary for a date when available.");
  registerDateTool(server, "fitbit_get_spo2_day", "Fitbit Daily SpO2", (date) => `/1/user/-/spo2/date/${date}.json`, "Get SpO2 summary for a date when available.");
  registerDateTool(server, "fitbit_get_weight_day", "Fitbit Weight Logs", (date) => `/1/user/-/body/log/weight/date/${date}.json`, "Get weight logs for a date. Requires weight scope.");
  registerDateTool(server, "fitbit_get_food_day", "Fitbit Food Logs", (date) => `/1/user/-/foods/log/date/${date}.json`, "Get food logs for a date. Requires nutrition scope.");
  registerDateTool(server, "fitbit_get_water_day", "Fitbit Water Logs", (date) => `/1/user/-/foods/log/water/date/${date}.json`, "Get water logs for a date. Requires nutrition scope.");

  server.registerTool("fitbit_get_heart_intraday", {
    title: "Fitbit Heart Rate Intraday",
    description: "Get heart-rate intraday samples for a date. Personal apps can access their own intraday data; third-party client/server apps may require Fitbit approval.",
    inputSchema: HeartIntradayInputSchema.shape,
    outputSchema: EndpointDataOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (params) => {
    try {
      const config = getConfig();
      const privacyMode = resolvePrivacyMode(config, params.privacy_mode);
      const suffix = params.start_time && params.end_time ? `/time/${params.start_time}/${params.end_time}` : "";
      const endpoint = `/1/user/-/activities/heart/date/${params.date}/1d/${params.detail_level}${suffix}.json`;
      const data = applyPrivacy(endpoint, await new FitbitClient(config).get(endpoint), privacyMode);
      return makeResponse({ endpoint, privacy_mode: privacyMode, data }, params.response_format, bulletList("Fitbit Heart Intraday", { endpoint, privacy_mode: privacyMode, data: JSON.stringify(data) }));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("fitbit_connection_status", {
    title: "Fitbit Connection Status",
    description: "Check local Fitbit config, token file, Node version, privacy mode, cache readiness and optional MCP client readiness without calling Fitbit or exposing secrets.",
    inputSchema: ConnectionStatusInputSchema.shape,
    outputSchema: ConnectionStatusOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format, client: targetClient }) => {
    const status = await buildConnectionStatus({ client: targetClient });
    return makeResponse(status, response_format, bulletList("Fitbit Connection Status", {
      ok: status.ok,
      ready_for_fitbit_api: status.ready_for_fitbit_api,
      missing_env: status.missing_env.join(", ") || "none",
      scope_status: status.oauth.scope_status,
      token_path: status.token.path,
      token_exists: status.token.exists,
      privacy_mode: status.privacy_mode,
      next_steps: status.next_steps.join(" | ")
    }));
  });

  server.registerTool("fitbit_cache_status", {
    title: "Fitbit Cache Status",
    description: "Show optional local SQLite cache status. Enable with FITBIT_CACHE=sqlite or FITBIT_CACHE=true.",
    inputSchema: ResponseOnlyInputSchema.shape,
    outputSchema: CacheStatusOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    try {
      const status = client().cacheStatus();
      return makeResponse(status, response_format, bulletList("Fitbit Cache Status", status));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("fitbit_privacy_audit", {
    title: "Fitbit Privacy Audit",
    description: "Return local privacy, cache, token-path and env-presence posture without revealing secret values.",
    inputSchema: ResponseOnlyInputSchema.shape,
    outputSchema: PrivacyAuditOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const audit = buildPrivacyAudit();
    return makeResponse(audit, response_format, bulletList("Fitbit Privacy Audit", audit));
  });

  server.registerTool("fitbit_revoke_access", {
    title: "Revoke Fitbit OAuth Access",
    description: "Revoke the current Fitbit OAuth grant and delete the local token file. Use only when the user explicitly wants to disconnect Fitbit.",
    inputSchema: ResponseOnlyInputSchema.shape,
    outputSchema: RevokeAccessOutputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async ({ response_format }) => {
    try {
      const result = await client().revokeAccess();
      const output = { ...result, note: "Fitbit access was revoked and local tokens were removed. Re-authorize before future API calls." };
      return makeResponse(output, response_format, bulletList("Fitbit Access Revoked", output));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("fitbit_daily_summary", {
    title: "Fitbit Daily Health Summary",
    description: "Build a practical daily summary from Fitbit activity, sleep, heart-rate, HRV and weight data when available. Read-only and non-medical.",
    inputSchema: DailySummaryInputSchema.shape,
    outputSchema: SummaryOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (params) => {
    try {
      const summary = await buildDailySummary(client(), params);
      return makeResponse(summary, params.response_format, formatSummaryMarkdown(summary));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("fitbit_weekly_summary", {
    title: "Fitbit Weekly Health Review",
    description: "Build a weekly Fitbit scorecard with activity, sleep, heart-rate, HRV availability, bottlenecks and actions. Read-only and non-medical.",
    inputSchema: WeeklySummaryInputSchema.shape,
    outputSchema: SummaryOutputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (params) => {
    try {
      const summary = await buildWeeklySummary(client(), params);
      return makeResponse(summary, params.response_format, formatSummaryMarkdown(summary));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });
}
