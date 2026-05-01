# Hermes Example

```bash
npx -y fitbit-mcp-unofficial setup --client hermes --no-auth
npx -y fitbit-mcp-unofficial auth
npx -y fitbit-mcp-unofficial doctor --client hermes
```

Useful direct tools:

- `mcp_fitbit_fitbit_connection_status`
- `mcp_fitbit_fitbit_daily_summary`
- `mcp_fitbit_fitbit_weekly_summary`
- `mcp_fitbit_fitbit_get_sleep_day`
- `mcp_fitbit_fitbit_get_heart_day`
- `mcp_fitbit_fitbit_get_heart_intraday`

Keep `FITBIT_CLIENT_SECRET` and OAuth tokens out of prompts, logs and public repos.
