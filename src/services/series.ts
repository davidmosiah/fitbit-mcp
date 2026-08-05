/**
 * Agent-safe heart-rate time-series for Fitbit intraday datasets.
 *
 * A full day at 1 Hz is ~86,400 samples; even 1 min is 1,440. Handing that to
 * an agent burns context. This module returns exact full-resolution stats plus
 * a hard-capped series under the shared `agent-safe-series/v1` contract
 * (Garmin MCP, Strava MCP, Kindred Mi Fitness — garmin-mcp#19).
 *
 * Fitbit is day-windowed (not a single workout id). `activity_id` in the
 * envelope is the civil date `yyyy-MM-dd`.
 */

export const SERIES_CONTRACT_VERSION = "agent-safe-series/v1";

export const SERIES_HARD_MAX_POINTS = 500;
export const SERIES_DEFAULT_MAX_POINTS = 400;
export const SERIES_DEFAULT_RESOLUTION_SECONDS = 60;

/** Fitbit series surface today is heart rate only (the dense stream). */
export const SERIES_METRICS = ["heart_rate"] as const;
export type SeriesMetric = (typeof SERIES_METRICS)[number];

export type SeriesPoint = {
  t: number;
  value: number;
  min: number;
  max: number;
  samples: number;
};

export type SeriesStats = {
  avg: number;
  min: number;
  max: number;
  p25: number;
  p50: number;
  p75: number;
  percentile_method: "linear_interpolation";
};

export type ZoneBucket = {
  zone: number;
  min_bpm: number;
  max_bpm: number | null;
  seconds: number;
  percent: number;
};

export type ReferenceSource =
  | "caller_provided"
  | "activity_recorded_max"
  | "observed_max";

export type CoverageAnchor = "nominal_duration" | "sample_span";

export type TimeInZone = {
  zone_model: "percent_of_reference_max_hr";
  reference_max_hr: number;
  reference_source: ReferenceSource;
  zones: ZoneBucket[];
};

export type DataQuality = {
  expected_samples: number;
  actual_samples: number;
  coverage_ratio: number;
  longest_gap_seconds: number;
  sample_interval_seconds: number;
  coverage_anchor: CoverageAnchor;
};

export type ActivitySeries = {
  contract_version: typeof SERIES_CONTRACT_VERSION;
  /** Civil date yyyy-MM-dd for Fitbit day windows. */
  activity_id: string | number;
  metric: SeriesMetric;
  unit: string;
  start_time?: string;
  t_unit: "seconds_from_start";
  resolution_seconds: number;
  requested_resolution_seconds: number;
  points: SeriesPoint[];
  stats: SeriesStats;
  time_in_zone?: TimeInZone;
  downsampled: boolean;
  source_points: number;
  returned_points: number;
  method: "time_bucket_mean" | "none";
  data_quality: DataQuality;
  notes: string[];
};

interface RawSample {
  t: number;
  value: number;
}

export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const rank = (sorted.length - 1) * q;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function computeStats(values: number[]): SeriesStats {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    avg: round(sum / values.length),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    p25: round(percentile(sorted, 0.25)),
    p50: round(percentile(sorted, 0.5)),
    p75: round(percentile(sorted, 0.75)),
    percentile_method: "linear_interpolation"
  };
}

export function computeTimeInZone(
  samples: RawSample[],
  sampleIntervalSeconds: number,
  referenceMaxHr: number,
  referenceSource: TimeInZone["reference_source"]
): TimeInZone {
  const bounds = [0.5, 0.6, 0.7, 0.8, 0.9].map((pct) => Math.round(referenceMaxHr * pct));
  const seconds = new Array(bounds.length).fill(0);

  for (const sample of samples) {
    let index = -1;
    for (let i = bounds.length - 1; i >= 0; i -= 1) {
      if (sample.value >= bounds[i]) {
        index = i;
        break;
      }
    }
    if (index >= 0) seconds[index] += sampleIntervalSeconds;
  }

  const total = seconds.reduce((acc, value) => acc + value, 0);
  return {
    zone_model: "percent_of_reference_max_hr",
    reference_max_hr: referenceMaxHr,
    reference_source: referenceSource,
    zones: bounds.map((min, index) => ({
      zone: index + 1,
      min_bpm: min,
      max_bpm: index === bounds.length - 1 ? null : bounds[index + 1] - 1,
      seconds: round(seconds[index], 1),
      percent: total > 0 ? round((seconds[index] / total) * 100, 1) : 0
    }))
  };
}

function medianInterval(samples: RawSample[]): number {
  if (samples.length < 2) return 1;
  const deltas: number[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    const delta = samples[i].t - samples[i - 1].t;
    if (delta > 0) deltas.push(delta);
  }
  if (deltas.length === 0) return 1;
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 === 0 ? (deltas[mid - 1] + deltas[mid]) / 2 : deltas[mid];
  return median > 0 ? median : 1;
}

