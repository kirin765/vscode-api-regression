import * as vscode from 'vscode';
import { ApiRegressionConfig, EndpointConfig, EndpointRules, CONFIG_DIR } from './config/schema.js';
import { ConfigStore, LoadedConfig, describeLoadFailure } from './storage/configStore.js';
import { SnapshotStore, SnapshotMeta } from './storage/snapshotStore.js';
import { CredentialStore } from './runner/credentials.js';
import { LicenseManager, TRIAL_PERIOD_DAYS } from './licensing/manager.js';
import { PreviewContentProvider } from './ui/contentProvider.js';
import { EndpointNode, EndpointsTreeProvider, ResultsTreeProvider } from './ui/tree.js';
import { RunStateStore, EndpointRunState } from './state.js';
import {
  runRequest,
  RunFailureInfo,
  joinUrl,
  parseUrl
} from './runner/runner.js';
import {
  resolveRequest,
  MissingCredentialError,
  ResolvedRequest
} from './runner/resolve.js';
import { parseJson, JsonParseError } from './json/parse.js';
import { JsonValue } from './json/value.js';
import { stringifyJson } from './json/stringify.js';
import { redactJson } from './snapshot/redact.js';
import {
  SnapshotRules,
  checkSnapshotCompatibility,
  createSnapshot,
  rulesChanged,
  snapshotValue
} from './snapshot/snapshot.js';
import { compare, CompareResult, DiffSummary } from './compare/compare.js';
import { buildMarkdownReport } from './report/markdown.js';
import { validateRulePath } from './json/pointer.js';

interface ExecutionSuccess {
  ok: true;
  status: number;
  value: JsonValue;
  redactedText: string;
  durationMs: number;
  byteLength: number;
}

interface ExecutionFailure {
  ok: false;
  failure: RunFailureInfo;
  durationMs: number;
}

type ExecutionOutcome = ExecutionSuccess | ExecutionFailure;

