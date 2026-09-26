import {
  JsonValue,
  JsonObject,
  JsonArray,
  getMember,
  objectKeys
} from '../json/value.js';
import {
  RuleSegment,
  parseRulePath,
  matchesRule,
  matchesAnyRule,
  formatPointer
} from '../json/pointer.js';
import { previewValue, describeType, DEFAULT_PREVIEW_LENGTH } from '../json/preview.js';
import { normalizeNumber } from '../json/number.js';

export type DiffKind =
  | 'added'
  | 'removed'
  | 'type-changed'
  | 'value-changed'
  | 'array-key-missing'
  | 'array-key-duplicate'
  | 'array-length';

export interface DiffEntry {
  /** Concrete JSON Pointer to the affected value. */
  path: string;
  kind: DiffKind;
  baselineType?: string;
  currentType?: string;
  baselinePreview?: string;
  currentPreview?: string;
  detail?: string;
}

export interface StatusComparison {
  baseline: number;
  current: number;
  changed: boolean;
}

export interface DiffSummary {
  added: number;
  removed: number;
  typeChanged: number;
  valueChanged: number;
  ambiguous: number;
  arrayLength: number;
  total: number;
}

export interface CompareResult {
  status: StatusComparison;
  diffs: DiffEntry[];
  ambiguous: DiffEntry[];
  ignoredPaths: string[];
  redactedPaths: string[];
  truncated: boolean;
  maxEntries: number;
  summary: DiffSummary;
  identical: boolean;
}

export interface ArrayMatchRule {
  readonly pattern: readonly RuleSegment[];
  readonly key: string;
  readonly source: string;
}

export interface CompareInput {
  baselineValue: JsonValue;
  currentValue: JsonValue;
  baselineStatus: number;
  currentStatus: number;
  ignorePaths?: readonly string[];
  redactPaths?: readonly string[];
  arrayMatchKeys?: Readonly<Record<string, string>>;
  maxEntries?: number;
  previewLength?: number;
}

export const DEFAULT_MAX_DIFF_ENTRIES = 2000;

export function parseIgnoreRules(paths: readonly string[]): RuleSegment[][] {
  return paths.map((path) => parseRulePath(path));
}

export function parseArrayMatchRules(
  map: Readonly<Record<string, string>>
): ArrayMatchRule[] {
  return Object.entries(map).map(([pattern, key]) => ({
    pattern: parseRulePath(pattern),
    key,
    source: pattern
  }));
}

export function compare(input: CompareInput): CompareResult {
  const maxEntries = input.maxEntries ?? DEFAULT_MAX_DIFF_ENTRIES;
  const previewLength = input.previewLength ?? DEFAULT_PREVIEW_LENGTH;
  const ignoreRules = parseIgnoreRules(input.ignorePaths ?? []);
  const arrayRules = parseArrayMatchRules(input.arrayMatchKeys ?? {});

  const ctx: Context = {
    maxEntries,
    previewLength,
    ignoreRules,
    arrayRules,
    diffs: [],
    ambiguous: [],
    ignored: new Set<string>(),
    truncated: false,
    stopped: false,
    summary: {
      added: 0,
      removed: 0,
      typeChanged: 0,
      valueChanged: 0,
      ambiguous: 0,
      arrayLength: 0,
      total: 0
    }
  };

  if (input.baselineStatus !== input.currentStatus) {
    ctx.truncated = false;
    pushDiff(ctx, {
      path: '$status',
      kind: 'value-changed',
      baselineType: 'number',
      currentType: 'number',
      baselinePreview: String(input.baselineStatus),
      currentPreview: String(input.currentStatus),
      detail: 'HTTP status changed'
    });
  }

  diffValue(input.baselineValue, input.currentValue, [], ctx);

  ctx.summary.total =
    ctx.summary.added +
    ctx.summary.removed +
    ctx.summary.typeChanged +
    ctx.summary.valueChanged +
    ctx.summary.ambiguous +
    ctx.summary.arrayLength;

  return {
    status: {
      baseline: input.baselineStatus,
      current: input.currentStatus,
      changed: input.baselineStatus !== input.currentStatus
    },
    diffs: ctx.diffs,
    ambiguous: ctx.ambiguous,
    ignoredPaths: [...ctx.ignored],
    redactedPaths: [...(input.redactPaths ?? [])],
    truncated: ctx.truncated,
    maxEntries,
    summary: ctx.summary,
    identical:
      !ctx.truncated &&
      ctx.diffs.length === 0 &&
      input.baselineStatus === input.currentStatus
  };
}

interface Context {
  maxEntries: number;
  previewLength: number;
  ignoreRules: RuleSegment[][];
  arrayRules: ArrayMatchRule[];
  diffs: DiffEntry[];
  ambiguous: DiffEntry[];
  ignored: Set<string>;
  truncated: boolean;
  stopped: boolean;
  summary: DiffSummary;
}

