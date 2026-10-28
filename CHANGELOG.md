# Changelog

> **Note on 0.4.x history:** versions 0.4.5–0.4.9 were packaged and distributed as `.vsix` files but their `package.json` version bumps were never committed to this repository, so their exact contents cannot be reconstructed from git history. The entry below for 0.4.10 has been reconstructed from the corresponding commits. Going forward, every published version is tagged and built by CI (see `.github/workflows/ci.yml`) so this gap cannot recur.

## [Unreleased]

### Documentation
- Align the README's current version and release link with the existing 0.7.0 package and summarize its tooling improvements.
- Add a technical and usability improvement plan with priorities and acceptance criteria. Planned features are not implemented by this documentation update.

## [0.7.0] — 2026-09-14 (current)

Project tooling and process, not runtime behavior — no user-facing changes to the
extension itself.

### Added
- CI (`.github/workflows/ci.yml`): every push/PR installs both workspaces, typechecks,
  runs the full test suite — including real execution of the generated Unix and
  PowerShell hook scripts against a real HTTP handler and `AgentStore`, previously
  always skipped for lack of a runtime — audits production dependencies, builds and
  packages a `.vsix`, uploaded as a build artifact.
- Release pipeline (`.github/workflows/release.yml`): pushing a `vX.Y.Z` tag verifies
  it matches `package.json`, re-runs the full quality gate, packages the `.vsix`,
  creates a GitHub Release with it attached, and publishes to the VS Code Marketplace
  once the `VSCE_PAT` secret is configured (see `.github/PUBLISHING.md`).
- Dependabot (`.github/dependabot.yml`) for both npm workspaces and GitHub Actions,
  weekly.
- `SECURITY.md`, `CONTRIBUTING.md`, issue templates (bug report / feature request), a
  PR template and `CODEOWNERS`.
- Regression tests for `engine.ts`'s idle-wander collision avoidance (the exact class
  of bug fixed in 0.4.11/0.4.12, previously with zero dedicated coverage), leisure-spot
  assignment, pet furniture-zone avoidance, `onToolDone`/`syncHistory`/
  `removeCharacter`; and for `sprites.ts`'s walking-sprite drawing, floor/furniture
  tiles and the sprite loader.
- Compatibility matrix and expanded testing documentation in the README.

### Changed
- `webview-ui`'s typecheck now covers every file under `src/`, not only
  `main.ts`/`isometric.ts`.
- Retroactively tagged `v0.1.0`, `v0.2.0`, `v0.3.0`, `v0.4.10` and `v0.4.11` on the
  commits that actually carry those versions; the untraceable 0.4.5–0.4.9/0.4.12 gap is
  documented above instead of left silent.
- `webview-ui/package.json`'s version now tracks the root package's.

### Fixed
- 8 dependency vulnerabilities in the root project (6 high, 2 moderate), via
  `npm audit fix` — including a major, dev-only `esbuild` bump, verified not to affect
  the build output.

## [0.6.1] — 2026-09-10

### Documentation
- Replaced the legacy animated GIF with a screenshot of the v0.6.0 isometric office, seated agents and task inspector, using demonstration data.

## [0.6.0] — 2026-09-10

### Added
- Animated seated poses at computers, gaming seats and TV couches, with 300 ms sit/stand transitions, articulated limbs and posture-aware selection.
- Clickable task history with Input, Output, Error and Event tabs, live completion updates, keyboard navigation and explicit missing/truncated/unmatched states.
- Opt-in `copilotPixelAgents.captureTaskDetails` setting (off by default), bounded in-memory tool payload retention, best-effort secret masking and immediate purge when disabled.
- Backend tests for normalization, validation, HTTP limits, hook transport and correlation; DOM tests for inspector interaction, accessibility and untrusted content.

### Changed
- Agents stand up before walking back from leisure to their workstation; coffee remains a standing activity.
- Task history is retained in the extension host (50 entries per agent) and restored with session metadata when the webview is recreated. Stop marks pending invocations interrupted.
- Generated Unix/Windows scripts serialize allowlisted tool arguments, results and errors safely, preserve failure outcomes, enforce transport limits and avoid proxy/redirect forwarding.
- Hook registration adds failure/session-end/waiting events and upgrades owned entries while preserving unrelated hooks. **Reinstall hooks after upgrading.**
- Removed raw stdin/environment logging from newly generated hooks; existing legacy logs are not deleted. The HTTP handler rejects malformed/oversized requests without logging their contents.
- Refreshed README with current behavior, privacy limits, migration, testing and the distinction between hook inspection and VS Code internal chat debugging.
- Updated transitive webview development dependencies to resolve the audit findings in nanoid/PostCSS.
- Excluded local Python virtual environments and bytecode caches from the VSIX package.

### Fixed
- Tool history correlation now uses invocation IDs and avoids guessing matches by tool name; duplicate correlated start/completion events do not create duplicate entries.
- Waiting/idle UI transitions no longer retain stale typing indicators; low seat backs and character overlays follow seated geometry.

## [0.5.0] — 2026-09-10

### Added
- Isometric 2.5D office with diamond floor tiles, two walls, volumetric furniture, lighting and shadows while preserving pixel-art characters.
- Camera zoom controls, drag-to-pan navigation and a fit-to-view button.
- Regression tests for projection, responsive framing, selection, camera interaction, layout and rendering fallbacks.

### Changed
- Characters, furniture and the pet now render in depth order; character selection uses the same projection as the camera.
- Office layout grows with the number of agents and remains independent of viewport size, preserving work and leisure activities during resizing.
- Refreshed office header, agent strip and compact empty state that keeps the scene visible.

## [0.4.12] — 2026-08-06

### Fixed
- Idle-wandering agents could pick the exact same random spot on the floor and end up with their sprites stacked on top of each other — added collision avoidance between characters (same pattern already used to keep the pet off the furniture), with a minimum on-screen separation and a few retries when picking a wander target

## [0.4.10] — 2026-08-06

### Added
- Office redesign with a coffee machine, plants, bookshelf, gaming setup, couch and TV, area rug and cat mascot.
- Agents go idle after 10s of inactivity and can game, watch TV or get coffee, returning to their desk immediately when a tool call starts.

### Fixed
- Critical hook parsing bug: an escaped `\n` inside a TypeScript template string produced a literal newline inside the generated `python3 -c` script, causing a `SyntaxError` and a blank payload on every invocation.
- Windows hook script (`hook.cmd`) never parsed the JSON payload — it only read `COPILOT_*` environment variables and ignored stdin entirely, so every event shipped with blank fields on Windows. Added `hook.ps1`, ported from the Unix branch's parsing logic, with `hook.cmd` now resolving the port and delegating to it.
- `hooks.json` format corrected to a single file with a `{"hooks":{"PreToolUse":[...]}}` structure; `chat.hookFilesLocations` corrected to an object (`{path: true}`) instead of an array.
- Canvas no longer clipped inside the webview (`html, body { height: 100% }`).

## [0.4.4] — 2026-06-09

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
