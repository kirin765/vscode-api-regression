/**
 * Exact decimal normalization for JSON number literals.
 *
 * JSON numbers are arbitrary-precision decimal literals. `Number(raw)` would
 * silently round values such as `9007199254740993`, so this module operates on
 * the literal text with string arithmetic instead.
 */

const DECIMAL_LITERAL =
  /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export function isValidJsonNumberLiteral(raw: string): boolean {
  return DECIMAL_LITERAL.test(raw);
}

/**
 * Normalizes a JSON number literal to a canonical, exponent-free decimal
 * string. Equal numeric values map to identical strings, e.g. `1e3` and
 * `1000.000` both normalize to `1000`.
 *
 * @throws when `raw` is not a well-formed JSON number literal.
 */
export function normalizeNumber(raw: string): string {
  if (!isValidJsonNumberLiteral(raw)) {
    throw new Error(`Invalid JSON number literal: ${raw}`);
  }

  let body = raw;
  let negative = false;
  if (body.startsWith('-')) {
    negative = true;
    body = body.slice(1);
  }

  const exponentIndex = body.search(/[eE]/);
  let exponent = 0;
  let mantissa = body;
  if (exponentIndex !== -1) {
    exponent = Number.parseInt(body.slice(exponentIndex + 1), 10);
    mantissa = body.slice(0, exponentIndex);
  }

  const dotIndex = mantissa.indexOf('.');
  let digits: string;
  let decimalPosition: number;
  if (dotIndex === -1) {
    digits = mantissa;
    decimalPosition = mantissa.length;
  } else {
    const intPart = mantissa.slice(0, dotIndex);
    const fracPart = mantissa.slice(dotIndex + 1);
    digits = intPart + fracPart;
    decimalPosition = intPart.length;
  }

  decimalPosition += exponent;

  // Strip leading zeros from the digit run (keeping decimalPosition aligned).
  let start = 0;
  while (start < digits.length - 1 && digits[start] === '0') {
    start += 1;
    decimalPosition -= 1;
  }
  digits = digits.slice(start);

  // Strip trailing zeros (they do not affect the value).
  let end = digits.length;
  while (end > 1 && digits[end - 1] === '0') {
    end -= 1;
  }
  digits = digits.slice(0, end);

  if (digits === '0') {
    return '0';
  }

  let result: string;
  if (decimalPosition <= 0) {
    result = '0.' + '0'.repeat(-decimalPosition) + digits;
  } else if (decimalPosition >= digits.length) {
    result = digits + '0'.repeat(decimalPosition - digits.length);
  } else {
    result =
      digits.slice(0, decimalPosition) + '.' + digits.slice(decimalPosition);
  }

  // Trim a trailing fractional zero created by the layout above.
  if (result.includes('.')) {
    result = result.replace(/0+$/, '').replace(/\.$/, '');
  }

  return negative ? '-' + result : result;
}

/** True when the literal round-trips through IEEE-754 without precision loss. */
export function isSafeIntegerLiteral(raw: string): boolean {
  const normalized = normalizeNumber(raw);
  if (normalized.includes('.')) {
    return false;
  }
  const asNumber = Number(normalized);
  return Number.isSafeInteger(asNumber);
}

/**
 * Best-effort numeric value for display. Returns `undefined` when the literal
 * is outside the exact range of IEEE-754 doubles, so callers never present a
 * rounded value as if it were exact.
 */
export function safeNumericValue(raw: string): number | undefined {
  const normalized = normalizeNumber(raw);
  const asNumber = Number(normalized);
  if (!Number.isFinite(asNumber)) {
    return undefined;
  }
  if (String(asNumber) === normalized) {
    return asNumber;
  }
  // Integers are exact whenever they round-trip through Number().
  if (!normalized.includes('.')) {
    return Number.isSafeInteger(asNumber) ? asNumber : undefined;
  }
  return asNumber;
}
