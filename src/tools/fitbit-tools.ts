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
  DataInventoryOutputSchema,
  EndpointDataOutputSchema,
  ExchangeCodeInputSchema,
  ExchangeCodeOutputSchema,
  IdInputSchema,
  PrivacyAuditOutputSchema,
  ResponseFormatSchema,
  ResponseOnlyInputSchema,
  RevokeAccessOutputSchema,
  SimpleReadInputSchema,
  SummaryOutputSchema,
  WeeklySummaryInputSchema,
  WellnessContextInputSchema,
  WellnessContextOutputSchema
} from "../schemas/common.js";
import { buildPrivacyAudit } from "../services/audit.js";
import { buildAgentManifest, formatAgentManifestMarkdown } from "../services/agent-manifest.js";
import { buildCapabilities } from "../services/capabilities.js";
import { buildDataInventory, formatInventoryMarkdown } from "../services/inventory.js";
import { buildConnectionStatus } from "../services/connection-status.js";
import { getConfig } from "../services/config.js";
import { bulletList, formatCollection, makeError, makeResponse } from "../services/format.js";
import { applyPrivacy, resolvePrivacyMode } from "../services/privacy.js";
import { buildDailySummary, buildWeeklySummary, formatSummaryMarkdown } from "../services/summary.js";
import { buildWellnessContext, formatWellnessContextMarkdown } from "../services/context.js";
import { FitbitClient, toFitbitCivilDate } from "../services/fitbit-client.js";
import {
  buildProfileSummary,
  getOnboardingFlow,
  getProfile,
  getProfilePath,
  missingCriticalFields,
  updateProfile
} from "../services/profile-store.js";

const DateReadInputSchema = z.object({
  date: z.string().default("today").describe("Date as yyyy-MM-dd or today. ISO date-times are accepted and reduced to the written calendar day."),
  privacy_mode: SimpleReadInputSchema.shape.privacy_mode,
  response_format: ResponseFormatSchema
}).strict();

