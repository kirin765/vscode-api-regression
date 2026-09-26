import * as vscode from 'vscode';
import {
  AccessEvaluation,
  evaluateAccess,
  verifyLicense,
  TRIAL_DAYS
} from './license.js';
import { LICENSE_PUBLIC_KEY_PEM, LICENSE_MAJOR_VERSION } from './publicKey.js';

const TRIAL_STARTED_KEY = 'apiRegression.trialStartedAt';
const REVOKED_SERIALS_KEY = 'apiRegression.revokedSerials';
const LICENSE_SECRET_KEY = 'apiRegression.license';

export class LicenseManager {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly publicKeyPem: string = LICENSE_PUBLIC_KEY_PEM
  ) {}

  async getTrialStartedAt(): Promise<string | undefined> {
    return this.context.globalState.get<string>(TRIAL_STARTED_KEY);
  }

  async getLicenseToken(): Promise<string | undefined> {
    return this.context.secrets.get(LICENSE_SECRET_KEY);
  }

  async getRevokedSerials(): Promise<string[]> {
    return this.context.globalState.get<string[]>(REVOKED_SERIALS_KEY, []);
  }

  async evaluate(): Promise<AccessEvaluation> {
    const token = await this.getLicenseToken();
    return evaluateAccess({
      trialStartedAt: await this.getTrialStartedAt(),
      licenseToken: token,
      publicKeyPem: this.publicKeyPem,
      revokedSerials: await this.getRevokedSerials(),
      expectedMajorVersion: LICENSE_MAJOR_VERSION
    });
  }

  async startTrial(): Promise<AccessEvaluation> {
    const existing = await this.getTrialStartedAt();
    if (!existing) {
      await this.context.globalState.update(
        TRIAL_STARTED_KEY,
        new Date().toISOString()
      );
    }
    return this.evaluate();
  }

  async setLicense(
    token: string
  ): Promise<{ ok: boolean; message: string }> {
    const result = verifyLicense(token, {
      publicKeyPem: this.publicKeyPem,
      revokedSerials: await this.getRevokedSerials(),
      expectedMajorVersion: LICENSE_MAJOR_VERSION
    });
    if (!result.valid) {
      return { ok: false, message: result.message ?? 'License could not be verified' };
    }
    await this.context.secrets.store(LICENSE_SECRET_KEY, token);
    return { ok: true, message: result.payload ? `Licensed to ${result.payload.email}` : 'Licensed' };
  }

  async clearLicense(): Promise<void> {
    await this.context.secrets.delete(LICENSE_SECRET_KEY);
  }

  async revoke(serial: string): Promise<void> {
    const serials = await this.getRevokedSerials();
    if (!serials.includes(serial)) {
      await this.context.globalState.update(REVOKED_SERIALS_KEY, [...serials, serial]);
    }
  }

  /**
   * Gate for local-only features. Network execution is separately gated by
   * Workspace Trust; licensing never blocks access to files the user owns.
   */
  async hasActiveAccess(): Promise<boolean> {
    const state = await this.evaluate();
    return state.state === 'licensed' || state.state === 'trial';
  }
}

export const TRIAL_PERIOD_DAYS = TRIAL_DAYS;
