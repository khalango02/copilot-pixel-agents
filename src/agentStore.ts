import { EventEmitter } from 'events';
import type { AgentState, HookEvent, ToolStatus } from './types.js';
import { toolNameToStatus } from './types.js';

const AGENT_IDLE_TIMEOUT_MS = 30_000;

export class AgentStore extends EventEmitter {
  private agents = new Map<string, AgentState>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
        this.onToolStart(hookEvent.session_id, hookEvent.tool_id, hookEvent.tool_name);
        break;
      case 'post_tool_use':
        this.onToolDone(hookEvent.session_id, hookEvent.tool_id);
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
    };
    this.agents.set(id, agent);
    this.emit('agentCreated', agent);
  }

  private removeAgent(id: string): void {
    if (!this.agents.has(id)) return;
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

  private onToolStart(agentId: string, toolId: string, toolName: string): void {
    const agent = this.ensureAgent(agentId);
    this.cancelIdleTimer(agentId);
    const status: ToolStatus = toolNameToStatus(toolName);
    agent.activeTools.set(toolId, { name: toolName, status });
    agent.isWaiting = false;
    agent.lastEventAt = Date.now();
    this.emit('agentToolStart', agentId, toolId, toolName, status);
  }

  private onToolDone(agentId: string, toolId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.activeTools.delete(toolId);
    agent.lastEventAt = Date.now();
    this.emit('agentToolDone', agentId, toolId);
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
    agent.activeTools.clear();
    agent.isWaiting = false;
    agent.lastEventAt = Date.now();
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
      this.emit('agentStatus', agentId, 'idle');
    }, 2000);
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
