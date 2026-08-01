/**
 * Contract gate for `fitbit_demo`.
 *
 * The demo tool exists so agents can see the payload shape before calling the
 * real Fitbit APIs. A hand-written example nobody compares against reality
 * drifts silently, and an agent that trusts it writes a parser for fields that
 * never arrive.
 *
 * This gate runs the REAL code paths over a synthetic Fitbit API fixture and
 * compares key sets against the demo payload, failing in both directions:
 *
 *   - a key in the demo that the real path never emits -> invented contract
 *   - a key the real path emits that the demo omits     -> incomplete contract
 *
 * Arrays are compared as the union of their elements' key paths, because a real
 * payload contains both populated and empty entries and either alone
 * under-describes the shape.
 *
 * Honest limitation, stated so nobody mistakes this for more than it is:
 * `fitbit_daily_summary` and `fitbit_wellness_context` are OUR builders, so
 * their key set is genuinely derived from repo code. `fitbit_get_heart_day` is
 * a passthrough of Fitbit's own response — the gate proves our envelope and
 * that the privacy layer preserves those keys in `structured` mode, but the
 * inner `data` shape comes from FITBIT_API_FIXTURE below, written from Fitbit's
 * documented heart-rate response. If Fitbit changes that endpoint, only a live
 * call catches it. Every sample is additionally validated against the zod
 * output schema its tool actually declares, which is fully repo-owned truth.
 */
import assert from 'node:assert/strict';
import { buildDailySummary } from '../dist/services/summary.js';
import { buildWellnessContext } from '../dist/services/context.js';
import { applyPrivacy } from '../dist/services/privacy.js';
import { buildDemoPayload } from '../dist/services/demo.js';
import {
  EndpointDataOutputSchema,
  SummaryOutputSchema,
  WellnessContextOutputSchema
} from '../dist/schemas/common.js';

const DATE = new Date().toISOString().slice(0, 10);
const TIMEZONE = 'America/Fortaleza';
const HEART_ENDPOINT = `/1/user/-/activities/heart/date/${DATE}/1d.json`;

/**
 * Synthetic Fitbit Web API responses, shaped like the documented endpoints.
 * Values are obviously fake; no real health data belongs in this repo.
 */
const FITBIT_API_FIXTURE = {
  heart: {
    'activities-heart': [
      {
        dateTime: DATE,
        value: {
          restingHeartRate: 56,
          heartRateZones: [
            { name: 'Out of Range', min: 30, max: 92, minutes: 1147, caloriesOut: 1720.4 },
            { name: 'Fat Burn', min: 92, max: 129, minutes: 42, caloriesOut: 310.2 },
            { name: 'Cardio', min: 129, max: 158, minutes: 18, caloriesOut: 168.9 },
            { name: 'Peak', min: 158, max: 220, minutes: 4, caloriesOut: 47.3 }
          ]
        }
      }
    ]
  },
  activity: {
    summary: {
      steps: 8420,
      caloriesOut: 2310,
      fairlyActiveMinutes: 22,
      veryActiveMinutes: 16,
      sedentaryMinutes: 612,
      distances: [{ activity: 'total', distance: 6.4 }]
    }
  },
  sleep: { summary: { totalMinutesAsleep: 446 }, sleep: [{ efficiency: 92, dateOfSleep: DATE }] },
  hrv: { hrv: [{ dateTime: DATE, value: { rmssd: 42.1 } }] },
  weight: { weight: [{ date: DATE, weight: 80.2, bmi: 24.1 }] }
};

const fixtureClient = {
  async get(endpoint) {
    if (endpoint.includes('/activities/heart/date/')) return FITBIT_API_FIXTURE.heart;
    if (endpoint.includes('/activities/date/')) return FITBIT_API_FIXTURE.activity;
    if (endpoint.includes('/sleep/date/')) return FITBIT_API_FIXTURE.sleep;
    if (endpoint.includes('/hrv/date/')) return FITBIT_API_FIXTURE.hrv;
    if (endpoint.includes('/body/log/weight/date/')) return FITBIT_API_FIXTURE.weight;
    throw new Error(`unexpected endpoint ${endpoint}`);
  }
};

/**
 * Keys the real path only emits when the account/date happens to carry that
 * record type. The demo shows them because they are part of the contract an
 * agent may encounter; the fixture may or may not produce them. Each entry
 * needs a reason.
 *
 * This is deliberately narrow. Adding a key here to silence the gate defeats
 * the gate — only list fields that are genuinely conditional on API contents.
 */
const OPTIONAL_IN_REAL = new Map([
  // No allowances needed today: the fixture exercises every documented field.
  // Kept as the explicit, reviewable place to record one if that ever changes.
]);

