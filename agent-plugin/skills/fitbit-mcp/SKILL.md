---
name: fitbit-mcp
description: >-
  Read the user's Fitbit activity, heart rate, sleep and body data through the local fitbit MCP server. Use when the user asks about Fitbit steps, sleep, heart rate, body measurements, exercise, or a daily or weekly Fitbit summary. Starts with connection status, uses synthetic demo data before OAuth, and never asks for secrets in chat.
---

# Fitbit

MCP server `fitbit` from the `fitbit-mcp-unofficial@0.7.0` npm package, run locally through `npx`. It reads daily activity, steps, heart rate, sleep, body measurements and exercise logs. Data source: the official Fitbit Web API.

## Workflow

1. Start with `fitbit_connection_status`. Then pick what fits the question: `fitbit_daily_summary`, `fitbit_weekly_summary`.
2. If `fitbit_connection_status` reports the connector is not ready, call `fitbit_demo` for clearly labelled synthetic data so the user sees the shape of the answer, then give them the setup commands below to run in their own terminal.
3. Lead with the answer to the user's question, then the two or three numbers that support it, with dates. Say when data is missing or stale instead of filling gaps.

## Setup (the user runs this in a terminal, not in chat)

```bash
npx -y fitbit-mcp-unofficial@0.7.0 setup --client generic
npx -y fitbit-mcp-unofficial@0.7.0 auth
npx -y fitbit-mcp-unofficial@0.7.0 doctor
```

`setup` asks for the Fitbit developer app client ID and secret and saves them locally (`--client generic` because this plugin already registers the server with Hermes); `auth` opens the Fitbit consent page in the browser and stores the OAuth tokens under `~/.fitbit-mcp/` with 0600 permissions; `doctor` confirms readiness.

## Safety

- Never ask the user to paste client secrets, passwords, tokens or MFA codes into the chat; setup happens in their terminal.
- Tools that change local state: fitbit_profile_update (local profile only), fitbit_exchange_code (stores OAuth tokens locally). Use them only when the user asks.
- Destructive: fitbit_revoke_access (revokes the Fitbit grant and deletes local tokens). Confirm with the user first.
- Not medical advice: the data supports personal reflection and planning, not diagnosis or treatment. Point the user to a clinician for symptoms, medication or anything urgent.
