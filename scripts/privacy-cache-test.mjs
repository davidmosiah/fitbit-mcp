import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPrivacyAudit } from '../dist/services/audit.js';
import { FitbitCache } from '../dist/services/cache.js';
import { applyPrivacy, normalizeStreams } from '../dist/services/privacy.js';
import { redactErrorMessage, redactSensitive } from '../dist/services/redaction.js';

const activity = {
  id: 123,
  name: 'Morning Ride',
  activityName: 'Ride',
  distance: 42,
  activeDuration: 5400000,
  start_latlng: [40.1, -73.1],
  map: { summary_polyline: 'encoded' },
  averageHeartRate: 142
};

const structured = applyPrivacy('/activities/123', activity, 'structured');
assert.equal(structured.id, 123);
assert.equal(structured.averageHeartRate, 142);
assert.equal(structured.start_latlng, undefined);
assert.equal(structured.map, undefined);

const summary = applyPrivacy('/activities/123', activity, 'summary');
assert.equal(summary.distance, 42);
assert.equal(summary.averageHeartRate, 142);
assert.equal(summary.map, undefined);

const raw = applyPrivacy('/activities/123', activity, 'raw');
assert.equal(raw.map.summary_polyline, 'encoded');

const structuredWeight = applyPrivacy('/body/log/weight/date/2026-07-08.json', {
  weight: [{ date: '2026-07-08', weight: 80, futureMetric: 17 }],
  pagination: { afterDate: '2026-07-08' },
}, 'structured');
assert.equal(structuredWeight.weight[0].futureMetric, 17);
assert.deepEqual(structuredWeight.pagination, { afterDate: '2026-07-08' });

const structuredDevice = applyPrivacy('/devices.json', {
  id: 'device-1',
  deviceVersion: 'Synthetic',
  battery: 'High',
  futureCapability: { ecg: true },
}, 'structured');
assert.deepEqual(structuredDevice.futureCapability, { ecg: true });

const streams = normalizeStreams({ heartrate: { data: [120, 121] }, latlng: { data: [[1, 2]] } }, 'structured', false);
assert.equal(streams.latlng, undefined);
assert.deepEqual(streams.heartrate.data, [120, 121]);

// Nested GPS must not survive structured mode (recursive redaction).
const nested = applyPrivacy('/1/user/-/activities/99.json', {
  activityId: 99,
  averageHeartRate: 130,
  path: {
    points: [
      { latitude: 10, longitude: 20, elev: 100 },
      { latitude: 11, longitude: 21, elev: 110 },
    ],
  },
  map: { summary_polyline: 'secret-route', color: 'blue' },
  nested: { latlng: [1, 2], name: 'keep' },
}, 'structured');
assert.equal(nested.averageHeartRate, 130);
assert.equal(nested.map, undefined, 'map key is GPS-class and must be dropped entirely');
assert.equal(nested.path?.points?.[0]?.latitude, undefined);
assert.equal(nested.path?.points?.[0]?.elev, 100);
assert.equal(nested.nested?.latlng, undefined);
assert.equal(nested.nested?.name, 'keep');

assert.equal(redactSensitive({ access_token: 'abc', nested: { client_secret: 'def' } }).access_token, '[REDACTED]');
assert.match(redactErrorMessage('Authorization: Bearer abc.def.ghi'), /REDACTED/);
assert.equal(buildPrivacyAudit().unofficial, true);
assert.equal(buildPrivacyAudit().gps_redaction_default, true);

const dir = mkdtempSync(join(tmpdir(), 'fitbit-mcp-cache-'));
try {
  const path = join(dir, 'cache.sqlite');
  const cache = new FitbitCache(path);
  cache.set('GET', 'https://example.com/a', { ok: true });
  assert.deepEqual(cache.get('GET', 'https://example.com/a'), { ok: true });
  assert.equal(cache.status().entries, 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, privacy: true, cache: true, redaction: true, audit: true }, null, 2));

// Agent escalation gate: raw / include_gps without intent must throw
import { resolvePrivacyMode } from '../dist/services/privacy.js';
const cfg = { privacyMode: 'structured' };
try {
  resolvePrivacyMode(cfg, 'raw', { explicit_user_intent: false });
  assert.fail('raw without intent should throw');
} catch (e) {
  assert.match(String(e.message || e), /USER_ACTION_REQUIRED|explicit_user_intent/i);
}
try {
  resolvePrivacyMode(cfg, 'structured', { include_gps: true, explicit_user_intent: false });
  assert.fail('include_gps without intent should throw');
} catch (e) {
  assert.match(String(e.message || e), /USER_ACTION_REQUIRED|explicit_user_intent/i);
}
assert.equal(resolvePrivacyMode(cfg, 'raw', { explicit_user_intent: true }), 'raw');
assert.equal(resolvePrivacyMode(cfg, 'structured', { include_gps: true, explicit_user_intent: true }), 'structured');
// config-default raw without agent override does not require intent
assert.equal(resolvePrivacyMode({ privacyMode: 'raw' }), 'raw');
console.log(JSON.stringify({ ok: true, suite: 'privacy-escalation-gate' }, null, 2));
