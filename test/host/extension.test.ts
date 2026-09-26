import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';

suite('API Regression extension host', () => {
  test('registers all contributed commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    const expected = [
      'apiRegression.initConfig',
      'apiRegression.openConfig',
      'apiRegression.validateConfig',
      'apiRegression.captureBaseline',
      'apiRegression.rerunEndpoint',
      'apiRegression.rerunGroup',
      'apiRegression.replaceBaseline',
      'apiRegression.exportReport',
      'apiRegression.exportBaseline',
      'apiRegression.manageCredentials',
      'apiRegression.deleteBaseline',
      'apiRegression.refresh',
      'apiRegression.licenseStatus',
      'apiRegression.startTrial',
      'apiRegression.enterLicense'
    ];
    for (const command of expected) {
      assert.ok(
        commands.includes(command),
        `expected command ${command} to be registered`
      );
    }
  });

  test('creates a configuration template in the workspace', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'extension host tests should run in a workspace folder');
    const configUri = vscode.Uri.joinPath(
      folder.uri,
      '.api-regression',
      'config.json'
    );
    try {
      await vscode.workspace.fs.delete(configUri);
    } catch {
      // No existing config; that is fine.
    }
    await vscode.commands.executeCommand('apiRegression.initConfig');
    const bytes = await vscode.workspace.fs.readFile(configUri);
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
    assert.strictEqual(parsed.schemaVersion, 1);
    assert.ok(Array.isArray(parsed.endpoints));
    assert.ok(parsed.environments.local);
  });

  test('validates without throwing', async () => {
    await vscode.commands.executeCommand('apiRegression.validateConfig');
  });

  test('refresh does not throw with no configuration', async () => {
    await vscode.commands.executeCommand('apiRegression.refresh');
  });

  test('exporting a report without a run surfaces an error, not a crash', async () => {
    // Should resolve without throwing; it shows an error message instead.
    await vscode.commands.executeCommand('apiRegression.exportReport');
  });
});
