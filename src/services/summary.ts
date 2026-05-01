import type { FitbitClient } from "./fitbit-client.js";

const DAY_MS = 24 * 60 * 60 * 1000;

type UnknownRecord = Record<string, unknown>;

export interface SummaryOptions {
  days: number;
  compare_days?: number;
  timezone?: string;
}

function isObject(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function num(record: UnknownRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function round(value?: number, digits = 1): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sum(values: Array<number | undefined>): number {
  return values.reduce<number>((total, value) => total + (typeof value === "number" && Number.isFinite(value) ? value : 0), 0);
}

function avg(values: Array<number | undefined>): number | undefined {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return nums.length ? sum(nums) / nums.length : undefined;
}

function percentDelta(current?: number, previous?: number): number | undefined {
  if (current === undefined || previous === undefined || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

function dateString(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

async function safeGet(client: Pick<FitbitClient, "get">, endpoint: string): Promise<unknown> {
  try {
    return await client.get(endpoint);
  } catch (error) {
    return { error: (error as Error).message, endpoint };
  }
}

async function dailyBundle(client: Pick<FitbitClient, "get">, date: string) {
  const [activity, sleep, heart, hrv, weight] = await Promise.all([
    safeGet(client, `/1/user/-/activities/date/${date}.json`),
    safeGet(client, `/1.2/user/-/sleep/date/${date}.json`),
    safeGet(client, `/1/user/-/activities/heart/date/${date}/1d.json`),
    safeGet(client, `/1/user/-/hrv/date/${date}.json`),
    safeGet(client, `/1/user/-/body/log/weight/date/${date}.json`)
  ]);
  return { date, activity, sleep, heart, hrv, weight };
}

function dailyStats(bundle: Awaited<ReturnType<typeof dailyBundle>>) {
  const activity = isObject(bundle.activity) ? bundle.activity : {};
  const summary = isObject(activity.summary) ? activity.summary : {};
  const sleep = isObject(bundle.sleep) ? bundle.sleep : {};
  const sleepSummary = isObject(sleep.summary) ? sleep.summary : {};
  const heart = isObject(bundle.heart) ? bundle.heart : {};
  const heartSeries = Array.isArray(heart["activities-heart"]) ? heart["activities-heart"] as UnknownRecord[] : [];
  const heartValue = isObject(heartSeries[0]?.value) ? heartSeries[0].value as UnknownRecord : {};
  const hrv = isObject(bundle.hrv) ? bundle.hrv : {};
  const hrvSeries = Array.isArray(hrv.hrv) ? hrv.hrv as UnknownRecord[] : [];
  const hrvValue = isObject(hrvSeries[0]?.value) ? hrvSeries[0].value as UnknownRecord : {};

  return {
    date: bundle.date,
    steps: num(summary, ["steps"]),
    calories_out: num(summary, ["caloriesOut", "caloriesOutUnestimated"]),
    active_minutes: sum([num(summary, ["fairlyActiveMinutes"]), num(summary, ["veryActiveMinutes"])]),
    sedentary_minutes: num(summary, ["sedentaryMinutes"]),
    distance_km: firstDistanceKm(summary),
    resting_heart_rate: num(heartValue, ["restingHeartRate"]),
    sleep_minutes: num(sleepSummary, ["totalMinutesAsleep"]),
    sleep_efficiency: sleepSummary.efficiencyAverage ?? avgSleepEfficiency(sleep),
    hrv_rmssd: num(hrvValue, ["rmssd"]),
    has_activity_error: isObject(bundle.activity) && typeof bundle.activity.error === "string",
    has_sleep_error: isObject(bundle.sleep) && typeof bundle.sleep.error === "string",
    has_heart_error: isObject(bundle.heart) && typeof bundle.heart.error === "string",
    has_hrv_error: isObject(bundle.hrv) && typeof bundle.hrv.error === "string"
  };
}

function firstDistanceKm(summary: UnknownRecord): number | undefined {
  const distances = Array.isArray(summary.distances) ? summary.distances as UnknownRecord[] : [];
  const total = distances.find((entry) => entry.activity === "total");
  return total ? num(total, ["distance"]) : undefined;
}

function avgSleepEfficiency(sleep: UnknownRecord): number | undefined {
  const logs = Array.isArray(sleep.sleep) ? sleep.sleep as UnknownRecord[] : [];
  return avg(logs.map((log) => num(log, ["efficiency"])));
}

function classifyReadiness(stats: ReturnType<typeof dailyStats>): string {
  const sleepHours = (stats.sleep_minutes ?? 0) / 60;
  const active = stats.active_minutes ?? 0;
  if (sleepHours >= 7 && active <= 90) return "good_base";
  if (sleepHours < 6 && active >= 60) return "recovery_risk";
  if (sleepHours < 6) return "sleep_limited";
  if (active >= 120) return "high_load";
  return "neutral";
}

function buildActions(stats: ReturnType<typeof dailyStats>, weekly?: ReturnType<typeof aggregateStats>): string[] {
  const actions: string[] = [];
  const state = classifyReadiness(stats);
  if (state === "recovery_risk") actions.push("Keep intensity low today: sleep was short and activity load was meaningful.");
  if (state === "sleep_limited") actions.push("Prioritize sleep timing, light exposure and a lower-stimulation evening before adding training stress.");
  if (state === "high_load") actions.push("Protect joints and connective tissue: add mobility or zone 1/2 recovery before another hard day.");
  if (state === "good_base") actions.push("If subjective energy is good, this is a reasonable day for quality work or progressive aerobic volume.");
  if ((stats.resting_heart_rate ?? 0) > 0 && (stats.sleep_minutes ?? 0) < 360) actions.push("Watch resting heart rate alongside poor sleep; avoid interpreting one metric in isolation.");
  if (weekly?.avg_sleep_hours !== undefined && weekly.avg_sleep_hours < 6.5) actions.push("Weekly sleep average is below 6.5h; recovery improvements may beat training complexity.");
  actions.push("This is not medical advice; use Fitbit as trend context and escalate symptoms to a clinician.");
  return [...new Set(actions)];
}

function aggregateStats(days: ReturnType<typeof dailyStats>[]) {
  return {
    days: days.length,
    total_steps: round(sum(days.map((day) => day.steps)), 0),
    avg_steps: round(avg(days.map((day) => day.steps)), 0),
    avg_active_minutes: round(avg(days.map((day) => day.active_minutes)), 0),
    avg_sleep_hours: round(avg(days.map((day) => day.sleep_minutes).map((minutes) => minutes === undefined ? undefined : minutes / 60)), 2),
    avg_resting_heart_rate: round(avg(days.map((day) => day.resting_heart_rate)), 0),
    avg_hrv_rmssd: round(avg(days.map((day) => day.hrv_rmssd)), 1),
    days_with_sleep: days.filter((day) => day.sleep_minutes !== undefined).length,
    days_with_hrv: days.filter((day) => day.hrv_rmssd !== undefined).length
  };
}

export async function buildDailySummary(client: Pick<FitbitClient, "get">, options: SummaryOptions) {
  const date = dateString(0);
  const bundle = await dailyBundle(client, date);
  const stats = dailyStats(bundle);
  const readiness = classifyReadiness(stats);

  return {
    kind: "daily_summary" as const,
    generated_at: new Date().toISOString(),
    window: { date, days: options.days, timezone: options.timezone ?? "UTC" },
    data_quality: {
      confidence: [stats.has_activity_error, stats.has_sleep_error, stats.has_heart_error].filter(Boolean).length === 0 ? "high" : "partial",
      missing_or_failed: {
        activity: stats.has_activity_error,
        sleep: stats.has_sleep_error,
        heart: stats.has_heart_error,
        hrv: stats.has_hrv_error
      }
    },
    scorecard: stats,
    diagnostic: {
      readiness_context: readiness,
      primary_signal: readiness === "recovery_risk" ? "Load and sleep are misaligned; recovery discipline matters today." : "Use Fitbit trends as a practical readiness context, not a diagnosis.",
      action_candidates: buildActions(stats)
    },
    safety: {
      medical_advice: false,
      api_boundary: "Fitbit Web API provides processed activity, sleep, heart and body metrics; it does not provide raw accelerometer telemetry through this MCP."
    }
  };
}

export async function buildWeeklySummary(client: Pick<FitbitClient, "get">, options: SummaryOptions) {
  const days = Math.max(options.days, 7);
  const compareDays = options.compare_days ?? 7;
  const currentBundles = await Promise.all(Array.from({ length: days }, (_, index) => dailyBundle(client, dateString(index))));
  const current = currentBundles.map(dailyStats).reverse();
  const previous = compareDays > 0
    ? (await Promise.all(Array.from({ length: compareDays }, (_, index) => dailyBundle(client, dateString(days + index))))).map(dailyStats).reverse()
    : [];
  const currentStats = aggregateStats(current);
  const previousStats = previous.length ? aggregateStats(previous) : undefined;

  return {
    kind: "weekly_summary" as const,
    generated_at: new Date().toISOString(),
    window: { days, compare_days: compareDays, timezone: options.timezone ?? "UTC" },
    data_quality: {
      days_with_activity: current.filter((day) => day.steps !== undefined).length,
      days_with_sleep: currentStats.days_with_sleep,
      days_with_hrv: currentStats.days_with_hrv,
      confidence: currentStats.days_with_sleep >= 5 ? "high" : currentStats.days_with_sleep >= 3 ? "medium" : "low"
    },
    scorecard: {
      current: currentStats,
      previous: previousStats,
      delta: previousStats ? {
        steps_pct: round(percentDelta(currentStats.avg_steps, previousStats.avg_steps), 1),
        active_minutes_pct: round(percentDelta(currentStats.avg_active_minutes, previousStats.avg_active_minutes), 1),
        sleep_hours_pct: round(percentDelta(currentStats.avg_sleep_hours, previousStats.avg_sleep_hours), 1),
        resting_hr_pct: round(percentDelta(currentStats.avg_resting_heart_rate, previousStats.avg_resting_heart_rate), 1),
        hrv_pct: round(percentDelta(currentStats.avg_hrv_rmssd, previousStats.avg_hrv_rmssd), 1)
      } : undefined
    },
    diagnostic: {
      load_classification: classifyWeeklyLoad(currentStats),
      bottlenecks: inferBottlenecks(currentStats, previousStats),
      action_candidates: buildActions(current[current.length - 1] ?? current[0], currentStats),
      next_week_success_metrics: [
        "Keep sleep average above the user's sustainable baseline before increasing intensity.",
        "Track active minutes and resting heart rate together, not in isolation.",
        "Use HRV only when enough days are available; sparse HRV should be treated as low confidence.",
        "If symptoms, illness or abnormal vitals appear, seek clinical guidance instead of agent optimization."
      ]
    },
    safety: {
      medical_advice: false,
      raw_sensor_boundary: "Fitbit MCP exposes processed API data and optional intraday heart-rate samples where permitted, not raw device telemetry."
    }
  };
}

function classifyWeeklyLoad(stats: ReturnType<typeof aggregateStats>): string {
  const active = stats.avg_active_minutes ?? 0;
  const sleep = stats.avg_sleep_hours ?? 0;
  if (active >= 90 && sleep < 6.5) return "high_load_low_sleep";
  if (active >= 90) return "high_load";
  if (sleep < 6.5) return "sleep_limited";
  if (active >= 35) return "moderate";
  return "light";
}

function inferBottlenecks(current: ReturnType<typeof aggregateStats>, previous?: ReturnType<typeof aggregateStats>): string[] {
  const bottlenecks: string[] = [];
  const activeDelta = percentDelta(current.avg_active_minutes, previous?.avg_active_minutes);
  const sleepDelta = percentDelta(current.avg_sleep_hours, previous?.avg_sleep_hours);
  if ((current.avg_sleep_hours ?? 0) < 6.5) bottlenecks.push("Average sleep is below 6.5h; recovery may be the limiting factor.");
  if (activeDelta !== undefined && activeDelta > 35) bottlenecks.push("Active minutes increased sharply versus the comparison window.");
  if (sleepDelta !== undefined && sleepDelta < -10) bottlenecks.push("Sleep duration decreased materially versus the comparison window.");
  if (current.days_with_hrv < 3) bottlenecks.push("HRV data is sparse; do not over-weight HRV conclusions.");
  if (!bottlenecks.length) bottlenecks.push("No obvious Fitbit-only bottleneck; combine trends with subjective energy, soreness and life stress.");
  return bottlenecks;
}

export function formatSummaryMarkdown(summary: Record<string, unknown>): string {
  const lines = [`# Fitbit ${summary.kind === "weekly_summary" ? "Weekly" : "Daily"} Summary`, ""];
  lines.push(`Generated: ${summary.generated_at}`);
  const diagnostic = summary.diagnostic as { primary_signal?: string; load_classification?: string; readiness_context?: string; action_candidates?: string[]; bottlenecks?: string[] } | undefined;
  if (diagnostic?.primary_signal) lines.push(`\n## Primary signal\n${diagnostic.primary_signal}`);
  if (diagnostic?.readiness_context) lines.push(`\n## Readiness context\n${diagnostic.readiness_context}`);
  if (diagnostic?.load_classification) lines.push(`\n## Load\n${diagnostic.load_classification}`);
  if (diagnostic?.bottlenecks?.length) {
    lines.push("\n## Bottlenecks");
    diagnostic.bottlenecks.forEach((item) => lines.push(`- ${item}`));
  }
  if (diagnostic?.action_candidates?.length) {
    lines.push("\n## Action candidates");
    diagnostic.action_candidates.forEach((item) => lines.push(`- ${item}`));
  }
  lines.push("\n## Structured data");
  lines.push("```json");
  lines.push(JSON.stringify(summary, null, 2));
  lines.push("```");
  return lines.join("\n");
}
