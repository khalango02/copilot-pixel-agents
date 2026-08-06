import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AgentStore } from './agentStore.js';
import type { HookEvent } from './types.js';

const DEFAULT_PORT = 7823;

export class HooksServer {
  private server: http.Server | null = null;
  private port: number;

  constructor(
    private readonly store: AgentStore,
    private readonly channel: vscode.OutputChannel,
    port = DEFAULT_PORT,
  ) {
    this.port = port;
  }

  get activePort(): number {
    return this.port;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end('Method Not Allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk) => (body += chunk.toString()));
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{}');
          this.handleBody(body);
        });
        req.on('error', () => {
          res.writeHead(400);
          res.end('Bad Request');
        });
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          // Try next port
          this.port++;
          this.server!.listen(this.port, '127.0.0.1');
        } else {
          reject(err);
        }
      });

      this.server.on('listening', () => {
        console.log(`[Copilot Pixel Agents] Hooks server listening on port ${this.port}`);
        this.writePortFile(this.port);
        resolve(this.port);
      });

      this.server.listen(this.port, '127.0.0.1');
    });
  }

  private handleBody(body: string): void {
    try {
      const event = JSON.parse(body) as HookEvent;
      const tool = 'tool_name' in event ? event.tool_name : '';
      this.channel.appendLine(
        `[${new Date().toLocaleTimeString()}] ← ${event.event}  session=${event.session_id.slice(0, 8)}${tool ? `  tool=${tool}` : ''}`,
      );
      this.store.processEvent(event);
    } catch {
      this.channel.appendLine(`[${new Date().toLocaleTimeString()}] ← invalid payload: ${body.slice(0, 120)}`);
    }
  }

  private writePortFile(port: number): void {
    try {
      const dir = path.join(os.homedir(), '.copilot-pixel-agents');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'port'), String(port), 'utf8');
    } catch {
      // Non-fatal; hook.sh falls back to default port
    }
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }
}
