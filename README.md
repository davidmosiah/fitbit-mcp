# Fitbit MCP Unofficial

[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-7C3AED?style=flat-square&logo=anthropic&logoColor=white)](https://modelcontextprotocol.io) [![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](https://opensource.org/licenses/MIT) [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Provider: Fitbit](https://img.shields.io/badge/data-Fitbit-00B0B9?style=flat-square&logo=fitbit&logoColor=white)](https://fitbit.com) [![npm version](https://img.shields.io/npm/v/fitbit-mcp-unofficial?style=flat-square&color=cb3837&logo=npm)](https://www.npmjs.com/package/fitbit-mcp-unofficial)


Unofficial, local-first Model Context Protocol server for connecting AI agents to user-authorized Fitbit data through the official Fitbit Web API.

It is designed for Claude, Cursor, Windsurf, Hermes, OpenClaw and other MCP clients that need safe access to activity, sleep, heart-rate, HRV, weight and nutrition context.

> Not affiliated with, endorsed by, or sponsored by Fitbit or Google. Not medical advice.

## What It Supports

- OAuth 2.0 authorization code flow with local token storage.
- Activity summaries and activity logs.
- Sleep logs and sleep-stage summaries when Fitbit provides them.
- Daily heart-rate zones and resting heart rate.
- Intraday heart-rate samples when the Fitbit app/API access permits it.
- HRV, SpO2 and breathing-rate endpoints when available for the account/device.
- Weight, food and water logs.
- Daily and weekly agent-ready summaries.
- Privacy modes: `summary`, `structured`, `raw`.
- Hermes-focused agent manifest and setup diagnostics.

## Quick Start

Create a Fitbit app at [dev.fitbit.com/apps](https://dev.fitbit.com/apps) and set the callback URL to:

```text
http://127.0.0.1:3000/callback
```

Recommended read scopes:

```text
activity heartrate profile settings sleep weight nutrition
```

Then run:

```bash
npx -y fitbit-mcp-unofficial setup
npx -y fitbit-mcp-unofficial auth
npx -y fitbit-mcp-unofficial doctor
```

Start the MCP server:

```bash
npx -y fitbit-mcp-unofficial
```

## Claude / Cursor / Generic MCP Config

```json
{
  "mcpServers": {
    "fitbit": {
      "command": "npx",
      "args": ["-y", "fitbit-mcp-unofficial"]
    }
  }
}
```

## Hermes

```bash
npx -y fitbit-mcp-unofficial setup --client hermes --no-auth
npx -y fitbit-mcp-unofficial doctor --client hermes
```

After config changes, reload MCP with `/reload-mcp` or `hermes mcp test fitbit`. A normal Fitbit data-access issue should not require restarting the Hermes gateway.

## Tools

Core setup and safety:

- `fitbit_agent_manifest`
- `fitbit_capabilities`
- `fitbit_connection_status`
- `fitbit_get_auth_url`
- `fitbit_exchange_code`
- `fitbit_privacy_audit`
- `fitbit_cache_status`
- `fitbit_revoke_access`

Data tools:

- `fitbit_get_profile`
- `fitbit_list_devices`
- `fitbit_get_activity_day`
- `fitbit_list_activities`
- `fitbit_get_activity`
- `fitbit_get_sleep_day`
- `fitbit_list_sleep`
- `fitbit_get_heart_day`
- `fitbit_get_heart_intraday`
- `fitbit_get_hrv_day`
- `fitbit_get_spo2_day`
- `fitbit_get_breathing_rate_day`
- `fitbit_get_weight_day`
- `fitbit_get_food_day`
- `fitbit_get_water_day`

Workflow tools:

- `fitbit_daily_summary`
- `fitbit_weekly_summary`

## Privacy Model

Tokens are stored locally under `~/.fitbit-mcp/` with user-only permissions. The server never prints access tokens or refresh tokens.

Privacy modes:

- `summary`: minimal fields for safe agent use.
- `structured`: normalized Fitbit data for analysis.
- `raw`: upstream Fitbit JSON, only when explicitly requested.

Health data is sensitive. Do not paste raw payloads publicly. This MCP is for personal context and training/wellness reflection, not diagnosis or treatment.

## Development

```bash
npm install
npm test
```

## Links

- Website: https://fitbitmcp.vercel.app/
- GitHub: https://github.com/davidmosiah/fitbitmcp
- npm: https://www.npmjs.com/package/fitbit-mcp-unofficial
- Delx Wellness registry: https://github.com/davidmosiah/delx-wellness
- Connector quality standard: https://github.com/davidmosiah/delx-wellness/blob/main/docs/connector-quality-standard.md
- Fitbit Web API: https://dev.fitbit.com/build/reference/web-api/
