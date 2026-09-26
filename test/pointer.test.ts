import { describe, expect, it } from 'vitest';
import {
  parseRulePath,
  validateRulePath,
  matchesRule,
  parsePointer,
  formatPointer
} from '../src/json/pointer.js';

describe('pointer helpers', () => {
  it('parses and formats concrete pointers', () => {
    expect(parsePointer('/a/b/0')).toEqual(['a', 'b', '0']);
    expect(parsePointer('/')).toEqual([]);
    expect(parsePointer('')).toEqual([]);
    expect(formatPointer(['a', 'b'])).toBe('/a/b');
    expect(formatPointer([])).toBe('/');
  });

  it('escapes tilde and slash in segments', () => {
    expect(formatPointer(['a/b', 'c~d'])).toBe('/a~1b/c~0d');
    expect(parsePointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d']);
  });

  it('parses wildcard rule paths', () => {
    expect(parseRulePath('/items/*/updatedAt')).toEqual([
      'items',
      '*',
      'updatedAt'
    ]);
  });

  it('rejects partial wildcards and missing leading slash', () => {
    expect(validateRulePath('/items/id*')).toBeDefined();
    expect(validateRulePath('items/id')).toBeDefined();
    expect(validateRulePath('/items/id')).toBeUndefined();
    expect(validateRulePath('/')).toBeUndefined();
  });

  it('matches wildcards against exactly one segment', () => {
    const rule = parseRulePath('/items/*/updatedAt');
    expect(matchesRule(rule, ['items', '0', 'updatedAt'])).toBe(true);
    expect(matchesRule(rule, ['items', '0', 'meta', 'updatedAt'])).toBe(false);
    expect(matchesRule(rule, ['items', '0'])).toBe(false);
  });
});
