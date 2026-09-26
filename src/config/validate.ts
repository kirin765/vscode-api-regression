import { validateRulePath } from '../json/pointer.js';
import {
  ApiRegressionConfig,
  AuthConfig,
  CONFIG_SCHEMA_VERSION,
  EndpointConfig,
  EndpointRules,
  IGNORED_HEADER_NAMES
} from './schema.js';

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  path: string;
  message: string;
  severity: IssueSeverity;
}

export interface ValidationResult {
  ok: boolean;
  config?: ApiRegressionConfig;
  issues: ValidationIssue[];
}

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function validateConfig(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const error = (path: string, message: string) =>
    issues.push({ path, message, severity: 'error' });
  const warn = (path: string, message: string) =>
    issues.push({ path, message, severity: 'warning' });

  if (!isPlainObject(value)) {
    error('$', 'Configuration must be a JSON object');
    return { ok: false, issues };
  }

  if (value.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    error(
      '$.schemaVersion',
      `Unsupported schemaVersion ${String(value.schemaVersion)}; this build supports ${CONFIG_SCHEMA_VERSION}`
    );
  }

  const environments = value.environments;
  if (!isPlainObject(environments)) {
    error('$.environments', 'environments must be an object');
  } else if (Object.keys(environments).length === 0) {
    error('$.environments', 'at least one environment is required');
  } else {
    for (const [id, env] of Object.entries(environments)) {
      const base = `$.environments.${id}`;
      if (!isPlainObject(env)) {
        error(base, 'environment must be an object');
        continue;
      }
      if (typeof env.baseUrl !== 'string') {
        error(`${base}.baseUrl`, 'baseUrl must be a string');
      } else {
        const urlIssue = validateBaseUrl(env.baseUrl);
        if (urlIssue) {
          error(`${base}.baseUrl`, urlIssue);
        }
      }
      if (env.description !== undefined && typeof env.description !== 'string') {
        error(`${base}.description`, 'description must be a string');
      }
    }
  }

  const endpoints = value.endpoints;
  if (!Array.isArray(endpoints)) {
    error('$.endpoints', 'endpoints must be an array');
    return { ok: issues.every((i) => i.severity !== 'error'), issues };
  }

  const seenIds = new Set<string>();
  endpoints.forEach((endpoint, index) => {
    const base = `$.endpoints[${index}]`;
    if (!isPlainObject(endpoint)) {
      error(base, 'endpoint must be an object');
      return;
    }
    validateEndpoint(endpoint, base, {
      error,
      warn,
      seenIds,
      environments: isPlainObject(environments) ? environments : {}
    });
  });

  const config = issues.some((i) => i.severity === 'error')
    ? undefined
    : (value as unknown as ApiRegressionConfig);

  return {
    ok: issues.every((i) => i.severity !== 'error'),
    config,
    issues
  };
}

interface EndpointContext {
  error(path: string, message: string): void;
  warn(path: string, message: string): void;
  seenIds: Set<string>;
  environments: Record<string, unknown>;
}

function validateEndpoint(
  endpoint: Record<string, unknown>,
  base: string,
  ctx: EndpointContext
): void {
  const id = endpoint.id;
  if (typeof id !== 'string' || id.length === 0) {
    ctx.error(`${base}.id`, 'id must be a non-empty string');
  } else if (!ID_PATTERN.test(id)) {
    ctx.error(
      `${base}.id`,
      'id may only contain letters, digits, dot, underscore and dash'
    );
  } else if (ctx.seenIds.has(id)) {
    ctx.error(`${base}.id`, `duplicate endpoint id '${id}'`);
  } else {
    ctx.seenIds.add(id);
  }

  if (typeof endpoint.name !== 'string' || endpoint.name.length === 0) {
    ctx.error(`${base}.name`, 'name must be a non-empty string');
  }

  if (endpoint.method !== undefined && endpoint.method !== 'GET') {
    ctx.error(
      `${base}.method`,
      `method '${String(endpoint.method)}' is not supported; only GET is available`
    );
  }

  const environment = endpoint.environment;
  if (typeof environment !== 'string' || environment.length === 0) {
    ctx.error(`${base}.environment`, 'environment must be a non-empty string');
  } else if (!Object.prototype.hasOwnProperty.call(ctx.environments, environment)) {
    ctx.error(
      `${base}.environment`,
      `unknown environment '${environment}'; define it under environments`
    );
  }

  const path = endpoint.path;
  if (typeof path !== 'string' || !path.startsWith('/')) {
    ctx.error(`${base}.path`, "path must be a string beginning with '/'");
  } else if (/^https?:\/\//i.test(path)) {
    ctx.error(`${base}.path`, 'path must be relative to the environment baseUrl');
  }

  validateHeaders(endpoint.headers, `${base}.headers`, ctx);
  validateAuth(endpoint.auth, `${base}.auth`, ctx);
  validateRules(endpoint.rules, `${base}.rules`, ctx);
}

