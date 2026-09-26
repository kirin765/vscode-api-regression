import * as vscode from 'vscode';

export const PREVIEW_SCHEME = 'api-regression-preview';

/**
 * Serves in-memory documents for the native diff editor and response previews.
 * Contents are kept only for the session and never written to disk.
 */
export class PreviewContentProvider
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private counter = 0;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  /** Registers content and returns a unique URI that serves it. */
  create(key: string, content: string): vscode.Uri {
    this.counter += 1;
    const uri = vscode.Uri.from({
      scheme: PREVIEW_SCHEME,
      path: `/${sanitize(key)}-${this.counter}.json`
    });
    this.contents.set(uri.toString(), content);
    return uri;
  }

  dispose(): void {
    this.contents.clear();
    this.emitter.dispose();
  }
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}
