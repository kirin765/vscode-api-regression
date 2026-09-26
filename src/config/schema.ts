export const CONFIG_DIR = '.api-regression';
export const CONFIG_FILE = 'config.json';
export const CONFIG_RELATIVE_PATH = `${CONFIG_DIR}/${CONFIG_FILE}`;

export const CONFIG_SCHEMA_VERSION = 1;
export const SNAPSHOT_SCHEMA_VERSION = 1;
export const RULE_VERSION = 1;

export type AuthType = 'none' | 'bearer' | 'apiKeyHeader';

export interface AuthConfig {
  type: AuthType;
  /** Name of the credential profile stored in VS Code SecretStorage. */
  profile?: string;
  /** Header name used when `type` is `apiKeyHeader`. */
  headerName?: string;
}

export interface EndpointRules {
  /** JSON Pointer-style paths with `*` wildcards excluded from comparison. */
  ignorePaths?: string[];
  /** Paths whose values are replaced before display/persistence. */
  redactPaths?: string[];
  /** Maps an array path to the field used to match array items. */
  arrayMatchKeys?: Record<string, string>;
}

export interface EndpointConfig {
  id: string;
  name: string;
  /** References a key in `environments`. */
  environment: string;
  /** A path beginning with `/`, resolved against the environment base URL. */
  path: string;
  /** Only `GET` is supported in this version. */
  method?: 'GET';
  headers?: Record<string, string>;
  auth?: AuthConfig;
  rules?: EndpointRules;
}

export interface EnvironmentConfig {
  baseUrl: string;
  description?: string;
}

export interface ApiRegressionConfig {
  schemaVersion: number;
  environments: Record<string, EnvironmentConfig>;
  endpoints: EndpointConfig[];
}

export const DEFAULT_IGNORE_PATHS = ['/meta/timestamp', '/meta/updatedAt'];
export const IGNORED_HEADER_NAMES = [
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization'
];

export function createConfigTemplate(port = 8787): ApiRegressionConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    environments: {
      local: {
        baseUrl: `http://127.0.0.1:${port}`,
        description: 'Synthetic local API used for the demo and tests'
      }
    },
    endpoints: [
      {
        id: 'products',
        name: 'Products (demo)',
        environment: 'local',
        path: '/api/products',
        method: 'GET',
        auth: { type: 'none' },
        rules: {
          ignorePaths: DEFAULT_IGNORE_PATHS,
          redactPaths: [],
          arrayMatchKeys: { '/items': 'id' }
        }
      },
      {
        id: 'products-changed',
        name: 'Products with a changed response (demo)',
        environment: 'local',
        path: '/api/products',
        method: 'GET',
        headers: { 'x-demo-variant': 'changed' },
        auth: { type: 'none' },
        rules: {
          ignorePaths: DEFAULT_IGNORE_PATHS,
          redactPaths: [],
          arrayMatchKeys: { '/items': 'id' }
        }
      }
    ]
  };
}
