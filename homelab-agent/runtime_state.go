package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type TrackedJob struct {
	JobID       string  `json:"jobId"`
	Name        string  `json:"name"`
	Kind        string  `json:"kind"`
	Status      string  `json:"status"`
	Progress    float64 `json:"progress"`
	Message     string  `json:"message"`
	StartedAt   string  `json:"startedAt"`
	UpdatedAt   string  `json:"updatedAt"`
	FinishedAt  string  `json:"finishedAt,omitempty"`
	DurationMs  int64   `json:"durationMs"`
	Cancellable bool    `json:"cancellable"`
}

type AgentLogEntry struct {
	Time    string `json:"time"`
	Level   string `json:"level"`
	Message string `json:"message"`
}

type HubSelfStatusResult struct {
	CheckedAt         string                   `json:"checkedAt"`
	OK                bool                     `json:"ok"`
	Reachable         bool                     `json:"reachable"`
	Registered        bool                     `json:"registered"`
	ServerOnline      bool                     `json:"serverOnline"`
	ServerPaused      bool                     `json:"serverPaused"`
	ServerLongPoll    bool                     `json:"serverLongPoll"`
	Endpoint          string                   `json:"endpoint"`
	Error             string                   `json:"error,omitempty"`
	ServerWorkerState string                   `json:"serverWorkerState"`
	ServerAlias       string                   `json:"serverAlias"`
	ServerDisplayName string                   `json:"serverDisplayName"`
	ServerLastSeenAt  string                   `json:"serverLastSeenAt"`
	HubServerTime     string                   `json:"hubServerTime"`
	HubAgentVersion   string                   `json:"hubAgentVersion"`
	RTTMs             int64                    `json:"rttMs"`
	ServerAgeMs       *int64                   `json:"serverAgeMs"`
	ServerActiveJobs  int                      `json:"serverActiveJobs"`
	ServerMaxJobs     int                      `json:"serverMaxJobs"`
	HubTotalNodes     int                      `json:"hubTotalNodes"`
	HubOnlineNodes    int                      `json:"hubOnlineNodes"`
	ActiveJobs        []map[string]interface{} `json:"activeJobs"`
	RecentJobs        []map[string]interface{} `json:"recentJobs"`
	FallbackUsed      bool                     `json:"fallbackUsed,omitempty"`
	Note              string                   `json:"note,omitempty"`
}

type persistedAgentState struct {
	Paused    bool   `json:"paused"`
	UpdatedAt string `json:"updatedAt"`
}

type agentRuntimeState struct {
	mu                sync.RWMutex
	startedAt         time.Time
	installDir        string
	localUIURL        string
	paused            bool
	lastHeartbeatOK   bool
	lastHeartbeatAt   time.Time
	lastHeartbeatRTT  int64
	lastHeartbeatErr  string
	consecutiveErrors int
	longPollConnected bool
	hubEndpoint       string
	hubAlias          string
	hubDisplayName    string
	hubAgentVersion   string
	hubTotalNodes     int
	hubOnlineNodes    int
	activeJobs        map[string]*TrackedJob
	recentJobs        []TrackedJob
	events            []AgentLogEntry
	lastSelfCheck     *HubSelfStatusResult
	onChange          func()
}

var runtimeState = newAgentRuntimeState()

func newAgentRuntimeState() *agentRuntimeState {
	return &agentRuntimeState{
		startedAt:  time.Now(),
		activeJobs: make(map[string]*TrackedJob),
		recentJobs: make([]TrackedJob, 0, 32),
		events:     make([]AgentLogEntry, 0, 80),
	}
}

func (s *agentRuntimeState) SetOnChange(fn func()) {
	s.mu.Lock()
	s.onChange = fn
	s.mu.Unlock()
}

func (s *agentRuntimeState) notifyChange() {
	s.mu.RLock()
	fn := s.onChange
	s.mu.RUnlock()
	if fn != nil {
		go fn()
	}
}

func (s *agentRuntimeState) SetInstallDir(dir string) {
	dir = strings.TrimSpace(dir)
	s.mu.Lock()
	s.installDir = dir
	s.mu.Unlock()

	if dir != "" {
		statePath := filepath.Join(dir, "agent-state.json")
		if raw, err := os.ReadFile(statePath); err == nil {
			var st persistedAgentState
			if json.Unmarshal(raw, &st) == nil {
				s.mu.Lock()
				s.paused = st.Paused
				s.mu.Unlock()
			}
		}
	}
}

