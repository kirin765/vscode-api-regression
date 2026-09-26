import * as vscode from 'vscode';
import {
  ApiRegressionConfig,
  CONFIG_DIR,
  CONFIG_RELATIVE_PATH,
  createConfigTemplate
} from '../config/schema.js';
import { ValidationIssue, validateConfig, formatIssues } from '../config/validate.js';

export interface LoadedConfig {
  config: ApiRegressionConfig;
  issues: ValidationIssue[];
  uri: vscode.Uri;
}

export interface ConfigLoadFailure {
  issues: ValidationIssue[];
  uri?: vscode.Uri;
  rawText?: string;
}

export class ConfigStore {
  private get workspaceFolder(): vscode.WorkspaceFolder | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }
    return folders[0];
  }

  get uri(): vscode.Uri | undefined {
    const folder = this.workspaceFolder;
    if (!folder) {
      return undefined;
    }
    return vscode.Uri.joinPath(folder.uri, ...CONFIG_RELATIVE_PATH.split('/'));
  }

  async exists(): Promise<boolean> {
    const uri = this.uri;
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

  async readText(): Promise<string | undefined> {
    const uri = this.uri;
    if (!uri) {
      return undefined;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return undefined;
    }
  }

  async load(): Promise<LoadedConfig | ConfigLoadFailure> {
    const uri = this.uri;
    if (!uri || !this.workspaceFolder) {
      return {
        issues: [
          {
            path: '$',
            message: 'Open a local folder to use API Regression',
            severity: 'error'
          }
        ]
      };
    }

    const text = await this.readText();
    if (text === undefined) {
      return {
        issues: [
          {
            path: '$',
            message: `No configuration found at ${CONFIG_RELATIVE_PATH}. Run "API Regression: Create Configuration".`,
            severity: 'error'
          }
        ],
        uri
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return {
        issues: [
          {
            path: '$',
            message: `Configuration is not valid JSON: ${
              error instanceof Error ? error.message : String(error)
            }`,
            severity: 'error'
          }
        ],
        uri,
        rawText: text
      };
    }

    const result = validateConfig(parsed);
    if (!result.ok || !result.config) {
      return { issues: result.issues, uri, rawText: text };
    }
    return { config: result.config, issues: result.issues, uri };
  }

  async createTemplate(): Promise<vscode.Uri | undefined> {
    const folder = this.workspaceFolder;
    if (!folder) {
      return undefined;
    }
    const uri = vscode.Uri.joinPath(folder.uri, ...CONFIG_RELATIVE_PATH.split('/'));
    const dir = vscode.Uri.joinPath(folder.uri, CONFIG_DIR);
    await vscode.workspace.fs.createDirectory(dir);
    const content = JSON.stringify(createConfigTemplate(), null, 2) + '\n';
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    return uri;
  }

  watch(onChange: () => void): vscode.Disposable {
    const folder = this.workspaceFolder;
    if (!folder) {
      return new vscode.Disposable(() => undefined);
    }
    const pattern = new vscode.RelativePattern(folder, CONFIG_RELATIVE_PATH);
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    return vscode.Disposable.from(
      watcher,
      watcher.onDidChange(onChange),
      watcher.onDidCreate(onChange),
      watcher.onDidDelete(onChange)
    );
  }
}

export function describeLoadFailure(failure: ConfigLoadFailure): string {
  return formatIssues(failure.issues);
}
