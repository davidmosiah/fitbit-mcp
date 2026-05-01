# OAuth

Create a Fitbit app at https://dev.fitbit.com/apps.

Callback URL:

```text
http://127.0.0.1:3000/callback
```

Recommended scopes:

```text
activity heartrate profile settings sleep weight nutrition
```

Run:

```bash
npx -y fitbit-mcp-unofficial setup
npx -y fitbit-mcp-unofficial auth
npx -y fitbit-mcp-unofficial doctor
```
