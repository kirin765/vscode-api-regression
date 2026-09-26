import { CompareResult, DiffEntry } from '../compare/compare.js';

export interface ReportContext {
  endpointId: string;
  endpointName: string;
  environment: string;
  url: string;
  baselineCapturedAt?: string;
  currentRunAt?: string;
  generatedAt?: string;
  /** Optional note about which environment each side came from. */
  crossEnvironment?: boolean;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function formatEntry(entry: DiffEntry): string {
  const baseline = entry.baselinePreview ?? '';
  const current = entry.currentPreview ?? '';
  const type =
    entry.kind === 'type-changed'
      ? `${entry.baselineType ?? '?'} -> ${entry.currentType ?? '?'}`
      : entry.currentType ?? entry.baselineType ?? '';
  const detail = entry.detail ?? '';
  return [
    `\`${escapeCell(entry.path)}\``,
    entry.kind,
    escapeCell(type),
    escapeCell(baseline),
    escapeCell(current),
    escapeCell(detail)
  ].join(' | ');
}

export function buildMarkdownReport(
  result: CompareResult,
  context: ReportContext
): string {
  const generatedAt = context.generatedAt ?? new Date().toISOString();
  const lines: string[] = [];

  lines.push(`# API Regression report: ${context.endpointName}`);
  lines.push('');
  lines.push(`- Endpoint: \`${context.endpointId}\``);
  lines.push(`- Environment: \`${context.environment}\``);
  lines.push(`- URL: ${context.url}`);
  if (context.baselineCapturedAt) {
    lines.push(`- Baseline captured: ${context.baselineCapturedAt}`);
  }
  if (context.currentRunAt) {
    lines.push(`- Current run: ${context.currentRunAt}`);
  }
  lines.push(`- Report generated: ${generatedAt}`);
  lines.push('');

  lines.push('## Result');
  lines.push('');
  lines.push(
    `- HTTP status: ${result.status.baseline} -> ${result.status.current}` +
      (result.status.changed ? ' (changed)' : ' (unchanged)')
  );
  lines.push(`- Identical after rules: ${result.identical ? 'yes' : 'no'}`);
  lines.push(
    `- Differences: ${result.summary.total} ` +
      `(added ${result.summary.added}, removed ${result.summary.removed}, ` +
      `type-changed ${result.summary.typeChanged}, value-changed ${result.summary.valueChanged}, ` +
      `ambiguous ${result.summary.ambiguous}, array-length ${result.summary.arrayLength})`
  );
  if (result.truncated) {
    lines.push(
      `- **Truncated**: only the first ${result.maxEntries} differences are listed. This report is not complete.`
    );
  }
  lines.push('');

  lines.push('## Differences');
  lines.push('');
  if (result.diffs.length === 0) {
    lines.push('_No differences after applying the ignore and matching rules._');
  } else {
    lines.push('Path | Kind | Type | Baseline | Current | Detail');
    lines.push('---|---|---|---|---|---');
    for (const entry of result.diffs) {
      lines.push(formatEntry(entry));
    }
    if (result.truncated) {
      lines.push('');
      lines.push(
        `_Output truncated at ${result.maxEntries} entries; further differences were not enumerated._`
      );
    }
  }
  lines.push('');

  if (result.ignoredPaths.length > 0) {
    lines.push('## Ignored paths');
    lines.push('');
    for (const path of result.ignoredPaths) {
      lines.push(`- \`${path}\``);
    }
    lines.push('');
  }

  if (result.redactedPaths.length > 0) {
    lines.push('## Redacted paths');
    lines.push('');
    for (const path of result.redactedPaths) {
      lines.push(`- \`${path}\``);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(
    'This report lists observed response differences. A difference is not necessarily a breaking ' +
      'change, and an unchanged response does not prove the API is correct.'
  );
  lines.push('');

  return lines.join('\n');
}
