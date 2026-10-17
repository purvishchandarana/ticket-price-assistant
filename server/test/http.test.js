import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError, createHttpClient, parseRetryAfter, redactUrl } from '../src/lib/http.js';

const jsonResponse = (status, body = {}, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('http client', () => {
  it('redacts secrets from URLs', () => {
    const safe = redactUrl('https://api.example.test/x?apikey=SECRET&keyword=a&client_secret=S2');
    assert.ok(!safe.includes('SECRET'));
    assert.ok(!safe.includes('S2'));
    assert.ok(safe.includes('keyword=a'));
  });

  it('parses Retry-After seconds and caps long waits', () => {
    assert.equal(parseRetryAfter('2'), 2000);
    assert.equal(parseRetryAfter('3600'), 30_000);
    assert.equal(parseRetryAfter(null), null);
    assert.equal(parseRetryAfter('garbage'), null);
  });

  it('retries 429 using Retry-After, then succeeds', async () => {
    const sleeps = [];
    const responses = [jsonResponse(429, {}, { 'retry-after': '1' }), jsonResponse(200, { ok: 1 })];
    const http = createHttpClient({
      minIntervalMs: 0,
      fetchImpl: async () => responses.shift(),
      sleep: async (ms) => sleeps.push(ms),
    });
    assert.deepEqual(await http.getJson('https://api.example.test/a'), { ok: 1 });
    assert.deepEqual(sleeps, [1000]);
  });

  it('gives up after maxRetries and never leaks the key in the error', async () => {
    let calls = 0;
    const http = createHttpClient({
      minIntervalMs: 0,
      maxRetries: 2,
      fetchImpl: async () => { calls++; return jsonResponse(500); },
      sleep: async () => {},
    });
    await assert.rejects(http.getJson('https://api.example.test/a?apikey=SECRET'), (err) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.status, 500);
      assert.ok(!err.url.includes('SECRET'));
      return true;
    });
    assert.equal(calls, 3);
  });

  it('does not retry client errors', async () => {
    let calls = 0;
    const http = createHttpClient({ minIntervalMs: 0, fetchImpl: async () => { calls++; return jsonResponse(401); } });
    await assert.rejects(http.getJson('https://api.example.test/a'), { status: 401 });
    assert.equal(calls, 1);
  });

  it('spaces out requests to the same host', async () => {
    const sleeps = [];
    const http = createHttpClient({
      minIntervalMs: 500,
      fetchImpl: async () => jsonResponse(200),
      sleep: async (ms) => sleeps.push(ms),
    });
    await Promise.all([http.getJson('https://a.test/1'), http.getJson('https://a.test/2'), http.getJson('https://b.test/1')]);
    // a.test's second call waits ~500ms; b.test is a separate host and doesn't wait.
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] > 400 && sleeps[0] <= 500);
  });
});
