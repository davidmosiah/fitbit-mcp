# Fitbit — Agent Plugins package

Portable [Agent Plugins](https://agent-plugins.org/) v1 package for
[Hermes Agent](https://github.com/NousResearch/hermes-agent) and other Agent Plugins clients:
the `fitbit` MCP server (`fitbit-mcp-unofficial@0.7.0` over stdio) plus the `fitbit-mcp` workflow skill.

## Install (Hermes Agent)

```bash
hermes plugins install davidmosiah/fitbit-mcp/agent-plugin --no-enable
hermes plugins enable fitbit-mcp
```

Requires Node.js 20+ (`npx` on PATH). The skill loads as `fitbit-mcp:fitbit-mcp`.

## Connector setup

```bash
npx -y fitbit-mcp-unofficial@0.7.0 setup --client generic
npx -y fitbit-mcp-unofficial@0.7.0 auth
npx -y fitbit-mcp-unofficial@0.7.0 doctor
```

`setup` asks for the Fitbit developer app client ID and secret and saves them locally (`--client generic` because this plugin already registers the server with Hermes); `auth` opens the Fitbit consent page in the browser and stores the OAuth tokens under `~/.fitbit-mcp/` with 0600 permissions; `doctor` confirms readiness.

## Disclosure

Runs the `fitbit-mcp-unofficial@0.7.0` npm package locally over stdio through `npx` (Node.js 20+ required); the package is downloaded from npm on first start. Data source: the official Fitbit Web API. Credentials and OAuth tokens are created by the connector's own `setup`/`auth` commands in the user's terminal and stay on the machine (`~/.fitbit-mcp/`); the plugin declares no environment variables and reads no Hermes credentials. Tools that change state: fitbit_profile_update (local profile only); fitbit_exchange_code (stores OAuth tokens locally); fitbit_revoke_access (revokes the Fitbit grant and deletes local tokens). The tool set comes from the pinned npm version, not from this repository's source tree.
