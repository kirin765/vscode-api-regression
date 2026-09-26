export interface FixtureHandle {
  server: import('node:http').Server;
  state: { requests: number; lastHeaders?: Record<string, unknown> };
  port: number;
  url: string;
  close(): Promise<void>;
}

export function createServer(): {
  server: import('node:http').Server;
  state: { requests: number; lastHeaders?: Record<string, unknown> };
};

export function startServer(port?: number, host?: string): Promise<FixtureHandle>;

declare const startServerFn: typeof startServer;
export default startServerFn;
