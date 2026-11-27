package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func resetGlobalAgentForTest(t *testing.T, hubURL string) {
	t.Helper()
	initHTTPClients()
	runtimeState = newAgentRuntimeState()
	agentCfg = AgentConfig{
		NodeID:  "test-win-node",
		HubURLs: []string{hubURL},
		Token:   "test-token-1234567890",
	}
	endpointMutex.Lock()
	currentEndpoint = ""
	endpointMutex.Unlock()
}

func TestRuntimeStateTransitionsAndPersistence(t *testing.T) {
	tmpDir := t.TempDir()
	st := newAgentRuntimeState()
	st.SetInstallDir(tmpDir)

	if got := st.WorkerState(); got != "offline" {
		t.Fatalf("expected offline initially, got %s", got)
	}

	st.SetHeartbeatSuccess("http://127.0.0.1:8090", 12, "เครื่องเทรด", "เครื่องเทรด", "1.2.0")
	if !st.IsConnected() {
		t.Fatalf("expected connected after heartbeat success")
	}
	if got := st.WorkerState(); got != "idle" {
		t.Fatalf("expected idle when connected with no jobs, got %s", got)
	}
	if got := st.DisplayName(); got != "เครื่องเทรด" {
		t.Fatalf("expected displayName เครื่องเทรด, got %s", got)
	}

	st.StartJob("gjob_1", "whisper-transcribe", "generic", "starting", true)
	if got := st.WorkerState(); got != "running" {
		t.Fatalf("expected running with active job, got %s", got)
	}
	st.UpdateJob("gjob_1", "running", 55.5, "transcribing")
	active := st.ActiveJobs()
	if len(active) != 1 || active[0].Progress != 55.5 || !active[0].Cancellable {
		t.Fatalf("unexpected active jobs: %+v", active)
	}

	// Pause takes precedence over running
	st.SetPaused(true, true)
	if got := st.WorkerState(); got != "paused" {
		t.Fatalf("expected paused when SetPaused(true), got %s", got)
	}
	if _, err := os.Stat(filepath.Join(tmpDir, "agent-state.json")); err != nil {
		t.Fatalf("expected persisted agent-state.json: %v", err)
	}

	// Reload persisted paused state into a fresh runtime state
	st2 := newAgentRuntimeState()
	st2.SetInstallDir(tmpDir)
	if !st2.IsPaused() {
		t.Fatalf("expected reloaded runtime state to preserve paused=true")
	}

	// Finish job and unpause -> idle
	st.FinishJob("gjob_1", "completed", "done")
	if len(st.ActiveJobs()) != 0 {
		t.Fatalf("expected 0 active jobs after finish")
	}
	recent := st.RecentJobs()
	if len(recent) != 1 || recent[0].Status != "completed" || recent[0].Progress != 100 {
		t.Fatalf("unexpected recent jobs: %+v", recent)
	}

	st.SetPaused(false, true)
	if got := st.WorkerState(); got != "idle" {
		t.Fatalf("expected idle after resume, got %s", got)
	}

	st.SetHeartbeatError("dial tcp timeout")
	if got := st.WorkerState(); got != "offline" {
		t.Fatalf("expected offline after heartbeat error, got %s", got)
	}
}

func TestVerifyWithHubSelfStatusAndFallback(t *testing.T) {
	// Case 1: Hub supports GET /api/agent-hub/agent/self-status
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Agent-Token") != "test-token-1234567890" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/api/agent-hub/agent/self-status" {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":                true,
				"registered":        true,
				"online":            true,
				"paused":            false,
				"workerState":       "idle",
				"alias":             "asridaytrade",
				"displayName":       "เครื่องเทรด",
				"lastSeenAt":        "2026-11-28T00:00:00Z",
				"ageMs":             1500,
				"longPollConnected": true,
				"activeJobs":        0,
				"maxJobs":           2,
				"currentJobs":       []interface{}{},
				"recentJobs":        []interface{}{},
				"hub": map[string]interface{}{
					"serverTime":   "2026-11-28T00:00:01Z",
					"agentVersion": "1.2.0",
					"totalNodes":   3,
					"onlineNodes":  2,
				},
			})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	resetGlobalAgentForTest(t, srv.URL)
	res := runtimeState.VerifyWithHub()
	if !res.OK || !res.Reachable || !res.ServerOnline || !res.Registered {
		t.Fatalf("expected online self-status result, got %+v", res)
	}
	if res.ServerWorkerState != "idle" || res.HubOnlineNodes != 2 || res.HubTotalNodes != 3 {
		t.Fatalf("unexpected self-status fields: %+v", res)
	}
	if res.ServerAgeMs == nil || *res.ServerAgeMs != 1500 {
		t.Fatalf("expected serverAgeMs=1500, got %+v", res.ServerAgeMs)
	}

	// Case 2: Older Hub returns 404 on self-status -> automatic fallback to heartbeat
	oldSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/agent-hub/agent/self-status" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.URL.Path == "/api/agent-hub/agent/heartbeat" && r.Method == http.MethodPost {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":         true,
				"nodeId":     "test-win-node",
				"serverTime": "2026-11-28T00:00:02Z",
				"commands":   []interface{}{},
			})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer oldSrv.Close()

	resetGlobalAgentForTest(t, oldSrv.URL)
	fb := runtimeState.VerifyWithHub()
	if !fb.OK || !fb.Reachable || !fb.ServerOnline || !fb.FallbackUsed {
		t.Fatalf("expected fallback verification to succeed, got %+v", fb)
	}
}