const HeartIntradayInputSchema = z.object({
  date: z.string().default("today").describe("Date as yyyy-MM-dd or today. ISO date-times are accepted and reduced to the written calendar day."),
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
        const date = toFitbitCivilDate(params.date);
        const endpoint = endpointBuilder(date);
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
  server.registerTool("fitbit_data_inventory", {
    title: "Fitbit Data Inventory",
    description: "Inventory supported Fitbit data domains, auth scope requirements, privacy boundary and recommended first calls. Does not call Fitbit APIs or expose user data.",
    inputSchema: ResponseOnlyInputSchema.shape,
    outputSchema: DataInventoryOutputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async ({ response_format }) => {
    const inventory = buildDataInventory();
    return makeResponse(inventory, response_format, formatInventoryMarkdown(inventory));
  });
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

  server.registerTool("fitbit_quickstart", {
    title: "Fitbit Quickstart",
    description: "Personalized 3-step setup walkthrough for the human user. Adapts to current state (env vars set? token present? what's next?). Call this first when the user asks 'how do I connect Fitbit?'",
    inputSchema: ResponseOnlyInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const status = await buildConnectionStatus();
    const hasEnv = status.missing_env.length === 0;
    const hasToken = status.ready_for_fitbit_api;
    const steps = [
      {
        step: 1,
        title: hasEnv ? "(done) Fitbit Developer credentials configured" : "Register a Fitbit app at https://dev.fitbit.com/apps",
        action: hasEnv
          ? "FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET, FITBIT_REDIRECT_URI are all set."
          : `Create a Fitbit Developer app (type: Personal or Server) with a Callback URL like ${status.redirect_uri ?? "http://127.0.0.1:3000/callback"}, then set: ${status.missing_env.join(", ")}.`,
        done: hasEnv,
      },
      {
        step: 2,
        title: hasToken ? "(done) Local token present — ready to read Fitbit data" : "Run the OAuth dance",
        action: hasToken
          ? "Tokens stored under ~/.fitbit-mcp/tokens.json. The connector will refresh automatically when needed."
          : "Run `fitbit-mcp-server auth` (or call fitbit_get_auth_url + fitbit_exchange_code from the agent). Open the URL, grant access, paste the code.",
        done: hasToken,
      },
      {
        step: 3,
        title: "Verify with the agent",
        action: "Call fitbit_connection_status, then fitbit_daily_summary or fitbit_wellness_context. Pair with wellness-nourish for sleep-aware meal coaching.",
        example: hasToken
          ? "fitbit_wellness_context() → sleep + activity load handoff for nourish/cycle-coach."
          : "Until step 2 is done, the data tools will surface a clear 'auth required' message.",
        done: false,
      },
    ];
    const payload = {
      ok: true,
      ready: hasEnv && hasToken,
      steps,
      next: steps.find((s) => !s.done) ?? steps[steps.length - 1],
      migration_note: "Fitbit accounts are migrating to Google Health Connect. Existing OAuth tokens still work; new users who already use a Pixel Watch or Google Health Connect may prefer the google-health-mcp connector instead. See https://blog.fitbit.com/ for the latest migration timeline.",
      cross_connector_hints: [
        "Pair Fitbit sleep + steps with wellness-nourish for sleep-aware meal coaching.",
        "Pair Fitbit HRV/RHR with wellness-cycle-coach for late-luteal load adjustments.",
        "Pair Fitbit resting heart rate with wellness-cgm-mcp glucose for metabolic-stress signals.",
      ],
    };
    const markdown = bulletList("Fitbit Quickstart", {
      ready: payload.ready,
      next: payload.next.title,
      migration: "Fitbit -> Google Health Connect migration is rolling out; existing tokens still work.",
    });
    return makeResponse(payload, response_format, markdown);
  });

  server.registerTool("fitbit_demo", {
    title: "Fitbit Demo",
    description: "Returns realistic example payloads of fitbit_daily_summary, fitbit_wellness_context, and fitbit_get_heart_day so agents see the contract before calling real Fitbit APIs.",
    inputSchema: ResponseOnlyInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      ok: true,
      is_demo: true,
      sample: {
        fitbit_daily_summary: {
          date: today,
          activity: { steps: 8420, active_minutes: 38, calories_out: 2310, distance_km: 6.4, floors: 12 },
          sleep: { score: 78, duration_min: 446, efficiency: 92, stages: { rem_min: 88, deep_min: 64, light_min: 248, wake_min: 46 } },
          heart: { resting_heart_rate: 56, fat_burn_min: 42, cardio_min: 18, peak_min: 4 },
          hrv: { daily_rmssd_ms: 42 },
        },
        fitbit_wellness_context: {
          window: "last_24h",
          sleep_score: 78,
          sleep_duration_min: 446,
          steps: 8420,
          resting_heart_rate: 56,
          hrv_ms: 42,
          activity_load: "moderate",
          recommendation: "Solid recovery night with good sleep efficiency. RHR slightly elevated vs. baseline — keep today's training conversational and hydrate. Aim for protein-forward meals to support overnight recovery.",
        },
        fitbit_get_heart_day: {
          endpoint: "/1/user/-/activities/heart/date/" + today + "/1d.json",
          privacy_mode: "structured",
          data: {
            "activities-heart": [
              {
                dateTime: today,
                value: {
                  restingHeartRate: 56,
                  heartRateZones: [
                    { name: "Out of Range", min: 30, max: 92, minutes: 1147 },
                    { name: "Fat Burn", min: 92, max: 129, minutes: 42 },
                    { name: "Cardio", min: 129, max: 158, minutes: 18 },
                    { name: "Peak", min: 158, max: 220, minutes: 4 },
                  ],
                },
              },
            ],
          },
        },
      },
      notes: [
        "All sample data is synthetic; tagged with is_demo=true.",
        "Real calls return live data from the Fitbit Web API after OAuth setup.",
        "Some endpoints (e.g. intraday heart rate) may require Fitbit Developer app type approval.",
      ],
    };
    const markdown = bulletList("Fitbit Demo", {
      is_demo: true,
      steps: 8420,
      sleep_score: 78,
      resting_heart_rate: 56,
      hrv_ms: 42,
      recommendation: payload.sample.fitbit_wellness_context.recommendation,
    });
    return makeResponse(payload, response_format, markdown);
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
  registerCollectionTool(server, "fitbit_list_sleep", "Fitbit Sleep Logs", "/1.2/user/-/sleep/list.json", "List Fitbit sleep logs. Supports before/after cursor, pagination and privacy modes. Requires sleep scope. Not medical advice.");

  registerGetByIdTool(server, "fitbit_get_activity", "Fitbit Activity", (id) => `/1/user/-/activities/${id}.json`, "Get detailed Fitbit activity log by id. Requires activity scope.");

  registerDateTool(server, "fitbit_get_activity_day", "Fitbit Daily Activity", (date) => `/1/user/-/activities/date/${date}.json`, "Get daily activity summary, goals and distances for a date. Requires activity scope.");
  registerDateTool(server, "fitbit_get_sleep_day", "Fitbit Daily Sleep", (date) => `/1.2/user/-/sleep/date/${date}.json`, "Get sleep logs and stages for a date. Requires sleep scope. Not medical advice.");
  registerDateTool(server, "fitbit_get_heart_day", "Fitbit Daily Heart Rate", (date) => `/1/user/-/activities/heart/date/${date}/1d.json`, "Get daily heart-rate zones and resting heart rate. Requires heartrate scope. Not medical advice.");
  registerDateTool(server, "fitbit_get_hrv_day", "Fitbit Daily HRV", (date) => `/1/user/-/hrv/date/${date}.json`, "Get HRV summary for a date when available. Requires heartrate scope and supported device/data. Not medical advice.");
  registerDateTool(server, "fitbit_get_breathing_rate_day", "Fitbit Daily Breathing Rate", (date) => `/1/user/-/br/date/${date}.json`, "Get breathing-rate summary for a date when available. Requires heartrate scope. Not medical advice.");
  registerDateTool(server, "fitbit_get_spo2_day", "Fitbit Daily SpO2", (date) => `/1/user/-/spo2/date/${date}.json`, "Get SpO2 summary for a date when available. Requires heartrate scope. Not medical advice.");
  registerDateTool(server, "fitbit_get_weight_day", "Fitbit Weight Logs", (date) => `/1/user/-/body/log/weight/date/${date}.json`, "Get weight logs for a date. Requires weight scope. Not medical advice.");
  registerDateTool(server, "fitbit_get_food_day", "Fitbit Food Logs", (date) => `/1/user/-/foods/log/date/${date}.json`, "Get food logs for a date. Requires nutrition scope.");
  registerDateTool(server, "fitbit_get_water_day", "Fitbit Water Logs", (date) => `/1/user/-/foods/log/water/date/${date}.json`, "Get water logs for a date. Requires nutrition scope.");

  server.registerTool("fitbit_get_heart_intraday", {
    title: "Fitbit Heart Rate Intraday",
    description: "Get heart-rate intraday samples for a date. Personal apps can access their own intraday data; third-party client/server apps may require Fitbit approval. Requires heartrate scope. Not medical advice.",
    inputSchema: HeartIntradayInputSchema.shape,
    outputSchema: EndpointDataOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (params) => {
    try {
      const config = getConfig();
      const privacyMode = resolvePrivacyMode(config, params.privacy_mode);
      const date = toFitbitCivilDate(params.date);
      const suffix = params.start_time && params.end_time ? `/time/${params.start_time}/${params.end_time}` : "";
      const endpoint = `/1/user/-/activities/heart/date/${date}/1d/${params.detail_level}${suffix}.json`;
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
    description: "Revoke the current Fitbit OAuth grant and delete the local token file. Use only when the user explicitly wants to disconnect Fitbit. Gated by explicit_user_intent: true (requires explicit user intent).",
    inputSchema: {
      explicit_user_intent: z
        .boolean()
        .optional()
        .describe("Must be true after the user explicitly asked to disconnect. Prevents agents from revoking autonomously."),
      response_format: z.enum(["markdown", "json"]).default("markdown")
    },
    outputSchema: RevokeAccessOutputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async ({ explicit_user_intent, response_format }) => {
    try {
      if (explicit_user_intent !== true) {
        return makeError(
          "USER_ACTION_REQUIRED: explicit_user_intent must be true to revoke access. Ask the user to confirm disconnect first."
        );
      }

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

  server.registerTool("fitbit_wellness_context", {
    title: "Fitbit Wellness Context",
    description: "Normalize Fitbit sleep and activity load into the shared wellness_context shape for recommendation engines.",
    inputSchema: WellnessContextInputSchema.shape,
    outputSchema: WellnessContextOutputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (params) => {
    try {
      const context = await buildWellnessContext(client(), params);
      return makeResponse(context, params.response_format, formatWellnessContextMarkdown(context));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  const ProfileGetInputSchema = ResponseOnlyInputSchema;
  const ProfileUpdateInputSchema = z.object({
    patch: z.record(z.string(), z.unknown()).describe("Partial WellnessProfileDocument patch. Top-level keys: profile, goals, devices, training, nutrition, preferences, safety, notes."),
    explicit_user_intent: z.boolean().optional().describe("Set to true ONLY after the user has explicitly confirmed they want to save this. Otherwise the tool refuses to write."),
    response_format: ResponseFormatSchema
  }).strict();
  const OnboardingInputSchema = z.object({
    locale: z.enum(["en", "pt-BR"]).optional().describe("Onboarding locale. Defaults to en."),
    response_format: ResponseFormatSchema
  }).strict();

  server.registerTool("fitbit_profile_get", {
    title: "Get Shared Wellness Profile",
    description:
      "Read the canonical Delx Wellness profile shared with the other wellness MCP connectors (Nourish, Cycle Coach, CGM, etc.). Read-only. Profile stores only what the user typed during onboarding — never OAuth tokens, API keys, or biomarkers.",
    inputSchema: ProfileGetInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    try {
      const profile = await getProfile();
      const payload = {
        ok: true,
        profile,
        summary: buildProfileSummary(profile),
        missing_critical: missingCriticalFields(profile),
        storage_path: getProfilePath()
      };
      return makeResponse(payload, response_format, bulletList("Wellness Profile", {
        summary: payload.summary,
        missing_critical: payload.missing_critical,
        storage_path: payload.storage_path
      }));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("fitbit_profile_update", {
    title: "Update Shared Wellness Profile",
    description:
      "Persist a partial patch to the canonical Delx Wellness profile. Requires explicit_user_intent=true after the user confirms they want to save. Rejects secret-like fields (oauth, token, api_key, password, cookie, refresh, session).",
    inputSchema: ProfileUpdateInputSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, async ({ patch, explicit_user_intent, response_format }) => {
    if (explicit_user_intent !== true) {
      const payload = {
        ok: false,
        error: "USER_ACTION_REQUIRED",
        hint: "Set explicit_user_intent=true after the user confirms they want to save this."
      };
      return makeResponse(payload, response_format, bulletList("Wellness Profile Update", payload));
    }
    try {
      const profile = await updateProfile(patch as Record<string, unknown>);
      const payload = {
        ok: true,
        profile,
        summary: buildProfileSummary(profile),
        updated_fields: Object.keys(patch ?? {})
      };
      return makeResponse(payload, response_format, bulletList("Wellness Profile Updated", {
        summary: payload.summary,
        updated_fields: payload.updated_fields
      }));
    } catch (error) {
      return makeError((error as Error).message);
    }
  });

  server.registerTool("fitbit_onboarding", {
    title: "Wellness Onboarding Flow",
    description:
      "Read-only. Return the 11-question Delx Wellness onboarding flow (en or pt-BR), the current shared profile, missing critical fields, and a cross-connector hint. Use this when the user starts a fresh wellness session and you need to fill out preferred_name, goals, devices, training context, nutrition, preferences, and safety.",
    inputSchema: OnboardingInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ locale, response_format }) => {
    try {
      const flow = getOnboardingFlow(locale ?? "en");
      const profile = await getProfile();
      const payload = {
        ok: true,
        flow,
        profile,
        summary: buildProfileSummary(profile),
        missing_critical: missingCriticalFields(profile),
        storage_path: getProfilePath(),
        cross_connector_hint:
          "This profile is shared across the Delx Wellness MCPs (e.g. wellness-nourish, wellness-cycle-coach, wellness-cgm-mcp). One onboarding pass populates context for all of them."
      };
      const markdown = bulletList("Wellness Onboarding", {
        locale: flow.locale,
        questions: `${flow.questions.length} questions`,
        missing_critical: payload.missing_critical,
        storage_path: payload.storage_path,
        cross_connector_hint: payload.cross_connector_hint
      });
      return makeResponse(payload, response_format, markdown);
    } catch (error) {
      return makeError((error as Error).message);
    }
  });
}
