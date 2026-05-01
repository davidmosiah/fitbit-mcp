# Privacy

Fitbit health data is sensitive. This MCP stores OAuth tokens locally under `~/.fitbit-mcp/` and never prints token values.

## Modes

- `summary`: minimal fields for safe agent use.
- `structured`: normalized Fitbit Web API data.
- `raw`: upstream Fitbit JSON, only when explicitly requested.

## Boundary

The MCP uses the official Fitbit Web API. It does not expose raw accelerometer telemetry, private Google endpoints, or medical diagnosis.
