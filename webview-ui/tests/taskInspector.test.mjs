import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const { outputFiles } = await build({
  entryPoints: [`${root}main.ts`], bundle: true, write: false, format: 'iife',
  plugins: [{ name: 'no-css-in-tests', setup(build) { build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' })); } }],
});

async function fixture(t, enabled = true) {
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { runScripts: 'outside-only', url: 'http://localhost/' });
  t.after(() => dom.window.close());
  const { window } = dom;
  await new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  const sent = [];
  window.acquireVsCodeApi = () => ({ postMessage: (message) => sent.push(message) });
  window.structuredClone = structuredClone;
  window.ResizeObserver = class { observe() {} };
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  window.HTMLCanvasElement.prototype.getContext = () => ({ imageSmoothingEnabled: false });
  window.eval(outputFiles[0].text);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  const send = (data) => window.dispatchEvent(new window.MessageEvent('message', { data }));
  send({ type: 'captureSettings', enabled });
  send({ type: 'agentCreated', id: 'a', name: 'Copilot' });
  const doc = window.document;
  const click = (selector) => { const el = doc.querySelector(selector); assert.ok(el, selector); el.click(); };
  const inspect = () => { click('.agent-chip'); click('.modal-hist-entry'); };
  return { window, doc, send, click, inspect, sent };
}

const payload = (text, extra = {}) => ({ text, truncated: false, redacted: false, ...extra });
function entry(extra = {}) {
  return { entryId: 'invocation-1', toolId: 'tool-1', toolName: 'read_file', status: 'reading', startedAt: 1700000000000,
    outcome: 'running', details: { input: payload('{"path":"src/example.ts"}') }, ...extra };
}
const start = (send, e) => send({ type: 'agentToolStart', id: 'a', toolId: e.toolId, toolName: e.toolName, status: e.status, entry: e });
const done = (send, e) => send({ type: 'agentToolDone', id: 'a', toolId: e.toolId, entry: e });

test('click history, inspect real payloads, update output live and return to the same task', async (t) => {
  const { doc, send, click, inspect } = await fixture(t);
  start(send, entry()); inspect();
  assert.match(doc.querySelector('.task-json').textContent, /"path": "src\/example.ts"/);
  click('#task-tab-output');
  assert.match(doc.querySelector('.task-content').textContent, /Waiting for the tool completion/);
  done(send, entry({ outcome: 'completed', finishedAt: 1700000000250, details: { input: payload('{"path":"src/example.ts"}'), output: payload('actual code\nreturn true;') } }));
  assert.equal(doc.querySelector('#task-tab-output').getAttribute('aria-selected'), 'true');
  assert.equal(doc.querySelector('.task-json').textContent, 'actual code\nreturn true;');
  assert.match(doc.querySelector('.task-summary').textContent, /250 ms/);
  click('#task-tab-metadata');
  assert.match(doc.querySelector('.task-json').textContent, /invocation-1/);
  click('[data-focus-key="back"]');
  assert.equal(doc.querySelectorAll('.modal-hist-entry').length, 1);
  assert.equal(doc.activeElement.dataset.entryId, 'invocation-1');
});

test('late output for another task does not change current selection; reused tool IDs stay separate', async (t) => {
  const { doc, send, inspect, click } = await fixture(t);
  start(send, entry()); inspect(); click('#task-tab-output');
  start(send, entry({ entryId: 'other', toolId: 'other-tool', toolName: 'run_terminal' }));
  done(send, entry({ entryId: 'other', toolId: 'other-tool', toolName: 'run_terminal', outcome: 'completed', finishedAt: 1700000000020 }));
  assert.equal(doc.querySelector('.task-title').textContent, 'read_file');
  assert.match(doc.querySelector('.task-content').textContent, /Waiting/);
  done(send, entry({ outcome: 'completed', finishedAt: 1700000000030 }));
  start(send, entry({ entryId: 'reused-id' }));
  assert.match(doc.querySelector('.task-summary').textContent, /Completed/);
  click('[data-focus-key="back"]');
  assert.equal(doc.querySelectorAll('.modal-hist-entry').length, 3);
});

test('untrusted tool names, IDs and output are text, never executable markup', async (t) => {
  const { window, doc, send, inspect, click } = await fixture(t);
  const hostile = '<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>';
  const e = entry({ entryId: '" autofocus onfocus="window.pwned=true', toolName: hostile, details: { input: payload(hostile) } });
  start(send, e); inspect();
  assert.equal(doc.querySelector('.task-title').textContent, hostile);
  assert.equal(doc.querySelector('.task-json').textContent, hostile);
  assert.equal(doc.querySelectorAll('#agent-modal img, #agent-modal script').length, 0);
  assert.equal(window.pwned, undefined);
  click('[data-focus-key="back"]');
  assert.equal(doc.querySelector('.modal-hist-entry').dataset.entryId, e.entryId);
  assert.equal(doc.querySelector('.modal-hist-entry').hasAttribute('autofocus'), false);
});

test('disabled capture hides payloads, routes to Settings, purges existing details and handles missing legacy data', async (t) => {
  const { doc, send, inspect, click, sent } = await fixture(t);
  start(send, entry()); inspect();
  send({ type: 'agentHistory', id: 'a', history: [entry({ details: undefined })] });
  send({ type: 'captureSettings', enabled: false });
  assert.equal(doc.querySelector('.task-json'), null);
  assert.match(doc.querySelector('.task-content').textContent, /capture is off/);
  click('[data-focus-key="settings"]');
  assert.equal(sent.at(-1).type, 'openCaptureSettings');
  send({ type: 'captureSettings', enabled: true });
  assert.match(doc.querySelector('.task-content').textContent, /No payload was received/);
  click('[data-focus-key="back"]');
  send({ type: 'agentToolStart', id: 'a', toolId: 'legacy', toolName: 'old_hook', status: 'other' });
  click('.modal-hist-entry');
  assert.match(doc.querySelector('.task-content').textContent, /No payload was received/);
});

test('failed, interrupted, unmatched and truncated events are explicit; history eviction has a safe empty state', async (t) => {
  const { doc, send, inspect, click } = await fixture(t);
  const e = entry({ outcome: 'failed', finishedAt: 1700000000200, unmatched: true, details: { error: payload('masked [REDACTED]', { redacted: true, truncated: true }) } });
  done(send, e); inspect(); click('#task-tab-error');
  assert.match(doc.querySelector('.task-summary').textContent, /Failed/);
  assert.match(doc.querySelector('#agent-modal').textContent, /Unmatched event/);
  assert.match(doc.querySelector('.task-content').textContent, /redacted.*truncated/s);
  send({ type: 'agentHistory', id: 'a', history: [entry({ outcome: 'interrupted', finishedAt: 1700000000300 })] });
  assert.match(doc.querySelector('.task-summary').textContent, /Interrupted/);
  send({ type: 'agentHistory', id: 'a', history: [] });
  assert.match(doc.querySelector('.task-content').textContent, /no longer in the retained history/);
  click('[data-focus-key="back"]');
  assert.match(doc.querySelector('.modal-history').textContent, /No tools yet/);
});

test('snapshot restores up to 50 entries and metadata before opening the inspector', async (t) => {
  const { doc, send, inspect, click } = await fixture(t);
  send({ type: 'existingAgents', agents: [{ id: 'a', name: 'Copilot', sessionStartedAt: 1700000000000,
    inputTokens: 1000, outputTokens: 2000, isWaiting: false, activeTools: [],
    toolHistory: Array.from({ length: 60 }, (_, i) => entry({ entryId: `item-${i}`, toolId: `tool-${i}`, outcome: 'completed', finishedAt: 1700000000001 })),
  }] });
  inspect(); click('#task-tab-metadata');
  assert.match(doc.querySelector('.task-json').textContent, /item-59/);
  click('[data-focus-key="back"]');
  assert.equal(doc.querySelectorAll('.modal-hist-entry').length, 50);
  assert.match(doc.querySelector('.modal-stats').textContent, /1.0k/);
});

test('tabs work with keyboard, preserve focus on updates, and switching agents resets the task', async (t) => {
  const { doc, window, send, inspect, click } = await fixture(t);
  start(send, entry()); inspect();
  const tab = doc.querySelector('#task-tab-input');
  tab.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(doc.activeElement.id, 'task-tab-output');
  done(send, entry({ outcome: 'completed', finishedAt: 1700000000001 }));
  assert.equal(doc.activeElement.id, 'task-tab-output');
  send({ type: 'agentCreated', id: 'b', name: 'Other agent' });
  doc.querySelectorAll('.agent-chip')[1].click();
  assert.equal(doc.querySelector('.task-title'), null);
  assert.equal(doc.querySelector('.modal-name').textContent, 'Other agent');
  click('#modal-close-btn');
  assert.equal(doc.querySelector('#agent-modal').style.display, 'none');
});