func (s *agentRuntimeState) InstallDir() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.installDir
}

func (s *agentRuntimeState) SetLocalUIURL(u string) {
	s.mu.Lock()
	s.localUIURL = strings.TrimSpace(u)
	s.mu.Unlock()
}

func (s *agentRuntimeState) LocalUIURL() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.localUIURL
}

func (s *agentRuntimeState) SetHeartbeatSuccess(ep string, rttMs int64, alias, displayName, hubVer string) {
	now := time.Now()
	s.mu.Lock()
	prevConnected := s.isConnectedLocked(now)
	s.lastHeartbeatOK = true
	s.lastHeartbeatAt = now
	s.lastHeartbeatRTT = rttMs
	s.lastHeartbeatErr = ""
	s.consecutiveErrors = 0
	if ep != "" {
		s.hubEndpoint = ep
	}
	if alias != "" {
		s.hubAlias = alias
	}
	if displayName != "" {
		s.hubDisplayName = displayName
	}
	if hubVer != "" {
		s.hubAgentVersion = hubVer
	}
	s.mu.Unlock()

	if !prevConnected {
		s.RecordEvent("info", fmt.Sprintf("เชื่อมต่อเครื่องแม่สำเร็จ (%s, %d ms)", ep, rttMs))
		s.notifyChange()
	}
}

func (s *agentRuntimeState) SetHubClusterCounts(totalNodes, onlineNodes int) {
	s.mu.Lock()
	if totalNodes >= 0 {
		s.hubTotalNodes = totalNodes
	}
	if onlineNodes >= 0 {
		s.hubOnlineNodes = onlineNodes
	}
	s.mu.Unlock()
}

func (s *agentRuntimeState) SetHeartbeatError(errMsg string) {
	now := time.Now()
	s.mu.Lock()
	prevConnected := s.isConnectedLocked(now)
	s.lastHeartbeatOK = false
	s.lastHeartbeatErr = strings.TrimSpace(errMsg)
	s.consecutiveErrors++
	count := s.consecutiveErrors
	s.mu.Unlock()

	if prevConnected || count == 1 || count%10 == 0 {
		s.RecordEvent("warn", fmt.Sprintf("ส่ง Heartbeat ไม่สำเร็จ (%d): %s", count, errMsg))
		s.notifyChange()
	}
}

func (s *agentRuntimeState) SetLongPollConnected(v bool) {
	s.mu.Lock()
	changed := s.longPollConnected != v
	s.longPollConnected = v
	s.mu.Unlock()
	if changed {
		s.notifyChange()
	}
}

func (s *agentRuntimeState) SetPaused(paused bool, persist bool) {
	s.mu.Lock()
	changed := s.paused != paused
	s.paused = paused
	installDir := s.installDir
	s.mu.Unlock()

	if persist && installDir != "" {
		_ = os.MkdirAll(installDir, 0755)
		st := persistedAgentState{
			Paused:    paused,
			UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		}
		if raw, err := json.MarshalIndent(st, "", "  "); err == nil {
			_ = os.WriteFile(filepath.Join(installDir, "agent-state.json"), raw, 0600)
		}
	}

	if changed {
		if paused {
			s.RecordEvent("info", "เปลี่ยนสถานะเป็น: พักรับงานชั่วคราว (Paused)")
		} else {
			s.RecordEvent("info", "เปลี่ยนสถานะเป็น: พร้อมรับงาน (Active)")
		}
		s.notifyChange()
	}
}

func (s *agentRuntimeState) IsPaused() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.paused
}

func (s *agentRuntimeState) isConnectedLocked(now time.Time) bool {
	if !s.lastHeartbeatOK || s.lastHeartbeatAt.IsZero() {
		return false
	}
	return now.Sub(s.lastHeartbeatAt) <= 18*time.Second
}

func (s *agentRuntimeState) IsConnected() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.isConnectedLocked(time.Now())
}

func (s *agentRuntimeState) WorkerState() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.isConnectedLocked(time.Now()) {
		return "offline"
	}
	if s.paused {
		return "paused"
	}
	if len(s.activeJobs) > 0 || atomic.LoadInt32(&activeJobsCount) > 0 {
		return "running"
	}
	return "idle"
}

