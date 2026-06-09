# Changelog

## [0.3.0] — 2026-06-09 (current)

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