function pushDiff(ctx: Context, entry: DiffEntry): void {
  if (ctx.diffs.length >= ctx.maxEntries) {
    ctx.truncated = true;
    ctx.stopped = true;
    return;
  }
  ctx.diffs.push(entry);
  switch (entry.kind) {
    case 'added':
      ctx.summary.added += 1;
      break;
    case 'removed':
      ctx.summary.removed += 1;
      break;
    case 'type-changed':
      ctx.summary.typeChanged += 1;
      break;
    case 'value-changed':
      ctx.summary.valueChanged += 1;
      break;
    case 'array-length':
      ctx.summary.arrayLength += 1;
      break;
    case 'array-key-missing':
    case 'array-key-duplicate':
      ctx.summary.ambiguous += 1;
      ctx.ambiguous.push(entry);
      break;
  }
}

function diffValue(
  baseline: JsonValue,
  current: JsonValue,
  path: string[],
  ctx: Context
): void {
  if (ctx.stopped) {
    return;
  }

  if (matchesAnyRule(ctx.ignoreRules, path)) {
    ctx.ignored.add(formatPointer(path));
    return;
  }

  if (baseline.type !== current.type) {
    pushDiff(ctx, {
      path: formatPointer(path),
      kind: 'type-changed',
      baselineType: describeType(baseline),
      currentType: describeType(current),
      baselinePreview: previewValue(baseline, ctx.previewLength),
      currentPreview: previewValue(current, ctx.previewLength)
    });
    return;
  }

  switch (baseline.type) {
    case 'object':
      diffObject(baseline, current as JsonObject, path, ctx);
      return;
    case 'array':
      diffArray(baseline, current as JsonArray, path, ctx);
      return;
    case 'number':
      if (
        baseline.type === 'number' &&
        current.type === 'number' &&
        baseline.raw !== current.raw
      ) {
        // Compare exact decimal values, not literal spelling.
        if (!numbersEqual(baseline.raw, current.raw)) {
          pushValueChanged(ctx, path, baseline, current);
        }
      }
      return;
    case 'string':
      if (
        baseline.type === 'string' &&
        current.type === 'string' &&
        baseline.value !== current.value
      ) {
        pushValueChanged(ctx, path, baseline, current);
      }
      return;
    case 'boolean':
      if (
        baseline.type === 'boolean' &&
        current.type === 'boolean' &&
        baseline.value !== current.value
      ) {
        pushValueChanged(ctx, path, baseline, current);
      }
      return;
    case 'null':
      return;
  }
}

function numbersEqual(a: string, b: string): boolean {
  try {
    return normalizeNumber(a) === normalizeNumber(b);
  } catch {
    return a === b;
  }
}

function pushValueChanged(
  ctx: Context,
  path: string[],
  baseline: JsonValue,
  current: JsonValue
): void {
  pushDiff(ctx, {
    path: formatPointer(path),
    kind: 'value-changed',
    baselineType: describeType(baseline),
    currentType: describeType(current),
    baselinePreview: previewValue(baseline, ctx.previewLength),
    currentPreview: previewValue(current, ctx.previewLength)
  });
}

function diffObject(
  baseline: JsonObject,
  current: JsonObject,
  path: string[],
  ctx: Context
): void {
  const keys = objectKeys(baseline);
  const seen = new Set(keys);
  for (const key of objectKeys(current)) {
    if (!seen.has(key)) {
      keys.push(key);
    }
  }

  for (const key of keys) {
    if (ctx.stopped) {
      return;
    }
    const b = getMember(baseline, key);
    const c = getMember(current, key);
    const child = [...path, key];
    if (b === undefined) {
      pushDiff(ctx, {
        path: formatPointer(child),
        kind: 'added',
        currentType: c ? describeType(c) : undefined,
        currentPreview: c ? previewValue(c, ctx.previewLength) : undefined
      });
      continue;
    }
    if (c === undefined) {
      pushDiff(ctx, {
        path: formatPointer(child),
        kind: 'removed',
        baselineType: describeType(b),
        baselinePreview: previewValue(b, ctx.previewLength)
      });
      continue;
    }
    diffValue(b, c, child, ctx);
  }
}

function diffArray(
  baseline: JsonArray,
  current: JsonArray,
  path: string[],
  ctx: Context
): void {
  const matchKey = findArrayMatchKey(ctx.arrayRules, path);
  if (matchKey === undefined) {
    diffArrayByPosition(baseline, current, path, ctx);
    return;
  }
  diffArrayByKey(baseline, current, path, matchKey, ctx);
}