func (s *agentRuntimeState) WorkerStateThai() string {
	switch s.WorkerState() {
	case "offline":
		return "ออฟไลน์ (ขาดการเชื่อมต่อเครื่องแม่)"
	case "paused":
		return "พักรับงานชั่วคราว"
	case "running":
		jobs := s.ActiveJobs()
		if len(jobs) == 1 {
			name := jobs[0].Name
			if name == "" {
				name = jobs[0].JobID
			}
			return fmt.Sprintf("กำลังรันงาน: %s (%.0f%%)", name, jobs[0].Progress)
		}
		if len(jobs) > 1 {
			return fmt.Sprintf("กำลังรัน %d งานพร้อมกัน", len(jobs))
		}
		return "กำลังรันงาน"
	default:
		return "ออนไลน์ · ว่างพร้อมรับงาน"
	}
}

func (s *agentRuntimeState) DisplayName() string {
	s.mu.RLock()
	disp := s.hubDisplayName
	alias := s.hubAlias
	s.mu.RUnlock()
	if disp != "" {
		return disp
	}
	if alias != "" {
		return alias
	}
	sp := getSpecs()
	if sp.Hostname != "" {
		return sp.Hostname
	}
	if agentCfg.NodeID != "" {
		return agentCfg.NodeID
	}
	return "homelab-worker"
}

func (s *agentRuntimeState) StartJob(id, name, kind, msg string, cancellable bool) {
	if strings.TrimSpace(id) == "" {
		return
	}
	nowIso := time.Now().UTC().Format(time.RFC3339)
	if strings.TrimSpace(name) == "" {
		name = id
	}
	if strings.TrimSpace(kind) == "" {
		kind = "generic"
	}
	job := &TrackedJob{
		JobID:       id,
		Name:        name,
		Kind:        kind,
		Status:      "running",
		Progress:    0,
		Message:     msg,
		StartedAt:   nowIso,
		UpdatedAt:   nowIso,
		Cancellable: cancellable,
	}
	s.mu.Lock()
	s.activeJobs[id] = job
	s.mu.Unlock()

	s.RecordEvent("info", fmt.Sprintf("เริ่มงาน [%s] %s", kind, name))
	s.notifyChange()
}

func (s *agentRuntimeState) UpdateJob(id, status string, pct float64, msg string) {
	if strings.TrimSpace(id) == "" {
		return
	}
	nowIso := time.Now().UTC().Format(time.RFC3339)
	s.mu.Lock()
	job, ok := s.activeJobs[id]
	if ok {
		if status != "" {
			job.Status = status
		}
		if pct >= 0 && pct <= 100 {
			job.Progress = pct
		}
		if msg != "" {
			job.Message = msg
		}
		job.UpdatedAt = nowIso
		if stTime, err := time.Parse(time.RFC3339, job.StartedAt); err == nil {
			job.DurationMs = time.Since(stTime).Milliseconds()
		}
	}
	s.mu.Unlock()
	if ok {
		s.notifyChange()
	}
}

func (s *agentRuntimeState) FinishJob(id, status, msg string) {
	if strings.TrimSpace(id) == "" {
		return
	}
	now := time.Now()
	nowIso := now.UTC().Format(time.RFC3339)
	if status == "" {
		status = "completed"
	}

	var finished TrackedJob
	var existed bool
	s.mu.Lock()
	if job, ok := s.activeJobs[id]; ok {
		existed = true
		delete(s.activeJobs, id)
		job.Status = status
		if status == "completed" {
			job.Progress = 100
		}
		if msg != "" {
			job.Message = msg
		}
		job.UpdatedAt = nowIso
		job.FinishedAt = nowIso
		job.Cancellable = false
		if stTime, err := time.Parse(time.RFC3339, job.StartedAt); err == nil {
			job.DurationMs = now.Sub(stTime).Milliseconds()
		}
		finished = *job
		s.recentJobs = append([]TrackedJob{finished}, s.recentJobs...)
		if len(s.recentJobs) > 30 {
			s.recentJobs = s.recentJobs[:30]
		}
	}
	s.mu.Unlock()

	if existed {
		lvl := "info"
		if status != "completed" {
			lvl = "warn"
		}
		s.RecordEvent(lvl, fmt.Sprintf("จบงาน [%s] %s -> %s", finished.Kind, finished.Name, status))
		s.notifyChange()
	}
}

