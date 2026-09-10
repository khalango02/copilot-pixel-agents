import type { TaskDetails, ToolPayload } from './types.js';

export const MAX_DETAIL_CHARS = 16_000;
export const MAX_DETAIL_DEPTH = 8;
export const MAX_DETAIL_NODES = 2_000;
const OMITTED = '[TRUNCATED]';
const REDACTED = '[REDACTED]';
// Best effort only: arbitrary credentials in prose or novel formats can escape detection.
const sensitiveKey = /password|passwd|passphrase|secret|token|authorization|cookie|api.?key|private.?key|credential|client.?secret/i;
const excludedKey = /^(env|environment|environ|processEnv|raw_?prompt|prompt|system_?prompt|transcript|transcript_?path)$/i;

export function sanitizePayload(value: unknown): ToolPayload {
  let truncated = false;
  let redacted = false;
  let remaining = MAX_DETAIL_CHARS;
  let nodes = 0;
  const seen = new WeakSet<object>();
  const redactText = (text: string): string => {
    const next = text
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, REDACTED)
      .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+\/_.=:-]+/gi, REDACTED)
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{8,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]+)\b/g, REDACTED)
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
      .replace(/((?:password|passwd|passphrase|secret|token|authorization|cookie|api[_-]?key|credential)\s*["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, `$1${REDACTED}`)
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, `$1${REDACTED}@`);
    if (next !== text) redacted = true;
    return next;
  };
  const string = (text: string): string => {
    // Redact before truncation so a cut token does not hide its identifying prefix.
    const clean = redactText(text);
    if (clean.length > remaining) truncated = true;
    const result = clean.slice(0, Math.max(0, remaining));
    remaining -= result.length;
    return result;
  };
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > MAX_DETAIL_NODES || depth > MAX_DETAIL_DEPTH || remaining <= 0) {
      truncated = true;
      return OMITTED;
    }
    if (typeof item === 'string') return string(item);
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item : String(item);
    if (typeof item !== 'object') return string(String(item));
    if (seen.has(item)) { truncated = true; return '[Circular]'; }
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        const result: unknown[] = [];
        for (let i = 0; i < item.length; i++) {
          if (nodes >= MAX_DETAIL_NODES || remaining <= 0) { truncated = true; result.push(OMITTED); break; }
          const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
          result.push(visit(descriptor && 'value' in descriptor ? descriptor.value : '[Unavailable]', depth + 1));
        }
        return result;
      }
      const result: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(item)) {
        if (nodes >= MAX_DETAIL_NODES || remaining <= 0) { truncated = true; break; }
        if (excludedKey.test(key)) { redacted = true; continue; }
        const safeKey = string(key);
        if (sensitiveKey.test(key)) { result[safeKey] = REDACTED; redacted = true; ++nodes; continue; }
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        result[safeKey] = visit(descriptor && 'value' in descriptor ? descriptor.value : '[Unavailable]', depth + 1);
      }
      return result;
    } finally { seen.delete(item); }
  };
  try {
    // Hook companions may send safely serialized JSON in a ToolPayload envelope.
    if (typeof value === 'string' && /^[\s]*[\[{]/.test(value)) {
      try { value = JSON.parse(value); } catch { /* ordinary text */ }
    }
    const clean = visit(value, 0);
    const text = typeof clean === 'string' ? clean : JSON.stringify(clean);
    if (text.length > MAX_DETAIL_CHARS) truncated = true;
    return { text: text.slice(0, MAX_DETAIL_CHARS), truncated, redacted };
  } catch {
    return { text: '[Unavailable]', truncated: true, redacted };
  }
}

/** Re-sanitize even normalized envelopes: callers and the loopback client are untrusted. */
export function sanitizeDetails(details: TaskDetails | undefined): TaskDetails | undefined {
  if (!details) return undefined;
  const result: TaskDetails = {};
  for (const key of ['input', 'output', 'error'] as const) {
    const payload = details[key];
    if (!payload) continue;
    const clean = sanitizePayload(payload.text);
    result[key] = { ...clean, truncated: clean.truncated || payload.truncated === true, redacted: clean.redacted || payload.redacted === true };
  }
  return Object.keys(result).length ? result : undefined;
}