let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('API Regression');
  const configStore = new ConfigStore();
  const snapshotStore = new SnapshotStore(context);
  const credentials = new CredentialStore(context);
  const licenseManager = new LicenseManager(context);
  const previews = new PreviewContentProvider();
  const runState = new RunStateStore();

  const baselineIndex = new Map<string, SnapshotMeta>();
  const configCache: { current?: ApiRegressionConfig } = {};

  const endpointsTree = new EndpointsTreeProvider(
    () => configCache.current,
    (endpointId, environment) => baselineIndex.get(indexKey(endpointId, environment)),
    runState
  );
  const resultsTree = new ResultsTreeProvider(runState);

  context.subscriptions.push(
    output,
    previews,
    runState,
    endpointsTree,
    resultsTree,
    vscode.workspace.registerTextDocumentContentProvider('api-regression-preview', previews),
    vscode.window.registerTreeDataProvider('apiRegression.endpoints', endpointsTree),
    vscode.window.registerTreeDataProvider('apiRegression.results', resultsTree)
  );

  let disposed = false;
  context.subscriptions.push({ dispose: () => { disposed = true; } });

  const refresh = async (): Promise<void> => {
    const loaded = await configStore.load();
    if (isLoaded(loaded)) {
      configCache.current = loaded.config;
      for (const issue of loaded.issues) {
        appendIssue(issue.severity, issue.path, issue.message);
      }
    } else {
      configCache.current = undefined;
    }
    await refreshBaselines();
    endpointsTree.refresh();
  };

  async function refreshBaselines(): Promise<void> {
    baselineIndex.clear();
    const list = await snapshotStore.list();
    for (const info of list) {
      baselineIndex.set(indexKey(info.endpointId, info.environment), info.meta);
    }
  }

  context.subscriptions.push(configStore.watch(() => void refresh()));
  void refresh();

  const register = (id: string, handler: (...args: any[]) => any) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          await handler(...args);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          output.appendLine(`[error] ${id}: ${message}`);
          if (error instanceof JsonParseError) {
            vscode.window.showErrorMessage(`API Regression: ${message}`);
          } else if (error instanceof MissingCredentialError) {
            vscode.window
              .showErrorMessage(message, 'Manage Credentials')
              .then((choice) => {
                if (choice === 'Manage Credentials') {
                  void vscode.commands.executeCommand('apiRegression.manageCredentials');
                }
              });
          } else {
            vscode.window.showErrorMessage(`API Regression: ${message}`);
          }
        } finally {
          if (!disposed) {
            await refreshBaselines();
            endpointsTree.refresh();
          }
        }
      })
    );
  };

  const loadConfig = async (): Promise<ApiRegressionConfig | undefined> => {
    const loaded = await configStore.load();
    if (!isLoaded(loaded)) {
      const text = describeLoadFailure(loaded);
      const choice = await vscode.window.showErrorMessage(
        'API Regression configuration problem.',
        'Create Configuration',
        'Show Details'
      );
      if (choice === 'Create Configuration') {
        await vscode.commands.executeCommand('apiRegression.initConfig');
      } else if (choice === 'Show Details') {
        output.appendLine(text);
        output.show();
      }
      return undefined;
    }
    configCache.current = loaded.config;
    return loaded.config;
  };

  const getBounds = () => {
    const cfg = vscode.workspace.getConfiguration('apiRegression');
    return {
      timeoutMs: cfg.get<number>('requestTimeoutMs', 15000),
      maxBytes: cfg.get<number>('maxResponseBytes', 2 * 1024 * 1024),
      maxBatch: cfg.get<number>('maxBatchEndpoints', 10),
      maxDiffEntries: cfg.get<number>('maxDiffEntries', 2000)
    };
  };

  const requireTrust = (): boolean => {
    if (!vscode.workspace.isTrusted) {
      vscode.window.showErrorMessage(
        'API Regression: this workspace is not trusted. Network requests are disabled. Trust the workspace to run endpoints.'
      );
      return false;
    }
    return true;
  };

  const hasAccess = async (): Promise<boolean> => {
    const state = await licenseManager.evaluate();
    return state.state === 'licensed' || state.state === 'trial';
  };

  const requireAccess = async (): Promise<boolean> => {
    if (await hasAccess()) {
      return true;
    }
    const state = await licenseManager.evaluate();
    const choice = await vscode.window.showWarningMessage(
      `API Regression: ${state.message}`,
      'Start Trial',
      'Enter License Key'
    );
    if (choice === 'Start Trial') {
      const trial = await licenseManager.startTrial();
      vscode.window.showInformationMessage(`API Regression: ${trial.message}`);
      return trial.state === 'trial' || trial.state === 'licensed';
    }
    if (choice === 'Enter License Key') {
      await enterLicense(licenseManager);
      return hasAccess();
    }
    return false;
  };

  const pickEndpoint = async (
    config: ApiRegressionConfig,
    placeHolder = 'Select an endpoint',
    options: { canPickMany?: boolean; only?: string[] } = {}
  ): Promise<EndpointConfig | undefined> => {
    const candidates = config.endpoints.filter(
      (endpoint) => !options.only || options.only.includes(endpoint.id)
    );
    const items: Array<vscode.QuickPickItem & { endpoint: EndpointConfig }> =
      candidates.map((endpoint) => ({
        label: endpoint.name,
        description: `${endpoint.environment} · ${endpoint.path}`,
        detail:
          endpoint.auth && endpoint.auth.type !== 'none'
            ? `auth: ${endpoint.auth.type} (profile ${endpoint.auth.profile})`
            : undefined,
        endpoint
      }));
    if (options.canPickMany) {
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder,
        canPickMany: true
      });
      if (!picked || picked.length === 0) {
        return undefined;
      }
      return undefined; // handled by caller via pickEndpoints
    }
    const item = await vscode.window.showQuickPick(items, { placeHolder });
    return item?.endpoint;
  };

  const pickEndpoints = async (
    config: ApiRegressionConfig,
    placeHolder: string
  ): Promise<EndpointConfig[] | undefined> => {
    const items: Array<vscode.QuickPickItem & { endpoint: EndpointConfig }> =
      config.endpoints.map((endpoint) => ({
        label: endpoint.name,
        description: `${endpoint.environment} · ${endpoint.path}`,
        endpoint
      }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder,
      canPickMany: true
    });
    if (!picked || picked.length === 0) {
      return undefined;
    }
    const max = getBounds().maxBatch;
    if (picked.length > max) {
      vscode.window.showErrorMessage(
        `API Regression: select at most ${max} endpoints per batch`
      );
      return undefined;
    }
    return picked.map((item) => item.endpoint);
  };

  const confirmDestination = async (
    endpoint: EndpointConfig,
    resolved: ResolvedRequest
  ): Promise<boolean> => {
    const detail = [
      `Method: GET`,
      `URL: ${resolved.url}`,
      `Origin: ${resolved.origin}`,
      `Auth: ${resolved.authDescription}`,
      `Environment: ${endpoint.environment}`
    ].join('\n');
    const choice = await vscode.window.showWarningMessage(
      'Run this request?',
      { modal: true, detail },
      'Run'
    );
    return choice === 'Run';
  };

  const executeEndpoint = async (
    endpoint: EndpointConfig,
    resolved: ResolvedRequest
  ): Promise<ExecutionOutcome> => {
    const bounds = getBounds();
    const controller = new AbortController();
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `GET ${resolved.url}`,
        cancellable: true
      },
      async (_progress, token) => {
        token.onCancellationRequested(() => controller.abort());
        const result = await runRequest({
          url: resolved.url,
          headers: resolved.headers,
          timeoutMs: bounds.timeoutMs,
          maxResponseBytes: bounds.maxBytes,
          signal: controller.signal
        });
        if (!result.ok) {
          return { ok: false, failure: result.failure, durationMs: result.durationMs };
        }
        let value: JsonValue;
        try {
          value = parseJson(result.bodyText);
        } catch (error) {
          return {
            ok: false,
            durationMs: result.durationMs,
            failure: {
              kind: 'invalid-json',
              status: result.status,
              message:
                'Response body is not valid JSON: ' +
                (error instanceof Error ? error.message : String(error))
            }
          };
        }
        const rules = normalizeRules(endpoint);
        const redactedText = stringifyJson(redactJson(value, rules.redactPaths), {
          indent: 2
        });
        return {
          ok: true,
          status: result.status,
          value,
          redactedText,
          durationMs: result.durationMs,
          byteLength: result.byteLength
        };
      }
    );
  };

  const openPreview = async (title: string, content: string): Promise<void> => {
    const uri = previews.create(title, content);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(doc, 'json');
    await vscode.window.showTextDocument(doc, { preview: true });
  };

  const reportFailure = (endpoint: EndpointConfig, failure: RunFailureInfo): void => {
    output.appendLine(
      `[${new Date().toISOString()}] ${endpoint.id} ${failure.kind}: ${failure.message}`
    );
    vscode.window.showErrorMessage(
      `Run failed for '${endpoint.name}' (${failure.kind}): ${failure.message}`
    );
  };

  const editRules = async (
    endpoint: EndpointConfig
  ): Promise<SnapshotRules | undefined> => {
    const current = normalizeRules(endpoint);
    const ignore = await promptForPaths(
      'Ignore paths (comma-separated JSON Pointers, * wildcard)',
      current.ignorePaths,
      true
    );
    if (ignore === undefined) {
      return undefined;
    }
    const redact = await promptForPaths(
      'Redact paths (values hidden from preview, storage and reports)',
      current.redactPaths,
      false
    );
    if (redact === undefined) {
      return undefined;
    }
    return {
      ignorePaths: ignore,
      redactPaths: redact,
      arrayMatchKeys: current.arrayMatchKeys
    };
  };

  async function promptForPaths(
    prompt: string,
    initial: string[],
    allowWildcard: boolean
  ): Promise<string[] | undefined> {
    const value = await vscode.window.showInputBox({
      prompt: allowWildcard
        ? `${prompt}. Leave empty for none.`
        : `${prompt}. Leave empty for none.`,
      value: initial.join(', '),
      placeHolder: '/meta/timestamp, /items/*/updatedAt'
    });
    if (value === undefined) {
      return undefined;
    }
    const paths = value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    for (const path of paths) {
      const issue = validateRulePath(path);
      if (issue) {
        vscode.window.showErrorMessage(`Invalid path '${path}': ${issue}`);
        return undefined;
      }
    }
    return paths;
  }

  const captureBaseline = async (node?: EndpointNode): Promise<void> => {
    if (!requireTrust() || !(await requireAccess())) {
      return;
    }
    const config = await loadConfig();
    if (!config) {
      return;
    }
    const endpoint = node?.endpoint ?? (await pickEndpoint(config, 'Select an endpoint to capture'));
    if (!endpoint) {
      return;
    }
    const environment = config.environments[endpoint.environment];
    if (!environment) {
      vscode.window.showErrorMessage(
        `API Regression: unknown environment '${endpoint.environment}'`
      );
      return;
    }

    let resolved: ResolvedRequest;
    try {
      resolved = await resolveRequest(endpoint, environment, credentials);
    } catch (error) {
      if (error instanceof MissingCredentialError) {
        const choice = await vscode.window.showErrorMessage(
          error.message,
          'Manage Credentials'
        );
        if (choice === 'Manage Credentials') {
          await vscode.commands.executeCommand('apiRegression.manageCredentials');
        }
        return;
      }
      throw error;
    }

    if (!(await confirmDestination(endpoint, resolved))) {
      return;
    }

    const outcome = await executeEndpoint(endpoint, resolved);
    if (!outcome.ok) {
      reportFailure(endpoint, outcome.failure);
      runState.set(failedState(endpoint, resolved.url, outcome.failure));
      return;
    }

    const rules = await editRules(endpoint);
    if (!rules) {
      return;
    }

    const redacted = redactJson(outcome.value, rules.redactPaths);
    const redactedText = stringifyJson(redacted, { indent: 2 });

    const existing = await snapshotStore.read(endpoint.id, endpoint.environment);
    if (existing) {
      const confirm = await vscode.window.showWarningMessage(
        `A baseline already exists for '${endpoint.name}'. Replace it?`,
        { modal: true, detail: 'Replacing keeps the previous baseline only in your editor history.' },
        'Replace Baseline'
      );
      if (confirm !== 'Replace Baseline') {
        return;
      }
    }

    const snapshot = createSnapshot({
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      environment: endpoint.environment,
      sourceOrigin: resolved.origin,
      url: resolved.url,
      status: outcome.status,
      value: redacted,
      rules
    });

    const meta = await snapshotStore.write(
      snapshot,
      existing ? { expectedEtag: existing.meta.etag } : {}
    );
    baselineIndex.set(indexKey(endpoint.id, endpoint.environment), meta);

    output.appendLine(
      `[${new Date().toISOString()}] captured baseline ${endpoint.id} status=${outcome.status} bytes=${outcome.byteLength}`
    );
    void openPreview(`${endpoint.name} (baseline)`, redactedText);
    vscode.window.showInformationMessage(
      `Baseline saved for '${endpoint.name}' (HTTP ${outcome.status}).`
    );
  };

  const rerunEndpoint = async (node?: EndpointNode | { endpointId?: string; environment?: string }): Promise<void> => {
    if (!requireTrust() || !(await requireAccess())) {
      return;
    }
    const config = await loadConfig();
    if (!config) {
      return;
    }
    const endpoint = await resolveSelectedEndpoint(config, node, 'Select an endpoint to rerun');
    if (!endpoint) {
      return;
    }
    const environment = config.environments[endpoint.environment];
    if (!environment) {
      vscode.window.showErrorMessage(
        `API Regression: unknown environment '${endpoint.environment}'`
      );
      return;
    }

    let resolved: ResolvedRequest;
    try {
      resolved = await resolveRequest(endpoint, environment, credentials);
    } catch (error) {
      if (error instanceof MissingCredentialError) {
        const choice = await vscode.window.showErrorMessage(
          error.message,
          'Manage Credentials'
        );
        if (choice === 'Manage Credentials') {
          await vscode.commands.executeCommand('apiRegression.manageCredentials');
        }
        return;
      }
      throw error;
    }
    if (!(await confirmDestination(endpoint, resolved))) {
      return;
    }

    const outcome = await executeEndpoint(endpoint, resolved);
    if (!outcome.ok) {
      reportFailure(endpoint, outcome.failure);
      runState.set(failedState(endpoint, resolved.url, outcome.failure));
      return;
    }

    const stored = await snapshotStore.read(endpoint.id, endpoint.environment);
    if (!stored) {
      runState.set({
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        environment: endpoint.environment,
        url: resolved.url,
        ranAt: new Date().toISOString(),
        outcome: 'no-baseline',
        currentText: outcome.redactedText
      });
      const choice = await vscode.window.showInformationMessage(
        `No baseline for '${endpoint.name}' yet.`,
        'Capture Baseline Now'
      );
      if (choice === 'Capture Baseline Now') {
        await captureBaseline({ kind: 'endpoint', endpoint, environment: endpoint.environment });
      }
      return;
    }

    const compatibility = checkSnapshotCompatibility(stored.snapshot, {
      endpointId: endpoint.id,
      environment: endpoint.environment
    });
    if (!compatibility.compatible) {
      const choice = await vscode.window.showErrorMessage(
        `Baseline for '${endpoint.name}' cannot be compared: ${compatibility.reasons.join('; ')}`,
        'Recapture Baseline'
      );
      if (choice === 'Recapture Baseline') {
        await captureBaseline({ kind: 'endpoint', endpoint, environment: endpoint.environment });
      }
      return;
    }

    const rules = normalizeRules(endpoint);
    let comparisonRules = rules;
    if (rulesChanged(stored.snapshot, rules)) {
      const choice = await vscode.window.showWarningMessage(
        `Comparison rules changed since '${endpoint.name}' was captured. A baseline cannot be reinterpreted silently.`,
        { modal: true, detail: 'Use the new rules for this comparison (recorded in the report) or recapture the baseline first.' },
        'Use New Rules',
        'Recapture Baseline'
      );
      if (choice === 'Recapture Baseline') {
        await captureBaseline({ kind: 'endpoint', endpoint, environment: endpoint.environment });
        return;
      }
      if (choice !== 'Use New Rules') {
        return;
      }
      comparisonRules = rules;
    }

    const baselineValue = snapshotValue(stored.snapshot);
    const result = compare({
      baselineValue,
      currentValue: redactJson(outcome.value, comparisonRules.redactPaths),
      baselineStatus: stored.snapshot.status,
      currentStatus: outcome.status,
      ignorePaths: comparisonRules.ignorePaths,
      redactPaths: comparisonRules.redactPaths,
      arrayMatchKeys: comparisonRules.arrayMatchKeys,
      maxEntries: getBounds().maxDiffEntries
    });

    const state: EndpointRunState = {
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      environment: endpoint.environment,
      url: resolved.url,
      ranAt: new Date().toISOString(),
      outcome: result.identical ? 'identical' : 'changed',
      compare: result,
      currentText: outcome.redactedText,
      baselineText: stored.snapshot.responseText,
      baselineMeta: stored.meta
    };
    runState.set(state);

    const left = previews.create(`${endpoint.id}-baseline`, stored.snapshot.responseText);
    const right = previews.create(`${endpoint.id}-current`, outcome.redactedText);
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `${endpoint.name}: baseline \u2194 current`
    );

    const summary = describeSummary(result);
    const actions = ['Export Markdown Report', 'Replace Baseline'];
    const choice = await vscode.window.showInformationMessage(
      `${endpoint.name}: HTTP ${result.status.baseline} \u2192 ${result.status.current}. ${summary}${
        result.truncated ? ' Output truncated.' : ''
      }`,
      ...actions
    );
    if (choice === 'Export Markdown Report') {
      await exportReport(state);
    } else if (choice === 'Replace Baseline') {
      await replaceBaselineFromState(endpoint, state);
    }
  };

  const rerunGroup = async (): Promise<void> => {
    if (!requireTrust() || !(await requireAccess())) {
      return;
    }
    const config = await loadConfig();
    if (!config) {
      return;
    }
    const endpoints = await pickEndpoints(config, 'Select up to 10 endpoints to run sequentially');
    if (!endpoints || endpoints.length === 0) {
      return;
    }

    const results: Array<{ endpoint: EndpointConfig; outcome: ExecutionOutcome }> = [];
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'API Regression batch run',
        cancellable: true
      },
      async (progress, token) => {
        for (let i = 0; i < endpoints.length; i += 1) {
          if (token.isCancellationRequested) {
            break;
          }
          const endpoint = endpoints[i];
          if (!endpoint) {
            continue;
          }
          progress.report({
            message: `${endpoint.name} (${i + 1}/${endpoints.length})`,
            increment: 100 / endpoints.length
          });
          const environment = config.environments[endpoint.environment];
          if (!environment) {
            continue;
          }
          try {
            const resolved = await resolveRequest(endpoint, environment, credentials);
            const outcome = await executeEndpoint(endpoint, resolved);
            results.push({ endpoint, outcome });
            if (outcome.ok) {
              await compareAfterBatchRun(endpoint, resolved, outcome);
            } else {
              runState.set(failedState(endpoint, resolved.url, outcome.failure));
            }
          } catch (error) {
            runState.set({
              endpointId: endpoint.id,
              endpointName: endpoint.name,
              environment: endpoint.environment,
              url: joinUrl(environment.baseUrl, endpoint.path),
              ranAt: new Date().toISOString(),
              outcome: 'failed',
              failureKind: 'resolve',
              failureMessage: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    );

    const changed = results.filter((r) => r.outcome.ok).length;
    const failed = results.filter((r) => !r.outcome.ok).length;
    vscode.window.showInformationMessage(
      `Batch finished: ${changed} executed, ${failed} failed, ${results.length} total.`
    );
  };

  const compareAfterBatchRun = async (
    endpoint: EndpointConfig,
    resolved: ResolvedRequest,
    outcome: ExecutionSuccess
  ): Promise<void> => {
    const stored = await snapshotStore.read(endpoint.id, endpoint.environment);
    if (!stored) {
      runState.set({
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        environment: endpoint.environment,
        url: resolved.url,
        ranAt: new Date().toISOString(),
        outcome: 'no-baseline',
        currentText: outcome.redactedText
      });
      return;
    }
    const compatibility = checkSnapshotCompatibility(stored.snapshot, {
      endpointId: endpoint.id,
      environment: endpoint.environment
    });
    if (!compatibility.compatible) {
      runState.set({
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        environment: endpoint.environment,
        url: resolved.url,
        ranAt: new Date().toISOString(),
        outcome: 'failed',
        failureKind: 'incompatible-baseline',
        failureMessage: compatibility.reasons.join('; ')
      });
      return;
    }
    const rules = normalizeRules(endpoint);
    const result = compare({
      baselineValue: snapshotValue(stored.snapshot),
      currentValue: redactJson(outcome.value, rules.redactPaths),
      baselineStatus: stored.snapshot.status,
      currentStatus: outcome.status,
      ignorePaths: rules.ignorePaths,
      redactPaths: rules.redactPaths,
      arrayMatchKeys: rules.arrayMatchKeys,
      maxEntries: getBounds().maxDiffEntries
    });
    runState.set({
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      environment: endpoint.environment,
      url: resolved.url,
      ranAt: new Date().toISOString(),
      outcome: result.identical ? 'identical' : 'changed',
      compare: result,
      currentText: outcome.redactedText,
      baselineText: stored.snapshot.responseText,
      baselineMeta: stored.meta
    });
  };

  const replaceBaselineFromState = async (
    endpoint: EndpointConfig,
    state: EndpointRunState
  ): Promise<void> => {
    if (!state.compare || !state.currentText) {
      vscode.window.showErrorMessage(
        'API Regression: run a comparison before replacing the baseline.'
      );
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Replace the baseline for '${endpoint.name}' with the current response?`,
      {
        modal: true,
        detail: `${describeSummary(state.compare)}\n\nThis is a separate, explicit action from comparison.`
      },
      'Replace Baseline'
    );
    if (confirm !== 'Replace Baseline') {
      return;
    }
    const environment = configCache.current?.environments[endpoint.environment];
    if (!environment) {
      return;
    }
    const resolved = await resolveRequest(endpoint, environment, credentials);
    const rules = normalizeRules(endpoint);
    const existing = await snapshotStore.read(endpoint.id, endpoint.environment);
    const snapshot = createSnapshot({
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      environment: endpoint.environment,
      sourceOrigin: resolved.origin,
      url: state.url,
      status: state.compare.status.current,
      value: parseJson(state.currentText),
      rules
    });
    try {
      const meta = await snapshotStore.write(
        snapshot,
        existing ? { expectedEtag: existing.meta.etag } : {}
      );
      baselineIndex.set(indexKey(endpoint.id, endpoint.environment), meta);
      vscode.window.showInformationMessage(`Baseline replaced for '${endpoint.name}'.`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `API Regression: could not replace baseline. ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  const replaceBaseline = async (node?: EndpointNode): Promise<void> => {
    const config = await loadConfig();
    if (!config) {
      return;
    }
    const endpoint =
      node?.endpoint ?? (await pickEndpoint(config, 'Select an endpoint whose baseline to replace'));
    if (!endpoint) {
      return;
    }
    const state = runState.get(endpoint.id, endpoint.environment);
    if (!state || !state.compare) {
      const choice = await vscode.window.showInformationMessage(
        `No reviewed run for '${endpoint.name}'. Compare it first.`,
        'Rerun and Compare'
      );
      if (choice === 'Rerun and Compare') {
        await rerunEndpoint({ kind: 'endpoint', endpoint, environment: endpoint.environment });
      }
      return;
    }
    await replaceBaselineFromState(endpoint, state);
  };

  const exportReport = async (arg?: EndpointRunState | { endpointId: string; environment: string }): Promise<void> => {
    const config = configCache.current ?? (await loadConfig());
    if (!config) {
      return;
    }
    let state: EndpointRunState | undefined;
    let endpoint: EndpointConfig | undefined;
    if (arg) {
      const endpointId = arg.endpointId;
      const environment = arg.environment;
      state = runState.get(endpointId, environment) ?? (isRunState(arg) ? arg : undefined);
      endpoint = config.endpoints.find(
        (item) => item.id === endpointId && item.environment === environment
      );
    }
    if (!state || !state.compare || !endpoint) {
      vscode.window.showErrorMessage(
        'API Regression: run a comparison before exporting a report.'
      );
      return;
    }
    const markdown = buildMarkdownReport(state.compare, {
      endpointId: state.endpointId,
      endpointName: state.endpointName,
      environment: state.environment,
      url: state.url,
      baselineCapturedAt: state.baselineText
        ? new Date(state.baselineMeta?.mtime ?? Date.now()).toISOString()
        : undefined,
      currentRunAt: state.ranAt
    });

    const folder = vscode.workspace.workspaceFolders?.[0];
    const defaultUri = folder
      ? vscode.Uri.joinPath(
          folder.uri,
          CONFIG_DIR,
          'reports',
          `${sanitizeName(state.endpointId)}-${timestamp()}.md`
        )
      : undefined;
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { Markdown: ['md'] },
      saveLabel: 'Export Report'
    });
    if (!target) {
      return;
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
    await vscode.workspace.fs.writeFile(target, Buffer.from(markdown, 'utf8'));
    const doc = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.showInformationMessage('Report exported.');
  };

  const exportBaseline = async (node?: EndpointNode): Promise<void> => {
    const config = await loadConfig();
    if (!config) {
      return;
    }
    const endpoint =
      node?.endpoint ?? (await pickEndpoint(config, 'Select an endpoint whose baseline to export'));
    if (!endpoint) {
      return;
    }
    const stored = await snapshotStore.read(endpoint.id, endpoint.environment);
    if (!stored) {
      vscode.window.showErrorMessage(`No baseline stored for '${endpoint.name}'.`);
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    const defaultUri = folder
      ? vscode.Uri.joinPath(
          folder.uri,
          CONFIG_DIR,
          'baselines',
          `${sanitizeName(endpoint.id)}-${sanitizeName(endpoint.environment)}.json`
        )
      : undefined;
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { JSON: ['json'] },
      saveLabel: 'Export Baseline'
    });
    if (!target) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      'Exported baselines are not encrypted. They are redacted, but review the file before committing it to a repository.',
      { modal: true },
      'Export'
    );
    if (confirm !== 'Export') {
      return;
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
    await snapshotStore.exportTo(target, stored.snapshot);
    vscode.window.showInformationMessage('Baseline exported (redacted).');
  };

  const deleteBaseline = async (node?: EndpointNode): Promise<void> => {
    const config = await loadConfig();
    if (!config) {
      return;
    }
    const endpoint =
      node?.endpoint ?? (await pickEndpoint(config, 'Select an endpoint whose baseline to delete'));
    if (!endpoint) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Delete the stored baseline for '${endpoint.name}'? This cannot be undone.`,
      { modal: true },
      'Delete'
    );
    if (confirm !== 'Delete') {
      return;
    }
    await snapshotStore.delete(endpoint.id, endpoint.environment);
    vscode.window.showInformationMessage(`Baseline deleted for '${endpoint.name}'.`);
  };

  const manageCredentials = async (): Promise<void> => {
    const action = await vscode.window.showQuickPick(
      [
        { label: 'Add or update a credential', value: 'set' },
        { label: 'Delete a credential', value: 'delete' },
        { label: 'Re-associate a credential to a new origin', value: 'reassociate' }
      ],
      { placeHolder: 'Manage API Regression credentials (stored in VS Code SecretStorage)' }
    );
    if (!action) {
      return;
    }
    const config = configCache.current ?? (await loadConfig());
    const knownProfiles = collectProfiles(config);
    const knownOrigins = collectOrigins(config);

    if (action.value === 'set') {
      const profile = await vscode.window.showInputBox({
        prompt: 'Credential profile name (as referenced by endpoints)',
        value: knownProfiles[0] ?? ''
      });
      if (!profile) {
        return;
      }
      const origin = await vscode.window.showQuickPick(
        [...knownOrigins, 'Enter a custom origin...'],
        { placeHolder: 'Destination origin (credentials are scoped to it)' }
      );
      if (!origin) {
        return;
      }
      const finalOrigin =
        origin === 'Enter a custom origin...'
          ? await vscode.window.showInputBox({ prompt: 'Origin (scheme://host:port)' })
          : origin;
      if (!finalOrigin) {
        return;
      }
      const secret = await vscode.window.showInputBox({
        prompt: `Secret for '${profile}' at ${finalOrigin}`,
        password: true,
        ignoreFocusOut: true
      });
      if (secret === undefined || secret.length === 0) {
        return;
      }
      await credentials.set(profile, finalOrigin, secret);
      vscode.window.showInformationMessage(`Credential saved for '${profile}' at ${finalOrigin}.`);
    } else if (action.value === 'delete') {
      const list = await credentials.list();
      if (list.length === 0) {
        vscode.window.showInformationMessage('No credentials stored for this workspace.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        list.map((entry) => ({ label: entry.profile, description: entry.origin, entry })),
        { placeHolder: 'Select a credential to delete' }
      );
      if (!picked) {
        return;
      }
      await credentials.delete(picked.entry.profile, picked.entry.origin);
      vscode.window.showInformationMessage('Credential deleted.');
    } else {
      const list = await credentials.list();
      if (list.length === 0) {
        vscode.window.showInformationMessage('No credentials stored for this workspace.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        list.map((entry) => ({ label: entry.profile, description: entry.origin, entry })),
        { placeHolder: 'Select a credential to re-associate' }
      );
      if (!picked) {
        return;
      }
      const newOrigin = await vscode.window.showInputBox({
        prompt: 'New origin (scheme://host:port)',
        value: picked.entry.origin
      });
      if (!newOrigin || newOrigin === picked.entry.origin) {
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Send the credential for '${picked.entry.profile}' to ${newOrigin}?`,
        { modal: true },
        'Re-associate'
      );
      if (confirm !== 'Re-associate') {
        return;
      }
      const moved = await credentials.reassociate(
        picked.entry.profile,
        picked.entry.origin,
        newOrigin
      );
      vscode.window.showInformationMessage(
        moved ? 'Credential re-associated.' : 'Credential could not be found.'
      );
    }
  };

  const showLicenseStatus = async (): Promise<void> => {
    const state = await licenseManager.evaluate();
    const detail = [`State: ${state.state}`, state.message];
    if (state.licenseError) {
      detail.push(`License note: ${state.licenseError}`);
    }
    const choice = await vscode.window.showInformationMessage(
      `API Regression license: ${state.state}`,
      { modal: true, detail: detail.join('\n') },
      ...(state.state === 'licensed'
        ? (['Remove License'] as const)
        : (['Start Trial', 'Enter License Key'] as const))
    );
    if (choice === 'Start Trial') {
      const trial = await licenseManager.startTrial();
      vscode.window.showInformationMessage(trial.message);
    } else if (choice === 'Enter License Key') {
      await enterLicense(licenseManager);
    } else if (choice === 'Remove License') {
      await licenseManager.clearLicense();
      vscode.window.showInformationMessage('License removed from this machine.');
    }
  };

  register('apiRegression.initConfig', async () => {
    const existing = await configStore.exists();
    if (existing) {
      const choice = await vscode.window.showWarningMessage(
        'A configuration already exists. Overwrite it with the template?',
        { modal: true },
        'Overwrite'
      );
      if (choice !== 'Overwrite') {
        await vscode.commands.executeCommand('apiRegression.openConfig');
        return;
      }
    }
    const uri = await configStore.createTemplate();
    if (!uri) {
      vscode.window.showErrorMessage('Open a local folder first.');
      return;
    }
    await refresh();
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  });

  register('apiRegression.openConfig', async () => {
    const uri = configStore.uri;
    if (!uri) {
      vscode.window.showErrorMessage('Open a local folder first.');
      return;
    }
    if (!(await configStore.exists())) {
      const choice = await vscode.window.showInformationMessage(
        'No configuration found. Create one?',
        'Create Configuration'
      );
      if (choice === 'Create Configuration') {
        await vscode.commands.executeCommand('apiRegression.initConfig');
      }
      return;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  });

  register('apiRegression.validateConfig', async () => {
    const loaded = await configStore.load();
    if (isLoaded(loaded)) {
      const warnings = loaded.issues.filter((issue) => issue.severity === 'warning');
      output.appendLine(
        `[${new Date().toISOString()}] configuration valid: ${loaded.config.endpoints.length} endpoint(s), ${warnings.length} warning(s)`
      );
      for (const issue of loaded.issues) {
        appendIssue(issue.severity, issue.path, issue.message);
      }
      output.show();
    } else {
      output.appendLine(describeLoadFailure(loaded));
      output.show();
      vscode.window.showErrorMessage('Configuration has validation errors. See the API Regression output.');
    }
  });

  register('apiRegression.captureBaseline', (node?: EndpointNode) => captureBaseline(node));
  register('apiRegression.rerunEndpoint', (node?: EndpointNode | { endpointId?: string; environment?: string }) =>
    rerunEndpoint(node)
  );
  register('apiRegression.rerunGroup', () => rerunGroup());
  register('apiRegression.replaceBaseline', (node?: EndpointNode) => replaceBaseline(node));
  register('apiRegression.exportReport', (arg?: EndpointRunState | { endpointId: string; environment: string }) =>
    exportReport(arg)
  );
  register('apiRegression.exportBaseline', (node?: EndpointNode) => exportBaseline(node));
  register('apiRegression.deleteBaseline', (node?: EndpointNode) => deleteBaseline(node));
  register('apiRegression.manageCredentials', () => manageCredentials());
  register('apiRegression.refresh', () => refresh());
  register('apiRegression.licenseStatus', () => showLicenseStatus());
  register('apiRegression.startTrial', async () => {
    const state = await licenseManager.startTrial();
    vscode.window.showInformationMessage(state.message);
  });
  register('apiRegression.enterLicense', () => enterLicense(licenseManager));

  function resolveSelectedEndpoint(
    config: ApiRegressionConfig,
    node: EndpointNode | { endpointId?: string; environment?: string } | undefined,
    placeHolder: string
  ): Promise<EndpointConfig | undefined> | EndpointConfig | undefined {
    if (node && 'kind' in node && node.kind === 'endpoint') {
      return node.endpoint;
    }
    if (node && 'endpointId' in node && node.endpointId) {
      const found = config.endpoints.find(
        (endpoint) =>
          endpoint.id === node.endpointId &&
          (!node.environment || endpoint.environment === node.environment)
      );
      if (found) {
        return found;
      }
    }
    return pickEndpoint(config, placeHolder);
  }
}

function isLoaded(
  result: LoadedConfig | { issues: unknown[] }
): result is LoadedConfig {
  return (result as LoadedConfig).config !== undefined;
}

function isRunState(value: unknown): value is EndpointRunState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'compare' in value &&
    'ranAt' in value
  );
}

