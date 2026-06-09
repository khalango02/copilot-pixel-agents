@echo off
:: Copilot Pixel Agents — hook script (Windows)
:: Sends agent events to the local visualization server.

set PORT=7823
set PORT_FILE=%USERPROFILE%\.copilot-pixel-agents\port
if exist "%PORT_FILE%" (
  set /p PORT=<"%PORT_FILE%"
)

set EVENT=%HOOK_EVENT%
if "%EVENT%"=="" set EVENT=%COPILOT_HOOK_EVENT%
if "%EVENT%"=="" set EVENT=unknown

set SESSION=%SESSION_ID%
if "%SESSION%"=="" set SESSION=%COPILOT_SESSION_ID%
if "%SESSION%"=="" set SESSION=%RANDOM%

set TOOL_NAME=%TOOL_NAME%
if "%TOOL_NAME%"=="" set TOOL_NAME=%COPILOT_TOOL_NAME%

set TOOL_ID=%TOOL_ID%
if "%TOOL_ID%"=="" set TOOL_ID=%COPILOT_TOOL_ID%
if "%TOOL_ID%"=="" set TOOL_ID=%RANDOM%

curl -s -X POST "http://127.0.0.1:%PORT%" ^
  -H "Content-Type: application/json" ^
  -d "{\"event\":\"%EVENT%\",\"session_id\":\"%SESSION%\",\"tool_name\":\"%TOOL_NAME%\",\"tool_id\":\"%TOOL_ID%\"}" >nul 2>&1

exit /b 0
