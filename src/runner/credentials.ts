import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { SecretLookup } from './resolve.js';

interface CredentialIndexEntry {
  profile: string;
  origin: string;
}

/**
 * Credentials are stored in VS Code SecretStorage, keyed by workspace, profile
 * and destination origin. A credential is therefore never sent to a different
 * origin after a base URL change; the lookup simply misses and the user is
 * asked to re-enter it.
 */
export class CredentialStore implements SecretLookup {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private get workspaceId(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const identity = folder ? folder.uri.toString() : 'no-workspace';
    return createHash('sha256').update(identity).digest('hex').slice(0, 16);
  }

  private secretKey(profile: string, origin: string): string {
    return `apiRegression.cred.${this.workspaceId}.${encodeURIComponent(profile)}.${encodeURIComponent(origin)}`;
  }

  private get indexKey(): string {
    return `apiRegression.credIndex.${this.workspaceId}`;
  }

  async get(profile: string, origin: string): Promise<string | undefined> {
    return this.context.secrets.get(this.secretKey(profile, origin));
  }

  async set(profile: string, origin: string, secret: string): Promise<void> {
    await this.context.secrets.store(this.secretKey(profile, origin), secret);
    await this.addToIndex({ profile, origin });
  }

  async delete(profile: string, origin: string): Promise<void> {
    await this.context.secrets.delete(this.secretKey(profile, origin));
    const index = await this.readIndex();
    await this.writeIndex(
      index.filter((entry) => !(entry.profile === profile && entry.origin === origin))
    );
  }

  async list(): Promise<CredentialIndexEntry[]> {
    return this.readIndex();
  }

  /** Re-associates a stored credential with a new origin after explicit consent. */
  async reassociate(
    profile: string,
    oldOrigin: string,
    newOrigin: string
  ): Promise<boolean> {
    const secret = await this.get(profile, oldOrigin);
    if (secret === undefined) {
      return false;
    }
    await this.set(profile, newOrigin, secret);
    await this.delete(profile, oldOrigin);
    return true;
  }

  private async readIndex(): Promise<CredentialIndexEntry[]> {
    const entries = this.context.globalState.get<CredentialIndexEntry[]>(
      this.indexKey,
      []
    );
    return Array.isArray(entries) ? entries : [];
  }

  private async writeIndex(entries: CredentialIndexEntry[]): Promise<void> {
    await this.context.globalState.update(this.indexKey, entries);
  }

  private async addToIndex(entry: CredentialIndexEntry): Promise<void> {
    const index = await this.readIndex();
    if (
      index.some(
        (item) => item.profile === entry.profile && item.origin === entry.origin
      )
    ) {
      return;
    }
    await this.writeIndex([...index, entry]);
  }
}
