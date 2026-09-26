import { JsonValue } from '../json/value.js';
import { parseJson } from '../json/parse.js';
import { stringifyJson } from '../json/stringify.js';
import { redactJson } from './redact.js';
import { SNAPSHOT_SCHEMA_VERSION, RULE_VERSION } from '../config/schema.js';

export interface SnapshotRules {
  ignorePaths: string[];
  redactPaths: string[];
  arrayMatchKeys: Record<string, string>;
}

export interface Snapshot {
  schemaVersion: number;
  ruleVersion: number;
  endpointId: string;
  endpointName: string;
  environment: string;
  sourceOrigin: string;
  url: string;
  capturedAt: string;
  status: number;
  /** Redacted response body. Numbers keep their original literal text. */
  responseText: string;
  rules: SnapshotRules;
  redactedPaths: string[];
}

export interface CreateSnapshotParams {
  endpointId: string;
  endpointName: string;
  environment: string;
  sourceOrigin: string;
  url: string;
  status: number;
  value: JsonValue;
  rules: SnapshotRules;
  capturedAt?: string;
}

export function createSnapshot(params: CreateSnapshotParams): Snapshot {
  const redacted = redactJson(params.value, params.rules.redactPaths);
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    ruleVersion: RULE_VERSION,
    endpointId: params.endpointId,
    endpointName: params.endpointName,
    environment: params.environment,
    sourceOrigin: params.sourceOrigin,
    url: params.url,
    capturedAt: params.capturedAt ?? new Date().toISOString(),
    status: params.status,
    responseText: stringifyJson(redacted, { indent: 2 }),
    rules: {
      ignorePaths: [...params.rules.ignorePaths],
      redactPaths: [...params.rules.redactPaths],
      arrayMatchKeys: { ...params.rules.arrayMatchKeys }
    },
    redactedPaths: [...params.rules.redactPaths]
  };
}

export function snapshotValue(snapshot: Snapshot): JsonValue {
  return parseJson(snapshot.responseText);
}

export interface SnapshotCompatibility {
  compatible: boolean;
  reasons: string[];
}

export function checkSnapshotCompatibility(
  snapshot: Snapshot,
  expected: {
    endpointId: string;
    environment: string;
    ruleVersion?: number;
    schemaVersion?: number;
  }
): SnapshotCompatibility {
  const reasons: string[] = [];
  if (snapshot.schemaVersion !== (expected.schemaVersion ?? SNAPSHOT_SCHEMA_VERSION)) {
    reasons.push(
      `Snapshot schema version ${snapshot.schemaVersion} does not match the supported version`
    );
  }
  if (snapshot.ruleVersion !== (expected.ruleVersion ?? RULE_VERSION)) {
    reasons.push(
      `Snapshot was captured with comparison rules v${snapshot.ruleVersion}; recapture the baseline`
    );
  }
  if (snapshot.endpointId !== expected.endpointId) {
    reasons.push('Snapshot belongs to a different endpoint');
  }
  if (snapshot.environment !== expected.environment) {
    reasons.push(
      `Snapshot was captured in environment '${snapshot.environment}', not '${expected.environment}'`
    );
  }
  return { compatible: reasons.length === 0, reasons };
}

/** True when an existing baseline exists and rules/config changed since capture. */
export function rulesChanged(
  snapshot: Snapshot,
  rules: SnapshotRules
): boolean {
  return (
    !sameStringArrays(snapshot.rules.ignorePaths, rules.ignorePaths) ||
    !sameStringArrays(snapshot.rules.redactPaths, rules.redactPaths) ||
    !sameRecord(snapshot.rules.arrayMatchKeys, rules.arrayMatchKeys)
  );
}

function sameStringArrays(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function sameRecord(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>
): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) {
    return false;
  }
  return keysA.every((key, index) => key === keysB[index] && a[key] === b[key]);
}
