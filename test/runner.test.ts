import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../fixtures/server.mjs';
import {
  runRequest,
  joinUrl,
  originOf,
  parseUrl
} from '../src/runner/runner.js';

let fixture: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  fixture = await startServer(0);
});

afterAll(async () => {
  await fixture.close();
});

describe('runRequest — happy path', () => {
  it('fetches JSON and returns the body', async () => {
    const result = await runRequest({ url: joinUrl(fixture.url, '/api/products') });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.bodyText).toContain('"Widget"');
      expect(result.redirected).toBe(false);
    }
  });

  it('decodes gzip responses', async () => {
    const result = await runRequest({ url: joinUrl(fixture.url, '/api/gzip') });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bodyText).toContain('"Widget"');
    }
  });

  it('attaches headers from the caller', async () => {
    const result = await runRequest({
      url: joinUrl(fixture.url, '/api/echo'),
      headers: { 'x-custom': 'hello', authorization: 'Bearer test-token' }
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bodyText).toContain('hello');
      expect(result.bodyText).toContain('"hasAuthorization":true');
    }
  });
});

describe('runRequest — failures are not response differences', () => {
  it('reports a non-2xx status as a successful execution with that status', async () => {
    const result = await runRequest({
      url: joinUrl(fixture.url, '/api/status?code=503')
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(503);
    }
  });

  it('fails on a timeout', async () => {
    const result = await runRequest({
      url: joinUrl(fixture.url, '/api/slow?ms=500'),
      timeoutMs: 100
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('timeout');
    }
  });

  it('fails when the response exceeds the byte limit', async () => {
    const result = await runRequest({
      url: joinUrl(fixture.url, '/api/large?bytes=100000'),
      maxResponseBytes: 4096
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('too-large');
    }
  });

  it('does not follow redirects and reports the target', async () => {
    const result = await runRequest({ url: joinUrl(fixture.url, '/api/redirect') });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('redirect');
      expect(result.failure.location).toBe('/api/products');
      expect(result.failure.status).toBe(302);
    }
  });

  it('honours cancellation', async () => {
    const controller = new AbortController();
    setImmediate(() => controller.abort());
    const result = await runRequest({
      url: joinUrl(fixture.url, '/api/slow?ms=2000'),
      timeoutMs: 5000,
      signal: controller.signal
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('cancelled');
    }
  });

  it('rejects non-http protocols', async () => {
    const result = await runRequest({ url: 'file:///etc/passwd' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['unsupported-protocol', 'invalid-url']).toContain(result.failure.kind);
    }
  });

  it('fails cleanly on an unreachable host', async () => {
    const result = await runRequest({
      url: 'http://127.0.0.1:1/nope',
      timeoutMs: 2000
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('network');
    }
  });

  it('returns malformed bodies to the caller to reject as invalid JSON', async () => {
    const result = await runRequest({ url: joinUrl(fixture.url, '/api/malformed') });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bodyText).toBe('not json at all');
    }
  });
});

describe('url helpers', () => {
  it('joins base and path without duplicating slashes', () => {
    expect(joinUrl('http://x:1/', '/a')).toBe('http://x:1/a');
    expect(joinUrl('http://x:1', 'a')).toBe('http://x:1/a');
  });

  it('exposes the origin', () => {
    expect(originOf('https://example.com:8443/a/b')).toBe('https://example.com:8443');
  });

  it('rejects unsupported protocols', () => {
    expect(() => parseUrl('ftp://example.com')).toThrow();
  });
});
