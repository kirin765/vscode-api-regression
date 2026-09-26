import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../fixtures/server.mjs';
import { runRequest, joinUrl } from '../src/runner/runner.js';
import { parseJson } from '../src/json/parse.js';
import { redactJson } from '../src/snapshot/redact.js';
import { createSnapshot, snapshotValue } from '../src/snapshot/snapshot.js';
import { compare } from '../src/compare/compare.js';
import { buildMarkdownReport } from '../src/report/markdown.js';
import { EndpointConfig } from '../src/config/schema.js';
import { resolveRequest, SecretLookup } from '../src/runner/resolve.js';

let fixture: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  fixture = await startServer(0);
});

afterAll(async () => {
  await fixture.close();
});

const noSecrets: SecretLookup = { async get() { return undefined; } };

async function fetchValue(url: string) {
  const result = await runRequest({ url });
  if (!result.ok) {
    throw new Error(`run failed: ${result.failure.message}`);
  }
  return { status: result.status, value: parseJson(result.bodyText) };
}

describe('end-to-end capture → rerun → diff', () => {
  it('ignores the timestamp and detects a number-to-string price change', async () => {
    const baseUrl = fixture.url;
    const baselineEndpoint: EndpointConfig = {
      id: 'products',
      name: 'Products',
      environment: 'local',
      path: '/api/products',
      rules: {
        ignorePaths: ['/meta/updatedAt'],
        arrayMatchKeys: { '/items': 'id' }
      }
    };

    const resolved = await resolveRequest(
      baselineEndpoint,
      { baseUrl },
      noSecrets
    );
    const baselineRun = await fetchValue(resolved.url);

    const snapshot = createSnapshot({
      endpointId: baselineEndpoint.id,
      endpointName: baselineEndpoint.name,
      environment: 'local',
      sourceOrigin: resolved.origin,
      url: resolved.url,
      status: baselineRun.status,
      value: baselineRun.value,
      rules: { ignorePaths: ['/meta/updatedAt'], redactPaths: [], arrayMatchKeys: { '/items': 'id' } }
    });

    // Rerun the same endpoint, forcing the "changed" variant via the fixture.
    const changedResolved = await resolveRequest(
      baselineEndpoint,
      { baseUrl },
      noSecrets
    );
    changedResolved.url = changedResolved.url + '?variant=changed';
    const changedRun = await fetchValue(changedResolved.url);

    const result = compare({
      baselineValue: snapshotValue(snapshot),
      currentValue: changedRun.value,
      baselineStatus: snapshot.status,
      currentStatus: changedRun.status,
      ignorePaths: ['/meta/updatedAt', '/items/*/updatedAt'],
      arrayMatchKeys: { '/items': 'id' }
    });

    expect(result.identical).toBe(false);
    const priceChange = result.diffs.find((d) => d.path === '/items/1/price');
    expect(priceChange?.kind).toBe('type-changed');
    expect(priceChange?.baselineType).toBe('number');
    expect(priceChange?.currentType).toBe('string');

    // updatedAt changes are ignored on both meta and items.
    expect(
      result.diffs.some((d) => d.path.endsWith('/updatedAt'))
    ).toBe(false);
    expect(result.ignoredPaths.length).toBeGreaterThan(0);

    // Item 2 removed, item 3 added via key matching.
    expect(result.diffs.some((d) => d.kind === 'removed' && d.path.includes('/2'))).toBe(true);
    expect(result.diffs.some((d) => d.kind === 'added' && d.path.includes('/3'))).toBe(true);
  });

  it('treats a pure key reordering as identical', async () => {
    const baseRun = await fetchValue(joinUrl(fixture.url, '/api/products'));
    const reordered = await fetchValue(
      joinUrl(fixture.url, '/api/products?variant=reorder')
    );
    const result = compare({
      baselineValue: baseRun.value,
      currentValue: reordered.value,
      baselineStatus: 200,
      currentStatus: 200
    });
    expect(result.identical).toBe(true);
  });

  it('flags reversed array order when no match key is configured', async () => {
    const baseRun = await fetchValue(joinUrl(fixture.url, '/api/products'));
    const reversed = await fetchValue(
      joinUrl(fixture.url, '/api/products?variant=array-reorder')
    );
    const result = compare({
      baselineValue: baseRun.value,
      currentValue: reversed.value,
      baselineStatus: 200,
      currentStatus: 200,
      ignorePaths: ['/meta/updatedAt', '/items/*/updatedAt']
    });
    expect(result.identical).toBe(false);
    expect(result.diffs.some((d) => d.path === '/items/0/id')).toBe(true);
  });

  it('reports duplicate array keys as ambiguous', async () => {
    const baseRun = await fetchValue(joinUrl(fixture.url, '/api/products'));
    const dup = await fetchValue(
      joinUrl(fixture.url, '/api/products?variant=dup-keys')
    );
    const result = compare({
      baselineValue: baseRun.value,
      currentValue: dup.value,
      baselineStatus: 200,
      currentStatus: 200,
      arrayMatchKeys: { '/items': 'id' }
    });
    expect(result.diffs.some((d) => d.kind === 'array-key-duplicate')).toBe(true);
  });

  it('keeps large integers exact across capture and comparison', async () => {
    const baseline = await fetchValue(joinUrl(fixture.url, '/api/products/big'));
    const changed = await fetchValue(
      joinUrl(fixture.url, '/api/products/big?variant=changed')
    );
    const result = compare({
      baselineValue: baseline.value,
      currentValue: changed.value,
      baselineStatus: 200,
      currentStatus: 200
    });
    const big = result.diffs.find((d) => d.path === '/bigNumber');
    expect(big?.kind).toBe('value-changed');
    expect(big?.baselinePreview).toBe('9007199254740993');
    expect(big?.currentPreview).toBe('9007199254740994');
  });

  it('reports a status change as a difference', async () => {
    const ok = await fetchValue(joinUrl(fixture.url, '/api/status?code=200'));
    const bad = await fetchValue(joinUrl(fixture.url, '/api/status?code=503'));
    const result = compare({
      baselineValue: ok.value,
      currentValue: bad.value,
      baselineStatus: ok.status,
      currentStatus: bad.status
    });
    expect(result.status.changed).toBe(true);
    expect(result.diffs.some((d) => d.path === '$status')).toBe(true);
  });

  it('classifies malformed JSON as an execution failure, not a difference', async () => {
    const result = await runRequest({ url: joinUrl(fixture.url, '/api/malformed') });
    expect(result.ok).toBe(true);
    // The extension's executeEndpoint parses and would fail here.
    expect(() => parseJson((result as { bodyText: string }).bodyText)).toThrow();
  });

  it('redacts secrets before comparison output', async () => {
    const value = parseJson('{"data":"keep","secret":"hunter2"}');
    const redacted = redactJson(value, ['/secret']);
    const baseline = createSnapshot({
      endpointId: 'x',
      endpointName: 'X',
      environment: 'local',
      sourceOrigin: 'http://127.0.0.1',
      url: 'http://127.0.0.1/x',
      status: 200,
      value: redacted,
      rules: { ignorePaths: [], redactPaths: ['/secret'], arrayMatchKeys: {} }
    });
    expect(baseline.responseText).not.toContain('hunter2');
  });

  it('authenticates against the fixture', async () => {
    const auth: EndpointConfig = {
      id: 'auth',
      name: 'Auth',
      environment: 'local',
      path: '/api/auth',
      auth: { type: 'bearer', profile: 'local' }
    };
    const lookup: SecretLookup = {
      async get(profile, origin) {
        if (profile === 'local' && origin === new URL(fixture.url).origin) {
          return 'test-token';
        }
        return undefined;
      }
    };
    const resolved = await resolveRequest(auth, { baseUrl: fixture.url }, lookup);
    const result = await runRequest({ url: resolved.url, headers: resolved.headers });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
    }
  });
});

