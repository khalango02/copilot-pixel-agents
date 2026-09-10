import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtemp, writeFile, symlink, rm, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
// Bundle in memory: tests never build into dist or load a real VS Code host.
function load(file, mocks = {}) {
  const { outputFiles } = buildSync({ entryPoints: [join(root, 'src', file)], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputFiles[0].text)((id) => id in mocks ? mocks[id] : require(id), module, module.exports);
  return module.exports;
}
const { AgentStore, MAX_TOOL_HISTORY } = load('agentStore.ts');
const { normalizeHookEvent, MAX_HTTP_BODY_BYTES } = load('hookPayload.ts');
const { sanitizePayload, MAX_DETAIL_CHARS } = load('taskDetails.ts');
const { createHookRequestHandler } = load('hookHttp.ts');
const { buildHookScript, buildHookPsScript } = load('hookScripts.ts');
const { buildCopilotHooksJson, buildClaudeHooks, mergeHookConfig } = load('hooksConfig.ts');
const pre = (id = 'call', extra = {}) => ({ event: 'pre_tool_use', session_id: 'session', tool_id: id, tool_name: 'read_file', ...extra });
const post = (id = 'call', extra = {}) => ({ event: 'post_tool_use', session_id: 'session', tool_id: id, success: true, ...extra });
const payload = (text) => ({ text, truncated: false, redacted: false });
function storeFor(t, enabled = true) {
  const store = new AgentStore({ captureTaskDetails: enabled });
  t.after(() => store.dispose());
  return store;
}

test('allowlisted aliases preserve actual input/output/error and failure with capture off', () => {
  for (const inputKey of ['tool_input', 'toolInput', 'toolArgs']) {
    const event = normalizeHookEvent({ hookEventName: 'PreToolUse', sessionId: 's', toolCallId: 't', toolName: 'read', [inputKey]: { path: 'example.txt' }, environment: { secret: 'no' }, prompt: 'no', transcript: 'no' }, true);
    assert.equal(event.details.input.text, '{"path":"example.txt"}');
    assert.deepEqual(Object.keys(event).sort(), ['details', 'event', 'session_id', 'tool_id', 'tool_name']);
  }
  for (const outputKey of ['tool_response', 'toolResponse', 'tool_result', 'toolResult']) {
    assert.equal(normalizeHookEvent({ ...post(), [outputKey]: [0, false, 'text'] }, true).details.output.text, '[0,false,"text"]');
    assert.equal(normalizeHookEvent({ ...post(), [outputKey]: { success: false } }).success, false);
  }
  for (const errorKey of ['error', 'tool_error', 'toolError']) {
    const data = { ...post(), [errorKey]: { message: 'failure' } };
    assert.equal(normalizeHookEvent(data, true).details.error.text, '{"message":"failure"}');
    assert.equal(normalizeHookEvent(data).success, false);
    assert.equal(normalizeHookEvent(data).details, undefined);
  }
  for (const event of ['PostToolUseFailure', 'postToolUseFailure', 'post_tool_use_failure']) {
    assert.equal(normalizeHookEvent({ event, session_id: 's', success: true }).success, false);
  }
  assert.equal(normalizeHookEvent(post('t', { success: false })).success, false);
  assert.equal(normalizeHookEvent({ event: 'post_tool_use', session_id: 's' }).success, true);
  assert.equal(normalizeHookEvent({ ...pre(), toolArgs: false }, true).details.input.text, 'false');
  assert.equal(normalizeHookEvent({ ...post(), tool_response: null }, true).details.output.text, 'null');
});

test('validation rejects bad metadata, events, IDs, names, success and token counts', () => {
  for (const value of [null, [], {}, { event: 'constructor', session_id: 's' }, pre('x', { session_id: '' }), pre('x', { session_id: 1 }), pre('x', { tool_name: '' }), pre('x', { tool_name: 'bad\nname' }), pre('x'.repeat(257)), post('x', { success: 'false' })]) {
    assert.throws(() => normalizeHookEvent(value));
  }
  for (const count of [-1, NaN, Infinity, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => normalizeHookEvent({ event: 'token_usage', session_id: 's', input_tokens: count, output_tokens: 0 }));
  }
  assert.deepEqual(normalizeHookEvent({ event: 'tokenUsage', sessionId: 's', inputTokens: 0, outputTokens: 10 }), { event: 'token_usage', session_id: 's', input_tokens: 0, output_tokens: 10 });
  assert.equal(normalizeHookEvent(pre('', { tool_name: 'tool "quoted" | unicode ç' })).tool_id, undefined);
});

test('capture gating never changes successful false/empty error outcomes', (t) => {
  for (const enabled of [false, true]) {
    const store = storeFor(t, enabled);
    for (const error of [false, '', null]) {
      const event = normalizeHookEvent(post('t', { error }), enabled);
      store.processEvent(event);
      assert.equal(store.get('session').toolHistory.at(-1).outcome, 'completed');
    }
  }
});

test('sanitization is recursive, bounded, JSON-safe and removes sensitive/excluded keys', () => {
  const clean = sanitizePayload({ nested: [{ password: 'password-value', api_key: 'api-value', sessionToken: 'token-value', safe: 'ordinary' }], environment: { anything: 'env-value' }, raw_prompt: 'prompt-value', transcript: 'transcript-value', text: 'Bearer opaque.value and ghp_abcdefghijklmnopqrstuvwxyz' });
  assert.equal(clean.redacted, true);
  assert.equal(clean.truncated, false);
  for (const secret of ['password-value', 'api-value', 'token-value', 'env-value', 'prompt-value', 'transcript-value', 'opaque.value', 'ghp_abcdefghijklmnopqrstuvwxyz']) assert.ok(!clean.text.includes(secret));
  assert.ok(clean.text.includes('ordinary'));
  assert.doesNotThrow(() => JSON.parse(clean.text));
  const long = sanitizePayload('x'.repeat(100_000));
  assert.equal(long.text.length, MAX_DETAIL_CHARS);
  assert.equal(long.truncated, true);
  let deep = { leaf: 'deep' };
  for (let i = 0; i < 20; i++) deep = { child: deep };
  assert.equal(sanitizePayload(deep).truncated, true);
  assert.equal(sanitizePayload(Array(10_000).fill(0)).truncated, true);
  const circular = {}; circular.self = circular;
  assert.equal(sanitizePayload(circular).truncated, true);
  let getterCalled = false;
  sanitizePayload({ get secretGetter() { getterCalled = true; throw Error('do not execute'); } });
  assert.equal(getterCalled, false);
  for (const value of [undefined, 10n, NaN, Infinity, Symbol('x'), () => {}, new Date(), new Map()]) assert.equal(typeof sanitizePayload(value).text, 'string');
  const proto = sanitizePayload(JSON.parse('{"__proto__":{"password":"hidden"}}'));
  assert.ok(!proto.text.includes('hidden'));
  const marked = normalizeHookEvent(post('x', { details: { output: { text: 'safe', redacted: true, truncated: true } } }), true);
  assert.deepEqual(marked.details.output, { text: 'safe', redacted: true, truncated: true });
});

test('store preserves stable invocation identity, deduplicates pre, reuses tool IDs after completion', (t) => {
  const store = storeFor(t);
  const starts = [], done = [];
  store.on('agentToolStart', (...args) => starts.push(args));
  store.on('agentToolDone', (...args) => done.push(args));
  store.processEvent(pre('call', { details: { input: payload('input') } }));
  store.processEvent(pre('call'));
  assert.equal(starts.length, 1);
  assert.equal(store.get('session').activeTools.size, 1);
  store.processEvent(post('call', { success: false, details: { output: payload('output'), error: payload('failed') } }));
  const entry = store.get('session').toolHistory[0];
  assert.equal(starts[0][4].entryId, done[0][2].entryId);
  assert.equal(entry.outcome, 'failed');
  assert.equal(entry.details.input.text, 'input');
  assert.equal(entry.details.output.text, 'output');
  assert.ok(entry.finishedAt >= entry.startedAt);
  store.processEvent(pre('call'));
  store.processEvent(post('call'));
  assert.equal(store.get('session').toolHistory.length, 2);
  assert.notEqual(store.get('session').toolHistory[1].entryId, entry.entryId);
  assert.equal(store.get('session').toolHistory[1].outcome, 'completed');
  assert.equal(starts[0][4].outcome, 'running', 'emitted entries are snapshots, not mutable references');
});

test('missing IDs and post-only events never correlate by tool name or another active ID', (t) => {
  const store = storeFor(t);
  store.processEvent(pre('a'));
  store.processEvent(pre('b'));
  store.processEvent(pre(undefined, { tool_id: undefined }));
  store.processEvent(pre(undefined, { tool_id: undefined }));
  store.processEvent(post(undefined, { tool_id: undefined, tool_name: 'read_file' }));
  store.processEvent(post('unknown', { tool_name: 'read_file' }));
  const agent = store.get('session');
  assert.equal(agent.activeTools.size, 4);
  assert.equal(agent.toolHistory.length, 6);
  assert.equal(new Set(agent.toolHistory.map((entry) => entry.entryId)).size, 6);
  assert.ok(agent.toolHistory.slice(2).every((entry) => entry.unmatched));
  store.processEvent(post('a'));
  assert.equal(agent.activeTools.size, 3);
  assert.equal(agent.toolHistory[0].outcome, 'completed');
  assert.equal(agent.toolHistory[1].outcome, 'running');
  store.processEvent(post('only', { session_id: 'new-session' }));
  assert.equal(store.get('new-session').toolHistory[0].unmatched, true);
});

test('duplicate completion hooks update the same invocation without duplicating history', (t) => {
  const store = storeFor(t);
  store.processEvent(pre('t'));
  store.processEvent(post('t', { details: { output: payload('result') } }));
  const id = store.get('session').toolHistory[0].entryId;
  store.processEvent(post('t'));
  assert.equal(store.get('session').toolHistory.length, 1);
  assert.equal(store.get('session').toolHistory[0].entryId, id);
  assert.equal(store.get('session').toolHistory[0].details.output.text, 'result');
  store.processEvent(pre('t'));
  store.processEvent(post('t'));
  assert.equal(store.get('session').toolHistory.length, 2);
  assert.notEqual(store.get('session').toolHistory[1].entryId, id);
});

test('stop/session_end interrupts pending entries and history/active state stays bounded', (t) => {
  const store = storeFor(t);
  const done = [];
  store.on('agentToolDone', (_agent, _tool, entry) => done.push(entry));
  for (let i = 0; i < 70; i++) store.processEvent(pre(String(i)));
  assert.equal(store.get('session').toolHistory.length, MAX_TOOL_HISTORY);
  assert.equal(store.get('session').activeTools.size, MAX_TOOL_HISTORY);
  assert.equal(done.length, 20);
  assert.ok(done.every((entry) => entry.outcome === 'interrupted'));
  store.processEvent({ event: 'stop', session_id: 'session' });
  assert.equal(store.get('session').activeTools.size, 0);
  assert.ok(store.get('session').toolHistory.every((entry) => entry.outcome === 'interrupted' && entry.finishedAt));
  store.processEvent(pre('new'));
  store.processEvent({ event: 'session_end', session_id: 'session' });
  assert.equal(done.at(-1).outcome, 'interrupted');
  assert.equal(store.get('session'), undefined);
});

test('capture defaults off, purges running and terminal details, and snapshots include full metadata', (t) => {
  const store = new AgentStore(); t.after(() => store.dispose());
  assert.equal(store.captureTaskDetails, false);
  store.processEvent(pre('disabled', { details: { input: payload('not captured') } }));
  assert.equal(store.get('session').toolHistory[0].details, undefined);
  store.setCaptureTaskDetails(true);
  store.processEvent({ event: 'session_start', session_id: 'named', agent_name: 'Named Agent' });
  store.processEvent(pre('first', { session_id: 'named', details: { input: payload('first input') } }));
  store.processEvent(post('first', { session_id: 'named' }));
  store.processEvent(pre('second', { session_id: 'named', details: { input: payload('second input') } }));
  store.processEvent({ event: 'token_usage', session_id: 'named', input_tokens: 12, output_tokens: 34 });
  store.processEvent({ event: 'waiting', session_id: 'named' });
  const snapshot = store.getSnapshots().find((agent) => agent.id === 'named');
  assert.deepEqual(Object.keys(snapshot).sort(), ['activeTools', 'id', 'inputTokens', 'isWaiting', 'name', 'outputTokens', 'sessionStartedAt', 'toolHistory']);
  assert.equal(snapshot.name, 'Named Agent');
  assert.equal(snapshot.inputTokens, 12); assert.equal(snapshot.outputTokens, 34); assert.equal(snapshot.isWaiting, true);
  assert.deepEqual(snapshot.activeTools, [['second', { name: 'read_file', status: 'reading' }]]);
  snapshot.toolHistory.length = 0;
  assert.equal(store.get('named').toolHistory.length, 2);
  const histories = [];
  store.on('agentHistory', (id, history) => histories.push({ id, history }));
  store.setCaptureTaskDetails(false);
  assert.ok(histories.every(({ history }) => history.every((entry) => !entry.details)));
  store.processEvent(post('second', { session_id: 'named', details: { output: payload('not captured') } }));
  assert.ok(store.get('named').toolHistory.every((entry) => !entry.details));
  store.setCaptureTaskDetails(true);
  assert.ok(store.get('named').toolHistory.every((entry) => !entry.details));
});

async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return server.address().port;
}
function send(port, body, { method = 'POST', chunked = false } = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method, headers: chunked ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': bytes.length } }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    for (let i = 0; i < bytes.length; i += 8192) req.write(bytes.subarray(i, i + 8192));
    req.end();
  });
}

