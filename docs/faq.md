# FAQ

## Is this official?

No. It is unofficial and not affiliated with Fitbit or Google.

## What data can it read?

Activity, sleep, daily heart rate, intraday heart rate when permitted, HRV, SpO2, breathing rate, weight, food, water, profile and devices.

For agent work on dense HR prefer **`fitbit_heart_series`** (`agent-safe-series/v1`): exact full-resolution stats plus a hard-capped series so a full day at 1 Hz never blows the context window. Shared shape with Garmin/Strava MCP and Mi Fitness Data Bridge (Kindred) — [garmin-mcp#19](https://github.com/davidmosiah/garmin-mcp/issues/19). Use `fitbit_get_heart_intraday` only when you need the raw dataset dump.

## Does it provide raw sensor data?

No raw accelerometer/device telemetry. `raw` mode means upstream Fitbit Web API JSON for supported endpoints.

## Is it medical advice?

No. It provides wellness/training context only.
