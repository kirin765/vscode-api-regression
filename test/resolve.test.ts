import { describe, expect, it } from 'vitest';
import {
  MissingCredentialError,
  SecretLookup,
  resolveRequest
} from '../src/runner/resolve.js';
import { EndpointConfig, EnvironmentConfig } from '../src/config/schema.js';

class MapSecrets implements SecretLookup {
  constructor(private readonly secrets: Map<string, string>) {}
  async get(profile: string, origin: string): Promise<string | undefined> {
    return this.secrets.get(`${profile}@${origin}`);
  }
}

const environment: EnvironmentConfig = { baseUrl: 'https://api.example.com' };

function endpoint(auth: EndpointConfig['auth']): EndpointConfig {
  return {
    id: 'e',
    name: 'E',
    environment: 'prod',
    path: '/v1/things',
    auth
  };
}

describe('resolveRequest', () => {
  it('composes the request without credentials for none auth', async () => {
    const resolved = await resolveRequest(
      endpoint({ type: 'none' }),
      environment,
      new MapSecrets(new Map())
    );
    expect(resolved.url).toBe('https://api.example.com/v1/things');
    expect(resolved.origin).toBe('https://api.example.com');
    expect(resolved.headers.authorization).toBeUndefined();
    expect(resolved.usesCredential).toBe(false);
  });

  it('adds a bearer header from the scoped secret', async () => {
    const resolved = await resolveRequest(
      endpoint({ type: 'bearer', profile: 'prod' }),
      environment,
      new MapSecrets(new Map([['prod@https://api.example.com', 'tok']]))
    );
    expect(resolved.headers.authorization).toBe('Bearer tok');
    expect(resolved.usesCredential).toBe(true);
  });

  it('adds an api key header', async () => {
    const resolved = await resolveRequest(
      endpoint({ type: 'apiKeyHeader', profile: 'prod', headerName: 'X-API-Key' }),
      environment,
      new MapSecrets(new Map([['prod@https://api.example.com', 'key']]))
    );
    expect(resolved.headers['x-api-key']).toBe('key');
  });

  it('refuses to reuse a credential registered for another origin', async () => {
    await expect(
      resolveRequest(
        endpoint({ type: 'bearer', profile: 'prod' }),
        environment,
        new MapSecrets(new Map([['prod@https://other.example.com', 'tok']]))
      )
    ).rejects.toBeInstanceOf(MissingCredentialError);
  });

  it('reports the origin and profile when a credential is missing', async () => {
    try {
      await resolveRequest(
        endpoint({ type: 'apiKeyHeader', profile: 'prod', headerName: 'x-key' }),
        environment,
        new MapSecrets(new Map())
      );
      throw new Error('expected MissingCredentialError');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingCredentialError);
      const missing = error as MissingCredentialError;
      expect(missing.origin).toBe('https://api.example.com');
      expect(missing.profile).toBe('prod');
      expect(missing.headerName).toBe('x-key');
    }
  });

  it('rejects an invalid base URL', async () => {
    await expect(
      resolveRequest(
        endpoint({ type: 'none' }),
        { baseUrl: 'not a url' },
        new MapSecrets(new Map())
      )
    ).rejects.toThrow();
  });
});
