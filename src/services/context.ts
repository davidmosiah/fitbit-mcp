import type { FitbitClient } from "./fitbit-client.js";
import { buildDailySummary, type SummaryOptions } from "./summary.js";

type ContextOptions = SummaryOptions & { soreness?: string[]; injury_flags?: string[]; notes?: string };
type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function loadFromActiveMinutes(activeMinutes?: number): "low" | "normal" | "high" | "unknown" {
  if (activeMinutes === undefined) return "unknown";
  if (activeMinutes >= 120) return "high";
  if (activeMinutes <= 20) return "low";
  return "normal";
}

export async function buildWellnessContext(client: Pick<FitbitClient, "get">, options: ContextOptions) {
  const summary = await buildDailySummary(client as FitbitClient, options);
  const scorecard = record(summary.scorecard);
  const sleepEfficiency = num(scorecard.sleep_efficiency);
  const activeMinutes = num(scorecard.active_minutes);
  const recentTrainingLoad = loadFromActiveMinutes(activeMinutes);

  return {
    source: "fitbit",
    generated_at: summary.generated_at,
    sleep_score: sleepEfficiency,
    recent_training_load: recentTrainingLoad,
    soreness: options.soreness ?? [],
    injury_flags: options.injury_flags ?? [],
    notes: [options.notes].filter((note): note is string => Boolean(note)),
    data_quality: summary.data_quality,
    telegram_summary: [
      "Fitbit wellness context",
      sleepEfficiency !== undefined ? `Sleep: ${sleepEfficiency}` : undefined,
      `Load: ${recentTrainingLoad}`
    ].filter(Boolean).join(" | ")
  };
}

export function formatWellnessContextMarkdown(context: Record<string, unknown>): string {
  return ["# Fitbit Wellness Context", "", JSON.stringify(context, null, 2)].join("\n");
}
