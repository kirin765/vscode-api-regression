import { JsonValue } from './value.js';
import { stringifyJson } from './stringify.js';

export const DEFAULT_PREVIEW_LENGTH = 120;

/** Compact, bounded, single-line preview of a JSON value. */
export function previewValue(
  value: JsonValue,
  maxLength: number = DEFAULT_PREVIEW_LENGTH
): string {
  const text = stringifyJson(value, { indent: 0 });
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, Math.max(0, maxLength - 1)) + '\u2026';
}

/** Human-readable JSON type name. */
export function describeType(value: JsonValue): string {
  return value.type;
}
