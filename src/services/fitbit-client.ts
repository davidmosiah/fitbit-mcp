import { URL, URLSearchParams } from "node:url";
import { DEFAULT_LIMIT, FITBIT_API_BASE_URL, FITBIT_AUTH_URL, FITBIT_REVOKE_URL, FITBIT_TOKEN_URL, MAX_FITBIT_LIMIT } from "../constants.js";
import type { FitbitConfig, FitbitTokenSet } from "../types.js";
import { disabledCacheStatus, FitbitCache, type CacheStatus } from "./cache.js";
import { fetchWithRetry as fetchWithRetryMiddleware } from "./http-retry.js";
import { redactErrorMessage } from "./redaction.js";
import { TokenStore } from "./token-store.js";

export interface ListParams {
  after?: string;
  before?: string;
  page?: number;
  limit?: number;
  all_pages?: boolean;
  max_pages?: number;
}

export class FitbitClient {
  private readonly tokenStore: TokenStore;
  private cache?: FitbitCache;

  constructor(private readonly config: FitbitConfig) {
    this.tokenStore = new TokenStore(config.tokenPath);
  }

  authUrl(state?: string, scopes?: string[]): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: (scopes?.length ? scopes : this.config.scopes).join(" "),
      expires_in: "604800"
    });
    if (state) params.set("state", state);
    return `${FITBIT_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(input: string): Promise<{ ok: true; token_path: string; scope?: string; expires_at?: number }> {
    const code = this.extractCode(input);
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri
    });
    const tokens = await this.requestTokens(body);
    const redirectScope = this.extractScope(input);
    await this.tokenStore.withLock(async () => this.tokenStore.write({ ...tokens, scope: tokens.scope ?? redirectScope }));
    return { ok: true, token_path: this.config.tokenPath, scope: tokens.scope ?? redirectScope, expires_at: tokens.expires_at };
  }

  async get(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("GET", path, undefined, params);
  }

  async post(path: string, body?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.request("POST", path, body);
  }

  async revokeAccess(): Promise<{ ok: true; token_path: string; local_tokens_cleared: boolean }> {
    const token = await this.getValidToken();
    const body = new URLSearchParams({ token: token.access_token });
    const response = await this.fetchWithRetry(FITBIT_REVOKE_URL, {
      method: "POST",
      headers: this.formHeaders(),
      body: body.toString()
    });
    await this.parseResponse(response);
    await this.tokenStore.withLock(async () => this.tokenStore.clear());
    return { ok: true, token_path: this.config.tokenPath, local_tokens_cleared: true };
  }

  cacheStatus(): CacheStatus {
    if (!this.config.cacheEnabled) return disabledCacheStatus(this.config.cachePath);
    return this.getCache().status();
  }

  async list(path: string, params: ListParams = {}): Promise<{ records: unknown[]; next_page?: number; pages_fetched: number }> {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_FITBIT_LIMIT);
    const maxPages = params.all_pages ? Math.max(1, params.max_pages ?? 1) : 1;
    const records: unknown[] = [];
    let offset = Math.max(((params.page ?? 1) - 1) * limit, 0);
    let pages = 0;

    while (pages < maxPages) {
      const payload = await this.get(path, {
        ...fitbitDateCursor(params),
        sort: params.before ? "asc" : "desc",
        offset,
        limit
      });
      const pageRecords = extractRecords(payload);
      records.push(...pageRecords);
      pages += 1;
      if (!params.all_pages || pageRecords.length < limit) break;
      offset += limit;
    }

    return { records, next_page: records.length && records.length % limit === 0 ? Math.floor(offset / limit) + 1 : undefined, pages_fetched: pages };
  }

  private extractCode(input: string): string {
    try {
      const url = new URL(input);
      const code = url.searchParams.get("code");
      if (code) return code;
    } catch {
      // Not a URL; treat as raw code.
    }
    return input;
  }

  private extractScope(input: string): string | undefined {
    try {
      const url = new URL(input);
      return url.searchParams.get("scope") ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async request(method: "GET" | "POST", path: string, body?: Record<string, string | number | boolean | undefined>, params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    const token = await this.getValidToken();
    const url = this.buildUrl(path, params);
    const response = await this.fetchWithRetry(url, {
      method,
      headers: this.jsonHeaders(token.access_token),
      body: body ? JSON.stringify(cleanParams(body)) : undefined
    });

    if (response.status === 401) {
      const refreshed = await this.refreshToken(true);
      const retry = await this.fetchWithRetry(url, {
        method,
        headers: this.jsonHeaders(refreshed.access_token),
        body: body ? JSON.stringify(cleanParams(body)) : undefined
      });
      return this.parseAndCache(method, url, retry);
    }

    return this.parseAndCache(method, url, response);
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${FITBIT_API_BASE_URL}${cleanPath}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  private async getValidToken(): Promise<FitbitTokenSet> {
    const tokens = await this.tokenStore.read();
    if (!tokens?.access_token) {
      throw new Error("Fitbit token not found. Run fitbit-mcp-server auth, or use fitbit_get_auth_url then fitbit_exchange_code.");
    }
    const expiresAt = tokens.expires_at ?? 0;
    const shouldRefresh = Boolean(tokens.refresh_token && expiresAt && expiresAt - Math.floor(Date.now() / 1000) < 3600);
    return shouldRefresh ? this.refreshToken(false) : tokens;
  }

  private async refreshToken(force: boolean): Promise<FitbitTokenSet> {
    return this.tokenStore.withLock(async () => {
      const current = await this.tokenStore.read();
      if (!current?.refresh_token) {
        throw new Error("Fitbit refresh token not found. Re-authorize with fitbit-mcp-server auth.");
      }
      if (!force && current.expires_at && current.expires_at - Math.floor(Date.now() / 1000) >= 3600) return current;

      const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: current.refresh_token });
      const refreshed = await this.requestTokens(body);
      await this.tokenStore.write({ ...current, ...refreshed });
      return { ...current, ...refreshed };
    });
  }

  private async requestTokens(body: URLSearchParams): Promise<FitbitTokenSet> {
    const response = await this.fetchWithRetry(FITBIT_TOKEN_URL, {
      method: "POST",
      headers: this.formHeaders(),
      body: body.toString()
    });
    const data = await this.parseResponse(response) as Record<string, unknown>;
    const expiresAt = typeof data.expires_at === "number"
      ? data.expires_at
      : typeof data.expires_in === "number"
        ? Math.floor(Date.now() / 1000) + data.expires_in
        : undefined;
    return {
      access_token: String(data.access_token ?? ""),
      refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      token_type: typeof data.token_type === "string" ? data.token_type : undefined,
      scope: typeof data.scope === "string" ? data.scope : undefined,
      expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
      expires_at: expiresAt
    };
  }

  private jsonHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Language": "en_US",
      "User-Agent": "fitbit-mcp-server/0.1.0"
    };
  }

  private formHeaders(): Record<string, string> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    return {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "Accept-Language": "en_US",
      "User-Agent": "fitbit-mcp-server/0.1.0"
    };
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    const payload = text ? safeJson(text) : null;
    if (!response.ok) {
      const details = payload && typeof payload === "object" ? JSON.stringify(payload) : text;
      throw new Error(`Fitbit API HTTP ${response.status}: ${redactErrorMessage(details || response.statusText)}`);
    }
    return payload ?? {};
  }

  private async parseAndCache(method: "GET" | "POST", url: string, response: Response): Promise<unknown> {
    try {
      const payload = await this.parseResponse(response);
      if (this.config.cacheEnabled && method === "GET") this.getCache().set(method, url, payload);
      return payload;
    } catch (error) {
      if (this.config.cacheEnabled && method === "GET") {
        const cached = this.getCache().get(method, url);
        if (cached !== undefined) return cached;
      }
      throw error;
    }
  }

  private getCache(): FitbitCache {
    this.cache ??= new FitbitCache(this.config.cachePath);
    return this.cache;
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    return fetchWithRetryMiddleware(fetch, url, init, {
      vendor: "fitbit",
      envFlag: "FITBIT_NO_RETRY"
    });
  }
}

function fitbitDateCursor(params: ListParams): Record<string, string> {
  if (params.after) return { afterDate: toDate(params.after) };
  if (params.before) return { beforeDate: toDate(params.before) };
  return { beforeDate: "today" };
}

function toDate(value: string): string {
  if (value === "today") return value;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value.slice(0, 10);
  return new Date(parsed).toISOString().slice(0, 10);
}

function extractRecords(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["activities", "sleep", "weight", "fat", "foods", "water", "devices", "goals", "records"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function cleanParams(input: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== "")) as Record<string, string | number | boolean>;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