test('HTTP validates before processing, limits byte size, supports chunked UTF-8, metadata-only logs', async (t) => {
  const store = storeFor(t, false), logs = [];
  const port = await listen(t, createHookRequestHandler(store, (line) => logs.push(line)));
  assert.equal(await send(port, JSON.stringify(pre('t', { tool_input: 'secret-value' }))), 200);
  assert.equal(store.get('session').toolHistory[0].details, undefined);
  assert.equal(await send(port, '{"secret":"raw-value"'), 400);
  assert.equal(await send(port, JSON.stringify(post('x', { success: 'no' }))), 400);
  assert.equal(await send(port, JSON.stringify(pre()), { method: 'GET' }), 405);
  assert.equal(await send(port, Buffer.from([0xff])), 400);
  for (const chunked of [false, true]) assert.equal(await send(port, 'x'.repeat(MAX_HTTP_BODY_BYTES + 1), { chunked }), 413);
  const boundary = JSON.stringify({ event: 'waiting', session_id: 'boundary', ignored: '' });
  assert.equal(await send(port, boundary.replace('"ignored":""', `"ignored":"${'x'.repeat(MAX_HTTP_BODY_BYTES - Buffer.byteLength(boundary))}"`)), 200);
  assert.equal(store.get('session').toolHistory.length, 1);
  store.setCaptureTaskDetails(true);
  assert.equal(await send(port, JSON.stringify(post('t', { tool_response: 'ação 🦊', error: 'failure' })), { chunked: true }), 200);
  assert.equal(store.get('session').toolHistory[0].details.output.text, 'ação 🦊');
  assert.equal(store.get('session').toolHistory[0].outcome, 'failed');
  assert.ok(logs.every((line) => !/secret-value|raw-value|failure|ação/.test(line)));
  assert.equal(await send(port, JSON.stringify({ event: 'stop', session_id: 'session' })), 200);
});

