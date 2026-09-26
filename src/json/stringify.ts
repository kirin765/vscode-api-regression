import { JsonValue } from './value.js';

export interface StringifyOptions {
  /** Number of spaces per level. `0` produces a single compact line. */
  indent?: number;
}

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t'
};

export function escapeJsonString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i] as string;
    const escaped = ESCAPES[ch];
    if (escaped !== undefined) {
      out += escaped;
      continue;
    }
    const code = value.charCodeAt(i);
    if (code < 0x20) {
      out += '\\u' + code.toString(16).padStart(4, '0');
    } else {
      out += ch;
    }
  }
  return out + '"';
}

/** Serializes a {@link JsonValue} back to JSON text, preserving number literals. */
export function stringifyJson(
  value: JsonValue,
  options: StringifyOptions = {}
): string {
  const indent = options.indent ?? 2;
  return write(value, indent, 0);
}

function write(value: JsonValue, indent: number, depth: number): string {
  const pad = indent > 0 ? ' '.repeat(indent * depth) : '';
  const childPad = indent > 0 ? ' '.repeat(indent * (depth + 1)) : '';
  const newline = indent > 0 ? '\n' : '';
  const sep = indent > 0 ? ': ' : ':';

  switch (value.type) {
    case 'null':
      return 'null';
    case 'boolean':
      return value.value ? 'true' : 'false';
    case 'number':
      return value.raw;
    case 'string':
      return escapeJsonString(value.value);
    case 'array': {
      if (value.items.length === 0) {
        return '[]';
      }
      const inner = value.items
        .map((item) => childPad + write(item, indent, depth + 1))
        .join(',' + newline);
      return '[' + newline + inner + newline + pad + ']';
    }
    case 'object': {
      if (value.entries.length === 0) {
        return '{}';
      }
      const inner = value.entries
        .map(
          ([key, item]) =>
            childPad + escapeJsonString(key) + sep + write(item, indent, depth + 1)
        )
        .join(',' + newline);
      return '{' + newline + inner + newline + pad + '}';
    }
  }
}
