import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/host/**/*.test.js',
  version: 'stable',
  workspaceFolder: 'test/fixtures/workspace',
  launchArgs: ['--disable-extensions'],
  mocha: {
    ui: 'bdd',
    timeout: 60000
  }
});
