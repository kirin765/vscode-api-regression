import http from 'node:http';
import zlib from 'node:zlib';

const FIXED = '2026-01-01T00:00:00.000Z';
const CHANGED = '2026-02-01T00:00:00.000Z';

function defaultProducts() {
  return {
    meta: { timestamp: FIXED, updatedAt: FIXED, version: 2 },
    items: [
      {
        id: 1,
        name: 'Widget',
        price: 19.99,
        currency: 'USD',
        tags: ['a', 'b'],
        updatedAt: FIXED
      },
      {
        id: 2,
        name: 'Gadget',
        price: 5,
        currency: 'USD',
        tags: [],
        updatedAt: FIXED
      }
    ]
  };
}

function variantBody(variant) {
  switch (variant) {
    case 'changed': {
      const value = defaultProducts();
      value.meta.updatedAt = CHANGED;
      value.items = [
        {
          id: 1,
          name: 'Widget',
          price: '19.99', // number -> string
          currency: 'USD',
          tags: ['a', 'b'],
          updatedAt: CHANGED
        },
        {
          id: 3, // item 2 removed, item 3 added
          name: 'Gizmo',
          price: 7.5,
          currency: 'USD',
          tags: [],
          updatedAt: CHANGED
        }
      ];
      return value;
    }
    case 'reorder': {
      // Same values, different object key order throughout.
      return {
        items: [
          {
            updatedAt: FIXED,
            tags: ['a', 'b'],
            currency: 'USD',
            price: 19.99,
            name: 'Widget',
            id: 1
          },
          {
            updatedAt: FIXED,
            tags: [],
            currency: 'USD',
            price: 5,
            name: 'Gadget',
            id: 2
          }
        ],
        meta: { version: 2, updatedAt: FIXED, timestamp: FIXED }
      };
    }
    case 'array-reorder': {
      const value = defaultProducts();
      value.items.reverse();
      return value;
    }
    case 'dup-keys': {
      const value = defaultProducts();
      value.items.push({ ...value.items[0] });
      return value;
    }
    case 'missing-key': {
      const value = defaultProducts();
      delete value.items[0].id;
      return value;
    }
    case 'removed-null': {
      const value = defaultProducts();
      value.items[0].note = null;
      delete value.items[1].currency;
      return value;
    }
    case 'numeric-string': {
      const value = defaultProducts();
      value.items[0].price = '19.99';
      return value;
    }
    case 'changed-null': {
      const value = defaultProducts();
      value.items[0].currency = null;
      return value;
    }
    default:
      return defaultProducts();
  }
}

function serialize(value, bigNumber) {
  let text = JSON.stringify(value, null, 2);
  if (bigNumber !== undefined) {
    text = text.replace('"@@BIG@@"', bigNumber);
  }
  return text;
}

export function createServer() {
  // `mode` models a deployed API version. Change it at runtime via the
  // /__demo/mode endpoint to simulate shipping a code change between a
  // baseline capture and a rerun.
  const state = {
    requests: 0,
    lastHeaders: undefined,
    mode: process.env.DEMO_MODE ?? 'default'
  };

  const server = http.createServer((req, res) => {
    state.requests += 1;
    state.lastHeaders = { ...req.headers };
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const variant =
      url.searchParams.get('variant') ??
      req.headers['x-demo-variant'] ??
      (url.searchParams.has('reset') ? 'default' : state.mode);

    const json = (status, body, extraHeaders = {}) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        ...extraHeaders
      });
      res.end(body);
    };

    if (path === '/__demo/mode') {
      const requested = url.searchParams.get('set');
      if (requested) {
        state.mode = requested;
      }
      json(200, JSON.stringify({ mode: state.mode }));
      return;
    }

    if (path === '/api/products') {
      json(200, serialize(variantBody(variant)));
      return;
    }

    if (path === '/api/products/big') {
      const value = defaultProducts();
      value.bigNumber = '@@BIG@@';
      const big =
        variant === 'changed' ? '9007199254740994' : '9007199254740993';
      json(200, serialize(value, big));
      return;
    }

    if (path === '/api/status') {
      const code = Number(url.searchParams.get('code') ?? '200');
      json(code, JSON.stringify({ status: code }));
      return;
    }

    if (path === '/api/malformed') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not json at all');
      return;
    }

    if (path === '/api/empty') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('');
      return;
    }

    if (path === '/api/slow') {
      const ms = Number(url.searchParams.get('ms') ?? '20000');
      setTimeout(() => json(200, JSON.stringify({ waitedMs: ms })), ms);
      return;
    }

    if (path === '/api/large') {
      const bytes = Number(url.searchParams.get('bytes') ?? '3000000');
      const chunk = 'x'.repeat(1024);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"data":"');
      let written = 0;
      const write = () => {
        while (written < bytes) {
          written += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', write);
            return;
          }
        }
        res.end('"}');
      };
      write();
      return;
    }

    if (path === '/api/redirect') {
      res.writeHead(302, { location: '/api/products' });
      res.end();
      return;
    }

    if (path === '/api/gzip') {
      const body = zlib.gzipSync(Buffer.from(serialize(defaultProducts())));
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip'
      });
      res.end(body);
      return;
    }

    if (path === '/api/auth') {
      const authorization = req.headers.authorization;
      const apiKey = req.headers['x-api-key'];
      const ok =
        authorization === 'Bearer test-token' || apiKey === 'test-api-key';
      if (!ok) {
        json(401, JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      json(
        200,
        JSON.stringify({
          ok: true,
          hasAuthorization: Boolean(authorization),
          hasApiKey: Boolean(apiKey)
        })
      );
      return;
    }

    if (path === '/api/echo') {
      json(
        200,
        JSON.stringify({
          method: req.method,
          path,
          hasAuthorization: Boolean(req.headers.authorization),
          hasApiKey: Boolean(req.headers['x-api-key']),
          custom: req.headers['x-custom'] ?? null
        })
      );
      return;
    }

    json(404, JSON.stringify({ error: 'not found', path }));
  });

  return { server, state };
}

export function startServer(port = 0, host = '127.0.0.1') {
  const { server, state } = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        server,
        state,
        port: actualPort,
        url: `http://${host}:${actualPort}`,
        close: () =>
          new Promise((res) => {
            server.close(() => res());
          })
      });
    });
  });
}

const isMain =
  process.argv[1] && process.argv[1].endsWith('server.mjs');

if (isMain) {
  const port = Number(process.env.PORT ?? 8787);
  startServer(port)
    .then((handle) => {
      console.log(`Synthetic API listening on ${handle.url}`);
      console.log('Try:');
      console.log(`  curl ${handle.url}/api/products`);
      console.log(`  curl -H 'x-demo-variant: changed' ${handle.url}/api/products`);
      console.log('Press Ctrl+C to stop.');
      process.on('SIGINT', () => {
        handle.close().then(() => process.exit(0));
      });
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
