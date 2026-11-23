# Design Document: Live Browser Vision & Co-Pilot Workspace

**Date:** 2026-11-23  
**Status:** v3 — Implemented (2026-11-23)  
**Target Components:**
- `lab-browser` (`/home/dev/.local/share/lab-browser/`)
- `lab-dashboard` backend (`/home/dev/projects/lab-dashboard/server.js`, `gemini-manager.js`)
- `lab-dashboard` chat UI (`/home/dev/projects/lab-dashboard/public/gemini.html`)

---

## 1. Intent & Why

Currently, web automation via `lab-browser` happens "blindly" from the user's perspective inside [gemini.html](file:///home/dev/projects/lab-dashboard/public/gemini.html): the AI navigates and clicks inside headless Chromium while the user only sees text logs or static screenshots after the fact.

The user wants a **side-by-side Live Browser Vision Co-Pilot** inside the AI chat workspace so that:
1. **Real-world multi-step tasks** (e.g., booking train tickets, filling forms, portals requiring login/OTP/CAPTCHA) become transparent and collaborative — the user sees every mouse movement, click, scroll, and page change live, and can take over or pause the AI at any moment.
2. **Web app development & UI feedback** becomes effortless — the user can draw directly on the live webpage (pen, box, circle, numbered pin notes) or point with a **Magic DOM Inspector** to highlight exact HTML elements and send both the annotated screenshot and DOM metadata straight into the chat prompt.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **Split-Screen Workspace in `gemini.html`:** Chat on the left, Live Browser Vision on the right, toggleable and resizable without breaking existing chat features or mobile layout.
- **Live Video-Like Browser Stream (Approach 1):** Embed Playwright CDP Screencast (`Page.startScreencast`) inside `lab-browser`'s `session-daemon.js` to stream live frames at low latency.
- **Visible AI Presence:** Show a distinct **AI cursor + click ripple + action label** on the live view whenever the AI hovers, clicks, or types, so the user always sees what the AI is doing.
- **Live Shared Control + Explicit Pause:**
  - Whenever annotation tools are closed, the user can click, scroll, and type directly on the live browser canvas at any time.
  - Provide a prominent **`⏸️ หยุดรอ` (Pause AI)** button so the user can freeze AI browser actions whenever they want to inspect something closely or intervene manually, plus a **`▶️ ให้ AI ทำต่อ` / `✅ กรอกเสร็จแล้ว`** resume control.
  - Support automatic pause / handoff banner when the AI encounters sensitive steps (Login, Password, OTP, Payment, CAPTCHA).
- **Collapsible Visual Annotation & Magic DOM Toolbar:**
  - Collapsed by default to a small unobtrusive floating button so normal viewing/clicking stays uncluttered.
  - When expanded: Freehand Pen, Rectangle, Circle/Ellipse, Eraser, Magic DOM (`div` Inspector), Pin Notes (`1`, `2`, `3`), Undo/Clear, and **"Send to Chat"** action.

### Non-Goals
- Running a separate heavy noVNC / X11 / WebRTC container stack for the browser.
- Automatically solving or bypassing CAPTCHAs / anti-bot gates (those always trigger a user handoff pause).
- Multi-user collaborative editing of the same browser session from different users simultaneously.

### Anti-Goals (Failure Conditions)
- Cluttering the live browser viewport with permanent drawing overlays when the user just wants to watch or interact with a website.
- Hanging CLI/agent tool calls indefinitely until socket timeouts occur when the user pauses the browser.
- Breaking the existing `lab-browser` CLI workflow (`open`, `view`, `shot`, `snapshot`, `click`, etc.) used outside the dashboard.
- Blocking or lagging the `lab-dashboard` Node.js event loop during active screencast streaming.

---

## 3. Constraints & Current System Reality

1. **`lab-dashboard` (`server.js`):**
   - Pure Node.js v24 `http` server with **no `package.json` or external `ws` package**; already handles SSE (`text/event-stream`) with periodic keepalive comments (`: keepalive\n\n`) to survive Caddy/reverse-proxy idle timeouts.
   - Served via HTTPS Tailscale proxy (`https://homelab.tail285279.ts.net`) and PM2 (`lab-dashboard`).
   - Existing image attachment flow in `gemini.html` uses `POST /api/gemini/upload-image` (`{ dataUrl, filename }`) which stores images and populates `pendingAttachments`.
