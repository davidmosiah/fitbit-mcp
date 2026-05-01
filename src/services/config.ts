import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SCOPES } from "../constants.js";
import type { PrivacyMode, FitbitConfig } from "../types.js";
import { loadConfigSources } from "./local-config.js";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

export function getConfig(): FitbitConfig {
  const sources = loadConfigSources(process.env, homedir());
  const value = (name: keyof typeof sources.values) => env(name) ?? sources.values[name];
  const clientId = value("FITBIT_CLIENT_ID");
  const clientSecret = value("FITBIT_CLIENT_SECRET");
  const redirectUri = value("FITBIT_REDIRECT_URI");
  const tokenPath = value("FITBIT_TOKEN_PATH") ?? join(homedir(), ".fitbit-mcp", "tokens.json");
  const cachePath = value("FITBIT_CACHE_PATH") ?? join(homedir(), ".fitbit-mcp", "cache.sqlite");
  const scopes = (value("FITBIT_SCOPES")?.split(/[ ,]+/).filter(Boolean)) ?? DEFAULT_SCOPES;
  const privacyMode = parsePrivacyMode(value("FITBIT_PRIVACY_MODE"));
  const cacheEnabled = parseBool(value("FITBIT_CACHE"), false);

  const missing = [
    ["FITBIT_CLIENT_ID", clientId],
    ["FITBIT_CLIENT_SECRET", clientSecret],
    ["FITBIT_REDIRECT_URI", redirectUri]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Missing required FITBIT environment variables: ${missing.join(", ")}. ` +
      "Create an app at https://dev.fitbit.com/apps and set these variables before using Fitbit tools."
    );
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: redirectUri!,
    scopes,
    tokenPath,
    privacyMode,
    cacheEnabled,
    cachePath
  };
}

function parsePrivacyMode(value: string | undefined): PrivacyMode {
  if (value === "summary" || value === "structured" || value === "raw") return value;
  return "structured";
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on", "sqlite"].includes(value.toLowerCase());
}
