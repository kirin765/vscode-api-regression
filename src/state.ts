import * as vscode from 'vscode';
import { CompareResult } from './compare/compare.js';
import { SnapshotMeta } from './storage/snapshotStore.js';

export type RunOutcome = 'identical' | 'changed' | 'failed' | 'no-baseline';

export interface EndpointRunState {
  endpointId: string;
  endpointName: string;
  environment: string;
  url: string;
  ranAt: string;
  outcome: RunOutcome;
  failureKind?: string;
  failureMessage?: string;
  compare?: CompareResult;
  /** Redacted, pretty-printed current response for the diff view. */
  currentText?: string;
  baselineText?: string;
  baselineMeta?: SnapshotMeta;
}

/** In-memory (non-persistent) record of the most recent run per endpoint. */
export class RunStateStore {
  private readonly states = new Map<string, EndpointRunState>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  private key(endpointId: string, environment: string): string {
    return `${endpointId}::${environment}`;
  }

  set(state: EndpointRunState): void {
    this.states.set(this.key(state.endpointId, state.environment), state);
    this.emitter.fire();
  }

  get(endpointId: string, environment: string): EndpointRunState | undefined {
    return this.states.get(this.key(endpointId, environment));
  }

  all(): EndpointRunState[] {
    return [...this.states.values()];
  }

  clear(): void {
    this.states.clear();
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
