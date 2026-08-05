/**
 * Deterministic Fitbit activities-heart-intraday fixture.
 * Same closed-form HR profile as garmin/strava/Kindred 3h ride, but as a
 * civil-day dataset starting at 06:00 local (common wake window).
 */

export const SERIES_DATE = '2026-07-15';
export const RIDE_DURATION_SECONDS = 10800;
export const DAY_START_OFFSET = 6 * 3600; // 06:00:00

export function heartRateAt(tFromMidnight) {
  const t = tFromMidnight - DAY_START_OFFSET;
  if (t < 0 || t >= RIDE_DURATION_SECONDS) return null;
  if (t < 1200) return 95 + (130 - 95) * (t / 1200);
  if (t < 4800) return 140 + 8 * Math.sin((2 * Math.PI * (t - 1200)) / 600);
  if (t < 6600) {
    const intoBlock = (t - 4800) % 600;
    return intoBlock < 300 ? 168 : 120;
  }
  if (t < 9000) return 150 + 4 * Math.sin((2 * Math.PI * (t - 6600)) / 300);
  return 145 - (145 - 95) * ((t - 9000) / 1800);
}

function formatClock(secondsFromMidnight) {
  const h = Math.floor(secondsFromMidnight / 3600);
  const m = Math.floor((secondsFromMidnight % 3600) / 60);
  const s = secondsFromMidnight % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * @param {object} [options]
 * @param {number} [options.sampleIntervalSeconds]
 * @param {Array<[number, number]>} [options.gaps] Inclusive [startFromMidnight, endFromMidnight]
 * @param {number} [options.startOffset] First sample offset from midnight
 * @param {number} [options.durationSeconds]
 */
export function buildSyntheticIntraday(options = {}) {
  const {
    sampleIntervalSeconds = 1,
    gaps = [],
    startOffset = DAY_START_OFFSET,
    durationSeconds = RIDE_DURATION_SECONDS
  } = options;

  const inGap = (t) => gaps.some(([start, end]) => t >= start && t <= end);
  const dataset = [];
  for (let t = startOffset; t < startOffset + durationSeconds; t += sampleIntervalSeconds) {
    if (inGap(t)) continue;
    const hr = heartRateAt(t);
    if (hr === null) continue;
    dataset.push({ time: formatClock(t), value: Math.round(hr * 100) / 100 });
  }

  return {
    'activities-heart': [
      {
        dateTime: SERIES_DATE,
        value: {
          restingHeartRate: 62,
          heartRateZones: [
            { name: 'Out of Range', min: 30, max: 94, minutes: 10 },
            { name: 'Fat Burn', min: 94, max: 131, minutes: 40 },
            { name: 'Cardio', min: 131, max: 159, minutes: 80 },
            { name: 'Peak', min: 159, max: 220, minutes: 30 }
          ]
        }
      }
    ],
    'activities-heart-intraday': {
      dataset,
      datasetInterval: sampleIntervalSeconds,
      datasetType: sampleIntervalSeconds === 1 ? 'second' : 'minute'
    }
  };
}

export function groundTruth(options = {}) {
  const {
    sampleIntervalSeconds = 1,
    gaps = [],
    startOffset = DAY_START_OFFSET,
    durationSeconds = RIDE_DURATION_SECONDS
  } = options;
  const inGap = (t) => gaps.some(([start, end]) => t >= start && t <= end);
  const values = [];
  for (let t = startOffset; t < startOffset + durationSeconds; t += sampleIntervalSeconds) {
    if (inGap(t)) continue;
    const hr = heartRateAt(t);
    if (hr === null) continue;
    values.push(hr);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const percentile = (q) => {
    if (sorted.length <= 1) return sorted[0];
    const rank = (sorted.length - 1) * q;
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    if (low === high) return sorted[low];
    return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
  };
  return {
    count: values.length,
    avg: sum / values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p25: percentile(0.25),
    p50: percentile(0.5),
    p75: percentile(0.75)
  };
}
