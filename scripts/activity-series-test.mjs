/**
 * Regression tests for agent-safe-series/v1 on Fitbit intraday HR.
 */
import assert from 'node:assert/strict';
import {
  SERIES_HARD_MAX_POINTS,
  buildHeartSeries,
  extractSamples,
  parseFitbitClock,
  percentile
} from '../dist/services/series.js';
import {
  DAY_START_OFFSET,
  SERIES_DATE,
  buildSyntheticIntraday,
  groundTruth
} from './synthetic-series-fixture.mjs';

let passed = 0;
function check(label, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${label}`);
}

const payload = buildSyntheticIntraday();
const truth = groundTruth();

check('fixture has 3h of 1 Hz samples from 06:00', () => {
  assert.equal(payload['activities-heart-intraday'].dataset.length, 10800);
  assert.equal(truth.count, 10800);
  assert.equal(parseFitbitClock('06:00:00'), DAY_START_OFFSET);
});

check('extractSamples reads Fitbit dataset clocks', () => {
  const { samples } = extractSamples(payload);
  assert.equal(samples.length, 10800);
  assert.equal(samples[0].t, DAY_START_OFFSET);
});

check('stats on full-resolution samples after rebase to window origin', () => {
  const series = buildHeartSeries(payload, {
    date: SERIES_DATE,
    nominalDurationSeconds: 10800,
    startTime: `${SERIES_DATE}T06:00:00`,
    tOriginSeconds: DAY_START_OFFSET
  });
  assert.ok(series.downsampled);
  assert.equal(series.contract_version, 'agent-safe-series/v1');
  assert.equal(series.t_unit, 'seconds_from_start');
  assert.equal(series.points[0].t, 0);
  assert.ok(Math.abs(series.stats.avg - truth.avg) < 0.5, `avg ${series.stats.avg}`);
  assert.ok(series.returned_points <= SERIES_HARD_MAX_POINTS);
});

check('hard cap holds', () => {
  const series = buildHeartSeries(payload, {
    date: SERIES_DATE,
    resolutionSeconds: 1,
    maxPoints: 100000,
    tOriginSeconds: DAY_START_OFFSET,
    nominalDurationSeconds: 10800
  });
  assert.ok(series.returned_points <= SERIES_HARD_MAX_POINTS);
  assert.ok(series.notes.some((n) => n.includes('max_points')));
});

check('caller_provided reference source', () => {
  const series = buildHeartSeries(payload, {
    date: SERIES_DATE,
    referenceMaxHr: 190,
    tOriginSeconds: DAY_START_OFFSET,
    nominalDurationSeconds: 10800
  });
  assert.equal(series.time_in_zone.reference_source, 'caller_provided');
});

check('duration-anchored head gap (Kindred pattern)', () => {
  // Drop first 20 min of the 06:00–09:00 window.
  const headless = buildSyntheticIntraday({ gaps: [[DAY_START_OFFSET, DAY_START_OFFSET + 1200]] });
  const series = buildHeartSeries(headless, {
    date: SERIES_DATE,
    nominalDurationSeconds: 10800,
    tOriginSeconds: DAY_START_OFFSET,
    startTime: `${SERIES_DATE}T06:00:00`
  });
  assert.equal(series.data_quality.coverage_anchor, 'nominal_duration');
  assert.ok(
    series.data_quality.coverage_ratio > 0.85 && series.data_quality.coverage_ratio < 0.92,
    `coverage ${series.data_quality.coverage_ratio}`
  );
});

check('sample_span fallback without nominal duration', () => {
  const headless = buildSyntheticIntraday({ gaps: [[DAY_START_OFFSET, DAY_START_OFFSET + 4000]] });
  const series = buildHeartSeries(headless, {
    date: SERIES_DATE,
    tOriginSeconds: DAY_START_OFFSET
  });
  assert.equal(series.data_quality.coverage_anchor, 'sample_span');
  assert.equal(series.data_quality.coverage_ratio, 1);
});

check('missing dataset errors', () => {
  assert.throws(
    () => buildHeartSeries({ 'activities-heart-intraday': { dataset: [] } }, { date: SERIES_DATE }),
    /No heart_rate samples/
  );
});

check('percentile linear interpolation', () => {
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
});

check('1min full day still respects max_points', () => {
  const day = buildSyntheticIntraday({
    sampleIntervalSeconds: 60,
    startOffset: 0,
    durationSeconds: 86400
  });
  // Overwrite heartRateAt dependence: synthetic function only fills 06:00–09:00
  // for non-null HR. Build a flat 1min day manually.
  const dataset = [];
  for (let t = 0; t < 86400; t += 60) {
    dataset.push({
      time: `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:00`,
      value: 70 + (t % 600) / 100
    });
  }
  day['activities-heart-intraday'] = { dataset, datasetInterval: 60, datasetType: 'minute' };
  const series = buildHeartSeries(day, {
    date: SERIES_DATE,
    nominalDurationSeconds: 86400,
    maxPoints: 400
  });
  assert.equal(series.source_points, 1440);
  assert.ok(series.returned_points <= 400);
  assert.ok(series.downsampled);
});

console.log(`\nactivity-series: ${passed} checks passed`);
