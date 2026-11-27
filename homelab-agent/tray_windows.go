//go:build windows

package main

import (
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

var (
	user32                      = syscall.NewLazyDLL("user32.dll")
	shell32                     = syscall.NewLazyDLL("shell32.dll")
	procGetModuleHandleW        = kernel32.NewProc("GetModuleHandleW")
	procRegisterClassExW        = user32.NewProc("RegisterClassExW")
	procCreateWindowExW         = user32.NewProc("CreateWindowExW")
	procDefWindowProcW          = user32.NewProc("DefWindowProcW")
	procGetMessageW             = user32.NewProc("GetMessageW")
	procTranslateMessage        = user32.NewProc("TranslateMessage")
	procDispatchMessageW        = user32.NewProc("DispatchMessageW")
	procPostMessageW            = user32.NewProc("PostMessageW")
	procPostQuitMessage         = user32.NewProc("PostQuitMessage")
	procDestroyWindow           = user32.NewProc("DestroyWindow")
	procRegisterWindowMessageW  = user32.NewProc("RegisterWindowMessageW")
	procCreateIconFromResEx     = user32.NewProc("CreateIconFromResourceEx")
	procLoadIconW               = user32.NewProc("LoadIconW")
	procDestroyIcon             = user32.NewProc("DestroyIcon")
	procCreatePopupMenu         = user32.NewProc("CreatePopupMenu")
	procAppendMenuW             = user32.NewProc("AppendMenuW")
	procDestroyMenu             = user32.NewProc("DestroyMenu")
	procSetMenuDefaultItem      = user32.NewProc("SetMenuDefaultItem")
	procGetCursorPos            = user32.NewProc("GetCursorPos")
	procSetForegroundWindow     = user32.NewProc("SetForegroundWindow")
	procTrackPopupMenu          = user32.NewProc("TrackPopupMenu")
	procShellNotifyIconW        = shell32.NewProc("Shell_NotifyIconW")
)

const (
	wmNull           = 0x0000
	wmDestroy        = 0x0002
	wmCommand        = 0x0111
	wmLButtonUp      = 0x0202
	wmLButtonDblClk  = 0x0203
	wmRButtonUp      = 0x0205
	wmContextMenu    = 0x007B
	wmApp            = 0x8000
	wmTrayCallback   = wmApp + 1
	wmTrayRefresh    = wmApp + 2
	wmTrayQuit       = wmApp + 3

	nimAdd    = 0x00000000
	nimModify = 0x00000001
	nimDelete = 0x00000002

	nifMessage = 0x00000001
	nifIcon    = 0x00000002
	nifTip     = 0x00000004
	nifInfo    = 0x00000010

	niifInfo    = 0x00000001
	niifWarning = 0x00000002
	niifError   = 0x00000003

	mfString    = 0x00000000
	mfGrayed    = 0x00000001
	mfDisabled  = 0x00000002
	mfSeparator = 0x00000800

	tpmRightButton = 0x0002
	tpmBottomAlign = 0x0020
	tpmLeftAlign   = 0x0000

	idiApplication = 32512

	menuIDOpenUI   = 1001
	menuIDCheckHub = 1002
	menuIDPause    = 1003
	menuIDOpenHub  = 1004
	menuIDOpenLogs = 1005
	menuIDQuit     = 1009
)

type winPoint struct {
	X int32
	Y int32
}

type winMsg struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      winPoint
}

type wndClassExW struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     uintptr
	HIcon         uintptr
	HCursor       uintptr
	HbrBackground uintptr
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       uintptr
}

type winGUID struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

type notifyIconDataW struct {
	CbSize           uint32
	Hwnd             uintptr
	UID              uint32
	UFlags           uint32
	UCallbackMessage uint32
	HIcon            uintptr
	SzTip            [128]uint16
	DwState          uint32
	DwStateMask      uint32
	SzInfo           [256]uint16
	UVersion         uint32
	SzInfoTitle      [64]uint16
	DwInfoFlags      uint32
	GuidItem         winGUID
	HBalloonIcon     uintptr
}

