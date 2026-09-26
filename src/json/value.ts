/**
 * A lossless in-memory JSON representation.
 *
 * Numbers are stored as their raw source text so that large integers and
 * high-precision decimals are never silently rounded by `JSON.parse`.
 */

export interface JsonObject {
  readonly type: 'object';
  readonly entries: ReadonlyArray<readonly [string, JsonValue]>;
}

export interface JsonArray {
  readonly type: 'array';
  readonly items: ReadonlyArray<JsonValue>;
}

export interface JsonString {
  readonly type: 'string';
  readonly value: string;
}

export interface JsonNumber {
  readonly type: 'number';
  /** Raw numeric literal exactly as it appeared in the JSON text. */
  readonly raw: string;
}

export interface JsonBoolean {
  readonly type: 'boolean';
  readonly value: boolean;
}

export interface JsonNull {
  readonly type: 'null';
}

export type JsonValue =
  | JsonObject
  | JsonArray
  | JsonString
  | JsonNumber
  | JsonBoolean
  | JsonNull;

export function objectOf(
  entries: ReadonlyArray<readonly [string, JsonValue]>
): JsonObject {
  return { type: 'object', entries };
}

export function arrayOf(items: ReadonlyArray<JsonValue>): JsonArray {
  return { type: 'array', items };
}

export function stringOf(value: string): JsonString {
  return { type: 'string', value };
}

export function numberOf(raw: string): JsonNumber {
  return { type: 'number', raw };
}

export function booleanOf(value: boolean): JsonBoolean {
  return { type: 'boolean', value };
}

export const NULL: JsonNull = { type: 'null' };

/** Returns the value for a key in an object, or `undefined` when absent. */
export function getMember(obj: JsonObject, key: string): JsonValue | undefined {
  for (const [k, v] of obj.entries) {
    if (k === key) {
      return v;
    }
  }
  return undefined;
}

/** Returns the distinct keys of an object in first-seen order. */
export function objectKeys(obj: JsonObject): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const [k] of obj.entries) {
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

export type JsonKind = JsonValue['type'];

export function kindName(value: JsonValue): JsonKind {
  return value.type;
}

/**
 * Builds a JsonValue tree from native JavaScript values. Useful for tests and
 * for values that did not originate from parsed response text.
 */
export function fromNative(value: unknown): JsonValue {
  if (value === null) {
    return NULL;
  }
  switch (typeof value) {
    case 'string':
      return stringOf(value);
    case 'boolean':
      return booleanOf(value);
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new Error(`Cannot represent non-finite number: ${value}`);
      }
      return numberOf(String(value));
    }
    case 'bigint':
      return numberOf(value.toString());
    case 'object': {
      if (Array.isArray(value)) {
        return arrayOf(value.map(fromNative));
      }
      const entries: Array<readonly [string, JsonValue]> = [];
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined) {
          continue;
        }
        entries.push([k, fromNative(v)]);
      }
      return objectOf(entries);
    }
    default:
      throw new Error(`Cannot represent value of type ${typeof value}`);
  }
}
