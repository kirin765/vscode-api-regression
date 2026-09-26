import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

export const LICENSE_PREFIX = 'AR1';
export const LICENSE_PRODUCT = 'api-regression';
export const TRIAL_DAYS = 14;
export const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

export interface LicensePayload {
  v: 1;
  product: string;
  serial: string;
  email: string;
  kind: 'perpetual' | 'subscription';
  majorVersion: number;
  issuedAt: string;
  expiresAt?: string;
}

export type LicenseFailureReason =
  | 'malformed'
  | 'bad-signature'
  | 'wrong-product'
  | 'unsupported-version'
  | 'expired'
  | 'revoked';

export interface LicenseVerification {
  valid: boolean;
  payload?: LicensePayload;
  reason?: LicenseFailureReason;
  message?: string;
}

export interface VerifyLicenseOptions {
  publicKeyPem: string;
  now?: Date;
  revokedSerials?: readonly string[];
  expectedMajorVersion?: number;
}

export function verifyLicense(
  token: string,
  options: VerifyLicenseOptions
): LicenseVerification {
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) {
    return fail('malformed', 'License key is not in the expected format');
  }
  const payloadPart = parts[1] as string;
  const signaturePart = parts[2] as string;

  let payloadBytes: Buffer;
  let signature: Buffer;
  try {
    payloadBytes = base64UrlDecode(payloadPart);
    signature = base64UrlDecode(signaturePart);
  } catch {
    return fail('malformed', 'License key contains invalid base64 data');
  }

  let payload: LicensePayload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8')) as LicensePayload;
  } catch {
    return fail('malformed', 'License payload is not valid JSON');
  }

  if (payload.v !== 1) {
    return fail('unsupported-version', `Unsupported license version ${String(payload.v)}`);
  }
  if (payload.product !== LICENSE_PRODUCT) {
    return fail('wrong-product', 'License belongs to a different product');
  }

  let publicKey;
  try {
    publicKey = createPublicKey(options.publicKeyPem);
  } catch {
    return fail('malformed', 'Embedded public key could not be loaded');
  }

  let signatureOk = false;
  try {
    signatureOk = cryptoVerify(null, payloadBytes, publicKey, signature);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    return fail('bad-signature', 'License signature is not valid');
  }

  const revoked = options.revokedSerials ?? [];
  if (payload.serial && revoked.includes(payload.serial)) {
    return fail('revoked', 'License serial has been revoked');
  }

  const now = options.now ?? new Date();
  if (payload.expiresAt) {
    const expiry = new Date(payload.expiresAt);
    if (Number.isNaN(expiry.getTime())) {
      return fail('malformed', 'License expiry date is invalid');
    }
    if (expiry.getTime() <= now.getTime()) {
      return fail('expired', `License expired on ${payload.expiresAt}`);
    }
  }

  if (
    options.expectedMajorVersion !== undefined &&
    payload.majorVersion !== options.expectedMajorVersion
  ) {
    return {
      valid: false,
      payload,
      reason: 'unsupported-version',
      message: `License covers major version ${payload.majorVersion}; this build is major version ${options.expectedMajorVersion}`
    };
  }

  return { valid: true, payload };
}

export interface AccessEvaluation {
  state: 'licensed' | 'trial' | 'expired' | 'unlicensed';
  trialDaysTotal: number;
  trialDaysLeft?: number;
  trialStartedAt?: string;
  payload?: LicensePayload;
  /** Present when a supplied license was rejected. */
  licenseError?: string;
  message: string;
}

export interface AccessInput {
  trialStartedAt?: string;
  licenseToken?: string;
  publicKeyPem: string;
  now?: Date;
  revokedSerials?: readonly string[];
  expectedMajorVersion?: number;
}

export function evaluateAccess(input: AccessInput): AccessEvaluation {
  const now = input.now ?? new Date();

  let licenseError: string | undefined;
  if (input.licenseToken && input.licenseToken.trim().length > 0) {
    const result = verifyLicense(input.licenseToken, {
      publicKeyPem: input.publicKeyPem,
      now,
      revokedSerials: input.revokedSerials,
      expectedMajorVersion: input.expectedMajorVersion
    });
    if (result.valid && result.payload) {
      return {
        state: 'licensed',
        trialDaysTotal: TRIAL_DAYS,
        payload: result.payload,
        message: `Licensed to ${result.payload.email} (${result.payload.kind})`
      };
    }
    licenseError = result.message;
  }

  if (input.trialStartedAt) {
    const started = new Date(input.trialStartedAt);
    if (!Number.isNaN(started.getTime())) {
      const elapsed = now.getTime() - started.getTime();
      const remaining = TRIAL_MS - elapsed;
      if (remaining > 0) {
        const daysLeft = Math.ceil(remaining / (24 * 60 * 60 * 1000));
        return {
          state: 'trial',
          trialDaysTotal: TRIAL_DAYS,
          trialDaysLeft: daysLeft,
          trialStartedAt: input.trialStartedAt,
          licenseError,
          message: `Trial active: ${daysLeft} day(s) remaining`
        };
      }
      return {
        state: 'expired',
        trialDaysTotal: TRIAL_DAYS,
        trialDaysLeft: 0,
        trialStartedAt: input.trialStartedAt,
        licenseError,
        message: 'Trial has ended. Enter a license key to continue.'
      };
    }
    return {
      state: 'unlicensed',
      trialDaysTotal: TRIAL_DAYS,
      trialStartedAt: input.trialStartedAt,
      licenseError,
      message: 'Trial start date is invalid; restart the trial or enter a license key.'
    };
  }

  return {
    state: 'unlicensed',
    trialDaysTotal: TRIAL_DAYS,
    licenseError,
    message: `No trial started and no license key entered (${TRIAL_DAYS}-day trial available).`
  };
}

function fail(reason: LicenseFailureReason, message: string): LicenseVerification {
  return { valid: false, reason, message };
}

export function base64UrlEncode(bytes: Buffer): string {
  return bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + padding, 'base64');
}
