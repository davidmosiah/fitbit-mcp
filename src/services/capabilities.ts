import { DEFAULT_SCOPES } from "../constants.js";

export function buildCapabilities() {
  return {
    project: "fitbit-mcp-unofficial",
    mcp_name: "io.github.davidmosiah/fitbitmcp",
    creator: { name: "David Mosiah", github: "https://github.com/davidmosiah" },
    unofficial: true,
    api_boundary: {
      source: "Official Fitbit Web API with OAuth 2.0",
      raw_definition: "Raw means the full JSON response returned by supported Fitbit Web API endpoints. Intraday heart rate is available only where the user's app/API access permits it.",
      does_not_include: [
        "raw accelerometer/device telemetry",
        "continuous unrestricted sensor streams",
        "private Fitbit or Google endpoints",
        "write/upload actions by default",
        "medical diagnosis or treatment guidance"
      ]
    },
    auth_model: {
      type: "OAuth 2.0 authorization code with refresh tokens",
      token_storage: "Local token file with user-only permissions",
      recommended_redirect_uri: "http://127.0.0.1:3000/callback",
      default_scopes: DEFAULT_SCOPES
    },
    privacy_modes: [
      { mode: "summary", use_when: "Default-safe interpretation with identifiers and profile details minimized." },
      { mode: "structured", use_when: "Normalized activity, sleep, heart and body metrics for agents." },
      { mode: "raw", use_when: "The user explicitly needs upstream Fitbit payloads for debugging or deep analysis." }
    ],
    supported_data: [
      { name: "Profile and devices", examples: ["profile", "timezone", "units", "connected devices", "last sync"], tools: ["fitbit_get_profile", "fitbit_list_devices"] },
      { name: "Activity", examples: ["steps", "calories", "distance", "active minutes", "activity logs"], tools: ["fitbit_get_activity_day", "fitbit_list_activities", "fitbit_get_activity"] },
      { name: "Sleep", examples: ["sleep logs", "stages", "duration", "efficiency"], tools: ["fitbit_get_sleep_day", "fitbit_list_sleep"] },
      { name: "Heart and recovery context", examples: ["daily resting heart rate", "heart zones", "intraday heart rate", "HRV", "SpO2", "breathing rate"], tools: ["fitbit_get_heart_day", "fitbit_get_heart_intraday", "fitbit_get_hrv_day", "fitbit_get_spo2_day", "fitbit_get_breathing_rate_day"] },
      { name: "Body and nutrition", examples: ["weight", "food logs", "water logs"], tools: ["fitbit_get_weight_day", "fitbit_get_food_day", "fitbit_get_water_day"] }
    ],
    recommended_agent_flow: [
      "Call fitbit_agent_manifest when installing or operating inside a server agent such as Hermes.",
      "Call fitbit_connection_status before calling Fitbit data tools.",
      "If setup is incomplete, guide the user through setup, auth and doctor.",
      "Use fitbit_daily_summary or fitbit_weekly_summary before low-level endpoint tools.",
      "Use fitbit_wellness_context when handing sleep/activity context to Exercise Catalog.",
      "Treat health data as sensitive; avoid raw payloads unless explicitly requested.",
      "Use Fitbit as trend context, not medical diagnosis. Escalate symptoms or abnormal vitals to clinicians."
    ],
    client_aliases: {
      hermes: {
        tool_prefix: "mcp_fitbit_",
        direct_tools: ["mcp_fitbit_fitbit_agent_manifest", "mcp_fitbit_fitbit_connection_status", "mcp_fitbit_fitbit_daily_summary", "mcp_fitbit_fitbit_weekly_summary"],
        reload_command: "/reload-mcp",
        gateway_restart_required_for_data_access: false
      }
    },
    contribution_paths: [
      "Improve non-technical setup UX.",
      "Add more MCP client examples and screenshots.",
      "Add richer Fitbit endpoint coverage for temperature, goals and subscriptions.",
      "Add evaluations for realistic health and training questions.",
      "Consider optional write tools only behind explicit opt-in and safety gates."
    ],
    links: {
      github: "https://github.com/davidmosiah/fitbitmcp",
      docs: "https://fitbitmcp.vercel.app/",
      npm: "https://www.npmjs.com/package/fitbit-mcp-unofficial",
      fitbit_api_docs: "https://dev.fitbit.com/build/reference/web-api/",
      fitbit_auth_docs: "https://dev.fitbit.com/build/reference/web-api/developer-guide/authorization/",
      fitbit_apps: "https://dev.fitbit.com/apps"
    }
  };
}