test('webviewReady and live contracts expose full snapshots, entries and capture purge histories', (t) => {
  const store = storeFor(t), messages = [];
  const vscode = { Uri: { joinPath: (...parts) => parts.join('/') }, commands: { executeCommand() {} } };
  const { PixelOfficeViewProvider } = load('viewProvider.ts', { vscode });
  const provider = new PixelOfficeViewProvider({ extensionUri: '/test' }, store, 7823);
  let receive;
  provider.resolveWebviewView({ webview: { options: {}, asWebviewUri: (value) => value, postMessage: (message) => messages.push(message), onDidReceiveMessage: (handler) => { receive = handler; }, cspSource: 'test' } });
  store.processEvent(pre('t', { details: { input: payload('input') } }));
  store.processEvent(post('t'));
  assert.ok(messages.find((m) => m.type === 'agentToolStart').entry);
  assert.equal(messages.find((m) => m.type === 'agentToolDone').entry.outcome, 'completed');
  messages.length = 0;
  receive({ type: 'webviewReady' });
  assert.deepEqual(messages[0], { type: 'captureSettings', enabled: true });
  assert.deepEqual(messages[1], { type: 'existingAgents', agents: store.getSnapshots() });
  assert.deepEqual(messages[2], { type: 'serverPort', port: 7823 });
  messages.length = 0;
  store.setCaptureTaskDetails(false);
  assert.equal(messages.find((m) => m.type === 'agentHistory').history[0].details, undefined);
  assert.deepEqual(messages.at(-1), { type: 'captureSettings', enabled: false });
});