func TestLocalUIEndpoints(t *testing.T) {
	mockHub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/agent-hub/agent/heartbeat" {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":          true,
				"displayName": "MyPC",
				"workerState": "idle",
				"commands":    []interface{}{},
			})
			return
		}
		if r.URL.Path == "/api/agent-hub/agent/self-status" {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":          true,
				"registered":  true,
				"online":      true,
				"workerState": "idle",
				"displayName": "MyPC",
				"hub": map[string]interface{}{
					"agentVersion": "1.2.0",
					"totalNodes":   1,
					"onlineNodes":  1,
				},
			})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer mockHub.Close()

	resetGlobalAgentForTest(t, mockHub.URL)
	runtimeState.SetInstallDir(t.TempDir())
	mux := buildLocalUIMux(nil)

	// GET / returns HTML
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Homelab Worker Agent") {
		t.Fatalf("unexpected GET / response: code=%d", rec.Code)
	}

	// GET /api/status
	req = httptest.NewRequest(http.MethodGet, "/api/status", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("expected 200 on /api/status, got %d", rec.Code)
	}

	// POST /api/pause
	req = httptest.NewRequest(http.MethodPost, "/api/pause", bytes.NewBufferString(`{"paused":true}`))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 200 || !runtimeState.IsPaused() {
		t.Fatalf("expected pause to succeed, code=%d paused=%v", rec.Code, runtimeState.IsPaused())
	}

	// POST /api/check-hub
	req = httptest.NewRequest(http.MethodPost, "/api/check-hub", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("expected 200 on /api/check-hub, got %d", rec.Code)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	sc, _ := out["selfCheck"].(map[string]interface{})
	if sc == nil || sc["serverOnline"] != true {
		t.Fatalf("expected selfCheck.serverOnline=true, got %+v", out)
	}
}

func TestBuildLiveMetricsEmptyCurrentJobsJSON(t *testing.T) {
	resetGlobalAgentForTest(t, "http://127.0.0.1:1")

	metrics := buildLiveMetrics()
	if metrics.CurrentJobs == nil {
		t.Fatalf("expected CurrentJobs to be non-nil empty slice when idle")
	}

	raw, err := json.Marshal(metrics)
	if err != nil {
		t.Fatalf("json.Marshal(buildLiveMetrics()) failed: %v", err)
	}
	if !strings.Contains(string(raw), `"currentJobs":[]`) {
		t.Fatalf("expected JSON to contain \"currentJobs\":[], got: %s", string(raw))
	}
}

func TestVerifyWithHubFallbackConcurrentNoDeadlock(t *testing.T) {
	oldSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/agent-hub/agent/self-status" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.URL.Path == "/api/agent-hub/agent/heartbeat" && r.Method == http.MethodPost {
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"ok":          true,
				"nodeId":      "test-win-node",
				"displayName": "ConcurrentPC",
				"alias":       "concurrent-pc",
				"serverTime":  "2026-11-28T00:00:02Z",
				"commands":    []interface{}{},
			})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer oldSrv.Close()

	resetGlobalAgentForTest(t, oldSrv.URL)

	var wg sync.WaitGroup
	done := make(chan struct{})

	// Writers continuously acquiring s.mu.Lock() via SetHeartbeatSuccess
	for w := 0; w < 4; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 40; i++ {
				runtimeState.SetHeartbeatSuccess(oldSrv.URL, 5, "concurrent-pc", "ConcurrentPC", "1.2.0")
				runtimeState.SetLongPollConnected(i%2 == 0)
			}
		}()
	}

	// Readers calling VerifyWithHub() (fallback path) and buildLiveMetrics() concurrently
	for r := 0; r < 4; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 15; i++ {
				res := runtimeState.VerifyWithHub()
				if !res.OK || !res.FallbackUsed {
					t.Errorf("expected fallback VerifyWithHub OK, got %+v", res)
				}
				_ = buildLiveMetrics()
			}
		}()
	}

	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatalf("deadlock detected during concurrent VerifyWithHub fallback + SetHeartbeatSuccess")
	}
}
