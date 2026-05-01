# Fitbit MCP Skill

Use this skill whenever a user asks Hermes to inspect Fitbit activity, sleep, heart-rate, HRV, weight, nutrition, daily summaries or weekly summaries.

Rules:

- Start with `mcp_fitbit_fitbit_connection_status`.
- Prefer `mcp_fitbit_fitbit_daily_summary` and `mcp_fitbit_fitbit_weekly_summary` before low-level endpoint calls.
- Treat Fitbit data as sensitive. Do not request raw payloads unless the user explicitly asks.
- Do not diagnose or treat medical conditions.
- Reload MCP with `/reload-mcp` or `hermes mcp test fitbit`; do not restart the gateway for normal data access.
