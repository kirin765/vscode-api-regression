import { JsonValue, JsonArray, JsonObject, stringOf } from '../json/value.js';
import { RuleSegment, parseRulePath, matchesRule } from '../json/pointer.js';

export const REDACTED_MARKER = '[REDACTED]';

/**
 * Replaces every value whose path matches a redaction rule with
 * {@link REDACTED_MARKER}. Applied before a response is previewed, compared or
 * persisted so plaintext secrets never reach the UI or disk.
 */
export function redactJson(
  value: JsonValue,
  redactPaths: readonly string[]
): JsonValue {
  if (redactPaths.length === 0) {
    return value;
  }
  const rules = redactPaths.map((path) => parseRulePath(path));
  return walk(value, [], rules);
}

function walk(
  value: JsonValue,
  path: string[],
  rules: readonly (readonly RuleSegment[])[]
): JsonValue {
  if (matchesAny(rules, path)) {
    return stringOf(REDACTED_MARKER);
  }
  switch (value.type) {
    case 'object':
      return {
        type: 'object',
        entries: value.entries.map(
          ([key, child]) => [key, walk(child, [...path, key], rules)] as const
        )
      } as JsonObject;
    case 'array':
      return {
        type: 'array',
        items: value.items.map((child, index) =>
          walk(child, [...path, String(index)], rules)
        )
      } as JsonArray;
    default:
      return value;
  }
}

function matchesAny(
  rules: readonly (readonly RuleSegment[])[],
  path: readonly string[]
): boolean {
  return rules.some((rule) => matchesRule(rule, path));
}