func (s *agentRuntimeState) ActiveJobs() []TrackedJob {
	s.mu.RLock()
	out := make([]TrackedJob, 0, len(s.activeJobs))
	now := time.Now()
	for _, j := range s.activeJobs {
		cp := *j
		if stTime, err := time.Parse(time.RFC3339, cp.StartedAt); err == nil {
			cp.DurationMs = now.Sub(stTime).Milliseconds()
		}
		out = append(out, cp)
	}
	s.mu.RUnlock()

	sort.Slice(out, func(i, j int) bool {
		return out[i].StartedAt > out[j].StartedAt
	})
	return out
}

func (s *agentRuntimeState) RecentJobs() []TrackedJob {
	s.mu.RLock()
	out := make([]TrackedJob, len(s.recentJobs))
	copy(out, s.recentJobs)
	s.mu.RUnlock()
	return out
}

func (s *agentRuntimeState) RecordEvent(level, msg string) {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return
	}
	if level == "" {
		level = "info"
	}
	entry := AgentLogEntry{
		Time:    time.Now().UTC().Format(time.RFC3339),
		Level:   level,
		Message: truncateRunes(msg, 300),
	}
	s.mu.Lock()
	s.events = append([]AgentLogEntry{entry}, s.events...)
	if len(s.events) > 80 {
		s.events = s.events[:80]
	}
	s.mu.Unlock()
}

func (s *agentRuntimeState) Events() []AgentLogEntry {
	s.mu.RLock()
	out := make([]AgentLogEntry, len(s.events))
	copy(out, s.events)
	s.mu.RUnlock()
	return out
}

func (s *agentRuntimeState) LastSelfCheck() *HubSelfStatusResult {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.lastSelfCheck == nil {
		return nil
	}
	cp := *s.lastSelfCheck
	return &cp
}

