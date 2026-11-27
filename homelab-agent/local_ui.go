package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

//go:embed tray_ui.html
var trayUIHTML []byte

type localUIServer struct {
	srv      *http.Server
	listener net.Listener
	url      string
}

func startLocalUIServer(preferredPort int, onQuit func()) (*localUIServer, error) {
	if preferredPort <= 0 || preferredPort > 65535 {
		preferredPort = 18470
	}

	var ln net.Listener
	var err error
	for p := preferredPort; p <= preferredPort+20 && p <= 65535; p++ {
		ln, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			break
		}
	}
	if ln == nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return nil, err
		}
	}

	addr := ln.Addr().String()
	uiURL := "http://" + addr
	runtimeState.SetLocalUIURL(uiURL)

	mux := buildLocalUIMux(onQuit)
	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		_ = srv.Serve(ln)
	}()

	return &localUIServer{
		srv:      srv,
		listener: ln,
		url:      uiURL,
	}, nil
}

func (u *localUIServer) Close() {
	if u == nil || u.srv == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = u.srv.Shutdown(ctx)
}

func isLoopbackOriginAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	lower := strings.ToLower(origin)
	return strings.HasPrefix(lower, "http://127.0.0.1:") ||
		strings.HasPrefix(lower, "http://localhost:") ||
		lower == "http://127.0.0.1" ||
		lower == "http://localhost"
}

func writeLocalJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func buildLocalUIMux(onQuit func()) *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/index.html" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(trayUIHTML)
	})

	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeLocalJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"ok": false, "error": "method not allowed"})
			return
		}
		writeLocalJSON(w, http.StatusOK, runtimeState.BuildLocalStatusSnapshot())
	})

	mux.HandleFunc("/api/check-hub", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeLocalJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"ok": false, "error": "method not allowed"})
			return
		}
		if !isLoopbackOriginAllowed(r) {
			writeLocalJSON(w, http.StatusForbidden, map[string]interface{}{"ok": false, "error": "origin not allowed"})
			return
		}
		res := runtimeState.VerifyWithHub()
		writeLocalJSON(w, http.StatusOK, map[string]interface{}{
			"ok":        true,
			"selfCheck": res,
			"status":    runtimeState.BuildLocalStatusSnapshot(),
		})
	})

	mux.HandleFunc("/api/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeLocalJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"ok": false, "error": "method not allowed"})
			return
		}
		if !isLoopbackOriginAllowed(r) {
			writeLocalJSON(w, http.StatusForbidden, map[string]interface{}{"ok": false, "error": "origin not allowed"})
			return
		}
		err := sendHeartbeat()
		errStr := ""
		if err != nil {
			errStr = err.Error()
		}
		writeLocalJSON(w, http.StatusOK, map[string]interface{}{
			"ok":     err == nil,
			"error":  errStr,
			"status": runtimeState.BuildLocalStatusSnapshot(),
		})
	})

	mux.HandleFunc("/api/pause", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeLocalJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"ok": false, "error": "method not allowed"})
			return
		}
		if !isLoopbackOriginAllowed(r) {
			writeLocalJSON(w, http.StatusForbidden, map[string]interface{}{"ok": false, "error": "origin not allowed"})
			return
		}
		var body struct {
			Paused *bool `json:"paused"`
		}
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body)
		nextPaused := !runtimeState.IsPaused()
		if body.Paused != nil {
			nextPaused = *body.Paused
		}
		runtimeState.SetPaused(nextPaused, true)
		go func() {
			_ = sendHeartbeat()
		}()
		writeLocalJSON(w, http.StatusOK, map[string]interface{}{
			"ok":              true,
			"paused":          nextPaused,
			"workerState":     runtimeState.WorkerState(),
			"workerStateThai": runtimeState.WorkerStateThai(),
			"status":          runtimeState.BuildLocalStatusSnapshot(),
		})
	})

	mux.HandleFunc("/api/jobs/cancel", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeLocalJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"ok": false, "error": "method not allowed"})
			return
		}
		if !isLoopbackOriginAllowed(r) {
			writeLocalJSON(w, http.StatusForbidden, map[string]interface{}{"ok": false, "error": "origin not allowed"})
			return
		}
		var body struct {
			JobID string `json:"jobId"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil || strings.TrimSpace(body.JobID) == "" {
			writeLocalJSON(w, http.StatusBadRequest, map[string]interface{}{"ok": false, "error": "missing jobId"})
			return
		}
		data, err := handleJobCancel(map[string]interface{}{"jobId": strings.TrimSpace(body.JobID)})
		if err != nil {
			writeLocalJSON(w, http.StatusConflict, map[string]interface{}{"ok": false, "error": err.Error()})
			return
		}
		runtimeState.RecordEvent("warn", "สั่งยกเลิกงานจากหน้าต่างสถานะ: "+body.JobID)
		writeLocalJSON(w, http.StatusOK, map[string]interface{}{
			"ok":     true,
			"data":   data,
			"status": runtimeState.BuildLocalStatusSnapshot(),
		})
	})

	mux.HandleFunc("/api/open-hub", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeLocalJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"ok": false, "error": "method not allowed"})
			return
		}
		if !isLoopbackOriginAllowed(r) {
			writeLocalJSON(w, http.StatusForbidden, map[string]interface{}{"ok": false, "error": "origin not allowed"})
			return
		}
		openURLInBrowser(runtimeState.HubDashboardURL())
		writeLocalJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
	})

	mux.HandleFunc("/api/open-logs", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeLocalJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"ok": false, "error": "method not allowed"})
			return
		}
		if !isLoopbackOriginAllowed(r) {
			writeLocalJSON(w, http.StatusForbidden, map[string]interface{}{"ok": false, "error": "origin not allowed"})
			return
		}
		dir := runtimeState.InstallDir()
		if dir == "" {
			dir = getDefaultInstallDir()
		}
		openDirInFileManager(dir)
		writeLocalJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "dir": dir})
	})

	mux.HandleFunc("/api/quit", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeLocalJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"ok": false, "error": "method not allowed"})
			return
		}
		if !isLoopbackOriginAllowed(r) {
			writeLocalJSON(w, http.StatusForbidden, map[string]interface{}{"ok": false, "error": "origin not allowed"})
			return
		}
		writeLocalJSON(w, http.StatusOK, map[string]interface{}{"ok": true, "message": "กำลังปิด Homelab Agent..."})
		if onQuit != nil {
			go func() {
				time.Sleep(150 * time.Millisecond)
				onQuit()
			}()
		}
	})

	return mux
}

func checkExistingLocalUI(preferredPort int) string {
	if preferredPort <= 0 || preferredPort > 65535 {
		preferredPort = 18470
	}
	client := &http.Client{Timeout: 800 * time.Millisecond}
	for p := preferredPort; p <= preferredPort+5 && p <= 65535; p++ {
		base := fmt.Sprintf("http://127.0.0.1:%d", p)
		resp, err := client.Get(base + "/api/status")
		if err == nil {
			var probe struct {
				OK     bool   `json:"ok"`
				NodeID string `json:"nodeId"`
			}
			_ = json.NewDecoder(resp.Body).Decode(&probe)
			resp.Body.Close()
			if resp.StatusCode == 200 && probe.OK && probe.NodeID != "" {
				return base
			}
		}
	}
	return ""
}
