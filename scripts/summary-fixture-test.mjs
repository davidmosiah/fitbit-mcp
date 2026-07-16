import assert from 'node:assert/strict';
import { buildDailySummary, buildWeeklySummary } from '../dist/services/summary.js';
import { buildWellnessContext } from '../dist/services/context.js';

const today = new Date().toISOString().slice(0, 10);

const fakeClient = {
  async get(endpoint) {
    if (endpoint.includes('/activities/date/')) {
      return { summary: { steps: 9000, caloriesOut: 2400, fairlyActiveMinutes: 35, veryActiveMinutes: 25, sedentaryMinutes: 600, distances: [{ activity: 'total', distance: 7.2 }] } };
    }
    if (endpoint.includes('/sleep/date/')) {
      return { summary: { totalMinutesAsleep: 430 }, sleep: [{ efficiency: 91, dateOfSleep: today }] };
    }
    if (endpoint.includes('/activities/heart/date/')) {
      return { 'activities-heart': [{ dateTime: today, value: { restingHeartRate: 58 } }] };
    }
    if (endpoint.includes('/hrv/date/')) {
      return { hrv: [{ dateTime: today, value: { rmssd: 48.2 } }] };
    }
    if (endpoint.includes('/body/log/weight/date/')) {
      return { weight: [{ date: today, weight: 80 }] };
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  }
};

const daily = await buildDailySummary(fakeClient, { days: 7, timezone: 'UTC' });
assert.equal(daily.kind, 'daily_summary');
assert.equal(daily.scorecard.steps, 9000);
assert.equal(daily.scorecard.sleep_minutes, 430);
assert.equal(daily.scorecard.resting_heart_rate, 58);
assert.ok(daily.diagnostic.action_candidates.length >= 2);

const weekly = await buildWeeklySummary(fakeClient, { days: 7, compare_days: 7, timezone: 'UTC' });
assert.equal(weekly.kind, 'weekly_summary');
assert.equal(weekly.scorecard.current.days, 7);
assert.equal(weekly.scorecard.current.avg_sleep_hours, 7.17);
assert.ok(weekly.diagnostic.bottlenecks.length >= 1);

const context = await buildWellnessContext(fakeClient, { days: 7, timezone: 'UTC' });
assert.equal(context.source, 'fitbit');
assert.equal(context.sleep_score, 91);
assert.equal(context.recent_training_load, 'normal');

let capturedStderr = '';
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk) => {
  capturedStderr += String(chunk);
  return true;
};
try {
  const partialClient = {
    async get(endpoint) {
      if (endpoint.includes('/sleep/date/')) throw new Error('synthetic Fitbit sleep failure');
      return fakeClient.get(endpoint);
    },
  };
  await buildDailySummary(partialClient, { days: 7, timezone: 'UTC' });
} finally {
  process.stderr.write = originalStderrWrite;
}
assert.match(capturedStderr, /\[fitbit-mcp\] summary domain error: synthetic Fitbit sleep failure/);

console.log(JSON.stringify({ ok: true, daily: daily.kind, weekly: weekly.kind }, null, 2));