export function computeDataQuality(
  samples: RawSample[],
  options: { nominalDurationSeconds?: number } = {}
): DataQuality {
  const interval = medianInterval(samples);
  const span = samples.length > 1 ? samples[samples.length - 1].t - samples[0].t : 0;

  let expected: number;
  let coverage_anchor: CoverageAnchor;
  const nominal = options.nominalDurationSeconds;
  if (typeof nominal === "number" && Number.isFinite(nominal) && nominal > 0) {
    expected = Math.round(nominal / interval) + 1;
    coverage_anchor = "nominal_duration";
  } else {
    expected = span > 0 ? Math.round(span / interval) + 1 : samples.length;
    coverage_anchor = "sample_span";
  }

  let longestGap = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const delta = samples[i].t - samples[i - 1].t;
    if (delta > longestGap) longestGap = delta;
  }

  if (coverage_anchor === "nominal_duration" && samples.length > 0 && typeof nominal === "number") {
    const headGap = Math.max(0, samples[0].t);
    const tailGap = Math.max(0, nominal - samples[samples.length - 1].t);
    const edge = Math.max(headGap, tailGap);
    if (edge > longestGap) longestGap = edge;
  }

  return {
    expected_samples: expected,
    actual_samples: samples.length,
    coverage_ratio: expected > 0 ? round(Math.min(samples.length / expected, 1), 3) : 1,
    longest_gap_seconds: round(longestGap, 1),
    sample_interval_seconds: round(interval, 2),
    coverage_anchor
  };
}

export function downsampleToBuckets(samples: RawSample[], resolutionSeconds: number): SeriesPoint[] {
  if (samples.length === 0) return [];
  const origin = samples[0].t;
  const buckets = new Map<number, { sum: number; min: number; max: number; count: number }>();

  for (const sample of samples) {
    const index = Math.floor((sample.t - origin) / resolutionSeconds);
    const bucket = buckets.get(index);
    if (bucket) {
      bucket.sum += sample.value;
      bucket.count += 1;
      if (sample.value < bucket.min) bucket.min = sample.value;
      if (sample.value > bucket.max) bucket.max = sample.value;
    } else {
      buckets.set(index, { sum: sample.value, min: sample.value, max: sample.value, count: 1 });
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, bucket]) => ({
      t: round(origin + index * resolutionSeconds, 1),
      value: round(bucket.sum / bucket.count),
      min: round(bucket.min),
      max: round(bucket.max),
      samples: bucket.count
    }));
}

export function resolveEffectiveResolution(
  samples: RawSample[],
  requestedResolutionSeconds: number,
  maxPoints: number
): number {
  if (samples.length === 0) return requestedResolutionSeconds;
  const span = samples[samples.length - 1].t - samples[0].t;
  if (span <= 0) return requestedResolutionSeconds;

  let resolution = requestedResolutionSeconds;
  const needed = Math.ceil(span / maxPoints);
  if (needed > resolution) resolution = needed;

  while (downsampleToBuckets(samples, resolution).length > maxPoints) {
    resolution += Math.max(1, Math.ceil(resolution * 0.1));
  }
  return resolution;
}

/** "HH:mm:ss" or "HH:mm" → seconds from midnight. */
export function parseFitbitClock(time: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? "0");
  if (![hours, minutes, seconds].every((n) => Number.isFinite(n))) return undefined;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return undefined;
  return hours * 3600 + minutes * 60 + seconds;
}

export type FitbitIntradayPayload = Record<string, unknown>;

/**
 * Pull HR samples from a Fitbit intraday heart response.
 * Accepts either the full payload or the intraday sub-object alone.
 */
export function extractSamples(payload: FitbitIntradayPayload): {
  samples: RawSample[];
  datasetInterval?: number;
  datasetType?: string;
} {
  const intraday =
    (payload["activities-heart-intraday"] as Record<string, unknown> | undefined) ??
    (payload["activities-heart-intraday".toString()] as Record<string, unknown> | undefined) ??
    (payload.dataset ? payload : undefined);

  const dataset = (intraday?.dataset ?? payload.dataset) as unknown;
  if (!Array.isArray(dataset) || dataset.length === 0) {
    return { samples: [] };
  }

  const samples: RawSample[] = [];
  for (const row of dataset) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const value = Number(record.value);
    if (!Number.isFinite(value)) continue;
    const clock = typeof record.time === "string" ? parseFitbitClock(record.time) : undefined;
    if (clock === undefined) continue;
    samples.push({ t: clock, value });
  }

  samples.sort((a, b) => a.t - b.t);
  return {
    samples,
    datasetInterval: typeof intraday?.datasetInterval === "number" ? intraday.datasetInterval : undefined,
    datasetType: typeof intraday?.datasetType === "string" ? intraday.datasetType : undefined
  };
}

/** Optional max HR from the daily activities-heart summary block. */
export function pickDayRecordedMaxHr(payload: FitbitIntradayPayload): number | undefined {
  const days = payload["activities-heart"];
  if (!Array.isArray(days) || days.length === 0) return undefined;
  const value = (days[0] as Record<string, unknown>)?.value as Record<string, unknown> | undefined;
  if (!value) return undefined;
  for (const key of ["maxHeartRate", "max_heartrate", "max"]) {
    const n = Number(value[key]);
    if (Number.isFinite(n) && n >= 100 && n <= 240) return n;
  }
  // Peak zone upper bound is a weak signal — skip; prefer observed max.
  return undefined;
}