2. **`lab-browser` (`session-daemon.js`, `session-client.js`, `browser-core.js`, `actions.js`, `config.js`):**
   - `session-daemon.js` manages a Playwright Chromium context per `sessionName` (`^[a-zA-Z0-9_-]{1,32}$` enforced by `config.sanitizeSessionName`) over a Unix domain socket (`~/.local/share/lab-browser/state/<session>.sock`), serializing commands through a `queue = Promise.resolve()`.
   - `session-client.js` enforces a socket timeout (`45000ms` default or `timeoutMs + 15000ms`). Any pause mechanism **must not** rely on silently holding a standard CLI command open past the socket timeout.
   - `browser-core.js` uses `playwright-core@1.65.1`, enforces a RAM guard (`MemAvailable < 250 MB` blocks launch), and attaches console/network telemetry per page. Note that Chromium's `launchPersistentContext` (`--persist`) locks a single `userDataDir` (`SingletonLock`), so two concurrent browsers **cannot** share the same `userDataDir` simultaneously; instead, `playwright-core@1.65.1` supports `browser.newContext({ storageState })`, `context.storageState({ indexedDB: true })`, `context.cookies()`, `context.addCookies()`, and `context.clearCookies(filter)`.
   - Server RAM budget (~12 GB total, ~6.1 GB `MemAvailable`) supports running several Chromium instances (~250–400 MB each), provided per-room browsers launch lazily, auto-close on idle, and enforce an LRU concurrent cap.
3. **`gemini.html` Layout:**
   - Currently `.core-workspace` is a 2-column CSS Grid: `370px 1fr` (`.core-reactor-pane` on left, `.core-chat-pane` on right).
   - Opening Browser Vision on desktop needs to reclaim width so Chat + Browser don't get cramped into 3 narrow columns.

---

## 4. Approaches Considered

| Approach | Summary | Trade-offs | Decision |
|---|---|---|---|
| **1. Playwright CDP Screencast in `lab-browser`** | Use `page.context().newCDPSession(page)` + `Page.startScreencast` inside `session-daemon.js`, stream JPEG frames over a dedicated stream socket to `lab-dashboard`, and forward input/DOM inspection via CDP & `page`. | Lightweight (~0 extra OS services), shares exact browser state/cookies/tabs with `lab-browser` CLI, fast JPEG frames (`format: 'jpeg'`, adaptive quality), supports direct `DOM` / `elementFromPoint` inspection. Requires implementing the stream channel and input coordinate mapping carefully. | **Selected by User** |
| **2. Screenshot Polling Loop** | Repeatedly call `page.screenshot()` every 200–500ms. | Simple to build, but choppy FPS, higher CPU/latency per frame, poor feel for live mouse/scrolling. | Rejected |
| **3. Headful Chromium + Xvfb + noVNC/VNC** | Run full X11 desktop display server and stream via noVNC. | Native cursor rendering, but heavy RAM/CPU footprint, extra daemon dependencies, harder to overlay Magic DOM coordinates cleanly. | Rejected |

---

## 5. Detailed Design

### 5.1 Workspace Layout & Split-Screen UX (`gemini.html`)

- **Toggle Control:** Add a **`🌐 Browser Vision`** toggle button in the topbar (and a quick-open chip/button when `lab-browser` is active in the current chat).
- **Desktop Split Layout (`.core-workspace.is-browser-open`):**
  - Collapse `.core-reactor-pane` (370px) into a compact **Mini Core Status Pill** in the topbar/chat header while Browser Vision is open, freeing the full width for a clean 2-pane split:
    - **Left Pane:** `.core-chat-pane` (default ~42% width, min 340px).
    - **Draggable Resizer Handle:** vertical splitter between Chat and Browser panes (persisted in `localStorage`).
    - **Right Pane:** `.browser-vision-pane` (default ~58% width, min 420px).
  - **Mobile / Narrow Viewport (`< 960px`):** Switchable tab/drawer mode (`💬 แชท` | `🌐 เบราว์เซอร์`) with an indicator badge when AI is active or paused for input.
- **Browser Chrome Header Bar:**
  - Navigation controls: `←` Back, `→` Forward, `↻` Reload, URL bar (editable + Enter to navigate), Tab switcher dropdown (`tabs` / `tab <idx>`), and Viewport preset badge (`Desktop 1280×800` / `Mobile`).
  - Session status & auth indicator (`🟢 Live`, `🤖 AI กำลังทำงาน`, `⏸️ หยุดรอผู้ใช้`, current chat room badge, and a `🔑 Shared Login` indicator/menu to inspect saved domains or clear shared login sessions).
  - Prominent **`⏸️ หยุดรอ`** / **`▶️ ทำต่อ`** control button right in the browser header.
  - Close / Minimize button (`✕` / `◧`).

### 5.2 Streaming & Real-Time Transport (`lab-browser` ↔ `server.js` ↔ `gemini.html`)