type trayController struct {
	mu             sync.Mutex
	hwnd           uintptr
	taskbarCreated uint32
	icons          map[string]uintptr
	lastState      string
	lastTip        string
	lastOpenUI     time.Time
	onQuit         func()
	stopped        bool
}

var winTray = &trayController{}

func copyUTF16Fixed(dst []uint16, s string) {
	u16, err := syscall.UTF16FromString(s)
	if err != nil {
		return
	}
	maxLen := len(dst) - 1
	if maxLen <= 0 {
		return
	}
	if len(u16)-1 > maxLen {
		copy(dst[:maxLen], u16[:maxLen])
		dst[maxLen] = 0
		return
	}
	copy(dst, u16)
}

func makeStatusIcon(state string) uintptr {
	const size = 32
	// Primary RGB colors matching tactical theme
	var r0, g0, b0 uint8
	var rHi, gHi, bHi uint8
	switch state {
	case "idle":
		r0, g0, b0 = 16, 185, 129
		rHi, gHi, bHi = 110, 231, 183
	case "running":
		r0, g0, b0 = 14, 165, 233
		rHi, gHi, bHi = 125, 211, 252
	case "paused":
		r0, g0, b0 = 245, 158, 11
		rHi, gHi, bHi = 253, 224, 71
	default: // offline
		r0, g0, b0 = 239, 68, 68
		rHi, gHi, bHi = 252, 165, 165
	}

	const headerSize = 40
	const xorSize = size * size * 4
	const andStride = ((size + 31) / 32) * 4
	const andSize = andStride * size

	buf := make([]byte, headerSize+xorSize+andSize)
	// BITMAPINFOHEADER
	binary.LittleEndian.PutUint32(buf[0:4], headerSize)
	binary.LittleEndian.PutUint32(buf[4:8], size)
	binary.LittleEndian.PutUint32(buf[8:12], size*2) // XOR + AND
	binary.LittleEndian.PutUint16(buf[12:14], 1)
	binary.LittleEndian.PutUint16(buf[14:16], 32)
	binary.LittleEndian.PutUint32(buf[16:20], 0)
	binary.LittleEndian.PutUint32(buf[20:24], xorSize)

	cx, cy := float64(size-1)/2.0, float64(size-1)/2.0
	outerR := 14.2
	ringR := 11.4

	for y := 0; y < size; y++ {
		dibRow := size - 1 - y // bottom-up DIB
		for x := 0; x < size; x++ {
			dx := float64(x) - cx
			dy := float64(y) - cy
			dist := math.Hypot(dx, dy)

			var r, g, b, a uint8
			if dist <= outerR+0.8 {
				// Smooth alpha edge
				edgeAlpha := 1.0
				if dist > outerR-0.6 {
					edgeAlpha = math.Max(0, math.Min(1, (outerR+0.8-dist)/1.4))
				}
				a = uint8(edgeAlpha * 255)
				if dist > ringR {
					// Crisp dark navy bezel so icon stands out on light & dark taskbars
					r, g, b = 10, 18, 34
				} else {
					// Radial highlight from upper-left
					hiDist := math.Hypot(dx+3.5, dy+3.8)
					t := math.Max(0, math.Min(1, 1.0-(hiDist/11.5)))
					r = uint8(float64(r0)*(1-t*0.55) + float64(rHi)*(t*0.55))
					g = uint8(float64(g0)*(1-t*0.55) + float64(gHi)*(t*0.55))
					b = uint8(float64(b0)*(1-t*0.55) + float64(bHi)*(t*0.55))

					// Subtle center glyph for paused (two vertical bars) or running (bright core dot)
					if state == "paused" && math.Abs(dy) <= 5.0 && ((dx >= -4.2 && dx <= -1.4) || (dx >= 1.4 && dx <= 4.2)) {
						r, g, b = 15, 23, 42
					} else if state == "running" && dist <= 4.0 {
						r, g, b = 255, 255, 255
					} else if state == "offline" && math.Abs(dx) <= 4.5 && math.Abs(dy) <= 4.5 && (math.Abs(dx-dy) <= 1.4 || math.Abs(dx+dy) <= 1.4) {
						r, g, b = 255, 255, 255
					}
				}
			}

			off := headerSize + (dibRow*size+x)*4
			buf[off+0] = b
			buf[off+1] = g
			buf[off+2] = r
			buf[off+3] = a

			if a < 128 {
				andOff := headerSize + xorSize + dibRow*andStride + (x / 8)
				buf[andOff] |= 1 << uint(7-(x%8))
			}
		}
	}

	hIcon, _, _ := procCreateIconFromResEx.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
		1,          // fIcon = TRUE
		0x00030000, // dwVer
		size,
		size,
		0,
	)
	if hIcon == 0 {
		hIcon, _, _ = procLoadIconW.Call(0, uintptr(idiApplication))
	}
	return hIcon
}

