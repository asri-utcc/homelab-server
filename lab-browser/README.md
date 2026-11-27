# lab-browser

Headless Chromium service and CLI (`/home/dev/.local/bin/lab-browser`) for homelab automation and interactive Browser Vision sessions.

## Lab Browser Service (/lab-browser)

Standalone full-page web browser service hosted via `lab-dashboard` and sharing login state with Browser Vision.

- **URL:** `https://homelab.tail285279.ts.net/lab-browser` (protected by `forward_auth`; `/lab-browser.html` works directly as static fallback)
- **Default Session:** `bv_labweb_main` (mapped from `chat=labweb_main` via `browser-vision-bridge.js`)
- **Multiple Windows / Profiles:** Append `?profile=<name>` (alphanumeric, `_`, `-`) to open separate sessions (e.g., `?profile=work` maps to `chat=labweb_work`, session `bv_labweb_work`)
- **Shared Login:** Uses auth profile `'shared'` (`auth-store.js`), automatically syncing cookies and login sessions with Browser Vision across chat rooms. Manage or clear via the **Shared Login** popover in the toolbar.
- **AI Control:** AI agents can inspect or control the same live browser session using:
  ```bash
  /home/dev/.local/bin/lab-browser session <subcmd> --session bv_labweb_main --shared-auth
  ```
- **Idle TTL:** Requests `idleTtlSec: 3600` (clamped `600..7200` in `browser-vision-bridge.js`; takes effect after `lab-dashboard` is restarted, otherwise defaults to `600s`).
- **Resource Limits:** `MAX_CHAT_BROWSERS=5` and `MIN_FREE_MB=1200`. Each open window consumes 1 browser slot—use **🛑 ปิดเบราว์เซอร์** (`POST /api/browser-vision/close`) to release RAM when finished.
