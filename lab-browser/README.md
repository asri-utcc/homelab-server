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

## Google Login

Google may still reject automated browsers controlled via Playwright/CDP (e.g., `accounts.google.com/v3/signin/rejected`). Rather than trying to bypass Google's bot detection, the recommended workflow is to import an authenticated cookie session from your own desktop browser:

1. Install the **Cookie-Editor** extension in Chrome on your own computer.
2. Sign in to Google normally in your local Chrome.
3. Export cookies as **JSON** while visiting **both** `https://google.com` and `https://accounts.google.com`.
4. Transfer the exported file(s) to homelab with `scp`, for example:
   ```bash
   scp cookies.json dev@homelab:/tmp/cookies.json
   ```
5. Import the cookies into Lab Browser's shared auth store (defaults to the `shared` profile; add `--auth-profile <name>` to target a specific profile):
   ```bash
   /home/dev/.local/bin/lab-browser auth import /tmp/cookies.json
   ```
   *(Run the command for each exported JSON file if you saved `google.com` and `accounts.google.com` separately.)*
6. Delete the exported cookie JSON file(s) from both `/tmp/` on homelab and your local machine once imported.
7. In `/lab-browser` (or Browser Vision), click **🛑 ปิดเบราว์เซอร์** to close the running browser session, then reopen it so the new session loads the imported cookies.

## Memory watchdog

`session-daemon.js` monitors the browser process tree every 30 seconds to protect `homelab` from OOM without prematurely killing active logins:

- **PSS Measurement:** Sums `Pss:` from `/proc/<pid>/smaps_rollup` across all PIDs in the session process tree (falling back to RSS only if `smaps_rollup` is unreadable), avoiding double-counting shared Chromium pages.
- **Configurable Limits:**
  - `LAB_BROWSER_SESSION_MAX_MB` (default `2048`): Soft limit; only triggers shutdown when system `MemAvailable` is also below `1500 MB`.
  - `LAB_BROWSER_SESSION_HARD_MAX_MB` (default `3072`): Hard limit; triggers shutdown regardless of `MemAvailable`.
- **Login / Sensitive Grace Period:** Requires `2` consecutive over-limit checks normally, or `4` consecutive checks when the active page is on a login/sensitive page (e.g., `accounts.google.com`, `login.microsoftonline.com`, `appleid.apple.com`, or paths with `/signin`, `/login`, `/challenge`, `/2fa`, `/otp`). Resets to `0` if a check drops below the threshold.
- **`session_closed` Notification:** Before shutting down, the daemon broadcasts `{ type: 'session_closed', reason: 'memory_limit_exceeded', mb, limitMb }` over WebSocket so `lab-browser.html` displays a clear Thai notice and prevents silent auto-reconnect.
