import type { ToolHistoryEntry } from './types.js';

export const MAX_HISTORY = 50;
let nextLegacyId = 0;

/** Snapshots come oldest-first; the inspector presents most recent first. */
export function replaceHistory(history: ToolHistoryEntry[]): ToolHistoryEntry[] {
  return history.slice(-MAX_HISTORY).reverse().map((entry) => structuredClone(entry));
}

export function upsertHistory(history: ToolHistoryEntry[], entry: ToolHistoryEntry): void {
  const index = history.findIndex((item) => item.entryId === entry.entryId);
  if (index < 0) history.unshift(structuredClone(entry));
  else history[index] = structuredClone(entry);
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
}

/** Fallback for pre-upgrade messages; never fabricate arguments or responses. */
export function legacyEntry(toolId: string, toolName: string, status: ToolHistoryEntry['status']): ToolHistoryEntry {
  return { entryId: `legacy:${++nextLegacyId}`, toolId, toolName, status, startedAt: Date.now(), outcome: 'running' };
}