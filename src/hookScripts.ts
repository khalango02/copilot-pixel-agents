import { HOOK_EVENT_ALIASES } from './hookPayload.js';

/** Generated companions forward only allowlisted hook fields to loopback.
 * No prompts, environments, transcripts, diagnostics files, or chat-log discovery.
 * Large individual details are omitted with a marker, never the core event.
 */
const fields: Record<string, string[]> = {
  event: ['event', 'hookEventName', 'hook_event_name'],
  session_id: ['session_id', 'sessionId'],
  agent_name: ['agent_name', 'agentName'],
  tool_name: ['tool_name', 'toolName'],
  tool_id: ['tool_id', 'toolCallId', 'tool_call_id', 'tool_use_id', 'toolId'],
  success: ['success'],
  input_tokens: ['input_tokens', 'inputTokens'],
  output_tokens: ['output_tokens', 'outputTokens'],
};
const details: Record<string, string[]> = {
  input: ['tool_input', 'toolInput', 'toolArgs'],
  output: ['tool_response', 'toolResponse', 'tool_result', 'toolResult'],
  error: ['error', 'tool_error', 'toolError'],
};
const omitted = { text: '[Detail omitted: transport limit]', truncated: true, redacted: false };

function validPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid hook port');
  return port;
}
function shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }

export function buildHookScript(port: number, platform: NodeJS.Platform): string {
  validPort(port);
  if (platform === 'win32') {
    return `@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0hook.ps1" -Port ${port}
if errorlevel 1 echo {"permissionDecision":"allow"}
exit /b 0
`;
  }
  const python = `import sys, json, urllib.request
def pick(data, keys):
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return None
def encode(value):
    return json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("utf-8")
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
try:
    port = int(sys.argv[1])
    if not 1 <= port <= 65535:
        raise ValueError("port")
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    if not raw and len(sys.argv) > 2:
        raw = sys.argv[2]
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("object")
    fields = ${JSON.stringify(fields)}
    detail_fields = ${JSON.stringify(details)}
    omitted = json.loads(${JSON.stringify(JSON.stringify(omitted))})
    payload = {}
    for target, keys in fields.items():
        value = pick(data, keys)
        if value is not None:
            payload[target] = value
    aliases = ${JSON.stringify(HOOK_EVENT_ALIASES)}
    event = payload.get("event", "")
    payload["event"] = aliases.get(event, event)
    if isinstance(event, str) and "failure" in event.lower():
        payload["success"] = False
    error = pick(data, detail_fields["error"])
    response = pick(data, detail_fields["output"])
    if (error is not None and error is not False and error != "") or (isinstance(response, dict) and (response.get("success") is False or response.get("isError") is True or response.get("is_error") is True)):
        payload["success"] = False
    wire = {"input": "tool_input", "output": "tool_response", "error": "error"}
    for target, keys in detail_fields.items():
        key = next((key for key in keys if key in data), None)
        if key is None:
            continue
        value = data[key]
        try:
            fits = len(encode(value)) <= 60000
        except Exception:
            fits = False
        if fits:
            payload[wire[target]] = value
        else:
            payload.setdefault("details", {})[target] = omitted
    body = encode(payload)
    if len(body) > 250000:
        for target, key in wire.items():
            if key in payload:
                del payload[key]
                payload.setdefault("details", {})[target] = omitted
        body = encode(payload)
    if len(body) <= 250000:
        request = urllib.request.Request("http://127.0.0.1:" + str(port), data=body, headers={"Content-Type": "application/json"}, method="POST")
        # Do not use proxy environment variables or follow redirects.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=3) as response:
            pass
except Exception:
    pass
`;
  return `#!/bin/sh
# Copilot Pixel Agents: allowlisted JSON transport; no persistent diagnostics.
PORT=${port}
PORT_FILE="$HOME/.copilot-pixel-agents/port"
[ -f "$PORT_FILE" ] && PORT=$(cat "$PORT_FILE" 2>/dev/null)
if command -v python3 >/dev/null 2>&1; then
  python3 -c ${shellQuote(python)} "$PORT" "$@" >/dev/null 2>&1
fi
printf '{"permissionDecision":"allow"}\\n'
exit 0
`;
}