test('extension reacts to configuration changes without reading installed hooks or chat logs', async (t) => {
  let enabled = false, changeConfig, provider;
  const messages = [], writes = [];
  const config = { get: (key, fallback) => key === 'captureTaskDetails' ? enabled : fallback };
  const vscode = {
    workspace: {
      getConfiguration: () => config,
      onDidChangeConfiguration: (callback) => { changeConfig = callback; return { dispose() {} }; },
    },
    window: {
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      registerWebviewViewProvider: (_id, instance) => { provider = instance; return { dispose() {} }; },
      showErrorMessage: (message) => assert.fail(message),
    },
    commands: { registerCommand: () => ({ dispose() {} }), executeCommand() {} },
    Uri: { joinPath: (...parts) => parts.join('/') },
  };
  const http = {
    createServer: () => {
      const server = new EventEmitter();
      server.listen = () => { queueMicrotask(() => server.emit('listening')); return server; };
      server.address = () => ({ port: 7823 });
      server.close = () => {};
      return server;
    },
  };
  const fs = {
    mkdirSync() {}, writeFileSync: (path) => writes.push(path),
    readFileSync: () => assert.fail('activation must not read hook files when already installed'),
    existsSync: () => assert.fail('activation must not scan unrelated files'),
  };
  const { activate } = load('extension.ts', { vscode, fs, os: { homedir: () => '/mock-home' }, http });
  const context = { subscriptions: [], extensionUri: '/test', globalState: { get: () => true } };
  t.after(() => context.subscriptions.forEach((subscription) => subscription.dispose()));
  await activate(context);
  assert.deepEqual(writes, ['/mock-home/.copilot-pixel-agents/port']);
  provider.resolveWebviewView({ webview: { options: {}, asWebviewUri: (value) => value, postMessage: (message) => messages.push(message), onDidReceiveMessage() {}, cspSource: 'test' } });
  assert.equal(provider.store.captureTaskDetails, false);
  enabled = true;
  changeConfig({ affectsConfiguration: (name) => name === 'copilotPixelAgents.captureTaskDetails' });
  assert.deepEqual(messages.at(-1), { type: 'captureSettings', enabled: true });
  provider.store.processEvent(pre('t', { details: { input: payload('input') } }));
  enabled = false;
  changeConfig({ affectsConfiguration: () => true });
  assert.equal(messages.findLast((message) => message.type === 'agentHistory').history[0].details, undefined);
  assert.deepEqual(messages.at(-1), { type: 'captureSettings', enabled: false });
});

