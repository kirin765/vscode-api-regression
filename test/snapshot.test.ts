import { describe, expect, it } from 'vitest';
import {
  createSnapshot,
  snapshotValue,
  checkSnapshotCompatibility,
  rulesChanged
} from '../src/snapshot/snapshot.js';
import { parseJson } from '../src/json/parse.js';
import { stringifyJson } from '../src/json/stringify.js';

const rules = {
  ignorePaths: ['/meta/updatedAt'],
  redactPaths: ['/token'],
  arrayMatchKeys: { '/items': 'id' }
};

function makeSnapshot() {
  return createSnapshot({
    endpointId: 'products',
    endpointName: 'Products',
    environment: 'local',
    sourceOrigin: 'http://127.0.0.1:8787',
    url: 'http://127.0.0.1:8787/api/products',
    status: 200,
    value: parseJson('{"token":"secret","meta":{"updatedAt":"t"},"price":19.99}'),
    rules,
    capturedAt: '2026-01-01T00:00:00.000Z'
  });
}

describe('snapshot', () => {
  it('redacts on capture and never stores the secret', () => {
    const snapshot = makeSnapshot();
    expect(snapshot.responseText).not.toContain('secret');
    expect(snapshot.responseText).toContain('[REDACTED]');
    expect(snapshot.status).toBe(200);
    expect(snapshot.capturedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(snapshot.redactedPaths).toEqual(['/token']);
  });

  it('records the rules and versions used', () => {
    const snapshot = makeSnapshot();
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.ruleVersion).toBe(1);
    expect(snapshot.rules.ignorePaths).toEqual(['/meta/updatedAt']);
  });

  it('round-trips values through responseText', () => {
    const snapshot = makeSnapshot();
    const value = snapshotValue(snapshot);
    expect(stringifyJson(value, { indent: 0 })).toContain('19.99');
  });

  it('detects incompatible snapshots', () => {
    const snapshot = makeSnapshot();
    expect(
      checkSnapshotCompatibility(snapshot, {
        endpointId: 'products',
        environment: 'local'
      }).compatible
    ).toBe(true);

    const wrongEnv = checkSnapshotCompatibility(snapshot, {
      endpointId: 'products',
      environment: 'staging'
    });
    expect(wrongEnv.compatible).toBe(false);
    expect(wrongEnv.reasons.join(' ')).toContain('staging');

    const wrongEndpoint = checkSnapshotCompatibility(snapshot, {
      endpointId: 'other',
      environment: 'local'
    });
    expect(wrongEndpoint.compatible).toBe(false);

    const wrongVersion = checkSnapshotCompatibility(snapshot, {
      endpointId: 'products',
      environment: 'local',
      ruleVersion: 99
    });
    expect(wrongVersion.compatible).toBe(false);
  });

  it('detects rule changes that would reinterpret a baseline', () => {
    const snapshot = makeSnapshot();
    expect(rulesChanged(snapshot, rules)).toBe(false);
    expect(
      rulesChanged(snapshot, { ...rules, ignorePaths: ['/other'] })
    ).toBe(true);
    expect(
      rulesChanged(snapshot, { ...rules, arrayMatchKeys: { '/items': 'sku' } })
    ).toBe(true);
    expect(rulesChanged(snapshot, { ...rules, redactPaths: [] })).toBe(true);
  });
});
