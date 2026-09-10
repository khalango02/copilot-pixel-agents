import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { AgentSnapshot, AgentState, HookEvent, TaskDetails, ToolHistoryEntry } from './types.js';
import { toolNameToStatus } from './types.js';
import { sanitizeDetails } from './taskDetails.js';

export const MAX_TOOL_HISTORY = 50;

function copyEntry(entry: ToolHistoryEntry): ToolHistoryEntry {
  return { ...entry, ...(entry.details ? { details: {
    ...(entry.details.input ? { input: { ...entry.details.input } } : {}),
    ...(entry.details.output ? { output: { ...entry.details.output } } : {}),
    ...(entry.details.error ? { error: { ...entry.details.error } } : {}),
  } } : {}) };
}

export class AgentStore extends EventEmitter {
  private agents = new Map<string, AgentState>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private captureDetails: boolean;

  constructor(options: { captureTaskDetails?: boolean } = {}) {
    super();
    this.captureDetails = options.captureTaskDetails === true;
  }

  get captureTaskDetails(): boolean { return this.captureDetails; }

  setCaptureTaskDetails(enabled: boolean): void {
    this.captureDetails = enabled === true;
    // Always purge on disable, including pending entries, before notifying consumers.
    if (!enabled) {
      for (const agent of this.agents.values()) {
        for (const entry of agent.toolHistory) delete entry.details;
        this.emitHistory(agent);
      }
    }
    this.emit('captureSettings', enabled);
  }

  getSnapshots(): AgentSnapshot[] {
    return this.getAll().map((agent) => ({
      id: agent.id, name: agent.name, sessionStartedAt: agent.sessionStartedAt,
      inputTokens: agent.inputTokens, outputTokens: agent.outputTokens, isWaiting: agent.isWaiting,
      activeTools: [...agent.activeTools].map(([id, tool]) => [id, { ...tool }]),
      toolHistory: agent.toolHistory.map(copyEntry),
    }));
  }

  get(id: string): AgentState | undefined {
    return this.agents.get(id);
  }

  getAll(): AgentState[] {
    return [...this.agents.values()];
  }

  processEvent(hookEvent: HookEvent): void {
    switch (hookEvent.event) {
      case 'session_start':
        this.createAgent(hookEvent.session_id, hookEvent.agent_name);
        break;
      case 'session_end':
        this.removeAgent(hookEvent.session_id);
        break;
      case 'pre_tool_use':
        this.onToolStart(hookEvent.session_id, hookEvent.tool_id, hookEvent.tool_name, hookEvent.details);
        break;
      case 'post_tool_use':
        this.onToolDone(hookEvent.session_id, hookEvent.tool_id, hookEvent.success, hookEvent.tool_name, hookEvent.details);
        break;
      case 'waiting':
        this.onWaiting(hookEvent.session_id);
        break;
      case 'stop':
        this.onStop(hookEvent.session_id);
        break;
      case 'token_usage':
        this.onTokenUsage(hookEvent.session_id, hookEvent.input_tokens, hookEvent.output_tokens);
        break;
    }
  }

  private createAgent(id: string, name?: string): void {
    if (this.agents.has(id)) return;
    const agent: AgentState = {
      id,
      name: name ?? shortId(id),
      activeTools: new Map(),
      isWaiting: false,
      sessionStartedAt: Date.now(),
      lastEventAt: Date.now(),
      inputTokens: 0,
      outputTokens: 0,
      toolHistory: [],
    };
    this.agents.set(id, agent);
    this.emit('agentCreated', agent);
  }

  private removeAgent(id: string): void {
    if (!this.agents.has(id)) return;
    this.onStop(id);
    clearTimeout(this.idleTimers.get(id));
    this.idleTimers.delete(id);
    this.agents.delete(id);
    this.emit('agentRemoved', id);
  }

  private ensureAgent(id: string): AgentState {
    if (!this.agents.has(id)) {
      this.createAgent(id);
    }
    return this.agents.get(id)!;
  }

  private mergeDetails(entry: ToolHistoryEntry, details?: TaskDetails): void {
    const clean = this.captureDetails ? sanitizeDetails(details) : undefined;
    if (clean) entry.details = { ...entry.details, ...clean };
    if (!this.captureDetails) delete entry.details;
  }

  private pending(agent: AgentState, toolId?: string): ToolHistoryEntry | undefined {
    // Never correlate by name or a synthetic/missing ID, even with a single active tool.
    return toolId ? agent.toolHistory.find((entry) => !entry.unmatched && entry.toolId === toolId && entry.outcome === 'running') : undefined;
  }

