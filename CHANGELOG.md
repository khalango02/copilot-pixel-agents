# Changelog

## [0.4.4] — 2026-06-09 (current)

### Fixed
- `TypeError: i.includes is not a function` crash during Copilot hooks install — `chat.hookFilesLocations` can return a non-array in VS Code versions where the setting is not registered; now handled defensively with `Array.isArray()` check and the update is wrapped in try/catch so it never breaks the install flow
- Copilot hook files are now also written to `~/.copilot/hooks/` (VS Code's standard user-level hooks directory), so they work even without the `chat.hookFilesLocations` setting

## [0.4.3] — 2026-06-09

### Fixed — GitHub Copilot hooks
- **Hooks location**: Copilot hooks are now written to `~/.copilot-pixel-agents/copilot-hooks/` as individual `pre-tool-use.json` / `post-tool-use.json` / `stop.json` files and registered via VS Code `chat.hookFilesLocations` setting — the previous `~/.vscode/agent-hooks.json` mechanism was not the correct Copilot hooks API
- **JSON field names**: hook.sh now parses both camelCase (`sessionId`, `toolName`) used by GitHub Copilot AND snake_case (`session_id`, `tool_name`) used by Claude Code
- **fail-closed hooks**: hook.sh now outputs `{"permissionDecision":"allow"}` to stdout — required by the Copilot hooks spec; hooks without this response cause tool calls to be denied

## [0.4.2] — 2026-06-09

### Added
- **Output channel**: all hook events are now logged to the "Copilot Pixel Agents" output panel (`View → Output → Copilot Pixel Agents`) — makes it easy to confirm hooks are reaching the server
- **Actionable empty state**: the canvas now shows an "Install / Reinstall Hooks" button when no agents are running — clicking it runs the hooks installer without leaving the panel

### Fixed
- Empty state was a static canvas overlay with no interactivity; replaced with an HTML overlay that the button can be clicked

## [0.4.1] — 2026-06-09

### Fixed
- Activity Bar icon now appears after Marketplace install — `media/icon.svg` was accidentally excluded from the VSIX package via `.vscodeignore`

## [0.4.0] — 2026-06-09

### Changed
- **Zero-friction setup:** `Install Hooks` now auto-configures GitHub Copilot (`~/.vscode/agent-hooks.json`) AND Claude Code (`~/.claude/settings.json`) in one click — no manual file editing required
- First-launch prompt: on activation, extension offers to install hooks automatically
- Hook script (`hook.sh`) updated to support Claude Code's stdin-based JSON format alongside Copilot's env-var format
- README rewritten to reflect Marketplace-first installation (no need to clone)

## [0.3.0] — 2026-06-09

### Added / Changed
- Pixel art office visual overhaul:
  - Dark wood plank floor (programmatic — no more light gray tile PNGs)
  - Navy office wall with pixel art windows and baseboard
  - All rendering at 2× scale via ctx.scale() — characters are 32×64 px (was 16×32)
  - Workstation furniture (desk, PC monitor, chair) properly scaled and aligned
- Layout fix: canvas now lives in a `#canvas-wrap` flex wrapper so the bottom panel with agent chips always stays visible regardless of canvas size
- Bottom panel agent chips always visible; `height: 100%` replaces brittle `100vh` in CSS

## [0.2.0] — 2026-06-09

### Added
- Real pixel-art sprites for characters (6 palettes)
- Real furniture sprites: desk, chair, PC monitor with on/off animation
- Teams panel: sidebar listing all active agents with live status
- Agent inspector: click any character to see tool history, token usage, session duration
- Sprites loaded via Vite public assets pipeline

## [0.1.0] — 2026-06-09

### Added
- Initial release
- Local HTTP hooks server (port 7823) receives agent events
- Programmatic pixel-art characters animated by tool activity
- Compatible with GitHub Copilot Agent Mode and Claude Code hooks
- `Install Hooks` command generates hook scripts and config