async function enterLicense(licenseManager: LicenseManager): Promise<void> {
  const token = await vscode.window.showInputBox({
    prompt: `Paste your API Regression license key (${TRIAL_PERIOD_DAYS}-day trial available)`,
    password: true,
    ignoreFocusOut: true
  });
  if (!token) {
    return;
  }
  const result = await licenseManager.setLicense(token);
  if (result.ok) {
    vscode.window.showInformationMessage(`API Regression: ${result.message}`);
  } else {
    vscode.window.showErrorMessage(`API Regression: ${result.message}`);
  }
}

function normalizeRules(endpoint: EndpointConfig): SnapshotRules {
  const rules: EndpointRules = endpoint.rules ?? {};
  return {
    ignorePaths: [...(rules.ignorePaths ?? [])],
    redactPaths: [...(rules.redactPaths ?? [])],
    arrayMatchKeys: { ...(rules.arrayMatchKeys ?? {}) }
  };
}

function failedState(
  endpoint: EndpointConfig,
  url: string,
  failure: RunFailureInfo
): EndpointRunState {
  return {
    endpointId: endpoint.id,
    endpointName: endpoint.name,
    environment: endpoint.environment,
    url,
    ranAt: new Date().toISOString(),
    outcome: 'failed',
    failureKind: failure.kind,
    failureMessage: failure.message
  };
}