func buildTrayTooltip() string {
	name := runtimeState.DisplayName()
	state := runtimeState.WorkerState()
	var tip string
	switch state {
	case "running":
		jobs := runtimeState.ActiveJobs()
		if len(jobs) == 1 {
			jn := jobs[0].Name
			if jn == "" {
				jn = jobs[0].JobID
			}
			tip = fmt.Sprintf("Homelab Agent · กำลังรัน: %s (%.0f%%)", jn, jobs[0].Progress)
		} else if len(jobs) > 1 {
			tip = fmt.Sprintf("Homelab Agent · กำลังรัน %d งาน | %s", len(jobs), name)
		} else {
			tip = fmt.Sprintf("Homelab Agent · กำลังรันงาน | %s", name)
		}
	case "paused":
		tip = fmt.Sprintf("Homelab Agent · พักรับงานชั่วคราว | %s", name)
	case "idle":
		tip = fmt.Sprintf("Homelab Agent · ออนไลน์ (ว่าง) | %s", name)
	default:
		tip = fmt.Sprintf("Homelab Agent · ออฟไลน์ | %s", name)
	}
	return truncateRunes(tip, 120)
}

func (t *trayController) iconForState(state string) uintptr {
	if h, ok := t.icons[state]; ok && h != 0 {
		return h
	}
	if h, ok := t.icons["offline"]; ok && h != 0 {
		return h
	}
	return 0
}

func (t *trayController) addIcon() {
	if t.hwnd == 0 {
		return
	}
	state := runtimeState.WorkerState()
	tip := buildTrayTooltip()

	var nid notifyIconDataW
	nid.CbSize = uint32(unsafe.Sizeof(nid))
	nid.Hwnd = t.hwnd
	nid.UID = 1
	nid.UFlags = nifMessage | nifIcon | nifTip
	nid.UCallbackMessage = wmTrayCallback
	nid.HIcon = t.iconForState(state)
	copyUTF16Fixed(nid.SzTip[:], tip)

	procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&nid)))
	t.mu.Lock()
	t.lastState = state
	t.lastTip = tip
	t.mu.Unlock()
}

func (t *trayController) updateIcon(force bool) {
	if t.hwnd == 0 {
		return
	}
	state := runtimeState.WorkerState()
	tip := buildTrayTooltip()

	t.mu.Lock()
	if !force && state == t.lastState && tip == t.lastTip {
		t.mu.Unlock()
		return
	}
	t.lastState = state
	t.lastTip = tip
	t.mu.Unlock()

	var nid notifyIconDataW
	nid.CbSize = uint32(unsafe.Sizeof(nid))
	nid.Hwnd = t.hwnd
	nid.UID = 1
	nid.UFlags = nifIcon | nifTip
	nid.HIcon = t.iconForState(state)
	copyUTF16Fixed(nid.SzTip[:], tip)

	procShellNotifyIconW.Call(nimModify, uintptr(unsafe.Pointer(&nid)))
}

