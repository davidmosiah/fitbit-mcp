import type { PrivacyMode, FitbitConfig } from "../types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pickDefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
}

export function resolvePrivacyMode(config: FitbitConfig, override?: PrivacyMode): PrivacyMode {
  return override ?? config.privacyMode;
}

export function applyPrivacy(endpoint: string, payload: unknown, mode: PrivacyMode): unknown {
  if (mode === "raw") return payload;
  if (isObject(payload) && Array.isArray(payload.records)) {
    return { ...payload, privacy_mode: mode, records: payload.records.map((record) => normalizeRecord(endpoint, record, mode)) };
  }
  if (Array.isArray(payload)) return payload.map((record) => normalizeRecord(endpoint, record, mode));
  return normalizeRecord(endpoint, payload, mode);
}

export function normalizeRecord(endpoint: string, record: unknown, mode: PrivacyMode): unknown {
  if (!isObject(record)) return record;
  if (endpoint.includes("profile")) return normalizeProfile(record, mode);
  if (endpoint.includes("devices")) return normalizeDevices(record, mode);
  if (endpoint.includes("activities/list")) return normalizeActivity(record, mode);
  if (endpoint.includes("activities/") && !endpoint.includes("heart")) return normalizeActivityDetail(record, mode);
  if (endpoint.includes("sleep")) return normalizeSleep(record, mode);
  if (endpoint.includes("heart") || endpoint.includes("hrv") || endpoint.includes("spo2") || endpoint.includes("/br/")) return normalizeVitals(record, mode);
  if (endpoint.includes("body/log/weight")) return normalizeWeight(record, mode);
  if (endpoint.includes("foods/log")) return normalizeNutrition(record, mode);
  return mode === "summary" ? summarizeUnknown(record) : removeSensitive(record);
}

export function normalizeStreams(payload: unknown, mode: PrivacyMode, includeGps: boolean): unknown {
  if (mode === "raw") return payload;
  if (!isObject(payload)) return payload;
  const clean = removeSensitive(payload);
  if (!includeGps) { delete clean["activities-tracker-gps"]; delete clean.latlng; delete clean.gps; }
  if (mode === "summary") return summarizeUnknown(clean);
  return clean;
}

function normalizeProfile(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const user = isObject(record.user) ? record.user : record;
  const base = pickDefined({
    encodedId: user.encodedId,
    displayName: user.displayName,
    memberSince: user.memberSince,
    timezone: user.timezone,
    locale: user.locale,
    clockTimeDisplayFormat: user.clockTimeDisplayFormat,
    distanceUnit: user.distanceUnit,
    weightUnit: user.weightUnit
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...user, email: undefined, avatar: undefined, avatar150: undefined });
}

function normalizeDevices(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const devices = Array.isArray(record) ? record : [record];
  const normalized = devices.map((device) => isObject(device) ? pickDefined({
    id: mode === "summary" ? undefined : device.id,
    deviceVersion: device.deviceVersion,
    type: device.type,
    battery: device.battery,
    lastSyncTime: device.lastSyncTime
  }) : device);
  return Array.isArray(record) ? normalized : normalized[0];
}

function normalizeActivity(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    activityId: record.activityId,
    logId: record.logId,
    name: record.name,
    activityName: record.activityName,
    startTime: record.startTime,
    duration: record.duration,
    distance: record.distance,
    steps: record.steps,
    calories: record.calories,
    activeDuration: record.activeDuration,
    averageHeartRate: record.averageHeartRate
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeActivityDetail(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  if (mode === "summary") return normalizeActivity(record, mode);
  return removeSensitive(record);
}

function normalizeSleep(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  if (Array.isArray(record.sleep)) return { ...record, sleep: record.sleep.map((item) => isObject(item) ? normalizeSleepLog(item, mode) : item) };
  return normalizeSleepLog(record, mode);
}

function normalizeSleepLog(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    logId: record.logId,
    dateOfSleep: record.dateOfSleep,
    startTime: record.startTime,
    endTime: record.endTime,
    duration: record.duration,
    minutesAsleep: record.minutesAsleep,
    minutesAwake: record.minutesAwake,
    efficiency: record.efficiency,
    type: record.type
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeVitals(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  if (mode === "summary") return summarizeUnknown(record);
  return removeSensitive(record);
}

function normalizeWeight(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  if (Array.isArray(record.weight)) return { weight: record.weight.map((item) => isObject(item) ? normalizeWeight(item, mode) : item) };
  return mode === "summary" ? pickDefined({ date: record.date, weight: record.weight, bmi: record.bmi }) : removeSensitive(record);
}

function normalizeNutrition(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  if (mode === "summary") return summarizeUnknown(record);
  return removeSensitive(record);
}

function summarizeUnknown(record: Record<string, unknown>): Record<string, unknown> {
  return pickDefined({
    id: record.id ?? record.logId ?? record.activityId,
    date: record.date ?? record.dateTime ?? record.dateOfSleep,
    name: record.name ?? record.activityName,
    summary: record.summary,
    value: record.value
  });
}

function removeSensitive(record: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...record };
  for (const key of ["email", "fullName", "firstName", "lastName", "avatar", "avatar150", "features", "access_token", "refresh_token", "start_latlng", "end_latlng", "latlng", "map", "polyline", "summary_polyline", "gps", "tcxLink"] ) delete clone[key];
  return clone;
}
