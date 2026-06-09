export type ToolStatus = 'reading' | 'writing' | 'running' | 'searching' | 'thinking' | 'other';

export interface ToolHistoryEntry {
  toolId: string;
  toolName: string;
  status: ToolStatus;
  startedAt: number;
  finishedAt?: number;
}

export type ServerMessage =
  | { type: 'agentCreated'; id: string; name: string }
  | { type: 'agentRemoved'; id: string }
  | { type: 'existingAgents'; agents: Array<{ id: string; name: string }> }
  | { type: 'agentToolStart'; id: string; toolId: string; toolName: string; status: ToolStatus }
  | { type: 'agentToolDone'; id: string; toolId: string }
  | { type: 'agentStatus'; id: string; status: 'idle' | 'waiting' | 'active' }
  | { type: 'agentTokenUsage'; id: string; inputTokens: number; outputTokens: number }
  | { type: 'serverPort'; port: number };

export type ClientMessage =
  | { type: 'webviewReady' }
  | { type: 'focusAgent'; id: string }
  | { type: 'closeAgent'; id: string };