export interface BuildHeartSeriesOptions {
  /** Civil date yyyy-MM-dd used as activity_id. */
  date: string;
  resolutionSeconds?: number;
  maxPoints?: number;
  referenceMaxHr?: number;
  activityRecordedMaxHr?: number;
  /**
   * Nominal window length in seconds. Full civil day = 86400. For a
   * start_time/end_time window, pass (end - start). Enables duration-anchored
   * coverage (Kindred pattern).
   */
  nominalDurationSeconds?: number;
  /** Absolute start for the envelope (ISO-ish). Defaults to dateT00:00:00. */
  startTime?: string;
  /** Offset applied so points[].t is relative to window start, not midnight. */
  tOriginSeconds?: number;
}

export function buildHeartSeries(
  payload: FitbitIntradayPayload,
  options: BuildHeartSeriesOptions
): ActivitySeries {
  const {
    date,
    resolutionSeconds = SERIES_DEFAULT_RESOLUTION_SECONDS,
    maxPoints = SERIES_DEFAULT_MAX_POINTS,
    referenceMaxHr,
    activityRecordedMaxHr,
    nominalDurationSeconds,
    startTime,
    tOriginSeconds = 0
  } = options;

  const budget = Math.min(Math.max(1, Math.trunc(maxPoints)), SERIES_HARD_MAX_POINTS);
  const requested = Math.max(1, Math.trunc(resolutionSeconds));
  const notes: string[] = [];

  const { samples: rawSamples, datasetInterval, datasetType } = extractSamples(payload);
  if (rawSamples.length === 0) {
    throw new Error(
      `No heart_rate samples for ${date}. Fitbit returned no activities-heart-intraday dataset (scope, app type, or empty day).`
    );
  }

  // Rebase to window origin so t=0 is the series start, matching agent-safe-series/v1.
  const samples: RawSample[] = rawSamples.map((sample) => ({
    t: sample.t - tOriginSeconds,
    value: sample.value
  }));

  if (datasetType) {
    notes.push(`Upstream Fitbit datasetType=${datasetType}${datasetInterval !== undefined ? ` interval=${datasetInterval}` : ""}.`);
  }

  const values = samples.map((sample) => sample.value);
  const stats = computeStats(values);
  const dataQuality = computeDataQuality(samples, { nominalDurationSeconds });

  const effective = resolveEffectiveResolution(samples, requested, budget);
  if (effective !== requested) {
    notes.push(
      `Requested ${requested}s resolution would exceed max_points=${budget}; served at ${effective}s instead.`
    );
  }

  const shouldDownsample = effective > dataQuality.sample_interval_seconds && samples.length > budget;
  const points: SeriesPoint[] = shouldDownsample
    ? downsampleToBuckets(samples, effective)
    : samples.map((sample) => ({
        t: round(sample.t, 1),
        value: round(sample.value),
        min: round(sample.value),
        max: round(sample.value),
        samples: 1
      }));

  if (dataQuality.coverage_ratio < 0.9) {
    notes.push(
      `Sparse series: ${dataQuality.actual_samples} of ~${dataQuality.expected_samples} expected samples ` +
        `(anchor=${dataQuality.coverage_anchor}, longest gap ${dataQuality.longest_gap_seconds}s). Treat the shape as indicative.`
    );
  }

  let source: ReferenceSource;
  let reference: number;
  if (referenceMaxHr !== undefined) {
    source = "caller_provided";
    reference = referenceMaxHr;
  } else if (
    typeof activityRecordedMaxHr === "number" &&
    Number.isFinite(activityRecordedMaxHr) &&
    activityRecordedMaxHr > 0
  ) {
    source = "activity_recorded_max";
    reference = Math.round(activityRecordedMaxHr);
  } else {
    source = "observed_max";
    reference = Math.round(stats.max);
  }
  const timeInZone = computeTimeInZone(samples, dataQuality.sample_interval_seconds, reference, source);
  if (source !== "caller_provided") {
    notes.push(
      `reference_max_hr source=${source}. Pass reference_max_hr for zones that compare across days.`
    );
  }

  return {
    contract_version: SERIES_CONTRACT_VERSION,
    activity_id: date,
    metric: "heart_rate",
    unit: "bpm",
    start_time: startTime ?? `${date}T00:00:00`,
    t_unit: "seconds_from_start",
    resolution_seconds: shouldDownsample ? effective : round(dataQuality.sample_interval_seconds, 2),
    requested_resolution_seconds: requested,
    points,
    stats,
    time_in_zone: timeInZone,
    downsampled: shouldDownsample,
    source_points: samples.length,
    returned_points: points.length,
    method: shouldDownsample ? "time_bucket_mean" : "none",
    data_quality: dataQuality,
    notes
  };
}
