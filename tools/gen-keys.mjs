#!/usr/bin/env node
/**
 * Generates an Ed25519 key pair for license signing.
 *
 * Writes private and public PEM files into `.secrets/` (git-ignored) and prints
 * the public key to paste into `src/licensing/publicKey.ts`. Keep the private
 * key offline; it must never be committed or shipped.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const secretsDir = resolve(here, '../.secrets');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
mkdirSync(secretsDir, { recursive: true });

const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

writeFileSync(resolve(secretsDir, 'license-private.pem'), privatePem, {
  mode: 0o600
});
writeFileSync(resolve(secretsDir, 'license-public.pem'), publicPem);

console.log('Wrote .secrets/license-private.pem and .secrets/license-public.pem\n');
console.log('Embed this public key in src/licensing/publicKey.ts:\n');
console.log(publicPem);