function keyPaths(value, prefix = '', out = new Set()) {
  if (Array.isArray(value)) {
    // Union across elements: a real payload has both populated and empty entries.
    for (const item of value) keyPaths(item, `${prefix}[]`, out);
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  for (const key of Object.keys(value)) {
    const p = prefix ? `${prefix}.${key}` : key;
    out.add(p);
    keyPaths(value[key], p, out);
  }
  return out;
}

function diff(demoSet, realSet) {
  const invented = [...demoSet].filter((k) => !realSet.has(k)).sort();
  const missing = [...realSet]
    .filter((k) => !demoSet.has(k) && !OPTIONAL_IN_REAL.has(k))
    .sort();
  return { invented, missing };
}

function report(name, invented, missing) {
  const lines = [];
  if (invented.length > 0) {
    lines.push(
      `\n  ${name}: ${invented.length} key(s) in the demo that the real code NEVER returns.`,
      `  An agent trusting these writes a parser for data that never arrives:`,
      ...invented.map((k) => `    - ${k}`)
    );
  }
  if (missing.length > 0) {
    lines.push(
      `\n  ${name}: ${missing.length} key(s) the real code returns but the demo omits.`,
      `  Agents reading the demo will not know these exist:`,
      ...missing.map((k) => `    + ${k}`)
    );
  }
  return lines.join('\n');
}

const payload = buildDemoPayload();
const demo = payload.sample;

const real = {
  fitbit_daily_summary: await buildDailySummary(fixtureClient, { days: 1, timezone: TIMEZONE }),
  fitbit_wellness_context: await buildWellnessContext(fixtureClient, {
    days: 1,
    timezone: TIMEZONE,
    soreness: ['left calf'],
    injury_flags: [],
    notes: 'Travel week; bedtime drifted late.'
  }),
  fitbit_get_heart_day: {
    endpoint: HEART_ENDPOINT,
    privacy_mode: 'structured',
    data: applyPrivacy(HEART_ENDPOINT, FITBIT_API_FIXTURE.heart, 'structured')
  }
};

const failures = [];
let checked = 0;

for (const [name, realPayload] of Object.entries(real)) {
  assert.ok(demo[name], `demo payload is missing the ${name} sample entirely`);
  const demoSet = keyPaths(demo[name]);
  const realSet = keyPaths(realPayload);
  const { invented, missing } = diff(demoSet, realSet);
  checked += demoSet.size;
  if (invented.length > 0 || missing.length > 0) {
    failures.push(report(name, invented, missing));
  } else {
    console.log(`PASS ${name} — ${demoSet.size} key paths match the real code path`);
  }
}

// Each sample must also satisfy the zod output schema its tool declares.
// Key-path equality alone would not catch a sample that renames an enum value
// or drops a required literal.
const schemaChecks = [
  ['fitbit_daily_summary', SummaryOutputSchema],
  ['fitbit_wellness_context', WellnessContextOutputSchema],
  ['fitbit_get_heart_day', EndpointDataOutputSchema]
];
for (const [name, schema] of schemaChecks) {
  const result = schema.safeParse(demo[name]);
  if (!result.success) {
    failures.push(
      `\n  ${name}: demo sample does not satisfy the outputSchema the tool declares.` +
        `\n  ${JSON.stringify(result.error.issues, null, 2)}`
    );
  } else {
    console.log(`PASS ${name} — sample validates against its declared outputSchema`);
  }
}

// The demo must stay honest about being synthetic, whatever the shape says.
assert.equal(payload.is_demo, true, 'demo payload must be tagged is_demo=true');
assert.ok(Array.isArray(payload.notes) && payload.notes.length > 0, 'demo payload must carry notes');
console.log('PASS demo payload is tagged synthetic');

// A demo that leaks the identifying metadata the privacy layer strips would
// re-teach agents the wrong contract.
const encoded = JSON.stringify(payload).toLowerCase();
for (const needle of ['latitude', 'longitude', 'encodedid', 'access_token', 'refresh_token', 'email']) {
  assert.ok(!encoded.includes(needle), `demo payload must not contain "${needle}"`);
}
console.log('PASS demo payload carries no positional, identity or token keys');

if (failures.length > 0) {
  console.error('\nFAIL demo contract drifted from the real code:');
  console.error(failures.join('\n'));
  console.error(
    '\nFix src/services/demo.ts so the examples match what the server returns.' +
      '\nDo not widen OPTIONAL_IN_REAL to silence this — that is how the drift got here.\n'
  );
  process.exit(1);
}

console.log(`\ndemo-contract: ${checked} key paths verified against the real code paths`);
console.log(JSON.stringify({ ok: true, suite: 'demo-contract', samples: Object.keys(real).length }));
