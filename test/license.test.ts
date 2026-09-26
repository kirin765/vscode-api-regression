import { describe, expect, it } from 'vitest';
import {
  generateKeyPairSync,
  sign as cryptoSign,
  KeyObject
} from 'node:crypto';
import {
  evaluateAccess,
  verifyLicense,
  base64UrlEncode,
  LicensePayload,
  TRIAL_DAYS
} from '../src/licensing/license.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function issue(
  payload: Partial<LicensePayload>,
  key: KeyObject = privateKey
): string {
  const full: LicensePayload = {
    v: 1,
    product: 'api-regression',
    serial: 'SER-1',
    email: 'buyer@example.com',
    kind: 'perpetual',
    majorVersion: 1,
    issuedAt: '2026-01-01T00:00:00.000Z',
    ...payload
  };
  const payloadBytes = Buffer.from(JSON.stringify(full), 'utf8');
  const signature = cryptoSign(null, payloadBytes, key);
  return `AR1.${base64UrlEncode(payloadBytes)}.${base64UrlEncode(signature)}`;
}

describe('verifyLicense', () => {
  it('accepts a correctly signed perpetual license', () => {
    const token = issue({ majorVersion: 1 });
    const result = verifyLicense(token, {
      publicKeyPem: publicPem,
      expectedMajorVersion: 1
    });
    expect(result.valid).toBe(true);
    expect(result.payload?.email).toBe('buyer@example.com');
  });

  it('rejects a tampered payload', () => {
    const token = issue({ majorVersion: 1 });
    const parts = token.split('.');
    const tampered = JSON.parse(
      Buffer.from(parts[1] as string, 'base64').toString('utf8')
    );
    tampered.email = 'attacker@example.com';
    const forged = `AR1.${base64UrlEncode(Buffer.from(JSON.stringify(tampered)))}.${parts[2]}`;
    const result = verifyLicense(forged, { publicKeyPem: publicPem });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad-signature');
  });

  it('rejects a license signed by a different key', () => {
    const other = generateKeyPairSync('ed25519');
    const token = issue({ majorVersion: 1 }, other.privateKey);
    const result = verifyLicense(token, { publicKeyPem: publicPem });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad-signature');
  });

  it('rejects a malformed key', () => {
    expect(verifyLicense('nope', { publicKeyPem: publicPem }).reason).toBe('malformed');
    expect(verifyLicense('AR1.abc.def', { publicKeyPem: publicPem }).reason).toBe('malformed');
  });

  it('rejects the wrong product', () => {
    const token = issue({ product: 'other-product' });
    expect(verifyLicense(token, { publicKeyPem: publicPem }).reason).toBe('wrong-product');
  });

  it('rejects an expired subscription', () => {
    const token = issue({ kind: 'subscription', expiresAt: '2020-01-01T00:00:00.000Z' });
    const result = verifyLicense(token, {
      publicKeyPem: publicPem,
      now: new Date('2026-01-01T00:00:00.000Z')
    });
    expect(result.reason).toBe('expired');
  });

  it('rejects a revoked serial', () => {
    const token = issue({ serial: 'SER-REVOKED' });
    const result = verifyLicense(token, {
      publicKeyPem: publicPem,
      revokedSerials: ['SER-REVOKED']
    });
    expect(result.reason).toBe('revoked');
  });

  it('rejects a license for a different major version', () => {
    const token = issue({ majorVersion: 1 });
    const result = verifyLicense(token, {
      publicKeyPem: publicPem,
      expectedMajorVersion: 2
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unsupported-version');
  });
});

describe('evaluateAccess', () => {
  it('reports unlicensed with no trial and no key', () => {
    const state = evaluateAccess({ publicKeyPem: publicPem });
    expect(state.state).toBe('unlicensed');
    expect(state.trialDaysTotal).toBe(TRIAL_DAYS);
  });

  it('reports an active trial', () => {
    const now = new Date('2026-01-05T00:00:00.000Z');
    const state = evaluateAccess({
      publicKeyPem: publicPem,
      trialStartedAt: '2026-01-01T00:00:00.000Z',
      now
    });
    expect(state.state).toBe('trial');
    expect(state.trialDaysLeft).toBe(TRIAL_DAYS - 4);
  });

  it('treats an interrupted-then-existing trial as still started', () => {
    const state = evaluateAccess({
      publicKeyPem: publicPem,
      trialStartedAt: '2026-01-01T00:00:00.000Z',
      now: new Date('2026-01-02T00:00:00.000Z')
    });
    expect(state.state).toBe('trial');
  });

  it('expires the trial after the period', () => {
    const state = evaluateAccess({
      publicKeyPem: publicPem,
      trialStartedAt: '2026-01-01T00:00:00.000Z',
      now: new Date('2026-03-01T00:00:00.000Z')
    });
    expect(state.state).toBe('expired');
  });

  it('prefers a valid license over an expired trial', () => {
    const token = issue({ majorVersion: 0 });
    const state = evaluateAccess({
      publicKeyPem: publicPem,
      licenseToken: token,
      trialStartedAt: '2020-01-01T00:00:00.000Z',
      now: new Date('2026-01-01T00:00:00.000Z')
    });
    expect(state.state).toBe('licensed');
  });

  it('falls back to trial when the license is invalid and surfaces the error', () => {
    const state = evaluateAccess({
      publicKeyPem: publicPem,
      licenseToken: 'AR1.bad.bad',
      trialStartedAt: '2026-01-01T00:00:00.000Z',
      now: new Date('2026-01-02T00:00:00.000Z')
    });
    expect(state.state).toBe('trial');
    expect(state.licenseError).toBeDefined();
  });
});
