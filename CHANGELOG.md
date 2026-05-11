# Changelog

## 0.3.0 - 2026-05-11

- Add `fitbit_quickstart` tool — personalized 3-step setup walkthrough adapted to current state (env vars set? OAuth token present? what's next?). Surfaces the Fitbit-to-Google-Health-Connect migration path and returns cross-connector hints to pair with wellness-nourish, wellness-cycle-coach, and wellness-cgm-mcp.
- Add `fitbit_demo` tool — realistic example payloads of `fitbit_daily_summary`, `fitbit_wellness_context`, and `fitbit_get_heart_day` so agents see the contract before any real Fitbit API call.
- `recommended_first_calls` on the agent manifest now leads with `fitbit_quickstart` and `fitbit_demo`.
- Tool count: 27 → 29.

## 0.1.2

- Added `fitbit_agent_manifest` and `fitbit://agent-manifest` for machine-readable agent installation/runtime guidance.
- Added Hermes-specific diagnostics with `doctor --client hermes` and optional `client` support in `fitbit_connection_status`.
- `setup --client hermes` now writes a pinned Hermes MCP config plus a local Hermes skill that tells agents to use direct MCP tools.
- Added anti-friction guidance for Hermes: use `/reload-mcp` or `hermes mcp test fitbit`, not gateway restart, for normal Fitbit MCP config/data access.
- Added regression coverage for Hermes agent readiness, direct tool aliases and pinned package setup.

## 0.1.1

- Fixed collection Markdown previews so agents and humans no longer see `[object Object]` metadata.
- Added OAuth scope diagnostics to `doctor` and `fitbit_connection_status`.
- `doctor` now reports missing recommended scopes and asks for re-authorization when a token only has `read`.
- `setup` now writes the recommended read-only scopes explicitly.
- Added regression coverage for agent-readable output and scope readiness.

## 0.1.0

- Initial Fitbit MCP implementation.
- OAuth setup/auth/doctor CLI.
- 20 MCP tools, 5 resources and 3 prompts.
- Activity, stream, route, club, gear, athlete, zone and summary support.
- GPS privacy modes and local token/cache support.
