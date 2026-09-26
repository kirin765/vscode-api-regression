import { EndpointConfig, EnvironmentConfig } from '../config/schema.js';
import { joinUrl, originOf, parseUrl } from './runner.js';

export interface ResolvedRequest {
  url: string;
  origin: string;
  headers: Record<string, string>;
  /** True when the request will attach a credential header. */
  usesCredential: boolean;
  authDescription: string;
  secretPresent: boolean;
}

export interface SecretLookup {
  get(profile: string, origin: string): Promise<string | undefined>;
}

export class MissingCredentialError extends Error {
  constructor(
    readonly profile: string,
    readonly origin: string,
    readonly headerName?: string
  ) {
    super(
      `No credential stored for profile '${profile}' at ${origin}. ` +
        'Run "API Regression: Manage Credentials" to set it.'
    );
    this.name = 'MissingCredentialError';
  }
}

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

export async function resolveRequest(
  endpoint: EndpointConfig,
  environment: EnvironmentConfig,
  lookup: SecretLookup
): Promise<ResolvedRequest> {
  let origin: string;
  try {
    origin = originOf(environment.baseUrl);
  } catch (error) {
    throw new InvalidRequestError(
      error instanceof Error ? error.message : String(error)
    );
  }

  const url = joinUrl(environment.baseUrl, endpoint.path);
  parseUrl(url); // Throws when the composed URL is not a valid http(s) URL.

  const headers: Record<string, string> = { ...(endpoint.headers ?? {}) };
  const auth = endpoint.auth ?? { type: 'none' as const };
  let usesCredential = false;
  let secretPresent = false;
  let authDescription = 'none';

  if (auth.type === 'bearer') {
    const profile = requireProfile(endpoint, auth.profile);
    const secret = await lookup.get(profile, origin);
    if (secret === undefined || secret.length === 0) {
      throw new MissingCredentialError(profile, origin, 'authorization');
    }
    headers.authorization = `Bearer ${secret}`;
    usesCredential = true;
    secretPresent = true;
    authDescription = `bearer (profile: ${profile})`;
  } else if (auth.type === 'apiKeyHeader') {
    const profile = requireProfile(endpoint, auth.profile);
    const headerName = auth.headerName;
    if (!headerName) {
      throw new InvalidRequestError(
        `Endpoint '${endpoint.id}' uses apiKeyHeader auth without a headerName`
      );
    }
    const secret = await lookup.get(profile, origin);
    if (secret === undefined || secret.length === 0) {
      throw new MissingCredentialError(profile, origin, headerName);
    }
    headers[headerName.toLowerCase()] = secret;
    usesCredential = true;
    secretPresent = true;
    authDescription = `api key header '${headerName}' (profile: ${profile})`;
  }

  return { url, origin, headers, usesCredential, authDescription, secretPresent };
}

function requireProfile(
  endpoint: EndpointConfig,
  profile: string | undefined
): string {
  if (!profile) {
    throw new InvalidRequestError(
      `Endpoint '${endpoint.id}' requires an auth profile but none is configured`
    );
  }
  return profile;
}