func (s *agentRuntimeState) VerifyWithHub() *HubSelfStatusResult {
	nowIso := time.Now().UTC().Format(time.RFC3339)
	res := &HubSelfStatusResult{
		CheckedAt:  nowIso,
		ActiveJobs: []map[string]interface{}{},
		RecentJobs: []map[string]interface{}{},
	}

	if httpClient == nil {
		initHTTPClients()
	}

	path := fmt.Sprintf("/api/agent-hub/agent/self-status?nodeId=%s", url.QueryEscape(agentCfg.NodeID))
	t0 := time.Now()
	resp, ep, err := doHubRequest(httpClient, "GET", path, nil, "")
	rttMs := time.Since(t0).Milliseconds()
	res.RTTMs = rttMs
	res.Endpoint = ep

	if err != nil {
		res.Error = err.Error()
		s.mu.Lock()
		s.lastSelfCheck = res
		s.mu.Unlock()
		s.RecordEvent("warn", "เช็กสถานะกับเครื่องแม่ไม่สำเร็จ: "+err.Error())
		return res
	}
	defer resp.Body.Close()

	// Fallback if Hub is still running v1.1.0 without /api/agent-hub/agent/self-status
	if resp.StatusCode == 404 || resp.StatusCode == 405 {
		_, _ = io.Copy(io.Discard, resp.Body)
		return s.verifyWithHubFallback(nowIso)
	}

	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if resp.StatusCode != 200 {
		res.Reachable = true
		res.Error = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(bodyBytes)))
		s.mu.Lock()
		s.lastSelfCheck = res
		s.mu.Unlock()
		s.RecordEvent("warn", "เครื่องแม่ตอบกลับผิดพลาด: "+res.Error)
		return res
	}

	var parsed struct {
		OK                bool                     `json:"ok"`
		Registered        bool                     `json:"registered"`
		Online            bool                     `json:"online"`
		Paused            bool                     `json:"paused"`
		WorkerState       string                   `json:"workerState"`
		Alias             string                   `json:"alias"`
		DisplayName       string                   `json:"displayName"`
		LastSeenAt        string                   `json:"lastSeenAt"`
		AgeMs             *int64                   `json:"ageMs"`
		LongPollConnected bool                     `json:"longPollConnected"`
		ActiveJobs        int                      `json:"activeJobs"`
		MaxJobs           int                      `json:"maxJobs"`
		CurrentJobs       []map[string]interface{} `json:"currentJobs"`
		RecentJobs        []map[string]interface{} `json:"recentJobs"`
		ServerTime        string                   `json:"serverTime"`
		Hub               struct {
			ServerTime   string `json:"serverTime"`
			AgentVersion string `json:"agentVersion"`
			TotalNodes   int    `json:"totalNodes"`
			OnlineNodes  int    `json:"onlineNodes"`
		} `json:"hub"`
	}

	if uErr := json.Unmarshal(bodyBytes, &parsed); uErr != nil {
		res.Reachable = true
		res.Error = "invalid JSON from hub: " + uErr.Error()
		s.mu.Lock()
		s.lastSelfCheck = res
		s.mu.Unlock()
		return res
	}

	res.OK = parsed.OK
	res.Reachable = true
	res.Registered = parsed.Registered
	res.ServerOnline = parsed.Online
	res.ServerPaused = parsed.Paused
	res.ServerLongPoll = parsed.LongPollConnected
	res.ServerWorkerState = parsed.WorkerState
	res.ServerAlias = parsed.Alias
	res.ServerDisplayName = parsed.DisplayName
	res.ServerLastSeenAt = parsed.LastSeenAt
	res.ServerAgeMs = parsed.AgeMs
	res.ServerActiveJobs = parsed.ActiveJobs
	res.ServerMaxJobs = parsed.MaxJobs
	if parsed.Hub.ServerTime != "" {
		res.HubServerTime = parsed.Hub.ServerTime
	} else {
		res.HubServerTime = parsed.ServerTime
	}
	res.HubAgentVersion = parsed.Hub.AgentVersion
	res.HubTotalNodes = parsed.Hub.TotalNodes
	res.HubOnlineNodes = parsed.Hub.OnlineNodes
	if parsed.CurrentJobs != nil {
		res.ActiveJobs = parsed.CurrentJobs
	}
	if parsed.RecentJobs != nil {
		res.RecentJobs = parsed.RecentJobs
	}

	s.mu.Lock()
	s.lastSelfCheck = res
	if parsed.Alias != "" {
		s.hubAlias = parsed.Alias
	}
	if parsed.DisplayName != "" {
		s.hubDisplayName = parsed.DisplayName
	}
	if parsed.Hub.AgentVersion != "" {
		s.hubAgentVersion = parsed.Hub.AgentVersion
	}
	if parsed.Hub.TotalNodes > 0 {
		s.hubTotalNodes = parsed.Hub.TotalNodes
		s.hubOnlineNodes = parsed.Hub.OnlineNodes
	}
	s.mu.Unlock()

	if res.ServerOnline {
		s.RecordEvent("info", fmt.Sprintf("เช็กเครื่องแม่แล้ว: ออนไลน์ (%s, RTT %d ms)", res.ServerWorkerState, res.RTTMs))
	} else {
		s.RecordEvent("warn", fmt.Sprintf("เช็กเครื่องแม่แล้ว: เครื่องแม่เห็นเป็นออฟไลน์ (registered=%v)", res.Registered))
	}
	return res
}

func (s *agentRuntimeState) verifyWithHubFallback(nowIso string) *HubSelfStatusResult {
	res := &HubSelfStatusResult{
		CheckedAt:    nowIso,
		FallbackUsed: true,
		ActiveJobs:   []map[string]interface{}{},
		RecentJobs:   []map[string]interface{}{},
	}

	t0 := time.Now()
	err := sendHeartbeat()
	rttMs := time.Since(t0).Milliseconds()
	res.RTTMs = rttMs

	endpointMutex.RLock()
	ep := currentEndpoint
	endpointMutex.RUnlock()
	res.Endpoint = ep

	if err != nil {
		res.Error = "Heartbeat fallback failed: " + err.Error()
		s.mu.Lock()
		s.lastSelfCheck = res
		s.mu.Unlock()
		s.RecordEvent("warn", "เช็กสถานะเครื่องแม่ (fallback) ไม่สำเร็จ: "+err.Error())
		return res
	}

	zero := int64(0)
	localJobs := s.ActiveJobs()
	activeMaps := make([]map[string]interface{}, 0, len(localJobs))
	for _, j := range localJobs {
		activeMaps = append(activeMaps, map[string]interface{}{
			"jobId":    j.JobID,
			"name":     j.Name,
			"kind":     j.Kind,
			"status":   j.Status,
			"progress": j.Progress,
			"message":  j.Message,
		})
	}

	res.OK = true
	res.Reachable = true
	res.Registered = true
	res.ServerOnline = true
	res.ServerPaused = s.IsPaused()
	s.mu.RLock()
	res.ServerLongPoll = s.longPollConnected
	res.ServerAlias = s.hubAlias
	res.HubAgentVersion = s.hubAgentVersion
	res.HubTotalNodes = s.hubTotalNodes
	res.HubOnlineNodes = s.hubOnlineNodes
	s.mu.RUnlock()
	res.ServerDisplayName = s.DisplayName()
	res.ServerWorkerState = s.WorkerState()
	res.ServerLastSeenAt = time.Now().UTC().Format(time.RFC3339)
	res.HubServerTime = res.ServerLastSeenAt
	res.ServerAgeMs = &zero
	res.ServerActiveJobs = len(localJobs)
	res.ServerMaxJobs = 1
	res.ActiveJobs = activeMaps
	res.Note = "เครื่องแม่ใช้ API รุ่นเดิม (ยืนยันออนไลน์ผ่าน Heartbeat สำเร็จ)"

	s.mu.Lock()
	s.lastSelfCheck = res
	s.mu.Unlock()
	s.RecordEvent("info", fmt.Sprintf("เช็กเครื่องแม่ผ่าน Heartbeat fallback สำเร็จ (%s, RTT %d ms)", ep, rttMs))
	return res
}

