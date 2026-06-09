export type ToolStatus = 'reading' | 'writing' | 'running' | 'searching' | 'thinking' | 'other';

export interface AgentState {
  id: string;
  name: string;
  activeTools: Map<string, { name: string; status: ToolStatus }>;
  isWaiting: boolean;
  sessionStartedAt: number;
  lastEventAt: number;
  inputTokens: number;
  outputTokens: number;
}

/** Events sent from hook scripts → HTTP server → extension → webview */
export type HookEvent =
  | { event: 'session_start'; session_id: string; agent_name?: string }
  | { event: 'session_end'; session_id: string }
  | { event: 'pre_tool_use'; session_id: string; tool_name: string; tool_id: string }
  | { event: 'post_tool_use'; session_id: string; tool_id: string; success: boolean }
  | { event: 'waiting'; session_id: string }
  | { event: 'stop'; session_id: string }
  | { event: 'token_usage'; session_id: string; input_tokens: number; output_tokens: number };

/** Messages from extension → webview */
export type ServerMessage =
  | { type: 'agentCreated'; id: string; name: string }
  | { type: 'agentRemoved'; id: string }
  | { type: 'existingAgents'; agents: Array<{ id: string; name: string }> }
  | { type: 'agentToolStart'; id: string; toolId: string; toolName: string; status: ToolStatus }
  | { type: 'agentToolDone'; id: string; toolId: string }
  | { type: 'agentStatus'; id: string; status: 'idle' | 'waiting' | 'active' }
  | { type: 'agentTokenUsage'; id: string; inputTokens: number; outputTokens: number }
  | { type: 'serverPort'; port: number };

/** Messages from webview → extension */
export type ClientMessage =
  | { type: 'webviewReady' }
  | { type: 'focusAgent'; id: string }
  | { type: 'closeAgent'; id: string };

export function toolNameToStatus(toolName: string): ToolStatus {
  const name = toolName.toLowerCase();
  if (name.includes('read') || name.includes('view') || name.includes('list') || name.includes('get')) return 'reading';
  if (name.includes('write') || name.includes('edit') || name.includes('create') || name.includes('insert')) return 'writing';
  if (name.includes('run') || name.includes('exec') || name.includes('bash') || name.includes('terminal')) return 'running';
  if (name.includes('search') || name.includes('grep') || name.includes('find') || name.includes('web')) return 'searching';
  return 'other';
}
