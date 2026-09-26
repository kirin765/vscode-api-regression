import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/config/validate.js';
import { createConfigTemplate } from '../src/config/schema.js';

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    environments: { local: { baseUrl: 'http://127.0.0.1:8787' } },
    endpoints: [
      {
        id: 'products',
        name: 'Products',
        environment: 'local',
        path: '/api/products'
      }
    ],
    ...overrides
  };
}

describe('validateConfig', () => {
  it('accepts the generated template', () => {
    const result = validateConfig(createConfigTemplate());
    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('rejects an unsupported schema version', () => {
    const result = validateConfig(base({ schemaVersion: 99 }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === '$.schemaVersion')).toBe(true);
  });

  it('rejects unknown environments', () => {
    const result = validateConfig(
      base({
        endpoints: [
          {
            id: 'a',
            name: 'A',
            environment: 'missing',
            path: '/x'
          }
        ]
      })
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('unknown environment'))).toBe(true);
  });

  it('rejects non-GET methods', () => {
    const result = validateConfig(
      base({
        endpoints: [
          { id: 'a', name: 'A', environment: 'local', path: '/x', method: 'POST' }
        ]
      })
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('only GET'))).toBe(true);
  });

  it('rejects credentials embedded in baseUrl or headers', () => {
    const withCreds = validateConfig(
      base({
        environments: { local: { baseUrl: 'http://user:pass@127.0.0.1:8787' } }
      })
    );
    expect(withCreds.ok).toBe(false);

    const withAuthHeader = validateConfig(
      base({
        endpoints: [
          {
            id: 'a',
            name: 'A',
            environment: 'local',
            path: '/x',
            headers: { Authorization: 'Bearer leaked' }
          }
        ]
      })
    );
    expect(withAuthHeader.ok).toBe(false);
    expect(
      withAuthHeader.issues.some((i) => i.message.includes('must not be stored'))
    ).toBe(true);
  });

  it('requires a profile for credential auth', () => {
    const result = validateConfig(
      base({
        endpoints: [
          {
            id: 'a',
            name: 'A',
            environment: 'local',
            path: '/x',
            auth: { type: 'bearer' }
          }
        ]
      })
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('requires a profile'))).toBe(true);
  });

  it('requires a headerName for apiKeyHeader auth', () => {
    const result = validateConfig(
      base({
        endpoints: [
          {
            id: 'a',
            name: 'A',
            environment: 'local',
            path: '/x',
            auth: { type: 'apiKeyHeader', profile: 'p' }
          }
        ]
      })
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('headerName'))).toBe(true);
  });

  it('rejects invalid rule paths', () => {
    const result = validateConfig(
      base({
        endpoints: [
          {
            id: 'a',
            name: 'A',
            environment: 'local',
            path: '/x',
            rules: { ignorePaths: ['not-a-pointer'] }
          }
        ]
      })
    );
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate endpoint ids', () => {
    const endpoint = { id: 'dup', name: 'A', environment: 'local', path: '/x' };
    const result = validateConfig(base({ endpoints: [endpoint, { ...endpoint }] }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('duplicate'))).toBe(true);
  });

  it('warns when a path is both ignored and redacted', () => {
    const result = validateConfig(
      base({
        endpoints: [
          {
            id: 'a',
            name: 'A',
            environment: 'local',
            path: '/x',
            rules: { ignorePaths: ['/a'], redactPaths: ['/a'] }
          }
        ]
      })
    );
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });
});