func (t *trayController) showBalloon(title, body string, infoFlags uint32) {
	t.mu.Lock()
	hwnd := t.hwnd
	stopped := t.stopped
	t.mu.Unlock()
	if hwnd == 0 || stopped {
		return
	}
	var nid notifyIconDataW
	nid.CbSize = uint32(unsafe.Sizeof(nid))
	nid.Hwnd = hwnd
	nid.UID = 1
	nid.UFlags = nifInfo
	nid.DwInfoFlags = infoFlags
	copyUTF16Fixed(nid.SzInfoTitle[:], truncateRunes(title, 60))
	copyUTF16Fixed(nid.SzInfo[:], truncateRunes(body, 240))
	procShellNotifyIconW.Call(nimModify, uintptr(unsafe.Pointer(&nid)))
}

func (t *trayController) removeIcon() {
	if t.hwnd == 0 {
		return
	}
	var nid notifyIconDataW
	nid.CbSize = uint32(unsafe.Sizeof(nid))
	nid.Hwnd = t.hwnd
	nid.UID = 1
	procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&nid)))
}

func appendMenuItem(hMenu uintptr, flags uint32, id uintptr, label string) {
	if flags == mfSeparator {
		procAppendMenuW.Call(hMenu, uintptr(mfSeparator), 0, 0)
		return
	}
	ptr, err := syscall.UTF16PtrFromString(label)
	if err != nil {
		return
	}
	procAppendMenuW.Call(hMenu, uintptr(flags), id, uintptr(unsafe.Pointer(ptr)))
}

func (t *trayController) showContextMenu() {
	hMenu, _, _ := procCreatePopupMenu.Call()
	if hMenu == 0 {
		return
	}
	defer procDestroyMenu.Call(hMenu)

	state := runtimeState.WorkerState()
	statePrefix := "🔴"
	switch state {
	case "idle":
		statePrefix = "🟢"
	case "running":
		statePrefix = "🔵"
	case "paused":
		statePrefix = "🟠"
	}
	header := fmt.Sprintf("%s %s (%s)", statePrefix, runtimeState.WorkerStateThai(), runtimeState.DisplayName())
	appendMenuItem(hMenu, mfString|mfGrayed|mfDisabled, 0, truncateRunes(header, 72))
	appendMenuItem(hMenu, mfSeparator, 0, "")
	appendMenuItem(hMenu, mfString, menuIDOpenUI, "📊 เปิดแอปดูสถานะ (Status App)")
	appendMenuItem(hMenu, mfString, menuIDCheckHub, "📡 เช็กสถานะกับเครื่องแม่เดี๋ยวนี้")
	if runtimeState.IsPaused() {
		appendMenuItem(hMenu, mfString, menuIDPause, "▶️ กลับมาพร้อมรับงาน (Resume)")
	} else {
		appendMenuItem(hMenu, mfString, menuIDPause, "⏸️ พักรับงานชั่วคราว (Pause)")
	}
	appendMenuItem(hMenu, mfSeparator, 0, "")
	appendMenuItem(hMenu, mfString, menuIDOpenHub, "🌐 เปิดเว็บ Homelab Agent Hub")
	appendMenuItem(hMenu, mfString, menuIDOpenLogs, "📁 เปิดโฟลเดอร์ติดตั้ง / Log")
	appendMenuItem(hMenu, mfSeparator, 0, "")
	appendMenuItem(hMenu, mfString, menuIDQuit, "🚪 ออกจาก Homelab Agent")

	procSetMenuDefaultItem.Call(hMenu, menuIDOpenUI, 0)

	var pt winPoint
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForegroundWindow.Call(t.hwnd)
	procTrackPopupMenu.Call(
		hMenu,
		uintptr(tpmRightButton|tpmBottomAlign|tpmLeftAlign),
		uintptr(pt.X),
		uintptr(pt.Y),
		0,
		t.hwnd,
		0,
	)
	procPostMessageW.Call(t.hwnd, wmNull, 0, 0)
}

