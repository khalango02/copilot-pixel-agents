export type ToolStatus = 'reading' | 'writing' | 'running' | 'searching' | 'thinking' | 'other';

/** Browser-safe contracts: this module deliberately has no VS Code imports. */
export interface ToolPayload {
  text: string;
  truncated: boolean;
  redacted: boolean;
}

export interface TaskDetails {
  input?: ToolPayload;
  output?: ToolPayload;
  error?: ToolPayload;
}

export interface ToolHistoryEntry {
  entryId: string;
  toolId: string;
  toolName: string;
  status: ToolStatus;
  startedAt: number;
  finishedAt?: number;
  outcome: 'running' | 'completed' | 'failed' | 'interrupted';
  details?: TaskDetails;
  unmatched?: boolean;
}

export interface AgentSnapshot {
  id: string;
  name: string;
  sessionStartedAt: number;
  inputTokens: number;
  outputTokens: number;
  isWaiting: boolean;
  activeTools: Array<[string, { name: string; status: ToolStatus }]>;
  toolHistory: ToolHistoryEntry[];
}

export interface AgentState {
  id: string;
  name: string;
  activeTools: Map<string, { name: string; status: ToolStatus }>;
  isWaiting: boolean;
  sessionStartedAt: number;
  lastEventAt: number;
  inputTokens: number;
  outputTokens: number;
  toolHistory: ToolHistoryEntry[];
}

/** Events sent from hook scripts → HTTP server → extension → webview */
export type HookEvent =
  | { event: 'session_start'; session_id: string; agent_name?: string }
  | { event: 'session_end'; session_id: string }
  | { event: 'pre_tool_use'; session_id: string; tool_name: string; tool_id?: string; details?: TaskDetails }
  | { event: 'post_tool_use'; session_id: string; tool_id?: string; tool_name?: string; success: boolean; details?: TaskDetails }
  | { event: 'waiting'; session_id: string }
  | { event: 'stop'; session_id: string }
  | { event: 'token_usage'; session_id: string; input_tokens: number; output_tokens: number };

/** Messages from extension → webview */
export type ServerMessage =
  | { type: 'agentCreated'; id: string; name: string }
  | { type: 'agentRemoved'; id: string }
  | { type: 'existingAgents'; agents: AgentSnapshot[] }
  | { type: 'agentToolStart'; id: string; toolId: string; toolName: string; status: ToolStatus; entry?: ToolHistoryEntry }
  | { type: 'agentToolDone'; id: string; toolId: string; entry?: ToolHistoryEntry }
  | { type: 'agentHistory'; id: string; history: ToolHistoryEntry[] }
  | { type: 'captureSettings'; enabled: boolean }
  | { type: 'agentStatus'; id: string; status: 'idle' | 'waiting' | 'active' }
  | { type: 'agentTokenUsage'; id: string; inputTokens: number; outputTokens: number }
  | { type: 'serverPort'; port: number };

/** Messages from webview → extension */
export type ClientMessage =
  | { type: 'webviewReady' }
  | { type: 'focusAgent'; id: string }
  | { type: 'closeAgent'; id: string }
  | { type: 'openCaptureSettings' }
  | { type: 'installHooks' };

export function toolNameToStatus(toolName: string): ToolStatus {
  const name = toolName.toLowerCase();
  if (name.includes('read') || name.includes('view') || name.includes('list') || name.includes('get')) return 'reading';
  if (name.includes('write') || name.includes('edit') || name.includes('create') || name.includes('insert')) return 'writing';
  if (name.includes('run') || name.includes('exec') || name.includes('bash') || name.includes('terminal')) return 'running';
  if (name.includes('search') || name.includes('grep') || name.includes('find') || name.includes('web')) return 'searching';
  return 'other';
}