- **`lab-browser` Stream Socket (`<session>.stream.sock`):**
  - Alongside the existing command socket (`<session>.sock`), `session-daemon.js` opens a second Unix domain socket `<session>.stream.sock` for persistent duplex NDJSON/event streaming (so `Page.screencastFrame` events and mouse/keyboard inputs bypass the blocking action `queue` and never stall behind `waitForLoadState`).
  - On client connect, `session-daemon.js` attaches a CDP session (`context.newCDPSession(activePage)`) and starts `Page.startScreencast({ format: 'jpeg', quality: 72, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 })`.
  - When `activePage` switches (new popup/tab or `tab <idx>`), `session-daemon.js` detaches screencast from the old page and attaches to the new `activePage`, emitting a `page-changed` event (`url`, `title`, `viewport`, `tabs`).
  - Automatically acks frames (`Page.screencastFrameAck({ sessionId })`) and stops screencast when 0 stream subscribers are connected (zero idle CPU cost).
- **`lab-dashboard` (`server.js`) Bridge — Zero-Dependency WebSocket + HTTP Fallback:**
  - `server.js` handles HTTP `Upgrade` on `/ws/browser-vision?session=<name>` using Node's built-in `crypto` (RFC 6455 WebSocket framing, ~100 lines in a dedicated `browser-vision-bridge.js` module — no external `npm install` needed and full low-latency bidirectional transport over Caddy/HTTPS).
  - When the user switches chat rooms in `gemini.html`, the frontend cleanly closes the previous room's WebSocket and connects to `/ws/browser-vision?session=<newRoomBrowserSession>` (keeping the old room's daemon/tabs alive until idle TTL or LRU eviction so switching back resumes immediately).
  - Streams binary/base64 JPEG frames + JSON control events (`cursor`, `click-ripple`, `pause-state`, `page-meta`, `dom-hover`) to connected browser UI clients, and forwards user input events (`mouseMove`, `mouseDown`, `mouseUp`, `wheel`, `keyDown`, `keyUp`, `insertText`, `inspectPoint`) back to `session-daemon.js`.
  - Respects `lab-dashboard` session auth (validates the same dashboard auth cookie/token on the HTTP upgrade request).
  - Exposes REST helpers under `/api/browser-vision/*` for session listing, start/open URL, pause/resume, Magic DOM element capture, and shared-auth status/clear.

### 5.3 Live Shared Control, AI Cursor & Pause Gate

1. **Coordinate Mapping:**
   - The browser canvas renders the screencast frame inside an aspect-ratio-preserved stage (`object-fit: contain`).
   - Pointer events on the frontend normalize `(clientX, clientY)` relative to the rendered frame rectangle and scale linearly to Chromium's active viewport `(viewportWidth, viewportHeight)` before sending to CDP `Input.dispatchMouseEvent` / `page.mouse`.
2. **Visible AI Pointer & Click Ripple:**
   - Before `actions.js` executes `click`, `hover`, `fill`, `type`, or `select` on a target locator, `actions.js` resolves the element's bounding box center `(x, y)` and emits an AI telemetry event `{ kind: 'ai-action', action, x, y, label, target }` to `session-daemon.js` -> stream subscribers.
   - `actions.js` moves the pointer smoothly (`page.mouse.move(x, y, { steps: 8 })`) or highlights the target before clicking, while `gemini.html` renders a glowing **cyan AI cursor badge (`🤖 AI`) + expanding click ripple ring + brief action tag** (e.g., `กำลังคลิก: ค้นหาเที่ยวรถ`) on the overlay layer.
3. **Live Shared Control (Seamless Takeover):**
   - When the annotation toolbar is **off**, mouse moves/clicks/wheel/keyboard events on the stage go directly to the live Chromium page (`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`).
   - If the user clicks or types directly while an AI task is active, or clicks **`⏸️ หยุดรอ`**:
     - `session-daemon.js` immediately sets `paused = true`, `pauseReason = 'USER_PAUSED'` (or `'USER_INTERVENING'`).
     - A prominent non-blocking **Handoff Banner** appears at the top of the Browser Vision pane:
       - e.g. `"⏸️ หยุดรอผู้ใช้ — คุณสามารถคลิก/พิมพ์บนหน้าเว็บได้เต็มที่"` with **`[✅ ทำเสร็จแล้ว · ให้ AI ทำต่อ]`** (and an optional quick message input if the user wants to tell the AI what changed).