func (t *trayController) handleMenuCommand(id uint16) {
	switch id {
	case menuIDOpenUI:
		go openLocalStatusApp(runtimeState.LocalUIURL())
	case menuIDCheckHub:
		go func() {
			res := runtimeState.VerifyWithHub()
			t.RequestRefresh()
			if res.Reachable && res.ServerOnline {
				t.showBalloon(
					"Homelab Agent — ออนไลน์ปกติ",
					fmt.Sprintf("เครื่องแม่ยืนยัน: %s (%d ms) · %s", res.ServerWorkerState, res.RTTMs, res.Endpoint),
					niifInfo,
				)
			} else if res.Reachable {
				t.showBalloon(
					"Homelab Agent — แจ้งเตือนสถานะ",
					fmt.Sprintf("ติดต่อเครื่องแม่ได้ แต่สถานะฝั่งแม่คือ %s (%s)", res.ServerWorkerState, res.Error),
					niifWarning,
				)
			} else {
				t.showBalloon(
					"Homelab Agent — ติดต่อเครื่องแม่ไม่ได้",
					res.Error,
					niifError,
				)
			}
		}()
	case menuIDPause:
		nextPaused := !runtimeState.IsPaused()
		runtimeState.SetPaused(nextPaused, true)
		t.updateIcon(true)
		go func() {
			_ = sendHeartbeat()
			if nextPaused {
				t.showBalloon("Homelab Agent — พักรับงานชั่วคราว", "เครื่องแม่จะไม่ส่งงานใหม่เข้ามาจนกว่าจะกด Resume", niifWarning)
			} else {
				t.showBalloon("Homelab Agent — พร้อมรับงานแล้ว", "เครื่องนี้กลับมาออนไลน์พร้อมรับงานจาก Homelab แล้ว", niifInfo)
			}
		}()
	case menuIDOpenHub:
		go openURLInBrowser(runtimeState.HubDashboardURL())
	case menuIDOpenLogs:
		go func() {
			dir := runtimeState.InstallDir()
			if dir == "" {
				dir = getDefaultInstallDir()
			}
			openDirInFileManager(dir)
		}()
	case menuIDQuit:
		if t.onQuit != nil {
			go t.onQuit()
		}
	}
}

func (t *trayController) openStatusAppDebounced() {
	now := time.Now()
	t.mu.Lock()
	if !t.lastOpenUI.IsZero() && now.Sub(t.lastOpenUI) < 700*time.Millisecond {
		t.mu.Unlock()
		return
	}
	t.lastOpenUI = now
	t.mu.Unlock()
	go openLocalStatusApp(runtimeState.LocalUIURL())
}

func (t *trayController) RequestRefresh() {
	t.mu.Lock()
	hwnd := t.hwnd
	stopped := t.stopped
	t.mu.Unlock()
	if hwnd != 0 && !stopped {
		procPostMessageW.Call(hwnd, wmTrayRefresh, 0, 0)
	}
}

func trayWndProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	if winTray.taskbarCreated != 0 && msg == winTray.taskbarCreated {
		winTray.addIcon()
		return 0
	}
	switch msg {
	case wmTrayCallback:
		switch uint32(lParam & 0xFFFF) {
		case wmLButtonUp, wmLButtonDblClk:
			winTray.openStatusAppDebounced()
		case wmRButtonUp, wmContextMenu:
			winTray.showContextMenu()
		}
		return 0
	case wmCommand:
		winTray.handleMenuCommand(uint16(wParam & 0xFFFF))
		return 0
	case wmTrayRefresh:
		winTray.updateIcon(false)
		return 0
	case wmTrayQuit:
		winTray.removeIcon()
		procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		winTray.removeIcon()
		procPostQuitMessage.Call(0)
		return 0
	}
	ret, _, _ := procDefWindowProcW.Call(hwnd, uintptr(msg), wParam, lParam)
	return ret
}

