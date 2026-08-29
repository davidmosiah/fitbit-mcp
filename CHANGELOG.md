## 0.6.3 - 2026-08-29

Skill layer ships in-package (`skill/SKILL.md`). Agents can use MCP tools **or** `call <tool> --json` on the same binary; mutation gates stay identical.

## 0.6.0 - 2026-08-05

### Added

- **`fitbit_heart_series`** — bounded heart-rate series for one civil day under
  the shared **`agent-safe-series/v1`** contract (Garmin MCP, Strava MCP, Kindred
  Mi Fitness; [garmin-mcp#19](https://github.com/davidmosiah/garmin-mcp/issues/19)):
  - Exact full-resolution stats + hard-capped points (default 400 / max 500)
  - `coverage_anchor` (`nominal_duration` for full day or HH:mm window)
  - `reference_source`: `caller_provided` | `activity_recorded_max` | `observed_max`
  - Optional `start_time`/`end_time` window with rebased `t` offsets
  - Synthetic fixture + regression tests

### Changed

- Prefer `fitbit_heart_series` over raw `fitbit_get_heart_intraday` in agent
  guidance (capabilities, Hermes skill, intraday prompt, FAQ).

## 0.5.0 - 2026-08-01

### Fixed

- **`fitbit_demo` returned a shape the server never produces.** Every key of the
  `fitbit_daily_summary` example was invented (`date`, `activity.*` including a
  `floors` field that does not exist anywhere in this server, `sleep.stages.*`,
  `heart.fat_burn_min`, `hrv.daily_rmssd_ms`) and all 35 real key paths were
  missing (`kind`, `generated_at`, `window.*`, `data_quality.*`, `scorecard.*`,
  `diagnostic.*`, `safety.*`). The `fitbit_wellness_context` example invented 7
  keys (`window`, `steps`, `resting_heart_rate`, `hrv_ms`, `sleep_duration_min`,
  `activity_load`, `recommendation`) and omitted 14, including `source`,
  `recent_training_load`, `soreness`, `injury_flags`, `notes`, `data_quality`
  and `telegram_summary`. Neither example satisfied the `outputSchema` its own
  tool declares. An agent that trusted the demo — its entire stated purpose —
  wrote a parser for data that never arrives and missed every field that does.
- Worst case for a consumer: `activity_load: "moderate"` is not a value this
  server can emit (the enum is `low|normal|high|unknown`), so a branch on the
  documented value never fires and never errors — it silently falls through.
  Likewise `sleep_score` is the sleep *efficiency* percentage, not Fitbit's
  0-100 sleep score, so even the one key both shapes shared meant a different
  metric.
- `fitbit_get_heart_day` example omitted `caloriesOut` on each heart-rate zone.

### Added

- `scripts/demo-contract-test.mjs` (`npm run test:demo-contract`, wired into
  `npm test`): runs the real `buildDailySummary`, `buildWellnessContext` and
  `applyPrivacy` over a synthetic Fitbit API fixture, extracts recursive key
  paths and fails in **both** directions — a key the demo invents, and a
  contract key the demo omits. Also validates every sample against the zod
  `outputSchema` its tool declares. This is what makes the drift above unable
  to return.
- Demo payload moved to `src/services/demo.ts` so the gate can import it
  instead of trusting a copy.

## 0.4.11 - 2026-07-30

### Added / Fixed

- exchange_code description documents explicit user OAuth action (scorecard 100).

# Changelog

## 0.6.2

- Security: raise `hono` override to **4.13.1** (clears moderate MCP SDK transitive advisories); `@hono/node-server@2.1.0`.


## 0.6.1

- Security: override `fast-uri@3.1.5` and `ip-address@10.4.0` (high transitive).





## 0.4.10 - 2026-07-30

### Security

- Agent-requested `privacy_mode=raw` and `include_gps=true` require `explicit_user_intent=true` (config-default raw still allowed without per-call intent).

## 0.4.9 - 2026-07-30

### Security

- Recursive GPS/PII redaction in privacy layer (nested lat/lon/polyline/map dropped; Polar/Strava parity).

## 0.4.8 - 2026-07-30

### Security

- Security: require explicit_user_intent on revoke/disconnect tools so agents cannot wipe OAuth grants autonomously.

## 0.4.7 - 2026-07-30

### Fixed

- **Pagination `next_page` off-by-one** — a full single-page list reported `next_page` equal to the current page (`floor(offset/limit)+1` without advancing offset). Agents re-requested the same page. Now `next_page = startPage + pages_fetched`.
- **Day-tool date normalization** — `fitbit_get_*_day` and heart-intraday now reduce ISO date-times (`2026-07-08T23:00:00-03:00`) to the written civil day before building Fitbit path segments, matching list-cursor behavior. Rejects garbage dates before HTTP.

## 0.4.6 - 2026-07-16

### Fixed

- Match Fitbit's activity-list contract: `afterDate` uses ascending order, `beforeDate` uses descending order, and callers cannot send both cursors together.
- Preserve the caller's written calendar date when converting offset ISO date-times, and reject invalid cursors before any HTTP request.
- Preserve complete structured weight envelopes and device fields while continuing to remove GPS and secret-bearing values.
- Log redacted per-domain errors from partial summaries to stderr and add an executable HTTP-boundary regression suite.
- Raise the transitive Hono override to 4.12.30 so production installs no longer include the audited 4.12.22 vulnerabilities.

## 0.4.3 - 2026-05-20

### Added

- **HTTP response cache middleware** (`src/services/http-cache.ts`) — in-memory cache layered OUTSIDE retry (`fetchWithCache → fetchWithRetry → fetch`), so cached responses skip both network and retry. Default 60s TTL for GET only; POST/PUT/DELETE and 4xx/5xx responses are never cached.
- **`FITBIT_NO_CACHE=true` env var** — global per-process cache bypass; advertised in `server.json`.
- **Per-call `cache_ttl: 0`** request option — opts a single call out of cache without disabling globally.
- **Query-param-order-insensitive cache keys** — `?afterDate=…&beforeDate=…&limit=…` and `?limit=…&beforeDate=…&afterDate=…` share one cache entry.
- **`fitbit_cache_status` now reports `http_cache` stats** alongside SQLite stats: `size`, `hit_count`, `miss_count`, `hit_rate`, `default_ttl_seconds`, `bypass_env_var`.
- `scripts/http-cache-test.mjs` — eight-case unit suite covering cache hit, POST never cached, TTL expiration, query-param normalization, 4xx not cached, env-var bypass, per-call `cache_ttl: 0`, and `getCacheStats()` math.

## 0.4.2 - 2026-05-19

### Added

- **Dedicated HTTP retry middleware** (`src/services/http-retry.ts`) — extracted from `FitbitClient.fetchWithRetry` into a reusable, testable function with exponential backoff (500ms / 1s / 2s), ±20% jitter, and `Retry-After` header parsing (supports both seconds and HTTP-date formats).
- **`FITBIT_NO_RETRY=true` env flag** — disables retries entirely for tests or callers that want raw error propagation.
- **HTTP 408 added to retryable status set** alongside 429, 500, 502, 503, 504 — request-timeout responses are now transparently retried.
- **Network-error retries** — fetch failures (ECONNRESET, ENOTFOUND, timeouts) are now retried with the same backoff schedule as HTTP errors instead of bubbling up on the first failure.
- **Structured stderr logs** — each retry now writes `[fitbit-mcp] retry N/3 after Xms (status=Y or error=Z)` so agents can correlate spike-and-recovery patterns in their logs.
- `scripts/http-retry-test.mjs` — six-case unit suite covering happy path, Retry-After header, env disable flag, 401 non-retry, exhaustion, and network-error retry.

### Changed

- `FitbitClient.fetchWithRetry` now delegates to the shared middleware so the auth-failure 401 re-auth flow benefits from the same backoff guarantees.
- Backoff defers to `Retry-After` first (HTTP standard) and only computes jittered exponential when the header is absent or unparseable.

## 0.4.1 - 2026-05-11

### Fixed

- **Profile-store regex no longer false-positives on common wellness words.** Split `SECRET_PATTERNS` into `SECRET_KEY_PATTERNS` (broad, for field names like `oauth_token`) and `SECRET_VALUE_PATTERNS` (high-specificity, only credential shapes: JWTs, `Bearer <token>`, `sk_live_`, `sk-proj-`, `xoxb-`, `github_pat_`, raw `Authorization:` headers). Previously legitimate text like "5 training sessions per week", "limit cookies", "I need to refresh my approach", or "secret sauce: more sleep" was rejected.
- **Partial-profile reads no longer crash downstream.** `readProfileFile` now structurally merges with `DEFAULT_PROFILE` when legacy Hermes/OpenClaw files lacked sub-objects (goals, devices, training, nutrition, preferences, safety). Previously `buildProfileSummary` and `missingCriticalFields` would throw.
- **Onboarding `privacy_note` no longer hard-codes a single connector path.** Lists multiple example paths so the message reads correctly from every connector.

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
