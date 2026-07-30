import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FitbitClient } from '../dist/services/fitbit-client.js';

const dir = mkdtempSync(join(tmpdir(), 'fitbit-mcp-endpoint-contract-'));
const tokenPath = join(dir, 'tokens.json');
writeFileSync(tokenPath, JSON.stringify({ access_token: 'synthetic-token' }), { mode: 0o600 });

const client = new FitbitClient({
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
  redirectUri: 'http://127.0.0.1/callback',
  scopes: [],
  tokenPath,
  privacyMode: 'structured',
  cacheEnabled: false,
  cachePath: join(dir, 'cache.sqlite'),
});

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
  console.log(JSON.stringify({ ok: true, suite: 'endpoint-contracts', requests: requestedUrls.length }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (originalNoCache === undefined) delete process.env.FITBIT_NO_CACHE;
  else process.env.FITBIT_NO_CACHE = originalNoCache;
  rmSync(dir, { recursive: true, force: true });
}
