import type { IncomingMessage, ServerResponse } from 'http';
import type { AgentStore } from './agentStore.js';
import { MAX_HTTP_BODY_BYTES, normalizeHookEvent } from './hookPayload.js';

/** Pure Node request handler, independently testable without VS Code or disk I/O. */
export function createHookRequestHandler(store: AgentStore, log: (metadata: string) => void = () => {}) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const reply = (code: number): void => {
      if (!res.writableEnded) {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end('{}');
      }
    };
    if (req.method !== 'POST') { reply(405); req.resume(); return; }
    let size = 0;
    let rejected = false;
    const chunks: Buffer[] = [];
    const reject = (code: number): void => {
      rejected = true;
      chunks.length = 0;
      log(`hook rejected status=${code}`);
      reply(code);
    };
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_HTTP_BODY_BYTES) {
      reject(413); req.resume(); return;
    }
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_HTTP_BODY_BYTES) { reject(413); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      let event;
      try {
        const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        event = normalizeHookEvent(JSON.parse(body), store.captureTaskDetails);
      } catch { reject(400); return; }
      chunks.length = 0;
      // Log only fixed event metadata, never raw bodies, detail values, or exceptions.
      log(`hook event=${event.event} bytes=${size}`);
      store.processEvent(event);
      reply(200);
    });
    req.on('error', () => { if (!rejected) reject(400); });
    req.on('aborted', () => { rejected = true; chunks.length = 0; });
  };
}