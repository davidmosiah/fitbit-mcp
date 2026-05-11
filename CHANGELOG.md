# Changelog

## 0.4.0 - 2026-05-11

- Add shared wellness-profile support backed by the canonical Delx Wellness profile store at `~/.delx-wellness/profile.json` (vendored from `delx-wellness/lib/profile-store.ts` commit ab83d1a so the connector stays self-contained — no new npm deps).
- Add `fitbit_profile_get` tool — read-only summary of the shared profile plus the missing-critical-fields hint and absolute storage path.
- Add `fitbit_profile_update` tool — patch the shared profile but only when `explicit_user_intent=true`; otherwise it returns `USER_ACTION_REQUIRED` so agents do not silently persist things the user did not confirm.
- Add `fitbit_onboarding` tool — returns the 11-question onboarding flow in `en` or `pt-BR`, current profile, missing critical fields, and a cross-connector hint for pairing with `wellness-nourish`, `wellness-cycle-coach`, and `wellness-cgm-mcp`.
- Add `fitbit-mcp-server onboarding` CLI command — emits the same flow as JSON to stdout and a friendly Markdown summary to stderr when the terminal is interactive. Supports `--locale pt-BR`.
- Privacy contract: the shared profile NEVER stores OAuth tokens, refresh tokens, API keys, cookies, session ids or biomarkers — only what the user types into onboarding. Fitbit OAuth tokens remain in `~/.fitbit-mcp/tokens.json`.
- `recommended_first_calls` on the agent manifest now leads with `fitbit_profile_get` before `fitbit_quickstart`.
- Tool count: 29 → 32.

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