function validateHeaders(
  headers: unknown,
  base: string,
  ctx: EndpointContext
): void {
  if (headers === undefined) {
    return;
  }
  if (!isPlainObject(headers)) {
    ctx.error(base, 'headers must be an object of string values');
    return;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (IGNORED_HEADER_NAMES.includes(name.toLowerCase())) {
      ctx.error(
        `${base}["${name}"]`,
        `header '${name}' must not be stored in configuration; use auth profiles for credentials`
      );
    } else if (typeof value !== 'string') {
      ctx.error(`${base}["${name}"]`, 'header value must be a string');
    }
  }
}

function validateAuth(auth: unknown, base: string, ctx: EndpointContext): void {
  if (auth === undefined) {
    return;
  }
  if (!isPlainObject(auth)) {
    ctx.error(base, 'auth must be an object');
    return;
  }
  const type = auth.type;
  if (type !== 'none' && type !== 'bearer' && type !== 'apiKeyHeader') {
    ctx.error(base + '.type', "auth.type must be 'none', 'bearer' or 'apiKeyHeader'");
    return;
  }
  const profile = auth.profile;
  if (type === 'none') {
    if (profile !== undefined) {
      ctx.warn(base + '.profile', 'profile is ignored when auth.type is none');
    }
    return;
  }
  if (typeof profile !== 'string' || profile.length === 0) {
    ctx.error(base + '.profile', `auth.type '${type}' requires a profile name`);
  }
  if (type === 'apiKeyHeader') {
    const headerName = auth.headerName;
    if (typeof headerName !== 'string' || headerName.length === 0) {
      ctx.error(base + '.headerName', 'apiKeyHeader auth requires headerName');
    } else if (IGNORED_HEADER_NAMES.includes(headerName.toLowerCase())) {
      ctx.error(
        base + '.headerName',
        `headerName '${headerName}' is reserved; use bearer auth for Authorization`
      );
    }
  }
}

function validateRules(
  rules: unknown,
  base: string,
  ctx: EndpointContext
): void {
  if (rules === undefined) {
    return;
  }
  if (!isPlainObject(rules)) {
    ctx.error(base, 'rules must be an object');
    return;
  }
  const ignorePaths = validatePathList(rules.ignorePaths, `${base}.ignorePaths`, ctx);
  const redactPaths = validatePathList(rules.redactPaths, `${base}.redactPaths`, ctx);

  for (const path of ignorePaths) {
    if (redactPaths.includes(path)) {
      ctx.warn(
        `${base}.redactPaths`,
        `path '${path}' is both ignored and redacted; ignored paths are not compared`
      );
    }
  }

  const arrayMatchKeys = rules.arrayMatchKeys;
  if (arrayMatchKeys !== undefined) {
    if (!isPlainObject(arrayMatchKeys)) {
      ctx.error(`${base}.arrayMatchKeys`, 'arrayMatchKeys must be an object');
    } else {
      for (const [pattern, key] of Object.entries(arrayMatchKeys)) {
        const issue = validateRulePath(pattern);
        if (issue) {
          ctx.error(`${base}.arrayMatchKeys["${pattern}"]`, issue);
        }
        if (typeof key !== 'string' || key.length === 0) {
          ctx.error(
            `${base}.arrayMatchKeys["${pattern}"]`,
            'match key must be a non-empty string'
          );
        }
      }
    }
  }
}

function validatePathList(
  value: unknown,
  base: string,
  ctx: EndpointContext
): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    ctx.error(base, 'must be an array of path strings');
    return [];
  }
  const result: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'string') {
      ctx.error(`${base}[${index}]`, 'path must be a string');
      return;
    }
    const issue = validateRulePath(entry);
    if (issue) {
      ctx.error(`${base}[${index}]`, issue);
    } else {
      result.push(entry);
    }
  });
  return result;
}

function validateBaseUrl(baseUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return 'baseUrl must be an absolute http(s) URL';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'baseUrl must use the http or https protocol';
  }
  if (url.username || url.password) {
    return 'baseUrl must not embed credentials';
  }
  return undefined;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function formatIssues(issues: ValidationIssue[]): string {
  return issues
    .map((issue) => `${issue.severity === 'error' ? 'ERROR' : 'WARN'} ${issue.path}: ${issue.message}`)
    .join('\n');
}

export type { ApiRegressionConfig, EndpointConfig, EndpointRules, AuthConfig };