test('registration upgrades are idempotent and preserve unrelated Copilot/Claude hooks', () => {
  const script = '/temporary test/hook.sh';
  const current = { otherSetting: true, hooks: { PreToolUse: [{ command: 'other' }, { command: script, stale: true }], CustomEvent: [{ command: 'custom' }] } };
  const result = mergeHookConfig(current, buildCopilotHooksJson(script).hooks, script, 'copilot');
  assert.equal(result.otherSetting, true);
  assert.deepEqual(result.hooks.PreToolUse, [{ command: 'other' }, { type: 'command', command: script }]);
  assert.equal(result.hooks.PostToolUseFailure, undefined, 'not a documented VS Code hook');
  assert.equal(result.hooks.SessionEnd, undefined, 'not a documented VS Code hook');
  assert.deepEqual(result.hooks.CustomEvent, current.hooks.CustomEvent);
  assert.deepEqual(mergeHookConfig(result, buildCopilotHooksJson(script).hooks, script, 'copilot'), result);
  assert.equal(current.hooks.PreToolUse[1].stale, true);
  const claude = { permissions: { allow: [] }, hooks: { PreToolUse: [{ matcher: 'Bash', timeout: 5, hooks: [{ type: 'command', command: script }, { type: 'command', command: 'other' }] }] } };
  const merged = mergeHookConfig(claude, buildClaudeHooks(script), script, 'claude');
  assert.deepEqual(merged.hooks.PreToolUse[0], { matcher: 'Bash', timeout: 5, hooks: [{ type: 'command', command: 'other' }] });
  assert.ok(merged.hooks.PostToolUseFailure);
  assert.deepEqual(mergeHookConfig(merged, buildClaudeHooks(script), script, 'claude'), merged);
  assert.throws(() => mergeHookConfig([], {}, script, 'copilot'));
  assert.throws(() => mergeHookConfig({ hooks: { PreToolUse: 'bad' } }, buildClaudeHooks(script), script, 'claude'));
});

