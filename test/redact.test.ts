import { describe, expect, it } from 'vitest';
import { redactJson, REDACTED_MARKER } from '../src/snapshot/redact.js';
import { parseJson } from '../src/json/parse.js';
import { stringifyJson } from '../src/json/stringify.js';

describe('redactJson', () => {
  it('replaces matched values, including inside arrays', () => {
    const value = parseJson(
      '{"items":[{"id":1,"token":"secret"},{"id":2,"token":"other"}],"name":"x"}'
    );
    const redacted = redactJson(value, ['/items/*/token']);
    const text = stringifyJson(redacted, { indent: 0 });
    expect(text).not.toContain('secret');
    expect(text).not.toContain('other');
    expect(text).toContain(REDACTED_MARKER);
  });

  it('can redact an entire object subtree', () => {
    const value = parseJson('{"user":{"email":"a@b.c","name":"A"}}');
    const redacted = redactJson(value, ['/user']);
    expect(stringifyJson(redacted, { indent: 0 })).toBe(
      '{"user":"[REDACTED]"}'
    );
  });

  it('leaves unmatched data untouched', () => {
    const value = parseJson('{"a":1,"b":2}');
    const redacted = redactJson(value, ['/b']);
    expect(stringifyJson(redacted, { indent: 0 })).toBe('{"a":1,"b":"[REDACTED]"}');
  });

  it('is a no-op with no rules', () => {
    const value = parseJson('{"a":"secret"}');
    expect(redactJson(value, [])).toEqual(value);
  });
});
