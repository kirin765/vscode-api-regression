import {
  JsonValue,
  objectOf,
  arrayOf,
  stringOf,
  numberOf,
  booleanOf,
  NULL
} from './value.js';
import { isValidJsonNumberLiteral } from './number.js';

export interface ParseOptions {
  /** Maximum nesting depth accepted; protects against pathological input. */
  maxDepth?: number;
}

export class JsonParseError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(`${message} (at offset ${position})`);
    this.name = 'JsonParseError';
    this.position = position;
  }
}

const DEFAULT_MAX_DEPTH = 256;

/**
 * Parses JSON text into the lossless {@link JsonValue} tree. Numbers keep their
 * original literal text, duplicate object keys follow last-wins semantics.
 */
export function parseJson(text: string, options: ParseOptions = {}): JsonValue {
  const parser = new Parser(text, options.maxDepth ?? DEFAULT_MAX_DEPTH);
  parser.skipWhitespace();
  const value = parser.parseValue(0);
  parser.skipWhitespace();
  if (!parser.atEnd()) {
    throw new JsonParseError('Unexpected trailing content', parser.offset);
  }
  return value;
}

class Parser {
  offset = 0;
  private readonly text: string;
  private readonly length: number;
  private readonly maxDepth: number;

  constructor(text: string, maxDepth: number) {
    // Strip a leading BOM, which some servers emit.
    this.text = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    this.length = this.text.length;
    this.maxDepth = maxDepth;
  }

  atEnd(): boolean {
    return this.offset >= this.length;
  }

  skipWhitespace(): void {
    while (this.offset < this.length) {
      const code = this.text.charCodeAt(this.offset);
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
        this.offset += 1;
      } else {
        break;
      }
    }
  }

  parseValue(depth: number): JsonValue {
    if (depth > this.maxDepth) {
      throw new JsonParseError('Maximum nesting depth exceeded', this.offset);
    }
    if (this.atEnd()) {
      throw new JsonParseError('Unexpected end of input', this.offset);
    }
    const ch = this.text[this.offset];
    switch (ch) {
      case '{':
        return this.parseObject(depth);
      case '[':
        return this.parseArray(depth);
      case '"':
        return stringOf(this.parseString());
      case 't':
        this.expectKeyword('true');
        return booleanOf(true);
      case 'f':
        this.expectKeyword('false');
        return booleanOf(false);
      case 'n':
        this.expectKeyword('null');
        return NULL;
      default:
        if (ch !== undefined && (ch === '-' || (ch >= '0' && ch <= '9'))) {
          return this.parseNumber();
        }
        throw new JsonParseError(
          `Unexpected character ${JSON.stringify(ch)}`,
          this.offset
        );
    }
  }

  private parseObject(depth: number): JsonValue {
    this.offset += 1; // consume '{'
    const map = new Map<string, JsonValue>();
    this.skipWhitespace();
    if (this.text[this.offset] === '}') {
      this.offset += 1;
      return objectOf([]);
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text[this.offset] !== '"') {
        throw new JsonParseError("Expected '\"' to begin object key", this.offset);
      }
      const key = this.parseString();
      this.skipWhitespace();
      if (this.text[this.offset] !== ':') {
        throw new JsonParseError("Expected ':' after object key", this.offset);
      }
      this.offset += 1;
      this.skipWhitespace();
      const value = this.parseValue(depth + 1);
      // Last-wins for duplicate keys, preserving first-seen ordering.
      if (map.has(key)) {
        map.delete(key);
      }
      map.set(key, value);
      this.skipWhitespace();
      const sep = this.text[this.offset];
      if (sep === ',') {
        this.offset += 1;
        continue;
      }
      if (sep === '}') {
        this.offset += 1;
        return objectOf([...map.entries()]);
      }
      throw new JsonParseError("Expected ',' or '}' in object", this.offset);
    }
  }

  private parseArray(depth: number): JsonValue {
    this.offset += 1; // consume '['
    const items: JsonValue[] = [];
    this.skipWhitespace();
    if (this.text[this.offset] === ']') {
      this.offset += 1;
      return arrayOf(items);
    }
    for (;;) {
      this.skipWhitespace();
      items.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      const sep = this.text[this.offset];
      if (sep === ',') {
        this.offset += 1;
        continue;
      }
      if (sep === ']') {
        this.offset += 1;
        return arrayOf(items);
      }
      throw new JsonParseError("Expected ',' or ']' in array", this.offset);
    }
  }

  private parseString(): string {
    // Assumes the current character is the opening quote.
    this.offset += 1;
    let result = '';
    for (;;) {
      if (this.offset >= this.length) {
        throw new JsonParseError('Unterminated string', this.offset);
      }
      const ch = this.text[this.offset];
      if (ch === '"') {
        this.offset += 1;
        return result;
      }
      if (ch === '\\') {
        this.offset += 1;
        if (this.offset >= this.length) {
          throw new JsonParseError('Unterminated escape sequence', this.offset);
        }
        const esc = this.text[this.offset];
        switch (esc) {
          case '"':
            result += '"';
            this.offset += 1;
            break;
          case '\\':
            result += '\\';
            this.offset += 1;
            break;
          case '/':
            result += '/';
            this.offset += 1;
            break;
          case 'b':
            result += '\b';
            this.offset += 1;
            break;
          case 'f':
            result += '\f';
            this.offset += 1;
            break;
          case 'n':
            result += '\n';
            this.offset += 1;
            break;
          case 'r':
            result += '\r';
            this.offset += 1;
            break;
          case 't':
            result += '\t';
            this.offset += 1;
            break;
          case 'u':
            result += this.parseUnicodeEscape();
            break;
          default:
            throw new JsonParseError(
              `Invalid escape sequence \\${esc}`,
              this.offset
            );
        }
        continue;
      }
      const code = this.text.charCodeAt(this.offset);
      if (code < 0x20) {
        throw new JsonParseError('Unescaped control character in string', this.offset);
      }
      result += ch;
      this.offset += 1;
    }
  }

  private parseUnicodeEscape(): string {
    // Current offset points at 'u'.
    this.offset += 1;
    const hex = this.text.slice(this.offset, this.offset + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
      throw new JsonParseError('Invalid unicode escape', this.offset);
    }
    this.offset += 4;
    return String.fromCharCode(Number.parseInt(hex, 16));
  }

  private parseNumber(): JsonValue {
    const start = this.offset;
    if (this.text[this.offset] === '-') {
      this.offset += 1;
    }
    while (this.isDigit(this.text[this.offset])) {
      this.offset += 1;
    }
    if (this.text[this.offset] === '.') {
      this.offset += 1;
      while (this.isDigit(this.text[this.offset])) {
        this.offset += 1;
      }
    }
    if (this.text[this.offset] === 'e' || this.text[this.offset] === 'E') {
      this.offset += 1;
      if (this.text[this.offset] === '+' || this.text[this.offset] === '-') {
        this.offset += 1;
      }
      while (this.isDigit(this.text[this.offset])) {
        this.offset += 1;
      }
    }
    const raw = this.text.slice(start, this.offset);
    if (!isValidJsonNumberLiteral(raw)) {
      throw new JsonParseError('Invalid number literal', start);
    }
    return numberOf(raw);
  }

  private isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
  }

  private expectKeyword(keyword: string): void {
    if (this.text.slice(this.offset, this.offset + keyword.length) !== keyword) {
      throw new JsonParseError(`Expected '${keyword}'`, this.offset);
    }
    this.offset += keyword.length;
  }
}
