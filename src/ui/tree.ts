import * as vscode from 'vscode';
import { ApiRegressionConfig, EndpointConfig } from '../config/schema.js';
import { EndpointRunState, RunStateStore } from '../state.js';
import { SnapshotMeta } from '../storage/snapshotStore.js';

export type BaselineLookup = (
  endpointId: string,
  environment: string
) => SnapshotMeta | undefined;

export type EndpointNode = {
  kind: 'endpoint';
  endpoint: EndpointConfig;
  environment: string;
  baseline?: SnapshotMeta;
  run?: EndpointRunState;
};

export type EnvironmentNode = {
  kind: 'environment';
  environment: string;
  baseUrl: string;
  endpoints: EndpointNode[];
};

export type TreeNode = EnvironmentNode | EndpointNode;

export class EndpointsTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly getConfig: () => ApiRegressionConfig | undefined,
    private readonly baselineLookup: BaselineLookup,
    private readonly runs: RunStateStore
  ) {
    this.runs.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.kind === 'environment') {
      const item = new vscode.TreeItem(
        element.environment,
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.description = element.baseUrl;
      item.iconPath = new vscode.ThemeIcon('server-environment');
      item.contextValue = 'apiRegression.environment';
      return item;
    }
    return this.endpointItem(element);
  }

  getChildren(element?: TreeNode): TreeNode[] {
    const config = this.getConfig();
    if (!config) {
      return [];
    }
    if (!element) {
      const byEnvironment = new Map<string, EnvironmentNode>();
      for (const [name, env] of Object.entries(config.environments)) {
        byEnvironment.set(name, {
          kind: 'environment',
          environment: name,
          baseUrl: env.baseUrl,
          endpoints: []
        });
      }
      for (const endpoint of config.endpoints) {
        const node: EndpointNode = {
          kind: 'endpoint',
          endpoint,
          environment: endpoint.environment,
          baseline: this.baselineLookup(endpoint.id, endpoint.environment),
          run: this.runs.get(endpoint.id, endpoint.environment)
        };
        let env = byEnvironment.get(endpoint.environment);
        if (!env) {
          env = {
            kind: 'environment',
            environment: endpoint.environment,
            baseUrl: '(unknown)',
            endpoints: []
          };
          byEnvironment.set(endpoint.environment, env);
        }
        env.endpoints.push(node);
      }
      return [...byEnvironment.values()];
    }
    if (element.kind === 'environment') {
      return element.endpoints;
    }
    return [];
  }

  private endpointItem(node: EndpointNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.endpoint.name,
      vscode.TreeItemCollapsibleState.None
    );
    item.contextValue = 'apiRegression.endpoint';
    const status = describeStatus(node);
    item.description = `${node.endpoint.path} · ${status.text}`;
    item.iconPath = new vscode.ThemeIcon(
      status.icon,
      status.color ? new vscode.ThemeColor(status.color) : undefined
    );
    item.tooltip = buildTooltip(node);
    item.command = {
      command: 'apiRegression.rerunEndpoint',
      title: 'Rerun and Compare',
      arguments: [node]
    };
    return item;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function describeStatus(node: EndpointNode): {
  text: string;
  icon: string;
  color?: string;
} {
  if (node.run) {
    switch (node.run.outcome) {
      case 'identical':
        return { text: 'no differences', icon: 'pass', color: 'testing.iconPassed' };
      case 'changed':
        return {
          text: `${node.run.compare?.summary.total ?? 0} difference(s)`,
          icon: 'diff-modified',
          color: 'list.warningForeground'
        };
      case 'failed':
        return {
          text: `run failed (${node.run.failureKind ?? 'error'})`,
          icon: 'error',
          color: 'testing.iconFailed'
        };
      case 'no-baseline':
        return { text: 'no baseline yet', icon: 'circle-outline' };
    }
  }
  return node.baseline
    ? { text: 'baseline saved', icon: 'database' }
    : { text: 'no baseline', icon: 'circle-outline' };
}

function buildTooltip(node: EndpointNode): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${node.endpoint.name}**\n\n`);
  md.appendMarkdown(`- Environment: \`${node.environment}\`\n`);
  md.appendMarkdown(`- Path: \`${node.endpoint.path}\`\n`);
  md.appendMarkdown(`- Auth: \`${node.endpoint.auth?.type ?? 'none'}\`\n`);
  if (node.baseline) {
    md.appendMarkdown(`- Baseline updated: ${new Date(node.baseline.mtime).toLocaleString()}\n`);
  } else {
    md.appendMarkdown('- No baseline saved\n');
  }
  if (node.run) {
    md.appendMarkdown(`- Last run: ${new Date(node.run.ranAt).toLocaleString()} (${node.run.outcome})\n`);
  }
  return md;
}

export type ResultNode = {
  kind: 'result';
  state: EndpointRunState;
};

export class ResultsTreeProvider
  implements vscode.TreeDataProvider<ResultNode>, vscode.Disposable
{
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly runs: RunStateStore) {
    this.runs.onDidChange(() => this.emitter.fire());
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: ResultNode): vscode.TreeItem {
    const state = element.state;
    const item = new vscode.TreeItem(
      state.endpointName,
      vscode.TreeItemCollapsibleState.None
    );
    item.contextValue = 'apiRegression.result';
    const icon = outcomeIcon(state.outcome);
    item.iconPath = new vscode.ThemeIcon(icon);
    item.description = describeResult(state);
    item.tooltip = state.url;
    item.command = {
      command: 'apiRegression.exportReport',
      title: 'Export Report',
      arguments: [{ kind: 'endpoint', endpointId: state.endpointId, environment: state.environment }]
    };
    return item;
  }

  getChildren(element?: ResultNode): ResultNode[] {
    if (element) {
      return [];
    }
    return this.runs
      .all()
      .sort((a, b) => (a.ranAt < b.ranAt ? 1 : -1))
      .map((state) => ({ kind: 'result' as const, state }));
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function outcomeIcon(outcome: EndpointRunState['outcome']): string {
  switch (outcome) {
    case 'identical':
      return 'pass';
    case 'changed':
      return 'diff-modified';
    case 'failed':
      return 'error';
    case 'no-baseline':
      return 'circle-outline';
  }
}

function describeResult(state: EndpointRunState): string {
  switch (state.outcome) {
    case 'identical':
      return 'no differences';
    case 'changed':
      return `${state.compare?.summary.total ?? 0} difference(s)`;
    case 'failed':
      return `failed: ${state.failureKind ?? 'error'}`;
    case 'no-baseline':
      return 'no baseline to compare';
  }
}