  private newEntry(toolId: string | undefined, toolName: string, unmatched = !toolId): ToolHistoryEntry {
    const entryId = randomUUID();
    return {
      entryId, toolId: toolId || `unmatched:${entryId}`, toolName,
      status: toolNameToStatus(toolName), startedAt: Date.now(), outcome: 'running',
      ...(unmatched ? { unmatched: true } : {}),
    };
  }

  private appendEntry(agent: AgentState, entry: ToolHistoryEntry): void {
    if (agent.toolHistory.length >= MAX_TOOL_HISTORY) {
      const oldest = agent.toolHistory[0];
      if (oldest.outcome === 'running') this.finishEntry(agent, oldest, 'interrupted');
      agent.toolHistory.shift();
    }
    agent.toolHistory.push(entry);
  }

  private finishEntry(agent: AgentState, entry: ToolHistoryEntry, outcome: 'completed' | 'failed' | 'interrupted'): void {
    entry.outcome = outcome;
    entry.finishedAt = Date.now();
    agent.activeTools.delete(entry.toolId);
    this.emit('agentToolDone', agent.id, entry.toolId, copyEntry(entry));
  }

  private emitHistory(agent: AgentState): void {
    this.emit('agentHistory', agent.id, agent.toolHistory.map(copyEntry));
  }

  private onToolStart(agentId: string, toolId: string | undefined, toolName: string, details?: TaskDetails): void {
    const agent = this.ensureAgent(agentId);
    this.cancelIdleTimer(agentId);
    agent.isWaiting = false;
    agent.lastEventAt = Date.now();
    const existing = this.pending(agent, toolId);
    if (existing) {
      this.mergeDetails(existing, details);
      this.emitHistory(agent);
      return;
    }
    const entry = this.newEntry(toolId, toolName);
    this.mergeDetails(entry, details);
    this.appendEntry(agent, entry);
    agent.activeTools.set(entry.toolId, { name: toolName, status: entry.status });
    this.emit('agentToolStart', agentId, entry.toolId, toolName, entry.status, copyEntry(entry));
  }

  private onToolDone(agentId: string, toolId: string | undefined, success: boolean, toolName?: string, details?: TaskDetails): void {
    const agent = this.ensureAgent(agentId);
    let entry = this.pending(agent, toolId);
    if (!entry) {
      // Copilot can deliver the same hook through both registered directories.
      // A new pre event with a reused ID still creates a distinct pending entry.
      const completed = toolId ? [...agent.toolHistory].reverse().find((item) => item.toolId === toolId && !item.unmatched && item.outcome !== 'running') : undefined;
      if (completed) {
        this.mergeDetails(completed, details);
        if (success === false && completed.outcome === 'completed') completed.outcome = 'failed';
        this.emitHistory(agent);
        return;
      }
      entry = this.newEntry(toolId, toolName || 'Unknown tool', true);
      this.appendEntry(agent, entry);
    }
    this.mergeDetails(entry, details);
    agent.lastEventAt = Date.now();
    // Outcome is normalized before capture gating; e.g. error:false is not failure.
    this.finishEntry(agent, entry, success === false ? 'failed' : 'completed');
    if (agent.activeTools.size === 0) {
      this.scheduleIdleTimer(agentId);
    }
  }

  private onWaiting(agentId: string): void {
    const agent = this.ensureAgent(agentId);
    agent.isWaiting = true;
    agent.lastEventAt = Date.now();
    this.cancelIdleTimer(agentId);
    this.emit('agentStatus', agentId, 'waiting');
  }

  private onStop(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    for (const entry of agent.toolHistory) {
      if (entry.outcome === 'running') this.finishEntry(agent, entry, 'interrupted');
    }
    agent.activeTools.clear();
    agent.isWaiting = false;
    agent.lastEventAt = Date.now();
    this.emitHistory(agent);
    this.emit('agentStatus', agentId, 'idle');
    this.scheduleIdleTimer(agentId);
  }

  private onTokenUsage(agentId: string, inputTokens: number, outputTokens: number): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.inputTokens = inputTokens;
    agent.outputTokens = outputTokens;
    this.emit('agentTokenUsage', agentId, inputTokens, outputTokens);
  }

  private scheduleIdleTimer(agentId: string): void {
    this.cancelIdleTimer(agentId);
    const timer = setTimeout(() => {
      this.idleTimers.delete(agentId);
      this.emit('agentStatus', agentId, 'idle');
    }, 2000);
    timer.unref();
    this.idleTimers.set(agentId, timer);
  }

  private cancelIdleTimer(agentId: string): void {
    const t = this.idleTimers.get(agentId);
    if (t) clearTimeout(t);
    this.idleTimers.delete(agentId);
  }

  dispose(): void {
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    this.agents.clear();
  }
}

function shortId(id: string): string {
  return `Agent-${id.slice(0, 6)}`;
}
