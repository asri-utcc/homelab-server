---
name: web-browser
description: Visit, inspect, interact with, and capture screenshots/PDFs of websites locally using headless Chromium on this server. Use whenever the user asks to browse/open/view a webpage, capture/screenshot a website, check console/UI errors on a web app, or interact with forms/buttons on a page.
---

# Web Browser (Local Headless Chromium)

Visits real JS-rendered websites and captures screenshots/PDFs locally on this server using Playwright Chromium (`chromium-1255`, v159) with Thai/Noto/Emoji fonts installed.

## Tool
- CLI: always call by full path `/home/dev/.local/bin/lab-browser` (PM2 PATH lacks `~/.local/bin`) → `/home/dev/.local/share/lab-browser/bin/lab-browser.js`
- Browser cache: `/home/dev/.cache/ms-playwright` (pinned automatically regardless of `$HOME` / `agy` account)
- Default screenshots/PDFs output: `/home/dev/.gemini/outputs/browser/` (whitelisted in `lab-dashboard` `/api/gemini/local-image` so inline markdown images render in chat)
- Prints JSON on stdout (`{"ok": true, ...}`)

## Quick Commands (One-Shot — Exits & Frees RAM Immediately)
- Visit & read page text + title + headings + errors:
  `/home/dev/.local/bin/lab-browser view "<url>"`
  (Add `--shot` to also capture a screenshot, `--links` for links, `--max-chars 20000` for longer pages, `--raw-text` for plain text)
- Capture screenshot:
  `/home/dev/.local/bin/lab-browser shot "<url>"`
  Useful flags:
  - `--full-page` — full scrollable page
  - `--mobile` / `--tablet` / `--laptop` / `--viewport 1280x720`
  - `--dark` / `--light` — color scheme
  - `--wait 2000` / `--wait-for "#selector"` — wait for async charts/SPAs
  - `--selector "#element"` / `--clip x,y,w,h` — capture specific element or region
  - `--format jpeg --quality 90` — smaller JPG output
  - `--insecure` — allow self-signed HTTPS on local homelab URLs
  - `-o /path/to/file.png` — custom output path
- Check webpage health (HTTP status, console errors, uncaught JS errors, failed 4xx/5xx requests):
  `/home/dev/.local/bin/lab-browser check "<url>" --shot`
- Export PDF:
  `/home/dev/.local/bin/lab-browser pdf "<url>"`
- Extract rendered HTML or run JS in page:
  `/home/dev/.local/bin/lab-browser html "<url>" [-s "#id"]`
  `/home/dev/.local/bin/lab-browser eval "<url>" "document.title"`

## Multi-Step Interactive Sessions (Click, Login, Fill Forms, Scroll)
Uses a lightweight Unix-socket daemon (`0600`) that keeps tabs/cookies open across commands and **auto-closes after 10 minutes idle** so RAM is never leaked.
1. Start/open: `/home/dev/.local/bin/lab-browser session open "<url>"` (returns `@e1`, `@e2`, ... interactive element refs; add `--persist` to retain profile/cookies on disk)
2. Inspect elements: `/home/dev/.local/bin/lab-browser session snapshot`
3. Interact:
   - `session click "@e3"` (or CSS selector / `text=...`)
   - `session fill "@e1" "value"` / `session type "@e1" "text"` / `session press Enter`
   - `session select "@e4" "option"` / `session scroll down` / `session wait 1000`
4. Capture/read current state: `session shot --full-page` / `session text` / `session errors`
5. Always close when done (or let idle TTL clean up): `/home/dev/.local/bin/lab-browser session close`

## Viewing & Replying to User
1. Inspect any captured screenshot yourself with `read_file` before describing visual layout.
2. Show captured screenshots inline in chat using the absolute path inside `/home/dev/.gemini/outputs/browser/`:
   `![ภาพหน้าเว็บ](/home/dev/.gemini/outputs/browser/<filename>.png)`

## Safety & Maintenance
- Only `http://` and `https://` URLs are allowed (`file://`, `javascript:`, `chrome://` are blocked).
- Check system/browser health anytime: `/home/dev/.local/bin/lab-browser doctor`
- Clean old captures (>7 days): `/home/dev/.local/bin/lab-browser clean --days 7`
