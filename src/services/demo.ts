/**
 * Synthetic example payloads for `fitbit_demo`.
 *
 * The stated purpose of the demo tool is that agents see the contract *before*
 * calling the real Fitbit APIs. That only holds if the examples match what the
 * builders actually return — an example advertising a field the server never
 * emits makes an agent write a parser for data that never arrives.
 *
 * These shapes are not hand-maintained guesses: `scripts/demo-contract-test.mjs`
 * runs the real `buildDailySummary` / `buildWellnessContext` / `applyPrivacy`
 * over a synthetic Fitbit API fixture and fails the build when the key sets
 * diverge in either direction (invented keys, or contract fields the example
 * omits). It also validates each sample against the zod output schemas the
 * tools actually declare.
 *
 * If you change a builder's output shape, that gate fails and points here.
 * Update this file — do not weaken the gate.
 */

const DEMO_DATE = "2026-05-01";
const DEMO_TIMEZONE = "America/Fortaleza";
const DEMO_GENERATED_AT = "2026-05-01T23:59:00.000Z";

/** `buildDailySummary` reports availability of each domain, not just values. */
function demoDataQuality() {
  return {
    confidence: "high",
    missing_or_failed: {
      activity: false,
      sleep: false,
      heart: false,
      hrv: false
    }
  };
}

/** One representative day, matching the shape of `buildDailySummary`. */
function demoDailySummary() {
  return {
    kind: "daily_summary",
    generated_at: DEMO_GENERATED_AT,
    window: {
      date: DEMO_DATE,
      days: 1,
      timezone: DEMO_TIMEZONE
    },
    data_quality: demoDataQuality(),
    // Flat metric block. Note the names: `sleep_efficiency` is Fitbit's
    // efficiency percentage, `hrv_rmssd` is RMSSD in milliseconds, and
    // `distance_km` follows the account's distance unit.
    scorecard: {
      date: DEMO_DATE,
      steps: 8420,
      calories_out: 2310,
      active_minutes: 38,
      sedentary_minutes: 612,
      distance_km: 6.4,
      resting_heart_rate: 56,
      sleep_minutes: 446,
      sleep_efficiency: 92,
      hrv_rmssd: 42.1,
      has_activity_error: false,
      has_sleep_error: false,
      has_heart_error: false,
      has_hrv_error: false
    },
    diagnostic: {
      readiness_context: "good_base",
      primary_signal: "Use Fitbit trends as a practical readiness context, not a diagnosis.",
      action_candidates: [
        "If subjective energy is good, this is a reasonable day for quality work or progressive aerobic volume.",
        "This is not medical advice; use Fitbit as trend context and escalate symptoms to a clinician."
      ]
    },
    safety: {
      medical_advice: false,
      api_boundary:
        "Fitbit Web API provides processed activity, sleep, heart and body metrics; it does not provide raw accelerometer telemetry through this MCP."
    }
  };
}

/**
 * Shared wellness-context handoff shape, matching `buildWellnessContext`.
 *
 * `sleep_score` here is the Fitbit sleep *efficiency* percentage, not Fitbit's
 * 0-100 sleep score — the builder reads `scorecard.sleep_efficiency`.
 */
function demoWellnessContext() {
  return {
    source: "fitbit",
    generated_at: DEMO_GENERATED_AT,
    sleep_score: 92,
    recent_training_load: "normal",
    soreness: ["left calf"],
    injury_flags: [],
    notes: ["Travel week; bedtime drifted late."],
    data_quality: demoDataQuality(),
    telegram_summary: "Fitbit wellness context | Sleep: 92 | Load: normal"
  };
}

/**
 * Endpoint-passthrough shape shared by every date tool: the envelope is ours,
 * `data` is the Fitbit Web API payload after the privacy layer runs. Shown in
 * the default `structured` mode, which keeps the API keys and strips only
 * identifying/GPS fields.
 */
function demoHeartDay() {
  return {
    endpoint: `/1/user/-/activities/heart/date/${DEMO_DATE}/1d.json`,
    privacy_mode: "structured",
    data: {
      "activities-heart": [
        {
          dateTime: DEMO_DATE,
          value: {
            restingHeartRate: 56,
            heartRateZones: [
              { name: "Out of Range", min: 30, max: 92, minutes: 1147, caloriesOut: 1720.4 },
              { name: "Fat Burn", min: 92, max: 129, minutes: 42, caloriesOut: 310.2 },
              { name: "Cardio", min: 129, max: 158, minutes: 18, caloriesOut: 168.9 },
              { name: "Peak", min: 158, max: 220, minutes: 4, caloriesOut: 47.3 }
            ]
          }
        }
      ]
    }
  };
}

export function buildDemoPayload() {
  return {
    ok: true,
    is_demo: true,
    sample: {
      fitbit_daily_summary: demoDailySummary(),
      fitbit_wellness_context: demoWellnessContext(),
      fitbit_get_heart_day: demoHeartDay()
    },
    notes: [
      "All sample data is synthetic; tagged with is_demo=true.",
      "Real calls return live data from the Fitbit Web API after OAuth setup.",
      "Summary tools return the shape above; date tools return { endpoint, privacy_mode, data } where data is the Fitbit API payload after redaction.",
      "Some endpoints (e.g. intraday heart rate) may require Fitbit Developer app type approval."
    ]
  };
}