function diffArrayByPosition(
  baseline: JsonArray,
  current: JsonArray,
  path: string[],
  ctx: Context
): void {
  const shared = Math.min(baseline.items.length, current.items.length);
  for (let i = 0; i < shared; i += 1) {
    if (ctx.stopped) {
      return;
    }
    const baseItem = baseline.items[i];
    const currItem = current.items[i];
    if (baseItem === undefined || currItem === undefined) {
      continue;
    }
    diffValue(baseItem, currItem, [...path, String(i)], ctx);
  }
  if (baseline.items.length !== current.items.length) {
    pushDiff(ctx, {
      path: formatPointer(path),
      kind: 'array-length',
      baselineType: 'array',
      currentType: 'array',
      baselinePreview: `${baseline.items.length} items`,
      currentPreview: `${current.items.length} items`,
      detail: 'Array length changed; extra items reported as added/removed'
    });
  }
  for (let i = shared; i < baseline.items.length; i += 1) {
    if (ctx.stopped) {
      return;
    }
    const item = baseline.items[i];
    if (item === undefined) {
      continue;
    }
    pushDiff(ctx, {
      path: formatPointer([...path, String(i)]),
      kind: 'removed',
      baselineType: describeType(item),
      baselinePreview: previewValue(item, ctx.previewLength)
    });
  }
  for (let i = shared; i < current.items.length; i += 1) {
    if (ctx.stopped) {
      return;
    }
    const item = current.items[i];
    if (item === undefined) {
      continue;
    }
    pushDiff(ctx, {
      path: formatPointer([...path, String(i)]),
      kind: 'added',
      currentType: describeType(item),
      currentPreview: previewValue(item, ctx.previewLength)
    });
  }
}

interface Keyed {
  key: string;
  value: JsonValue;
  index: number;
}

function diffArrayByKey(
  baseline: JsonArray,
  current: JsonArray,
  path: string[],
  matchKey: string,
  ctx: Context
): void {
  const base = collectKeyed(baseline, matchKey, path, ctx.ambiguous);
  const curr = collectKeyed(current, matchKey, path, ctx.ambiguous);

  // Report ambiguity caused by missing/duplicate keys on either side.
  for (const entry of [...base.ambiguous, ...curr.ambiguous]) {
    pushDiff(ctx, entry);
  }
  if (ctx.stopped) {
    return;
  }

  const baseUnique = base.unique;
  const currUnique = curr.unique;

  for (const [key, baseItem] of baseUnique) {
    if (ctx.stopped) {
      return;
    }
    const currItem = currUnique.get(key);
    const child = [...path, key];
    if (currItem === undefined) {
      pushDiff(ctx, {
        path: formatPointer(child),
        kind: 'removed',
        baselineType: describeType(baseItem.value),
        baselinePreview: previewValue(baseItem.value, ctx.previewLength),
        detail: `Item with ${matchKey}=${key} removed`
      });
      continue;
    }
    diffValue(baseItem.value, currItem.value, child, ctx);
  }

  for (const [key, currItem] of currUnique) {
    if (ctx.stopped) {
      return;
    }
    if (!baseUnique.has(key)) {
      pushDiff(ctx, {
        path: formatPointer([...path, key]),
        kind: 'added',
        currentType: describeType(currItem.value),
        currentPreview: previewValue(currItem.value, ctx.previewLength),
        detail: `Item with ${matchKey}=${key} added`
      });
    }
  }
}

interface KeyedCollection {
  unique: Map<string, Keyed>;
  ambiguous: DiffEntry[];
}

function collectKeyed(
  array: JsonArray,
  matchKey: string,
  arrayPath: string[],
  _sink: DiffEntry[]
): KeyedCollection {
  const unique = new Map<string, Keyed>();
  const ambiguous: DiffEntry[] = [];
  array.items.forEach((item, index) => {
    const itemPath = formatPointer([...arrayPath, String(index)]);
    if (item.type !== 'object') {
      ambiguous.push({
        path: itemPath,
        kind: 'array-key-missing',
        detail: `Array item is not an object; cannot read match key '${matchKey}'`
      });
      return;
    }
    const keyValue = getMember(item, matchKey);
    if (keyValue === undefined) {
      ambiguous.push({
        path: itemPath,
        kind: 'array-key-missing',
        detail: `Array item is missing match key '${matchKey}'`
      });
      return;
    }
    const keyText = scalarKeyText(keyValue);
    if (keyText === undefined) {
      ambiguous.push({
        path: itemPath,
        kind: 'array-key-missing',
        detail: `Match key '${matchKey}' is not a string or number`
      });
      return;
    }
    if (unique.has(keyText)) {
      ambiguous.push({
        path: itemPath,
        kind: 'array-key-duplicate',
        detail: `Duplicate ${matchKey}=${keyText} in array`
      });
      return;
    }
    unique.set(keyText, { key: keyText, value: item, index });
  });
  return { unique, ambiguous };
}

function scalarKeyText(value: JsonValue): string | undefined {
  if (value.type === 'string') {
    return value.value;
  }
  if (value.type === 'number') {
    return value.raw;
  }
  return undefined;
}

function findArrayMatchKey(
  rules: ArrayMatchRule[],
  path: string[]
): string | undefined {
  for (const rule of rules) {
    if (matchesRule(rule.pattern, path)) {
      return rule.key;
    }
  }
  return undefined;
}
