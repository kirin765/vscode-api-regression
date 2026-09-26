#!/usr/bin/env node
/**
 * Issues a signed API Regression license key.
 *
 * Usage:
 *   node tools/issue-license.mjs --email buyer@example.com [options]
 *
 * Options:
 *   --email <address>     Buyer email (required)
 *   --serial <id>         Serial number (default: timestamp based)
 *   --kind <type>         perpetual | subscription (default: perpetual)
 *   --major <n>           Covered major version (default: 0)
 *   --expires <ISO date>  Optional expiry; required for subscriptions
 *   --key <path>          Private key PEM (default: .secrets/license-private.pem)
 *
 * Prints the license key to stdout. Keep the private key offline.
 */
import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1]?.startsWith('--') ? 'true' : argv[++i];
    args[key] = value;
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args.email) {
  console.error('error: --email is required');
  process.exit(1);
}

const kind = args.kind ?? 'perpetual';
if (kind === 'subscription' && !args.expires) {
  console.error('error: subscription licenses require --expires');
  process.exit(1);
}

const privateKeyPem = readFileSync(
  args.key ? resolve(args.key) : resolve(here, '../.secrets/license-private.pem'),
  'utf8'
);

const payload = {
  v: 1,
  product: 'api-regression',
  serial: args.serial ?? `AR-${Date.now().toString(36).toUpperCase()}`,
  email: args.email,
  kind,
  majorVersion: Number(args.major ?? 0),
  issuedAt: new Date().toISOString()
};
if (args.expires) {
  payload.expiresAt = new Date(args.expires).toISOString();
}

const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
const signature = sign(null, payloadBytes, privateKeyPem);

const b64url = (buffer) =>
  buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

console.log(`AR1.${b64url(payloadBytes)}.${b64url(signature)}`);