4. **How Pause Interacts with AI Tool Calls (Avoiding Timeout Bugs):**
   - `session-daemon.js` stores `paused` state and `pauseReason`.
   - When `paused === true`, any mutating AI command via `lab-browser` CLI (`click`, `fill`, `type`, `press`, `select`, `open`, `back`, `reload`) immediately returns a structured response `{ ok: false, paused: true, pauseReason, url, message: 'Session is paused by the user. Wait for user resume before continuing.' }` instead of hanging the 45s Unix socket.
   - Meanwhile, read-only inspection (`status`, `snapshot`, `view`, `shot`) still works if needed without mutating the page.
   - When the user clicks **`[✅ ทำเสร็จแล้ว · ให้ AI ทำต่อ]`**:
     - UI sends `resume` to `session-daemon.js` (`paused = false`).
     - `session-daemon.js` immediately flushes the room's updated cookies + web storage (`origins`) into the shared auth store (`shared.json`) so any newly completed Login/OTP is immediately available to all other chat rooms too.
     - If the AI chat turn is idle (waiting for the user's Login/OTP/Pause completion), `gemini.html` automatically dispatches a resume prompt to the active chat (e.g., `"ฉันดำเนินการในเบราว์เซอร์เรียบร้อยแล้ว ทำขั้นตอนถัดไปต่อได้เลย"` + optional note from the user).
5. **Session Mapping (Updated Decision 2 — Per-Chat Browser + Shared Auth):**
   - Each chat room (`chatSessionId`, e.g., `sess_1795474757000_ab12`) maps deterministically to its own isolated `lab-browser` session (`toBrowserSessionName(chatSessionId)` -> `bv_sess_...`, max 32 chars) launched with `--auth-profile shared`.
   - Every room has independent tabs, URLs, scroll position, DOM, and pause state, while sharing login session cookies & web storage via `~/.local/share/lab-browser/auth/shared.json`. (An optional session selector still lets you inspect other active `lab-browser` sessions if needed.)

### 5.4 Collapsible Visual Annotation & Magic DOM Toolbar

- **Collapsed State (Default):**
  - A compact floating pill button at the bottom-right or top-right corner of the browser stage: `🎨 ชี้จุด / วาด` (plus a subtle badge if annotations exist). Clicking it expands the floating toolbar; clicking again collapses it back to live interaction mode.
- **Expanded Toolbar Tools:**
  1. **`✏️ ปากกา` (Freehand Pen):** Draw freehand strokes on an HTML5 `<canvas>` overlay layered cleanly over the video frame. Color picker (default high-contrast `#ff4d4f` red / `#f59e0b` amber / `#00e5ff` cyan) + stroke width.
  2. **`⬜ สี่เหลี่ยม` (Rectangle):** Click-and-drag sharp bounding boxes.
  3. **`⭕ วงกลม` (Circle / Ellipse):** Click-and-drag circles/ellipses around elements.
  4. **`🧽 ยางลบ` (Eraser) + `↩️ ย้อนกลับ` (Undo) + `🗑️ ล้าง` (Clear):** Erase individual drawn shapes/strokes or pin notes cleanly (vector object model on canvas rather than raw destructive pixels, so erasing/undoing individual shapes works cleanly!).
  5. **`💬 ปักหมุด` (Pin Note `1`, `2`, `3`):** Click anywhere (or on a Magic DOM box) to place numbered markers (`①`, `②`, `③`) with an inline mini-popover for a short note (e.g., `"แก้ปุ่มนี้ให้ใหญ่ขึ้น"`).
  6. **`🎯 Magic DOM` (`div` Inspector):**
     - When enabled, hovering the mouse over the live browser throttles (~60–100ms) `inspectPoint(x, y)` calls to `session-daemon.js`.
     - `session-daemon.js` runs `page.evaluate(({ x, y }) => ...)` using `document.elementFromPoint(x, y)` (walking into open shadowRoots / iframes where same-origin) to return:
       - Bounding box `{ x, y, width, height }`
       - Tag name, `#id`, `.classes` (e.g. `div.ticket-card.active`)
       - Unique CSS selector path
       - Compact `outerHTML` snippet (truncated safely, e.g. max 600 chars) + `innerText` preview + key computed styles (`display`, `fontSize`, `color`, `backgroundColor`, `padding`, `margin`).
     - `gemini.html` draws a **dashed orange highlight box + floating tag pill (`div.className · 320×48`)** directly over the canvas in real time.
     - Clicking while Magic DOM is active locks/pins that element onto the annotation layer (optionally prompting for a Pin Note or adding it to the selected elements list).
- **Sending Annotations + Magic DOM to Chat (`📤 ส่งให้ AI ดู`):**
  - Composites the **current frozen browser frame + all drawn vectors + Magic DOM highlights + numbered pin badges** into a single crisp PNG data URL.
  - Uploads it via existing `POST /api/gemini/upload-image` into `pendingAttachments` in the left-hand chat composer.
  - Automatically attaches a structured text block (either into the composer draft or structured context attachment) listing:
    - Active page URL & viewport
    - Numbered Pin Notes (`① ...`, `② ...`)
    - Selected Magic DOM elements (`Selector`, `BoundingBox`, `HTML snippet`, `Computed Styles`)
  - User can add any extra instruction in the chat box and hit Send (or click `📤 ส่งทันที` if desired).

---

## 6. User Decisions (2026-11-23)

### Decision 1 → A: Route by task type
- When Browser Vision is open, **interactive tasks** (booking, form filling, multi-step flows, web app testing) go through `lab-browser session ... --session <roomBrowserSession> --shared-auth` (where `<roomBrowserSession>` is `toBrowserSessionName(chatSessionId)`), so every click shows on that chat room's right pane.
- **Quick background lookups** (one-shot `view` / `shot` / `check` without `--session`) still run in a throwaway stateless browser and **never** navigate the room's right-pane browser or touch shared login cookies. This protects pages and logins the user has open.
- The AI (or the user, via a button) can choose to show a background result on the right pane by opening it in a **new tab** of the room's browser (`session open <url> --new-tab`), not by replacing the current tab.
- The `gemini-manager.js` prompt hint states this rule and passes the exact `<roomBrowserSession>` for the active chat room.
- **New work:** `lab-browser` has no `--new-tab` yet (it only has `tabs` / `tab <i>`). Add `session open <url> --new-tab` to `session-daemon.js`.

### Decision 2 → Per-Chat Independent Browser + Shared Login Session Cookies (Revised from 2A)
The user revised Decision 2 so each chat room gets its own **independent browser**, while **login session cookies stay shared across chat rooms**:

1. **Deterministic Per-Room Browser Session:**
   - Each chat room (`sessionId` in `gemini-manager.js`, e.g. `sess_1795474757000_ab12`) maps to its own dedicated `lab-browser` session:
     - `toBrowserSessionName(sessionId)`: returns `bv_${sessionId}` when valid and `<= 32` chars (matching `config.sanitizeSessionName`), or `bv_${sha256(sessionId).slice(0, 16)}` as fallback for longer/custom IDs.
   - Each room has its own Chromium instance, `BrowserContext`, open tabs, URL history, scroll position, DOM state, pause gate, AI cursor, screencast stream (`<session>.stream.sock`), and frontend annotation map (`Map<chatSessionId, AnnotationState>`).
   - **Zero cross-room collisions:** Chat rooms never block each other, hijack each other's active tab, or require a shared `copilot` busy lock. Multiple rooms can run AI browser tasks simultaneously.

2. **Shared Auth Store (`auth-store.js`, `--auth-profile shared` / `--shared-auth`):**
   - **Why `newContext({ storageState })` + `auth-store.js` instead of `launchPersistentContext` (`--persist`):**
     - Chromium locks each `userDataDir` (`SingletonLock`), so two running browsers cannot mount the same profile folder simultaneously.
     - Creating a separate full Chromium profile directory per chat room would bloat disk space (50–200 MB cache per room) and still fail to share logins across rooms.
   - Instead, per-room daemons launched with `--auth-profile shared` (alias `--shared-auth`) use `browser.newContext({ storageState })` backed by a lightweight shared store at `~/.local/share/lab-browser/auth/shared.json` (`0o600`, atomic temp-file + `rename` with short-lived advisory lock):
     - **Cookies (persistent + session cookies):** Includes `HttpOnly`, `Secure`, `SameSite`, and session cookies (`expires: -1`, which Playwright serializes and restores across contexts).
     - **Web Storage (`origins`):** Includes `localStorage` and `indexedDB` (`context.storageState({ indexedDB: true })`) so modern SPAs / JWT / Firebase Auth logins also transfer cleanly across rooms.
   - **Lifecycle of Auth Sync:**
     - **On daemon start:** Loads `auth/shared.json` into `browser.newContext({ storageState })` before any page opens, so any new chat room starts already logged in.
     - **Incremental merge (no clobbering):**
       - Cookies merge by `(name, domain, path)` using the newest timestamp/value rather than blindly overwriting other domains' cookies.
       - **Logout / deletion propagation:** Each daemon remembers the set of cookie keys it last synced from `shared.json`. If a previously synced cookie disappears in that room's live `context.cookies()` (e.g. the user clicked Log out), the daemon records a tombstone in `shared.json` (TTL e.g. 1 hour) and removes that cookie from `shared.json` so other rooms don't resurrect it.
       - **Performance split:** Routine debounced syncs (~1.5s after page navigation or mutating CLI actions) sync cookies via sub-millisecond `context.cookies()` (CDP `Network.getCookies`, zero hidden page spawns). Full `context.storageState({ indexedDB: true })` (to also capture `localStorage` / `indexedDB`) runs on active-page `load`, on user resume (`✅ ทำเสร็จแล้ว`), and on daemon shutdown.
     - **Live cross-room sync (when multiple rooms are open at once):** Each `--auth-profile shared` daemon watches `shared.json` (version/mtime) and applies incoming cookie additions (`context.addCookies(...)`) and tombstoned deletions (`context.clearCookies({ name, domain, path })`) before navigation/actions and on live change notifications, without reloading or disturbing open pages.
     - **Manual control:** Provide a UI option / API endpoint (`POST /api/browser-vision/auth/clear`) to wipe `shared.json` and clear cookies across active shared-auth daemons when the user wants a clean logged-out slate; one-shot commands (`view`/`shot`/`check` without `--session`) stay isolated and never read or write `shared.json`.

3. **Multi-Browser Lifecycle & RAM Guard:**
   - **Lazy start:** A room's browser starts only when the user opens Browser Vision in that room or the AI executes a `lab-browser session ...` command in that room.
   - **Idle auto-close + Viewer protection:** Each daemon uses `idleTtlSec` (default 10 minutes), flushing `shared.json` before shutdown. While any Vision WebSocket viewer is connected (`subscribers.size > 0`) or an action is running, idle auto-close is paused.
   - **Concurrent Browser Cap (LRU Eviction):** Enforce a configurable cap (default `MAX_CHAT_BROWSERS = 5`) and a free-RAM floor (`MemAvailable < 1200 MB` in `session-client.js` / `browser-vision-bridge.js`). Before launching a new room browser when at cap or below the RAM floor, flush auth state and gracefully close the least-recently-used unattached (`subscribers.size === 0`, idle) room daemon.
   - **Chat room deletion cleanup:** `gemini-manager.js` `deleteSession(sessionId)` closes the matching `bv_<sessionId>` daemon if running so orphaned room browsers don't linger.
   - **Sensitive-step protection:** Auto-pause on Login, OTP, Payment, and CAPTCHA still applies in every room, and `shared.json` stays strictly on local disk (`0o600`).

## 7. Architectural Decisions Made (Builder Calls)

The following implementation details are settled cleanly within existing project patterns:
1. **Transport:** Implement lightweight RFC 6455 WebSocket support directly in a new `lab-dashboard/browser-vision-bridge.js` module using Node 24's built-in `crypto` + `net` (no `npm install ws` needed in `lab-dashboard`).
2. **State & Persistence:** Store frontend annotation objects in a per-room map (`Map<chatSessionId, AnnotationState>`) so switching rooms preserves each room's drawings/Magic DOM pins cleanly; persist shared login state (cookies + `localStorage`/`indexedDB` origins) in `~/.local/share/lab-browser/auth/shared.json`.
3. **Session Binding:** Deterministic per-room `lab-browser` session (`toBrowserSessionName(chatSessionId)`) + `--auth-profile shared`; pass the exact `--session` and `--shared-auth` instruction as a prompt hint in `gemini-manager.js` when Browser Vision is open (plus `LAB_BROWSER_AUTH_PROFILE=shared` fallback for `bv_*` session commands).
4. **Idle/Resource Protection:** Stop CDP screencast immediately when no WebSocket viewer is connected (`subscribers.size === 0`), keep frame rate/quality adaptive (e.g., max ~15–20 fps / JPEG quality 72), and enforce LRU eviction (`MAX_CHAT_BROWSERS = 5` / `MemAvailable >= 1200 MB` before spawning new room browsers).

---

## 8. Open Builder Scope (Left to Implementation Planning)

- Exact CSS styling tokens matching `gemini.html`'s dark holographic theme.
- Unit / integration tests for RFC 6455 WebSocket framing, `session-daemon.js` dual-socket stream + pause gate, `auth-store.js` cookie/origin merge + logout tombstone sync, LRU browser eviction, and `Magic DOM` selector builder.
- Prompt / system-instruction hook in `gemini-manager.js` so `agy` / `claude` / `deepseek` know when Browser Vision is open, which per-room `--session bv_... --shared-auth` name to use, and when to request user handoff (`Login`/`OTP`/`Payment`).

---

## 9. Implementation Notes

### 9.1 Files Changed & Added

**`lab-dashboard` (`/home/dev/projects/lab-dashboard/`, synced to `homelab-server/lab-dashboard/`):**
- `browser-vision-bridge.js` *(new)*: Zero-dependency RFC 6455 WebSocket upgrade/frame codec (`attachUpgrade`, `WsFrameParser`, `encodeWsFrame`, `encodeCloseFrame`), deterministic session naming (`toBrowserSessionName`), REST API handler (`handleApi`), and `closeChatBrowser(chatSessionId)` cleanup helper.
- `server.js`: Mounted `browserVisionBridge.handleApi` for `/api/browser-vision/*` and `browserVisionBridge.attachUpgrade` on the HTTP server; passes `browserVision: body.browserVision === true` into `geminiManager.executePrompt`.
- `gemini-manager.js`: Added `buildBrowserVisionHint` / `buildBrowserVisionPrompt` to inject `--session bv_... --shared-auth` instructions when `browserVision === true`, and `deleteSession` calls `closeChatBrowser(sessionId)`.
- `public/gemini.html`: Added desktop split-screen & mobile tab layout (`.core-workspace.is-browser-open`), resizable splitter, browser chrome header, live canvas viewer, AI cursor & ripple overlay, Pause/Resume handoff banner, Shared Auth domain manager, collapsible visual annotation toolbar (`✏️`/`⬜`/`⭕`/`💬`/`🎯 Magic DOM`/`🧽`), and `📤 ส่งให้ AI ดู` / `📤 ส่งทันที` composer integration.
- `test/browser-vision-bridge.test.js` *(new)*: `node:test` unit & upgrade tests for `toBrowserSessionName`, RFC 6455 framing (`mask`, `126`, `127`, fragmentation, interleaved control frames, 1 MB limit / close `1009`), and `401`/`101` auth checks.
- `docs/browser-vision-design.md`: Updated status to `v3 — Implemented (2026-11-23)` and added these implementation notes.

**`lab-browser` (`/home/dev/.local/share/lab-browser/`, outside git repo):**
- `bin/lab-browser.js`: Added `--shared-auth`, `--auth-profile <name>`, `--new-tab`, and `LAB_BROWSER_AUTH_PROFILE` fallback for `bv_*` sessions while keeping one-shot `view`/`shot`/`check` isolated.
- `lib/config.js`: Added `AUTH_DIR`, `sanitizeAuthProfile`, `MAX_CHAT_BROWSERS`, `MIN_FREE_MB_FOR_CHAT_BROWSER`, and `getFreeMemMb()`.
- `lib/auth-store.js` *(new)*: Atomic `0600` JSON store (`~/.local/share/lab-browser/auth/<profile>.json`) with advisory lock (`0700` dir), incremental cookie merge, logout tombstones (1h TTL), `origins` preservation (`localStorage` + `indexedDB`), `summary()`, and `clear()`.
- `lib/browser-core.js`: Added `storageState` / `authProfile` loading for shared-auth contexts, `openBrowserSession` support, and `resolveTargetLocator`.
- `lib/session-client.js`: Added `getStreamSocketPath`, `enforceChatBrowserCap` (LRU eviction of unviewed idle `bv_*` sessions when exceeding cap or RAM floor), and `LAB_BROWSER_DAEMON_OPTS` env passing.
- `lib/session-daemon.js`: Added `<session>.stream.sock` NDJSON server, CDP `Page.startScreencast` (`jpeg`, quality 72, throttled <=20fps, backpressure drop, stops at 0 subscribers), mouse/wheel/key/text/inspect/nav forwarding, pause gate (`paused: true` fast rejection <1s on mutating CLI commands), sensitive-page auto-pause (`PASSWORD`/`OTP`/`PAYMENT`/`CAPTCHA`), and debounced/on-load/on-resume/on-close shared-auth sync.
- `lib/actions.js`: Emits `onAiAction` telemetry (`click`, `hover`, `fill`, `type`, `select`) with element bounding-box coordinates for the live AI cursor overlay.
- `test/auth-store.test.js` *(new)*: `node:test` suite for incremental merge, tombstone deletion/re-login, origin preservation, `0600` permissions, `summary()`, and `clear()`.

### 9.2 Protocol & Contracts

- **Deterministic Session Name (`toBrowserSessionName`):** Returns `bv_${id}` when `/^[A-Za-z0-9_-]+$/` and `('bv_' + id).length <= 32`; otherwise `bv_` + first 16 hex chars of `sha256(id)`.
- **WebSocket Bridge (`/ws/browser-vision?chat=<chatSessionId>`):**
  - Authenticated via `isAuthorized(req)` (`currentSession(req)` cookie); unauthorized upgrades receive `HTTP/1.1 401 Unauthorized` and destroy.
  - RFC 6455 text frames (`<= 1 MB` max client message; oversized frames close with `1009`), 25s server heartbeat `ping`, and backpressure dropping only `type:"frame"` NDJSON lines if `socket.writableLength > 1.5 MB`.
  - Whitelisted client message types forwarded to `<session>.stream.sock`: `input`, `mouse`, `key`, `wheel`, `inspect`, `navigate`, `back`, `forward`, `reload`, `tab`, `tabs`, `new-tab`, `close-tab`, `pause`, `resume`, `resize`, `viewport`, `quality`, `ping`, `pong`, `status`.
- **Stream Unix Socket (`<session>.stream.sock`):**
  - Daemon emits NDJSON events: `hello`, `frame`, `page`, `tabs`, `ai-action`, `pause-state`, `inspect`, `capture`, `status`, `pong`, `error`.
- **REST Endpoints (`/api/browser-vision/*`, all require dashboard auth):**
  - `GET /api/browser-vision/session?chat=`
  - `POST /api/browser-vision/start` `{ chat, url? }`
  - `POST /api/browser-vision/pause` `{ chat, reason? }`
  - `POST /api/browser-vision/resume` `{ chat, note? }`
  - `POST /api/browser-vision/close` `{ chat }`
  - `GET /api/browser-vision/auth/status` *(domains & counts only — never exposes cookie values)*
  - `POST /api/browser-vision/auth/clear`
- **Pause Gate & Sensitive Auto-Pause:**
  - While `paused === true`, mutating CLI commands (`open`, `visit`, `navigate`, `click`, `hover`, `fill`, `type`, `press`, `select`, `scroll`, `back`, `reload`, `eval`, `wait`) immediately return `{ ok: false, paused: true, pauseReason, url, message }` without blocking on the action queue; read-only commands (`status`, `tabs`, `view`, `shot`, `snapshot`, `links`, `text`, `html`, `check`, `errors`, `pdf`) remain available.
  - Sensitive detection (`PASSWORD`, `OTP`, `CAPTCHA`, `PAYMENT`) auto-pauses with `handoff` when stream subscribers `> 0`, or attaches `sensitive: { kind }` without pausing when `subscribers === 0`.

### 9.3 Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `LAB_BROWSER_MAX_CHAT_BROWSERS` | `5` | Maximum concurrent `bv_*` per-chat browser daemons before LRU eviction of idle unviewed sessions (`viewers === 0 && !aiBusy`). |
| `LAB_BROWSER_MIN_FREE_MB` | `1200` | Minimum `MemAvailable` (MB) required before spawning a new `bv_*` browser daemon; triggers LRU eviction if below floor. |
| `LAB_BROWSER_AUTH_PROFILE` | *(unset; dashboard passes `--shared-auth`)* | Default auth profile automatically applied to `bv_*` CLI session commands when neither `--auth-profile`, `--shared-auth`, nor `--persist` is specified. |

### 9.4 Verification & How to Test

1. **Syntax checks:**
   ```bash
   node --check /home/dev/projects/lab-dashboard/browser-vision-bridge.js
   node --check /home/dev/projects/lab-dashboard/server.js
   node --check /home/dev/projects/lab-dashboard/gemini-manager.js
   ```
2. **Unit & bridge tests (`node:test`):**
   ```bash
   node --test /home/dev/.local/share/lab-browser/test/auth-store.test.js
   node --test /home/dev/projects/lab-dashboard/test/*.test.js
   ```
3. **Isolated E2E test server (safe while PM2 `lab-dashboard` runs on `8090`):**
   ```bash
   cd /home/dev/projects/lab-dashboard && DASHBOARD_HOST=172.17.0.1 DASHBOARD_PORT=8099 timeout 200 node server.js
   ```
   Verify login, `/ws/browser-vision?chat=...` JPEG streaming & mouse click navigation, pause/resume latency (`<1s` CLI rejection while paused), cross-room shared-auth sync/deletion (`0600`), LRU cap (`<=5` `bv_*` daemons), and one-shot / `--persist` non-interference.

### 9.5 Remaining Limitations

- `lab-browser` resides at `/home/dev/.local/share/lab-browser/` outside the `homelab-server` git repository, so changes there are deployed locally on the host rather than tracked in git.
- `Magic DOM` (`inspect`) resolves elements inside the main document, open `shadowRoot`s, and same-origin `iframe`s; cross-origin `iframe`s and closed `shadowRoot`s cannot be pierced due to Chromium same-origin isolation.
- Full `context.storageState({ indexedDB: true })` (`localStorage` + `indexedDB`) syncs on page `load`, user `resume`, and daemon `close`/`shutdown`, whereas debounced syncs after routine actions sync cookies only for low latency.
- The WebSocket bridge runs inside the single `lab-dashboard` Node process (`1 MB` client WS message cap) and assumes single-instance deployment (`ecosystem.config.js` `instances: 1`).