describe('report', () => {
  it('renders a redacted markdown report with summary and note', async () => {
    const baseline = await fetchValue(joinUrl(fixture.url, '/api/products'));
    const changed = await fetchValue(
      joinUrl(fixture.url, '/api/products?variant=changed')
    );
    const result = compare({
      baselineValue: baseline.value,
      currentValue: changed.value,
      baselineStatus: 200,
      currentStatus: 200,
      ignorePaths: ['/meta/updatedAt', '/items/*/updatedAt'],
      arrayMatchKeys: { '/items': 'id' }
    });
    const markdown = buildMarkdownReport(result, {
      endpointId: 'products',
      endpointName: 'Products',
      environment: 'local',
      url: joinUrl(fixture.url, '/api/products')
    });
    expect(markdown).toContain('# API Regression report: Products');
    expect(markdown).toContain('## Differences');
    expect(markdown).toContain('is not necessarily a breaking');
    expect(markdown).toContain('## Ignored paths');
    expect(markdown).not.toContain('hunter2');
  });

  it('adds a truncation notice', () => {
    const baseline = { type: 'array' as const, items: [] as ReturnType<typeof parseJson>[] };
    const current = { type: 'array' as const, items: [] as ReturnType<typeof parseJson>[] };
    for (let i = 0; i < 50; i += 1) {
      baseline.items.push(parseJson(String(i)));
      current.items.push(parseJson(String(i + 100)));
    }
    const result = compare({
      baselineValue: baseline,
      currentValue: current,
      baselineStatus: 200,
      currentStatus: 200,
      maxEntries: 5
    });
    const markdown = buildMarkdownReport(result, {
      endpointId: 'x',
      endpointName: 'X',
      environment: 'local',
      url: 'http://x/x'
    });
    expect(markdown).toContain('**Truncated**');
    expect(markdown).toContain('not complete');
  });
});
