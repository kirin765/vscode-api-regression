import { describe, expect, it } from 'vitest';
import { compare } from '../src/compare/compare.js';
import { parseJson } from '../src/json/parse.js';
import { JsonValue } from '../src/json/value.js';

function j(text: string): JsonValue {
  return parseJson(text);
}

function kinds(result: ReturnType<typeof compare>): string[] {
  return result.diffs.map((entry) => `${entry.kind}:${entry.path}`);
}

describe('compare — basics', () => {
  it('treats reordered object keys as identical', () => {
    const result = compare({
      baselineValue: j('{"a":1,"b":2}'),
      currentValue: j('{"b":2,"a":1}'),
      baselineStatus: 200,
      currentStatus: 200
    });
    expect(result.identical).toBe(true);
    expect(result.diffs).toHaveLength(0);
  });

  it('detects a number-to-string change', () => {
    const result = compare({
      baselineValue: j('{"price":19.99}'),
      currentValue: j('{"price":"19.99"}'),
      baselineStatus: 200,
      currentStatus: 200
    });
    expect(result.identical).toBe(false);
    expect(kinds(result)).toEqual(['type-changed:/price']);
    expect(result.diffs[0]?.baselineType).toBe('number');
    expect(result.diffs[0]?.currentType).toBe('string');
  });

  it('distinguishes missing from null', () => {
    const missing = compare({
      baselineValue: j('{"a":1}'),
      currentValue: j('{}'),
      baselineStatus: 200,
      currentStatus: 200
    });
    expect(kinds(missing)).toEqual(['removed:/a']);

    const nulled = compare({
      baselineValue: j('{"a":1}'),
      currentValue: j('{"a":null}'),
      baselineStatus: 200,
      currentStatus: 200
    });
    expect(kinds(nulled)).toEqual(['type-changed:/a']);
  });

  it('treats numerically equal literals as equal', () => {
    const result = compare({
      baselineValue: j('{"n":1e3}'),
      currentValue: j('{"n":1000.0}'),
      baselineStatus: 200,
      currentStatus: 200
    });
    expect(result.identical).toBe(true);
  });

  it('detects large-integer changes without rounding', () => {
    const result = compare({
      baselineValue: j('{"big":9007199254740993}'),
      currentValue: j('{"big":9007199254740994}'),
      baselineStatus: 200,
      currentStatus: 200
    });
    expect(kinds(result)).toEqual(['value-changed:/big']);
  });

  it('reports a status change', () => {
    const result = compare({
      baselineValue: j('{}'),
      currentValue: j('{}'),
      baselineStatus: 200,
      currentStatus: 500
    });
    expect(result.status.changed).toBe(true);
    expect(kinds(result)).toContain('value-changed:$status');
  });
});

describe('compare — arrays', () => {
  it('preserves array order by default', () => {
    const result = compare({
      baselineValue: j('[1,2,3]'),
      currentValue: j('[3,2,1]'),
      baselineStatus: 200,
      currentStatus: 200
    });
    expect(result.identical).toBe(false);
    expect(result.diffs.some((d) => d.kind === 'value-changed')).toBe(true);
  });

  it('reports array length changes', () => {
    const result = compare({
      baselineValue: j('[1,2]'),
      currentValue: j('[1,2,3]'),
      baselineStatus: 200,
      currentStatus: 200
    });
    expect(result.summary.arrayLength).toBe(1);
    expect(kinds(result)).toContain('added:/2');
  });

  it('matches array items by configured key regardless of order', () => {
    const result = compare({
      baselineValue: j('[{"id":1,"v":"a"},{"id":2,"v":"b"}]'),
      currentValue: j('[{"id":2,"v":"b"},{"id":1,"v":"a"}]'),
      baselineStatus: 200,
      currentStatus: 200,
      arrayMatchKeys: { '/': 'id' }
    });
    expect(result.identical).toBe(true);
  });

  it('reports items added and removed when matching by key', () => {
    const result = compare({
      baselineValue: j('[{"id":1},{"id":2}]'),
      currentValue: j('[{"id":1},{"id":3}]'),
      baselineStatus: 200,
      currentStatus: 200,
      arrayMatchKeys: { '/': 'id' }
    });
    expect(kinds(result)).toContain('removed:/2');
    expect(kinds(result)).toContain('added:/3');
  });

  it('reports duplicate match keys as ambiguous instead of pairing', () => {
    const result = compare({
      baselineValue: j('[{"id":1,"v":1},{"id":1,"v":2}]'),
      currentValue: j('[{"id":1,"v":1}]'),
      baselineStatus: 200,
      currentStatus: 200,
      arrayMatchKeys: { '/': 'id' }
    });
    expect(result.summary.ambiguous).toBeGreaterThan(0);
    expect(result.diffs.some((d) => d.kind === 'array-key-duplicate')).toBe(true);
  });

  it('reports missing match keys as ambiguous', () => {
    const result = compare({
      baselineValue: j('[{"id":1},{"v":2}]'),
      currentValue: j('[{"id":1},{"id":2}]'),
      baselineStatus: 200,
      currentStatus: 200,
      arrayMatchKeys: { '/': 'id' }
    });
    expect(result.diffs.some((d) => d.kind === 'array-key-missing')).toBe(true);
  });

  it('reports non-object items when a match key is configured', () => {
    const result = compare({
      baselineValue: j('[1]'),
      currentValue: j('[1]'),
      baselineStatus: 200,
      currentStatus: 200,
      arrayMatchKeys: { '/': 'id' }
    });
    expect(result.diffs.some((d) => d.kind === 'array-key-missing')).toBe(true);
  });
});

describe('compare — ignore rules', () => {
  it('ignores exact paths with a wildcard segment', () => {
    const result = compare({
      baselineValue: j('{"items":[{"id":1,"updatedAt":"x"},{"id":2,"updatedAt":"y"}]}'),
      currentValue: j('{"items":[{"id":1,"updatedAt":"z"},{"id":2,"updatedAt":"w"}]}'),
      baselineStatus: 200,
      currentStatus: 200,
      ignorePaths: ['/items/*/updatedAt']
    });
    expect(result.identical).toBe(true);
    expect(result.ignoredPaths).toContain('/items/0/updatedAt');
    expect(result.ignoredPaths).toContain('/items/1/updatedAt');
  });

  it('reports ignored paths so a match is not misleading', () => {
    const result = compare({
      baselineValue: j('{"meta":{"timestamp":"a"},"v":1}'),
      currentValue: j('{"meta":{"timestamp":"b"},"v":1}'),
      baselineStatus: 200,
      currentStatus: 200,
      ignorePaths: ['/meta/timestamp']
    });
    expect(result.identical).toBe(true);
    expect(result.ignoredPaths).toEqual(['/meta/timestamp']);
  });
});

describe('compare — bounds', () => {
  it('truncates beyond the configured maximum', () => {
    const baseline = { type: 'array' as const, items: [] as JsonValue[] };
    const current = { type: 'array' as const, items: [] as JsonValue[] };
    for (let i = 0; i < 100; i += 1) {
      baseline.items.push(j(String(i)));
      current.items.push(j(String(i + 1000)));
    }
    const result = compare({
      baselineValue: baseline,
      currentValue: current,
      baselineStatus: 200,
      currentStatus: 200,
      maxEntries: 10
    });
    expect(result.truncated).toBe(true);
    expect(result.diffs).toHaveLength(10);
  });
});
