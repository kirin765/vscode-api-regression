/**
 * JSON Pointer-style paths, with an added `*` wildcard for rule matching.
 *
 * Paths use the standard JSON Pointer escapes: `~0` for `~` and `~1` for `/`.
 * A rule segment of `*` matches exactly one segment (an object key or an array
 * index). Wildcards are only meaningful in rules, not in concrete paths.
 */

export const WILDCARD = '*';

export type PathSegment = string;
export type RuleSegment = string | typeof WILDCARD;

export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Parses a concrete JSON Pointer. The empty string and `/` both denote the
 * document root.
 */
export function parsePointer(path: string): string[] {
  if (path === '' || path === '/') {
    return [];
  }
  if (!path.startsWith('/')) {
    throw new Error(`JSON Pointer must start with '/': ${path}`);
  }
  const rawSegments = path.slice(1).split('/');
  return rawSegments.map(unescapePointerSegment);
}

export function formatPointer(segments: readonly string[]): string {
  if (segments.length === 0) {
    return '/';
  }
  return (
    '/' + segments.map(escapePointerSegment).join('/')
  );
}

/** Parses a rule path (JSON Pointer with `*` wildcards). */
export function parseRulePath(path: string): RuleSegment[] {
  if (path === '' || path === '/') {
    return [];
  }
  if (!path.startsWith('/')) {
    throw new Error(`Rule path must start with '/': ${path}`);
  }
  const rawSegments = path.slice(1).split('/');
  return rawSegments.map((segment) => {
    if (segment === WILDCARD) {
      return WILDCARD;
    }
    const unescaped = unescapePointerSegment(segment);
    if (unescaped.includes(WILDCARD)) {
      throw new Error(
        `A '*' wildcard must occupy an entire path segment: ${path}`
      );
    }
    return unescaped;
  });
}

/** Validates a rule path, returning an error message or `undefined`. */
export function validateRulePath(path: string): string | undefined {
  try {
    parseRulePath(path);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function matchesRule(
  ruleSegments: readonly RuleSegment[],
  actualSegments: readonly string[]
): boolean {
  if (ruleSegments.length !== actualSegments.length) {
    return false;
  }
  for (let i = 0; i < ruleSegments.length; i += 1) {
    const rule = ruleSegments[i];
    if (rule !== WILDCARD && rule !== actualSegments[i]) {
      return false;
    }
  }
  return true;
}

export function matchesAnyRule(
  rules: readonly (readonly RuleSegment[])[],
  actualSegments: readonly string[]
): boolean {
  return rules.some((rule) => matchesRule(rule, actualSegments));
}

/** Path of a value in a real document; indices are rendered numerically. */
export function childPath(
  parent: readonly string[],
  segment: string | number
): string[] {
  return [...parent, String(segment)];
}
