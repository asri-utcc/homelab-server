//go:build !windows

package main

import (
	"os/exec"
	"runtime"
)

func startSystemTray(stopCh <-chan struct{}, onQuit func()) {
	// Native Win32 tray is only active on Windows; Linux/macOS still serve the Local Status App HTTP UI.
}

func stopSystemTray() {
}

func openLocalStatusApp(uiURL string) {
	openURLInBrowser(uiURL)
}

func openURLInBrowser(rawURL string) {
	if rawURL == "" {
		return
	}
	if runtime.GOOS == "darwin" {
		_ = exec.Command("open", rawURL).Start()
		return
	}
	_ = exec.Command("xdg-open", rawURL).Start()
}

func openDirInFileManager(dir string) {
	if dir == "" {
		return
	}
	if runtime.GOOS == "darwin" {
		_ = exec.Command("open", dir).Start()
		return
	}
	_ = exec.Command("xdg-open", dir).Start()
}
