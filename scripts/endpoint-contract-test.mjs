import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FitbitClient } from '../dist/services/fitbit-client.js';

const dir = mkdtempSync(join(tmpdir(), 'fitbit-mcp-endpoint-contract-'));
const tokenPath = join(dir, 'tokens.json');
writeFileSync(tokenPath, JSON.stringify({ access_token: 'synthetic-token' }), { mode: 0o600 });

const config = {
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
  redirectUri: 'http://127.0.0.1/callback',
  scopes: [],
  tokenPath,
  privacyMode: 'structured',
  cacheEnabled: false,
  cachePath: join(dir, 'cache.sqlite'),
};
const client = new FitbitClient(config);

const originalFetch = globalThis.fetch;
const originalNoCache = process.env.FITBIT_NO_CACHE;
const requestedUrls = [];
process.env.FITBIT_NO_CACHE = 'true';

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  requestedUrls.push(url);
  return Response.json({ activities: [{ logId: 123, activityName: 'Run' }] });
};

try {
  const failures = [];

  const afterResult = await client.list('/1/user/-/activities/list.json', {
    after: '2026-07-08T23:00:00-03:00',
  });
  try {
    const afterUrl = requestedUrls.at(-1);
    assert.equal(afterUrl.searchParams.get('afterDate'), '2026-07-08');
    assert.equal(afterUrl.searchParams.get('beforeDate'), null);
    assert.equal(afterUrl.searchParams.get('sort'), 'asc');
    assert.equal(afterResult.records[0].logId, 123);
  } catch (error) {
    failures.push(error);
  }

  await client.list('/1/user/-/activities/list.json', {
    before: '2026-07-15T23:00:00-03:00',
  });
  try {
    const beforeUrl = requestedUrls.at(-1);
    assert.equal(beforeUrl.searchParams.get('beforeDate'), '2026-07-15');
    assert.equal(beforeUrl.searchParams.get('afterDate'), null);
    assert.equal(beforeUrl.searchParams.get('sort'), 'desc');
  } catch (error) {
    failures.push(error);
  }

  const fetchCountBeforeInvalid = requestedUrls.length;
  for (const params of [
    { after: 'not-a-date' },
    { after: '2026-07-08T00:00:00Z', before: '2026-07-15T00:00:00Z' },
  ]) {
    try {
      await assert.rejects(
        client.list('/1/user/-/activities/list.json', params),
        /Invalid Fitbit date cursor|Fitbit list accepts either after or before/,
      );
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    assert.equal(requestedUrls.length, fetchCountBeforeInvalid, 'invalid cursors must fail before HTTP');
  } catch (error) {
    failures.push(error);
  }

  // Full single page must advertise the *next* page, not the current one.
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    return Response.json({
      activities: Array.from({ length: 20 }, (_, i) => ({ logId: 2000 + i, activityName: `Run ${i}` })),
    });
  };
  try {
    const page1 = await client.list('/1/user/-/activities/list.json', { limit: 20, page: 1 });
    assert.equal(page1.records.length, 20);
    assert.equal(page1.next_page, 2, 'full page 1 must set next_page=2');
    assert.equal(page1.pages_fetched, 1);

    const page3 = await client.list('/1/user/-/activities/list.json', { limit: 20, page: 3 });
    assert.equal(page3.next_page, 4, 'full page 3 must set next_page=4');
  } catch (error) {
    failures.push(error);
  }

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    return Response.json({
      activities: Array.from({ length: 20 }, (_, i) => ({ logId: 3000 + i, activityName: `Walk ${i}` })),
    });
  };
  try {
    const multi = await client.list('/1/user/-/activities/list.json', { limit: 20, all_pages: true, max_pages: 2 });
    assert.equal(multi.records.length, 40);
    assert.equal(multi.pages_fetched, 2);
    assert.equal(multi.next_page, 3, 'after two full pages next_page must be 3');
  } catch (error) {
    failures.push(error);
  }

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    return Response.json({ activities: [{ logId: 1, activityName: 'Partial' }] });
  };
  try {
    const partial = await client.list('/1/user/-/activities/list.json', { limit: 20, page: 1 });
    assert.equal(partial.next_page, undefined, 'partial page must not set next_page');
  } catch (error) {
    failures.push(error);
  }

  // Civil-date helper: ISO date-times reduce to the written calendar day.
  try {
    const { toFitbitCivilDate } = await import('../dist/services/fitbit-client.js');
    assert.equal(toFitbitCivilDate('2026-07-08'), '2026-07-08');
    assert.equal(toFitbitCivilDate('2026-07-08T23:00:00-03:00'), '2026-07-08');
    assert.equal(toFitbitCivilDate('today'), 'today');
    await assert.rejects(async () => toFitbitCivilDate('not-a-date'), /Invalid Fitbit date/);
  } catch (error) {
    failures.push(error);
  }

  if (failures.length) throw new AggregateError(failures, 'Fitbit endpoint contract regressions');
  // Exercise the real authenticated request path; cache operations are a generic
  // method+URL Map double. No SQLite constructor, token refresh or network runs.
  const persistentCases = [
    { name: 'initial success', cacheEnabled: true, outcome: 'success' },
    { name: 'refreshed success', cacheEnabled: true, refresh: true, outcome: 'success' },
    { name: 'initial HTTP error', cacheEnabled: true, outcome: 'http' },
    { name: 'refreshed HTTP error', cacheEnabled: true, refresh: true, outcome: 'http' },
    { name: 'same credential HTTP error', cacheEnabled: true, sameCredential: true, outcome: 'http' },
    { name: 'disabled cache HTTP error', cacheEnabled: false, outcome: 'http' },
    { name: 'transport error', cacheEnabled: true, outcome: 'transport' },
    { name: 'response read error', cacheEnabled: true, outcome: 'read' },
  ];
  for (const scenario of persistentCases) {
    const scoped = new FitbitClient({ ...config, cacheEnabled: scenario.cacheEnabled });
    const url = 'https://api.fitbit.com/1/user/-/profile.json';
    const key = `GET ${url}`;
    const stale = { marker: 'synthetic-existing-cache-entry' };
    const cached = new Map([[key, stale]]);
    const calls = { opens: 0, gets: 0, sets: 0, refreshes: 0, requests: [] };
    const storage = {
      get(method, requestUrl) { calls.gets++; return cached.get(`${method} ${requestUrl}`); },
      set(method, requestUrl, payload) { calls.sets++; cached.set(`${method} ${requestUrl}`, payload); },
    };
    scoped.getCache = () => { calls.opens++; return storage; };
    let credential = 'synthetic-A';
    scoped.getValidToken = async () => ({ access_token: credential });
    scoped.refreshToken = async () => { calls.refreshes++; return { access_token: 'synthetic-refreshed' }; };
    const error = new Error(`synthetic ${scenario.outcome} failure`);
    let phase = 'first';
    scoped.fetchWithRetry = async (requestUrl, init) => {
      calls.requests.push({ url: requestUrl, authorization: new Headers(init.headers).get('Authorization') });
      if (phase === 'first') return Response.json({ marker: 'synthetic-fresh-A' });
      if (scenario.refresh && calls.refreshes === 0) return new Response('', { status: 401 });
      if (scenario.outcome === 'transport') throw error;
      if (scenario.outcome === 'read') {
        const response = new Response('', { status: 200 });
        response.text = async () => { throw error; };
        return response;
      }
      if (scenario.outcome === 'http') return Response.json({ message: 'synthetic unavailable' }, { status: 503 });
      return Response.json({ marker: 'synthetic-fresh-B' });
    };
    assert.deepEqual(await scoped.get('/1/user/-/profile.json'), { marker: 'synthetic-fresh-A' }, scenario.name);
    phase = 'second';
    if (!scenario.sameCredential) credential = 'synthetic-B';
    if (scenario.outcome === 'success') {
      assert.deepEqual(await scoped.get('/1/user/-/profile.json'), { marker: 'synthetic-fresh-B' }, scenario.name);
    } else if (scenario.outcome === 'http') {
      await assert.rejects(() => scoped.get('/1/user/-/profile.json'), /Fitbit API HTTP 503/, scenario.name);
    } else {
      await assert.rejects(() => scoped.get('/1/user/-/profile.json'), observed => observed === error, scenario.name);
    }
    assert.equal(calls.opens, 0, `${scenario.name}: authenticated payloads must not open persistent cache`);
    assert.equal(calls.gets, 0, `${scenario.name}: authenticated errors must not read fallback`);
    assert.equal(calls.sets, 0, `${scenario.name}: authenticated successes must not persist payloads`);
    assert.deepEqual([...cached.entries()], [[key, stale]], `${scenario.name}: existing cache entries stay untouched`);
    assert.equal(calls.refreshes, scenario.refresh ? 1 : 0, scenario.name);
    assert.deepEqual(calls.requests.map(r => r.url), Array(scenario.refresh ? 3 : 2).fill(url), scenario.name);
    assert.deepEqual(calls.requests.map(r => r.authorization), [
      'Bearer synthetic-A',
      scenario.sameCredential ? 'Bearer synthetic-A' : 'Bearer synthetic-B',
      ...(scenario.refresh ? ['Bearer synthetic-refreshed'] : []),
    ], scenario.name);
  }
  // Status must describe containment without opening or inspecting SQLite.
  for (const configured of [false, true]) {
    const statusClient = new FitbitClient({ ...config, cacheEnabled: configured });
    statusClient.getCache = () => { throw new Error('status must not open SQLite'); };
    const status = statusClient.cacheStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.configured, configured);
    assert.equal(status.authenticated_requests_bypass, true);
    assert.equal(status.existing_entries_preserved, true);
    assert.equal(status.entries_inspected, false);
    assert.equal(Object.hasOwn(status, 'entries'), false, 'uninspected stored entry count must be omitted');
    assert.equal(status.path, config.cachePath);
    assert.match(status.reason, /authenticated payload caching and offline fallback are disabled/i);
    assert.equal(status.http_cache.default_ttl_seconds, 60);
    assert.equal(typeof status.http_cache.hit_count, 'number');
    assert.equal(typeof status.http_cache.miss_count, 'number');
  }
  console.log(JSON.stringify({ ok: true, suite: 'endpoint-contracts', requests: requestedUrls.length, persistent_cases: persistentCases.length }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (originalNoCache === undefined) delete process.env.FITBIT_NO_CACHE;
  else process.env.FITBIT_NO_CACHE = originalNoCache;
  rmSync(dir, { recursive: true, force: true });
}
