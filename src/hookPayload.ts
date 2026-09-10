import type { HookEvent, TaskDetails } from './types.js';
import { sanitizePayload } from './taskDetails.js';

export const MAX_HTTP_BODY_BYTES = 256 * 1024;
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function first(value: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (Object.hasOwn(value, key) && value[key] !== undefined && value[key] !== null) return value[key];
  return undefined;
}
export const HOOK_EVENT_ALIASES: Record<string, HookEvent['event']> = {
  PreToolUse: 'pre_tool_use', preToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use', postToolUse: 'post_tool_use',
  PostToolUseFailure: 'post_tool_use', postToolUseFailure: 'post_tool_use', post_tool_use_failure: 'post_tool_use',
  SessionStart: 'session_start', sessionStart: 'session_start', SubagentStart: 'session_start', subagentStart: 'session_start',
  SessionEnd: 'session_end', sessionEnd: 'session_end',
  Stop: 'stop', agentStop: 'stop', SubagentStop: 'stop', subagentStop: 'stop',
  UserPromptSubmit: 'waiting', userPromptSubmitted: 'waiting',
  TokenUsage: 'token_usage', tokenUsage: 'token_usage',
};
function text(value: unknown, required: boolean, max: number): string | undefined {
  if (value === undefined || value === '') {
    if (required) throw new Error('Missing metadata');
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid metadata');
  return value;
}
function detailFields(data: Record<string, unknown>): TaskDetails | undefined {
  const result: TaskDetails = {};
  const fields = { input: ['tool_input', 'toolInput', 'toolArgs'], output: ['tool_response', 'toolResponse', 'tool_result', 'toolResult'], error: ['error', 'tool_error', 'toolError'] };
  for (const key of ['input', 'output', 'error'] as const) {
    // A present null tool result is still a real JSON result, not a missing field.
    const rawKey = fields[key].find((name) => Object.hasOwn(data, name) && data[name] !== undefined);
    const raw = rawKey === undefined ? undefined : data[rawKey];
    const envelope = record(data.details) ? data.details[key] : undefined;
    if (raw !== undefined) result[key] = sanitizePayload(raw);
    else if (record(envelope) && typeof envelope.text === 'string') {
      const clean = sanitizePayload(envelope.text);
      result[key] = { ...clean, truncated: clean.truncated || envelope.truncated === true, redacted: clean.redacted || envelope.redacted === true };
    }
  }
  return Object.keys(result).length ? result : undefined;
}

/** Validate and construct an allowlisted event; never spread incoming data. */
export function normalizeHookEvent(value: unknown, captureDetails = false): HookEvent {
  if (!record(value)) throw new Error('Invalid event');
  const rawEvent = text(first(value, ['event', 'hookEventName', 'hook_event_name']), true, 64)!;
  const event = Object.hasOwn(HOOK_EVENT_ALIASES, rawEvent) ? HOOK_EVENT_ALIASES[rawEvent] : rawEvent;
  const session_id = text(first(value, ['session_id', 'sessionId']), true, 256)!;
  switch (event) {
    case 'session_start': {
      const agent_name = text(first(value, ['agent_name', 'agentName']), false, 256);
      return { event, session_id, ...(agent_name ? { agent_name } : {}) };
    }
    case 'session_end': case 'stop': case 'waiting': return { event, session_id };
    case 'pre_tool_use': case 'post_tool_use': {
      const tool_id = text(first(value, ['tool_id', 'toolCallId', 'tool_call_id', 'tool_use_id', 'toolId']), false, 256);
      const tool_name = text(first(value, ['tool_name', 'toolName']), event === 'pre_tool_use', 256);
      const details = captureDetails ? detailFields(value) : undefined;
      const metadata = { session_id, ...(tool_id ? { tool_id } : {}), ...(details ? { details } : {}) };
      if (event === 'pre_tool_use') return { event, ...metadata, tool_name: tool_name! };
      if (value.success !== undefined && typeof value.success !== 'boolean') throw new Error('Invalid success');
      const error = first(value, ['error', 'tool_error', 'toolError']);
      const response = first(value, ['tool_response', 'toolResponse', 'tool_result', 'toolResult']);
      const responseFailed = record(response) && (response.success === false || response.isError === true || response.is_error === true);
      const failed = /failure/i.test(rawEvent) || value.success === false || responseFailed ||
        (error !== undefined && error !== false && error !== '') ||
        (record(value.details) && value.details.error !== undefined);
      return { event, ...metadata, ...(tool_name ? { tool_name } : {}), success: !failed };
    }
    case 'token_usage': {
      const input_tokens = first(value, ['input_tokens', 'inputTokens']);
      const output_tokens = first(value, ['output_tokens', 'outputTokens']);
      for (const count of [input_tokens, output_tokens]) {
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new Error('Invalid token count');
      }
      return { event, session_id, input_tokens: input_tokens as number, output_tokens: output_tokens as number };
    }
    default: throw new Error('Unknown event');
  }
}