import * as vscode from 'vscode';
import { Snapshot } from '../snapshot/snapshot.js';

export interface SnapshotMeta {
  etag: string;
  mtime: number;
  size: number;
}

export interface StoredSnapshot {
  snapshot: Snapshot;
  meta: SnapshotMeta;
}

export interface StoredSnapshotInfo {
  endpointId: string;
  environment: string;
  uri: vscode.Uri;
  meta: SnapshotMeta;
}

export class SnapshotConflictError extends Error {
  constructor(readonly expectedEtag: string, readonly actualEtag: string | undefined) {
    super('Baseline changed since it was loaded; reload before writing');
    this.name = 'SnapshotConflictError';
  }
}

export class SnapshotStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  get root(): vscode.Uri | undefined {
    return this.context.storageUri ?? this.context.globalStorageUri;
  }

  private uriFor(endpointId: string, environment: string): vscode.Uri | undefined {
    const root = this.root;
    if (!root) {
      return undefined;
    }
    return vscode.Uri.joinPath(root, 'baselines', fileName(endpointId, environment));
  }

  async exists(endpointId: string, environment: string): Promise<boolean> {
    const uri = this.uriFor(endpointId, environment);
    if (!uri) {
      return false;
    }
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  async read(
    endpointId: string,
    environment: string
  ): Promise<StoredSnapshot | undefined> {
    const uri = this.uriFor(endpointId, environment);
    if (!uri) {
      return undefined;
    }
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      return undefined;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    const snapshot = JSON.parse(Buffer.from(bytes).toString('utf8')) as Snapshot;
    return { snapshot, meta: metaOf(stat) };
  }

  async write(
    snapshot: Snapshot,
    options: { expectedEtag?: string } = {}
  ): Promise<SnapshotMeta> {
    const uri = this.uriFor(snapshot.endpointId, snapshot.environment);
    if (!uri) {
      throw new Error('No extension storage location is available');
    }
    const dir = vscode.Uri.joinPath(uri, '..');
    await vscode.workspace.fs.createDirectory(dir);

    if (options.expectedEtag !== undefined) {
      const current = await this.statOrUndefined(uri);
      const actualEtag = current ? metaOf(current).etag : undefined;
      if (actualEtag !== options.expectedEtag) {
        throw new SnapshotConflictError(options.expectedEtag, actualEtag);
      }
    }

    const content = JSON.stringify(snapshot, null, 2) + '\n';
    const tempUri = vscode.Uri.joinPath(
      dir,
      `.${fileName(snapshot.endpointId, snapshot.environment)}.${Date.now()}.tmp`
    );
    await vscode.workspace.fs.writeFile(tempUri, Buffer.from(content, 'utf8'));
    try {
      await vscode.workspace.fs.rename(tempUri, uri, { overwrite: true });
    } catch (error) {
      try {
        await vscode.workspace.fs.delete(tempUri);
      } catch {
        // Ignore cleanup failures.
      }
      throw error;
    }
    const stat = await vscode.workspace.fs.stat(uri);
    return metaOf(stat);
  }

  async delete(endpointId: string, environment: string): Promise<boolean> {
    const uri = this.uriFor(endpointId, environment);
    if (!uri) {
      return false;
    }
    try {
      await vscode.workspace.fs.delete(uri);
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<StoredSnapshotInfo[]> {
    const root = this.root;
    if (!root) {
      return [];
    }
    const dir = vscode.Uri.joinPath(root, 'baselines');
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return [];
    }
    const result: StoredSnapshotInfo[] = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.json')) {
        continue;
      }
      const parsed = parseFileName(name);
      if (!parsed) {
        continue;
      }
      const uri = vscode.Uri.joinPath(dir, name);
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        result.push({ ...parsed, uri, meta: metaOf(stat) });
      } catch {
        // Skip unreadable entries.
      }
    }
    return result;
  }

  /** Exports a redacted baseline into the workspace through an explicit action. */
  async exportTo(destination: vscode.Uri, snapshot: Snapshot): Promise<void> {
    const content = JSON.stringify(snapshot, null, 2) + '\n';
    await vscode.workspace.fs.writeFile(destination, Buffer.from(content, 'utf8'));
  }

  private async statOrUndefined(
    uri: vscode.Uri
  ): Promise<vscode.FileStat | undefined> {
    try {
      return await vscode.workspace.fs.stat(uri);
    } catch {
      return undefined;
    }
  }
}

function metaOf(stat: vscode.FileStat): SnapshotMeta {
  return { etag: `${stat.mtime}:${stat.size}`, mtime: stat.mtime, size: stat.size };
}

const FILE_SEPARATOR = '~';

function fileName(endpointId: string, environment: string): string {
  return `${toBase64Url(endpointId)}${FILE_SEPARATOR}${toBase64Url(environment)}.json`;
}

function parseFileName(name: string): { endpointId: string; environment: string } | undefined {
  const base = name.replace(/\.json$/, '');
  const separator = base.indexOf(FILE_SEPARATOR);
  if (separator === -1) {
    return undefined;
  }
  try {
    return {
      endpointId: fromBase64Url(base.slice(0, separator)),
      environment: fromBase64Url(base.slice(separator + 1))
    };
  } catch {
    return undefined;
  }
}

function toBase64Url(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + padding, 'base64').toString('utf8');
}
