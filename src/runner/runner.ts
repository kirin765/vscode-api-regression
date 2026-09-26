import * as http from 'node:http';
import * as https from 'node:https';
import * as zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type FailureKind =
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'timeout'
  | 'network'
  | 'tls'
  | 'too-large'
  | 'redirect'
  | 'cancelled'
  | 'invalid-json';

export interface RunFailureInfo {
  kind: FailureKind;
  message: string;
  status?: number;
  location?: string;
}

export interface RunSuccess {
  ok: true;
  url: string;
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  byteLength: number;
  durationMs: number;
  redirected: false;
}

export interface RunFailure {
  ok: false;
  url: string;
  durationMs: number;
  failure: RunFailureInfo;
}

export type RunResult = RunSuccess | RunFailure;

export interface RunOptions {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  signal?: AbortSignal;
}

/** Returns the origin (`scheme://host:port`) for a URL, or throws. */
export function originOf(url: string): string {
  const parsed = parseUrl(url);
  return parsed.origin;
}

export function parseUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol '${parsed.protocol}'; only http(s) is allowed`);
  }
  return parsed;
}

export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return base + suffix;
}

export async function runRequest(options: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  let url: URL;
  try {
    url = parseUrl(options.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind: FailureKind = message.includes('Unsupported protocol')
      ? 'unsupported-protocol'
      : 'invalid-url';
    return failure(options.url, started, { kind, message });
  }

  if (options.signal?.aborted) {
    return failure(options.url, started, {
      kind: 'cancelled',
      message: 'Request cancelled before it started'
    });
  }

  const transport = url.protocol === 'https:' ? https : http;

  return new Promise<RunResult>((resolve) => {
    let settled = false;
    let stream: Readable | undefined;

    const finish = (result: RunResult) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (options.signal && onAbort) {
        options.signal.removeEventListener('abort', onAbort);
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      request.destroy(new Error('__timeout__'));
      // Destroy the decompression stream so no further data is read.
      stream?.destroy();
      finish(
        failure(options.url, started, {
          kind: 'timeout',
          message: `Request timed out after ${timeoutMs} ms`
        })
      );
    }, timeoutMs);

    const onAbort = () => {
      request.destroy(new Error('__cancelled__'));
      stream?.destroy();
      finish(
        failure(options.url, started, {
          kind: 'cancelled',
          message: 'Request cancelled'
        })
      );
    };
    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    const request = transport.request(
      url,
      {
        method: 'GET',
        headers: {
          accept: 'application/json, text/json;q=0.9, */*;q=0.1',
          'accept-encoding': 'gzip, deflate, br',
          ...options.headers
        }
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = headerValue(response.headers.location);
        if (isRedirect(status) && location !== undefined) {
          response.resume();
          finish(
            failure(options.url, started, {
              kind: 'redirect',
              status,
              location,
              message: `Redirect (${status}) to ${location} was not followed`
            })
          );
          return;
        }

        const encoding = (headerValue(response.headers['content-encoding']) ?? '').toLowerCase();
        stream = decodingStream(response, encoding);
        const chunks: Buffer[] = [];
        let total = 0;
        let exceeded = false;

        stream.on('data', (chunk: Buffer) => {
          if (exceeded) {
            return;
          }
          total += chunk.length;
          if (total > maxBytes) {
            exceeded = true;
            stream?.destroy();
            response.destroy();
            finish(
              failure(options.url, started, {
                kind: 'too-large',
                status,
                message: `Response exceeded the ${maxBytes} byte decoded limit`
              })
            );
            return;
          }
          chunks.push(chunk);
        });

        stream.on('error', (error: Error) => {
          if (settled) {
            return;
          }
          finish(
            failure(options.url, started, {
              kind: classifyError(error),
              status,
              message: error.message
            })
          );
        });

        stream.on('end', () => {
          if (settled || exceeded) {
            return;
          }
          const body = Buffer.concat(chunks).toString('utf8');
          finish({
            ok: true,
            url: options.url,
            status,
            headers: normalizeHeaders(response.headers),
            bodyText: body,
            byteLength: total,
            durationMs: Date.now() - started,
            redirected: false
          });
        });
      }
    );

    request.on('error', (error: Error) => {
      if (settled) {
        return;
      }
      if (error.message === '__timeout__' || error.message === '__cancelled__') {
        return; // Already handled by the timer/abort path.
      }
      finish(
        failure(options.url, started, {
          kind: classifyError(error),
          message: error.message
        })
      );
    });

    request.end();
  });
}

function decodingStream(
  response: http.IncomingMessage,
  encoding: string
): Readable {
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return response.pipe(zlib.createGunzip());
    case 'deflate':
      return response.pipe(zlib.createInflate());
    case 'br':
      return response.pipe(zlib.createBrotliDecompress());
    default:
      return response;
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function classifyError(error: Error): FailureKind {
  const code = (error as NodeJS.ErrnoException).code ?? '';
  if (
    code.startsWith('ERR_TLS') ||
    code.startsWith('CERT_') ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN'
  ) {
    return 'tls';
  }
  if (code.startsWith('Z_') || code === 'Z_DATA_ERROR') {
    return 'network';
  }
  return 'network';
}

function failure(
  url: string,
  started: number,
  info: RunFailureInfo
): RunFailure {
  return {
    ok: false,
    url,
    durationMs: Date.now() - started,
    failure: info
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

function normalizeHeaders(
  headers: http.IncomingHttpHeaders
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

// Re-export for callers that construct streams without importing node:stream.
export { pipeline };