func (s *agentRuntimeState) HubDashboardURL() string {
	endpointMutex.RLock()
	ep := currentEndpoint
	endpointMutex.RUnlock()
	if ep == "" && len(agentCfg.HubURLs) > 0 {
		ep = agentCfg.HubURLs[0]
	}
	if ep == "" {
		return "https://homelab.tail285279.ts.net/agent-hub"
	}
	return strings.TrimRight(ep, "/") + "/agent-hub"
}

func (s *agentRuntimeState) BuildLocalStatusSnapshot() map[string]interface{} {
	now := time.Now()
	s.mu.RLock()
	lastHBAt := ""
	var lastHBAgeMs *int64
	if !s.lastHeartbeatAt.IsZero() {
		lastHBAt = s.lastHeartbeatAt.UTC().Format(time.RFC3339)
		age := now.Sub(s.lastHeartbeatAt).Milliseconds()
		lastHBAgeMs = &age
	}
	hbInfo := map[string]interface{}{
		"ok":                s.lastHeartbeatOK,
		"lastAt":            lastHBAt,
		"ageMs":             lastHBAgeMs,
		"rttMs":             s.lastHeartbeatRTT,
		"consecutiveErrors": s.consecutiveErrors,
		"lastError":         s.lastHeartbeatErr,
		"hubAgentVersion":   s.hubAgentVersion,
		"totalNodes":        s.hubTotalNodes,
		"onlineNodes":       s.hubOnlineNodes,
	}
	alias := s.hubAlias
	longPoll := s.longPollConnected
	localUIURL := s.localUIURL
	installDir := s.installDir
	startedAt := s.startedAt.UTC().Format(time.RFC3339)
	uptimeAgentSec := int64(now.Sub(s.startedAt).Seconds())
	s.mu.RUnlock()

	endpointMutex.RLock()
	ep := currentEndpoint
	endpointMutex.RUnlock()

	return map[string]interface{}{
		"ok":                true,
		"version":           AgentVersion,
		"nodeId":            agentCfg.NodeID,
		"displayName":       s.DisplayName(),
		"alias":             alias,
		"workerState":       s.WorkerState(),
		"workerStateThai":   s.WorkerStateThai(),
		"connected":         s.IsConnected(),
		"paused":            s.IsPaused(),
		"longPollConnected": longPoll,
		"currentEndpoint":   ep,
		"hubUrls":           agentCfg.HubURLs,
		"hubDashboardUrl":   s.HubDashboardURL(),
		"localUiUrl":        localUIURL,
		"installDir":        installDir,
		"startedAt":         startedAt,
		"uptimeAgentSec":    uptimeAgentSec,
		"serverTimeLocal":   now.UTC().Format(time.RFC3339),
		"heartbeat":         hbInfo,
		"specs":             getSpecs(),
		"metrics":           buildLiveMetrics(),
		"activeJobs":        s.ActiveJobs(),
		"recentJobs":        s.RecentJobs(),
		"lastSelfCheck":     s.LastSelfCheck(),
		"events":            s.Events(),
	}
}
