import { record } from './hookPayload.js';

const copilotEvents = ['PreToolUse', 'PostToolUse', 'Stop', 'SessionStart', 'UserPromptSubmit'];
const claudeEvents = [...copilotEvents, 'PostToolUseFailure', 'SessionEnd'];
export function buildCopilotHooksJson(scriptPath: string): { hooks: Record<string, unknown[]> } {
  return { hooks: Object.fromEntries(copilotEvents.map((event) => [event, [{ type: 'command', command: scriptPath }]])) };
}
export function buildClaudeHooks(scriptPath: string): Record<string, unknown[]> {
  return Object.fromEntries(claudeEvents.map((event) => [event, [{ matcher: '', hooks: [{ type: 'command', command: scriptPath }] }]]));
}

/** Replace only our command entries, preserving unrelated commands, groups and settings. */
export function mergeHookConfig(current: unknown, additions: Record<string, unknown[]>, scriptPath: string, format: 'copilot' | 'claude'): Record<string, unknown> {
  if (!record(current) || (current.hooks !== undefined && !record(current.hooks))) throw new Error('Invalid hook configuration');
  const hooks = { ...(record(current.hooks) ? current.hooks : {}) };
  for (const [event, entries] of Object.entries(additions)) {
    const existing = hooks[event] ?? [];
    if (!Array.isArray(existing)) throw new Error('Invalid hook event configuration');
    const retained: unknown[] = [];
    for (const entry of existing) {
      if (!record(entry)) { retained.push(entry); continue; }
      if (format === 'copilot') {
        if (entry.command !== scriptPath) retained.push(entry);
      } else if (Array.isArray(entry.hooks)) {
        const nested = entry.hooks.filter((hook: unknown) => !record(hook) || hook.command !== scriptPath);
        if (nested.length === entry.hooks.length) retained.push(entry);
        else if (nested.length) retained.push({ ...entry, hooks: nested });
      } else retained.push(entry);
    }
    hooks[event] = [...retained, ...entries];
  }
  return { ...current, hooks };
}