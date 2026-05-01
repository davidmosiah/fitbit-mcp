# Fitbit MCP Quickstart

1. Create a Fitbit app at https://dev.fitbit.com/apps
2. Set callback URL: `http://127.0.0.1:3000/callback`
3. Use scopes: `activity heartrate profile settings sleep weight nutrition`
4. Run:

```bash
npx -y fitbit-mcp-unofficial setup
npx -y fitbit-mcp-unofficial auth
npx -y fitbit-mcp-unofficial doctor
```

Add to your MCP client:

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