export function buildHookPsScript(): string {
  const mappings = (map: Record<string, string[]>) => Object.entries(map).map(([key, names]) => `        ${key} = @(${names.map((name) => `'${name}'`).join(', ')})`).join('\n');
    // PowerShell dictionaries are case insensitive; deduplicate equivalent event aliases.
    const aliases = Object.fromEntries(Object.entries(HOOK_EVENT_ALIASES).map(([key, value]) => [key.toLowerCase(), value]));
  return `param([string]$Port = "7823")
$ErrorActionPreference = 'Stop'
function Pick($Object, $Keys) {
    foreach ($key in $Keys) {
        $property = $Object.PSObject.Properties[$key]
        if ($null -ne $property -and $null -ne $property.Value) { return ,$property.Value }
    }
    return $null
}
function Encode($Value) { return ConvertTo-Json -InputObject $Value -Depth 100 -Compress -ErrorAction Stop -WarningAction Stop }
try {
    $portFile = Join-Path $env:USERPROFILE '.copilot-pixel-agents\\port'
    if (Test-Path -LiteralPath $portFile) { $Port = (Get-Content -LiteralPath $portFile -Raw).Trim() }
    $portNumber = 0
    if (-not [int]::TryParse($Port, [ref]$portNumber) -or $portNumber -lt 1 -or $portNumber -gt 65535) { throw 'port' }
    $raw = [Console]::In.ReadToEnd()
    $data = ConvertFrom-Json -InputObject $raw -ErrorAction Stop
    if ($null -eq $data -or $data -isnot [pscustomobject]) { throw 'object' }
    $fields = @{
${mappings(fields)}
    }
    $detailFields = @{
${mappings(details)}
    }
    $payload = @{}
    foreach ($target in $fields.Keys) {
        $value = Pick $data $fields[$target]
        if ($null -ne $value) { $payload[$target] = $value }
    }
    $aliases = @{
${Object.entries(aliases).map(([key, value]) => `        '${key}' = '${value}'`).join('\n')}
    }
    $event = [string]$payload['event']
    if ($aliases.ContainsKey($event)) { $payload['event'] = $aliases[$event] }
    if ($event -match 'failure') { $payload['success'] = $false }
    $errorValue = Pick $data $detailFields['error']
    $responseValue = Pick $data $detailFields['output']
    if (($null -ne $errorValue -and $errorValue -cne $false -and $errorValue -cne '') -or
        ($null -ne $responseValue -and ($responseValue.success -ceq $false -or $responseValue.isError -ceq $true -or $responseValue.is_error -ceq $true))) {
        $payload['success'] = $false
    }
    $wire = @{ input = 'tool_input'; output = 'tool_response'; error = 'error' }
    $omitted = @{ text = '[Detail omitted: transport limit]'; truncated = $true; redacted = $false }
    foreach ($target in $detailFields.Keys) {
        $property = $null
        foreach ($key in $detailFields[$target]) {
            $property = $data.PSObject.Properties[$key]
            if ($null -ne $property) { break }
        }
        if ($null -eq $property) { continue }
        $value = $property.Value
        $fits = $false
        try { $fits = [Text.Encoding]::UTF8.GetByteCount((Encode $value)) -le 60000 } catch { }
        if ($fits) { $payload[$wire[$target]] = $value }
        else {
            if (-not $payload.ContainsKey('details')) { $payload['details'] = @{} }
            $payload['details'][$target] = $omitted
        }
    }
    $body = [Text.Encoding]::UTF8.GetBytes((Encode $payload))
    if ($body.Length -gt 250000) {
        foreach ($target in $wire.Keys) {
            if ($payload.ContainsKey($wire[$target])) {
                $payload.Remove($wire[$target])
                if (-not $payload.ContainsKey('details')) { $payload['details'] = @{} }
                $payload['details'][$target] = $omitted
            }
        }
        $body = [Text.Encoding]::UTF8.GetBytes((Encode $payload))
    }
    if ($body.Length -le 250000) {
        # Explicitly disable proxies and redirects: only loopback is trusted.
        $request = [Net.HttpWebRequest]::Create("http://127.0.0.1:$portNumber")
        $request.Proxy = $null
        $request.AllowAutoRedirect = $false
        $request.Method = 'POST'
        $request.ContentType = 'application/json; charset=utf-8'
        $request.Timeout = 3000
        $request.ReadWriteTimeout = 3000
        $request.ContentLength = $body.Length
        $stream = $request.GetRequestStream()
        try { $stream.Write($body, 0, $body.Length) } finally { $stream.Dispose() }
        $response = $request.GetResponse()
        $response.Dispose()
    }
} catch {
    # Never persist input, environment, response, or exception text.
} finally {
    Write-Output '{"permissionDecision":"allow"}'
}
exit 0
`;
}