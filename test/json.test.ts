import { describe, expect, it } from 'vitest';
import { parseJson } from '../src/json/parse.js';
import { stringifyJson } from '../src/json/stringify.js';
import { normalizeNumber } from '../src/json/number.js';
import { JsonValue } from '../src/json/value.js';

describe('parseJson', () => {
  it('round-trips objects while ignoring key order', () => {
    const value = parseJson('{"b":1,"a":2}');
    expect(stringifyJson(value, { indent: 0 })).toBe('{"b":1,"a":2}');
  });

  it('preserves the raw literal of large integers', () => {
    const value = parseJson('{"big":9007199254740993}');
    expect(value.type).toBe('object');
    if (value.type === 'object') {
      const big = value.entries[0]?.[1];
      expect(big).toEqual({ type: 'number', raw: '9007199254740993' });
    }
  });

  it('keeps high-precision decimals intact', () => {
    const value = parseJson('0.1000000000000000055511151231257827');
    expect(value).toEqual({
      type: 'number',
      raw: '0.1000000000000000055511151231257827'
    });
  });

  it('applies last-wins for duplicate object keys', () => {
    const value = parseJson('{"a":1,"a":2}');
    if (value.type === 'object') {
      expect(value.entries).toHaveLength(1);
      expect(value.entries[0]?.[1]).toEqual({ type: 'number', raw: '2' });
    } else {
      throw new Error('expected object');
    }
  });

  it('distinguishes missing, null and empty string', () => {
    const value = parseJson('{"a":null,"b":""}');
    expect(value.type).toBe('object');
    if (value.type === 'object') {
      const a = value.entries.find(([k]) => k === 'a')?.[1];
      const b = value.entries.find(([k]) => k === 'b')?.[1];
      expect(a).toEqual({ type: 'null' });
      expect(b).toEqual({ type: 'string', value: '' });
    }
  });

  it('decodes escapes and unicode', () => {
    const value = parseJson('{"s":"line\\n\\u0041"}');
    if (value.type === 'object') {
      expect(value.entries[0]?.[1]).toEqual({ type: 'string', value: 'line\nA' });
    }
  });

  it('rejects malformed JSON with a positional error', () => {
    expect(() => parseJson('{"a":}')).toThrowError(/at offset/);
    expect(() => parseJson('{"a":1')).toThrow();
    expect(() => parseJson('')).toThrow();
    expect(() => parseJson('{"a":1} trailing')).toThrow();
  });

  it('accepts any top-level value', () => {
    expect(parseJson('null')).toEqual({ type: 'null' });
    expect(parseJson('[1,2]').type).toBe('array');
    expect(parseJson('"text"')).toEqual({ type: 'string', value: 'text' });
  });
});

describe('stringifyJson', () => {
  it('round-trips through parse and stringify without number loss', () => {
    const source = '{"big":123456789012345678901234567890,"x":1.238e5}';
    const value: JsonValue = parseJson(source);
    const again = parseJson(stringifyJson(value));
    expect(again).toEqual(value);
  });

  it('escapes control characters', () => {
    const value = parseJson('{"s":"tab\\t"}');
    expect(stringifyJson(value, { indent: 0 })).toBe('{"s":"tab\\t"}');
  });
});

describe('normalizeNumber', () => {
  it('equates numerically equal spellings', () => {
    expect(normalizeNumber('1e3')).toBe(normalizeNumber('1000.000'));
    expect(normalizeNumber('-0')).toBe('0');
    expect(normalizeNumber('0.000')).toBe('0');
    expect(normalizeNumber('1.10')).toBe('1.1');
    expect(normalizeNumber('0.000001')).toBe(normalizeNumber('1e-6'));
  });

  it('keeps distinct large integers distinct', () => {
    expect(normalizeNumber('9007199254740993')).not.toBe(
      normalizeNumber('9007199254740992')
    );
  });

  it('rejects non-literals', () => {
    expect(() => normalizeNumber('01')).toThrow();
    expect(() => normalizeNumber('NaN')).toThrow();
    expect(() => normalizeNumber('1.')).toThrow();
  });
});
