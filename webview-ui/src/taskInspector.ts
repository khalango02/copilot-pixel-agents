import type { ToolHistoryEntry, ToolPayload } from './types.js';

export type TaskTab = 'input' | 'output' | 'error' | 'metadata';
const TAB_LABELS: Record<TaskTab, string> = { input: 'Input', output: 'Output', error: 'Error', metadata: 'Event' };

export function formatPayload(payload: ToolPayload): string {
  if (payload.truncated) return payload.text;
  try { return JSON.stringify(JSON.parse(payload.text), null, 2); }
  catch { return payload.text; }
}

export function outcomeLabel(entry: ToolHistoryEntry): string {
  return { running: 'Running', completed: 'Completed', failed: 'Failed', interrupted: 'Interrupted' }[entry.outcome];
}

export function missingPayloadMessage(entry: ToolHistoryEntry | undefined, tab: TaskTab, enabled: boolean): string {
  if (!entry) return 'This task is no longer in the retained history (50 entries per agent).';
  if (!enabled && tab !== 'metadata') return 'Payload capture is off. Enable Capture Task Details in Settings to retain future inputs, outputs and errors. Previously discarded data cannot be recovered.';
  if (tab === 'output' && entry.outcome === 'running') return 'Waiting for the tool completion event. The provider may not include a response.';
  if (tab === 'error') return 'No error payload was received. This does not by itself prove the tool succeeded.';
  return 'No payload was received for this part of the task. Reinstall the updated hooks and run a new task. Some providers send metadata only; earlier data cannot be reconstructed.';
}

/** DOM-only payload rendering: tool output is never parsed as HTML/Markdown. */
export function renderTaskInspector(
  container: HTMLElement,
  entry: ToolHistoryEntry | undefined,
  agentName: string,
  enabled: boolean,
  onBack: () => void,
  onClose: () => void,
  onSettings: () => void,
): void {
  const previousScroll = container.querySelector('.task-content')?.scrollTop ?? 0;
  const focused = container.ownerDocument.activeElement as HTMLElement | null;
  const previousFocus = focused && container.contains(focused) ? focused.dataset.focusKey : undefined;
  const activeTab = (Object.keys(TAB_LABELS).includes(container.dataset.taskTab ?? '') ? container.dataset.taskTab : 'input') as TaskTab;
  container.replaceChildren();
  container.classList.add('showing-task');
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
    const node = container.ownerDocument.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text: string, key: string, action: () => void) => {
    const node = el('button', 'task-button', text);
    node.type = 'button'; node.dataset.focusKey = key;
    node.addEventListener('click', action);
    return node;
  };
  const header = el('div', 'task-header');
  const navigation = el('div', 'task-navigation');
  navigation.append(button('← History', 'back', onBack), button('Close ×', 'close', onClose));
  header.append(navigation, el('div', 'task-eyebrow', `TOOL INSPECTOR · ${agentName}`),
    el('h2', 'task-title', entry?.toolName ?? 'Task unavailable'));
  if (entry) {
    const meta = el('div', 'task-summary');
    meta.append(el('span', `task-outcome ${entry.outcome}`, outcomeLabel(entry)),
      el('span', '', new Date(entry.startedAt).toLocaleTimeString()),
      el('span', '', entry.finishedAt === undefined ? 'In progress' : `${Math.max(0, entry.finishedAt - entry.startedAt)} ms`));
    header.append(meta);
  }
  container.append(header);
  const notice = el('div', 'task-notice', 'Hook data only — not the VS Code chat debug log, model reasoning or a complete conversation.');
  container.append(notice);
  if (entry?.unmatched) container.append(el('div', 'task-warning', 'Unmatched event: a reliable start/end correlation was not available. Duration is not the full tool runtime.'));
  const settings = button(enabled ? 'Capture enabled · Settings' : 'Enable payload capture…', 'settings', onSettings);
  settings.classList.add('task-capture');
  container.append(settings);

  const tabs = el('div', 'task-tabs');
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Task payload sections');
  for (const [id, title] of Object.entries(TAB_LABELS)) {
    const tab = button(title, id, () => {
      container.dataset.taskTab = id;
      renderTaskInspector(container, entry, agentName, enabled, onBack, onClose, onSettings);
      container.querySelector<HTMLButtonElement>(`[data-focus-key="${id}"]`)?.focus();
    });
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(activeTab === id));
    tab.id = `task-tab-${id}`; tab.setAttribute('aria-controls', 'task-tab-panel');
    tab.tabIndex = activeTab === id ? 0 : -1;
    tab.addEventListener('keydown', (event) => {
      const ids = Object.keys(TAB_LABELS);
      const index = ids.indexOf(id);
      const next = event.key === 'ArrowRight' ? (index + 1) % ids.length
        : event.key === 'ArrowLeft' ? (index + ids.length - 1) % ids.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); container.querySelector<HTMLButtonElement>(`[data-focus-key="${ids[next]}"]`)?.click(); }
    });
    tabs.append(tab);
  }
  container.append(tabs);
  const content = el('div', 'task-content');
  content.id = 'task-tab-panel'; content.setAttribute('role', 'tabpanel');
  content.setAttribute('aria-labelledby', `task-tab-${activeTab}`); content.tabIndex = 0;
  content.dataset.focusKey = 'content';
  const payload = enabled && activeTab !== 'metadata' ? entry?.details?.[activeTab] : undefined;
  if (activeTab === 'metadata' && entry) {
    const pre = el('pre', 'task-json');
    const { details: _details, ...metadata } = entry;
    pre.textContent = JSON.stringify({ ...metadata, startedAtISO: new Date(entry.startedAt).toISOString(),
      finishedAtISO: entry.finishedAt === undefined ? undefined : new Date(entry.finishedAt).toISOString(),
      source: 'Pixel Agents hook events (normalized metadata)',
    }, null, 2);
    content.append(pre);
  } else if (payload) {
    if (payload.redacted) content.append(el('div', 'task-warning', 'Sensitive fields were redacted (best-effort). Review before sharing.'));
    if (payload.truncated) content.append(el('div', 'task-warning', 'Payload truncated or omitted by a size/depth limit; this is not the full content.'));
    content.append(el('pre', 'task-json', formatPayload(payload)));
  } else {
    content.append(el('p', 'task-empty', missingPayloadMessage(entry, activeTab, enabled)));
  }
  container.append(content);
  content.scrollTop = previousScroll;
  if (previousFocus) {
    Array.from(container.querySelectorAll<HTMLElement>('[data-focus-key]')).find((node) => node.dataset.focusKey === previousFocus)?.focus({ preventScroll: true });
  }
}