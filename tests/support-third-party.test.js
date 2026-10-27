const test = require('node:test');
const assert = require('node:assert/strict');
const { createStatusApi } = require('../support-third-party');

test('GitHub Status integration parses a live response and caches it for one minute', async () => {
  let calls = 0;
  const api = createStatusApi({
    now: () => 1000 + calls * 100,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => ({ page: { updated_at: '2026-10-27T00:00:00Z' }, status: { indicator: 'none', description: 'All Systems Operational' } }) };
    }
  });
  assert.equal((await api.getStatus()).source, 'live');
  await api.getStatus();
  assert.equal(calls, 1);
});

test('public status errors fall back without claiming a live outage', async () => {
  const api = createStatusApi({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  const result = await api.getStatus();
  assert.equal(result.source, 'fallback');
  assert.equal(result.available, false);
  assert.match(result.description, /temporarily unavailable/);
});

test('public status requests abort after the configured timeout', async () => {
  const api = createStatusApi({
    timeoutMs: 250,
    fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    })
  });
  const result = await api.getStatus();
  assert.equal(result.source, 'fallback');
  assert.equal(result.available, false);
});