func startSystemTray(stopCh <-chan struct{}, onQuit func()) {
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		hInst, _, _ := procGetModuleHandleW.Call(0)
		className, _ := syscall.UTF16PtrFromString("HomelabAgentTrayWindow")
		taskbarMsgName, _ := syscall.UTF16PtrFromString("TaskbarCreated")
		tbMsg, _, _ := procRegisterWindowMessageW.Call(uintptr(unsafe.Pointer(taskbarMsgName)))

		winTray.mu.Lock()
		winTray.taskbarCreated = uint32(tbMsg)
		winTray.onQuit = onQuit
		winTray.stopped = false
		winTray.icons = map[string]uintptr{
			"idle":    makeStatusIcon("idle"),
			"running": makeStatusIcon("running"),
			"paused":  makeStatusIcon("paused"),
			"offline": makeStatusIcon("offline"),
		}
		winTray.mu.Unlock()

		wc := wndClassExW{
			CbSize:        uint32(unsafe.Sizeof(wndClassExW{})),
			LpfnWndProc:   syscall.NewCallback(trayWndProc),
			HInstance:     hInst,
			LpszClassName: className,
		}
		procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

		hwnd, _, _ := procCreateWindowExW.Call(
			0,
			uintptr(unsafe.Pointer(className)),
			uintptr(unsafe.Pointer(className)),
			0,
			0, 0, 0, 0,
			0, 0, hInst, 0,
		)
		if hwnd == 0 {
			return
		}

		winTray.mu.Lock()
		winTray.hwnd = hwnd
		winTray.mu.Unlock()

		winTray.addIcon()
		runtimeState.SetOnChange(func() {
			winTray.RequestRefresh()
		})

		// Periodic tooltip/icon refresh & stop watcher
		go func() {
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					winTray.RequestRefresh()
				case <-stopCh:
					stopSystemTray()
					return
				}
			}
		}()

		var m winMsg
		for {
			ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if int32(ret) <= 0 {
				break
			}
			procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
		}

		winTray.mu.Lock()
		for _, h := range winTray.icons {
			if h != 0 {
				procDestroyIcon.Call(h)
			}
		}
		winTray.icons = nil
		winTray.hwnd = 0
		winTray.stopped = true
		winTray.mu.Unlock()
	}()
}

func stopSystemTray() {
	winTray.mu.Lock()
	hwnd := winTray.hwnd
	winTray.stopped = true
	winTray.mu.Unlock()
	if hwnd != 0 {
		procPostMessageW.Call(hwnd, wmTrayQuit, 0, 0)
	}
}

func findAppModeBrowserWindows() string {
	progFiles := os.Getenv("ProgramFiles")
	progFilesX86 := os.Getenv("ProgramFiles(x86)")
	localAppData := os.Getenv("LOCALAPPDATA")

	candidates := []string{
		filepath.Join(progFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(progFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
		filepath.Join(progFiles, "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(progFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
		filepath.Join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	if p, err := exec.LookPath("msedge.exe"); err == nil && p != "" {
		return p
	}
	if p, err := exec.LookPath("chrome.exe"); err == nil && p != "" {
		return p
	}
	return ""
}

func openLocalStatusApp(uiURL string) {
	if uiURL == "" {
		return
	}
	if browser := findAppModeBrowserWindows(); browser != "" {
		cmd := exec.Command(browser, "--app="+uiURL, "--window-size=500,790")
		cmd.SysProcAttr = hideWindowAttr()
		if err := cmd.Start(); err == nil {
			return
		}
	}
	openURLInBrowser(uiURL)
}

func openURLInBrowser(rawURL string) {
	if rawURL == "" {
		return
	}
	cmd := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", rawURL)
	cmd.SysProcAttr = hideWindowAttr()
	_ = cmd.Start()
}

func openDirInFileManager(dir string) {
	if dir == "" {
		return
	}
	cmd := exec.Command("explorer.exe", dir)
	cmd.SysProcAttr = hideWindowAttr()
	_ = cmd.Start()
}