test('generated Unix and Windows scripts serialize JSON, bound details, avoid raw diagnostics/proxy forwarding', () => {
  const unix = buildHookScript(7823, 'darwin'), windows = buildHookPsScript();
  for (const script of [unix, windows]) {
    for (const alias of ['tool_input', 'toolInput', 'toolArgs', 'tool_response', 'toolResponse', 'tool_result', 'toolResult', 'tool_error', 'success']) assert.ok(script.includes(alias));
    assert.ok(script.includes('60000')); assert.ok(script.includes('250000'));
    assert.ok(script.includes('permissionDecision'));
    assert.ok(!/hook-debug|Out-File|STDIN=|env \||COPILOT_SESSION_ID|transcript_path/.test(script));
  }
  assert.ok(unix.includes('json.dumps'));
  assert.ok(unix.includes('NoRedirect'));
  assert.ok(windows.includes('ConvertTo-Json -InputObject'));
  assert.ok(windows.includes('$request.Proxy = $null'));
  assert.ok(windows.includes('$request.AllowAutoRedirect = $false'));
  assert.ok(buildHookScript(7823, 'win32').includes('hook.ps1'));
  assert.throws(() => buildHookScript(NaN, 'darwin'));
});

function execute(command, args, input, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

// Opt-in only: configure the Python environment before supplying PIXEL_TEST_PYTHON.
test('generated Unix hook executes with mock loopback receiver in a cleaned temporary HOME', { skip: !process.env.PIXEL_TEST_PYTHON }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'pixel-backend-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const received = [];
  const port = await listen(t, (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => { received.push(JSON.parse(Buffer.concat(chunks).toString())); res.end('{}'); });
  });
  const bin = join(home, 'bin'); await mkdir(bin);
  await symlink(process.env.PIXEL_TEST_PYTHON, join(bin, 'python3'));
  const script = join(home, 'hook.sh');
  await writeFile(script, buildHookScript(port, 'darwin'), { mode: 0o755 });
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, PYTHONDONTWRITEBYTECODE: '1', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', PRIVATE_SECRET: 'must-not-forward' };
  for (const raw of [
    { hookEventName: 'PreToolUse', sessionId: 'session " | ç', toolCallId: 'tool|"', toolName: 'read "quoted"', toolArgs: { command: 'echo "hello"\nnext \\ path\tç', password: 'redact-me' }, prompt: 'do-not-forward', environment: { secret: 'do-not-forward' }, transcript_path: '/do-not-read' },
    { hook_event_name: 'PostToolUseFailure', session_id: 'session " | ç', tool_use_id: 'tool|"', tool_result: { text: 'result\nç' }, tool_error: 'actual failure' },
    { event: 'post_tool_use', session_id: 's', success: false, tool_response: false },
    { event: 'pre_tool_use', session_id: 's', tool_name: 'read', tool_input: 'x'.repeat(500_000) },
    { event: 'post_tool_use', session_id: 's', tool_response: { success: false, text: 'x'.repeat(500_000) }, tool_error: 'x'.repeat(500_000) },
  ]) {
    const output = await execute('/bin/sh', [script], JSON.stringify(raw), env);
    assert.equal(output.code, 0); assert.equal(output.stderr, '');
    assert.deepEqual(JSON.parse(output.stdout), { permissionDecision: 'allow' });
  }
  assert.equal(received.length, 5);
  assert.equal(received[0].session_id, 'session " | ç');
  assert.equal(received[0].event, 'pre_tool_use');
  assert.equal(received[0].tool_input.command, 'echo "hello"\nnext \\ path\tç');
  assert.equal(received[0].prompt, undefined); assert.equal(received[0].environment, undefined); assert.equal(received[0].transcript_path, undefined);
  assert.equal(normalizeHookEvent(received[0], true).details.input.redacted, true);
  assert.equal(normalizeHookEvent(received[1], true).success, false);
  assert.equal(received[1].event, 'post_tool_use');
  assert.equal(received[1].success, false);
  assert.equal(received[2].success, false); assert.equal(received[2].tool_response, false);
  assert.equal(received[3].tool_name, 'read'); assert.equal(received[3].details.input.truncated, true);
  assert.equal(received[4].success, false); assert.equal(received[4].details.output.truncated, true); assert.equal(received[4].details.error.truncated, true);
  assert.ok(received.every((value) => Buffer.byteLength(JSON.stringify(value)) < MAX_HTTP_BODY_BYTES));
  const malformed = await execute('/bin/sh', [script], 'not JSON', env);
  assert.equal(malformed.code, 0); assert.deepEqual(JSON.parse(malformed.stdout), { permissionDecision: 'allow' });
  assert.equal(received.length, 5);
  assert.deepEqual((await readdir(home)).sort(), ['bin', 'hook.sh']);
});