function describeSummary(result: CompareResult): string {
  const s: DiffSummary = result.summary;
  if (result.identical) {
    return 'No differences after applying rules.';
  }
  return [
    `${s.total} difference(s)`,
    `added ${s.added}`,
    `removed ${s.removed}`,
    `type-changed ${s.typeChanged}`,
    `value-changed ${s.valueChanged}`,
    `ambiguous ${s.ambiguous}`
  ].join(', ');
}

function indexKey(endpointId: string, environment: string): string {
  return `${endpointId}::${environment}`;
}

function appendIssue(
  severity: string,
  path: string,
  message: string
): void {
  output.appendLine(`${severity.toUpperCase()} ${path}: ${message}`);
}

function sanitizeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function collectProfiles(config: ApiRegressionConfig | undefined): string[] {
  const profiles = new Set<string>();
  for (const endpoint of config?.endpoints ?? []) {
    if (endpoint.auth?.profile) {
      profiles.add(endpoint.auth.profile);
    }
  }
  return [...profiles];
}

function collectOrigins(config: ApiRegressionConfig | undefined): string[] {
  const origins = new Set<string>();
  for (const environment of Object.values(config?.environments ?? {})) {
    try {
      origins.add(parseUrl(environment.baseUrl).origin);
    } catch {
      // Ignore invalid base URLs during credential management.
    }
  }
  return [...origins];
}

export function deactivate(): void {
  // Resources are released through the extension context subscriptions.
}