test('generated PowerShell runtime behavior (optional locally installed runtime)', { skip: !process.env.PIXEL_TEST_PWSH }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'pixel-backend-ps-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const received = [];
  const port = await listen(t, (req, res) => {
    const chunks = []; req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => { received.push(JSON.parse(Buffer.concat(chunks).toString())); res.end('{}'); });
  });
  const script = join(home, 'hook.ps1'); await writeFile(script, buildHookPsScript());
  for (const value of [
    { hookEventName: 'PreToolUse', sessionId: 's', toolName: 'read', toolArgs: ['quote"', 'ação', false] },
    { hook_event_name: 'PostToolUseFailure', session_id: 's', tool_result: { text: 'actual result' }, error: 'actual failure' },
    { event: 'post_tool_use', session_id: 's', success: false, toolResponse: 'x'.repeat(500_000) },
  ]) {
    const result = await execute(process.env.PIXEL_TEST_PWSH, ['-NoProfile', '-File', script, '-Port', String(port)], JSON.stringify(value), { ...process.env, HOME: home, USERPROFILE: home });
    assert.equal(result.code, 0); assert.deepEqual(JSON.parse(result.stdout), { permissionDecision: 'allow' });
  }
  assert.equal(received.length, 3);
  assert.deepEqual(received[0].tool_input, ['quote"', 'ação', false]);
  assert.equal(normalizeHookEvent(received[1]).success, false);
  assert.equal(received[2].details.output.truncated, true);
  assert.equal(received[2].success, false);
});