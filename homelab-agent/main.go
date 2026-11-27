package main

import (
	"archive/tar"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"math"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var (
	AgentVersion   = "1.2.0"
	DefaultHubURLs = "https://homelab.tail285279.ts.net,http://100.93.214.79,http://100.93.214.79:8090,http://192.168.1.123,https://192.168.1.123"
	DefaultToken   = "hlag_7f8e9a2b4c6d1e3f5a7b9c0d2e4f6a8b"
)

type DiskInfo struct {
	Mount   string  `json:"mount"`
	Total   uint64  `json:"total"`
	Used    uint64  `json:"used"`
	Free    uint64  `json:"free"`
	UsedPct float64 `json:"usedPct"`
}

type StaticSpecs struct {
	NodeID       string   `json:"nodeId"`
	Hostname     string   `json:"hostname"`
	OS           string   `json:"os"`
	Arch         string   `json:"arch"`
	OSCaption    string   `json:"osCaption"`
	Username     string   `json:"username"`
	CPUModel     string   `json:"cpuModel"`
	CPUCores     int      `json:"cpuCores"`
	CPUThreads   int      `json:"cpuThreads"`
	GPUModel     string   `json:"gpuModel"`
	GPUVramMB    int      `json:"gpuVramMB"`
	HasNvidiaSmi bool     `json:"hasNvidiaSmi"`
	HasNVENC     bool     `json:"hasNvenc"`
	FFmpegPath   string   `json:"ffmpegPath"`
	BlenderPath  string   `json:"blenderPath"`
	NodePath     string   `json:"nodePath"`
	PythonPath   string   `json:"pythonPath"`
	GitPath      string   `json:"gitPath"`
	Capabilities []string `json:"capabilities"`
	IPs          []string `json:"ips"`
	InstallDir   string   `json:"installDir"`
	ExePath      string   `json:"exePath"`
	Version      string   `json:"version"`
}

type LiveMetrics struct {
	CPUPct      float64      `json:"cpuPct"`
	MemTotal    uint64       `json:"memTotal"`
	MemUsed     uint64       `json:"memUsed"`
	MemFree     uint64       `json:"memFree"`
	MemPct      float64      `json:"memPct"`
	Disks       []DiskInfo   `json:"disks"`
	UptimeSec   uint64       `json:"uptimeSec"`
	GPUTempC    int          `json:"gpuTempC"`
	GPUUtilPct  int          `json:"gpuUtilPct"`
	ActiveJobs  int32        `json:"activeJobs"`
	Paused      bool         `json:"paused"`
	WorkerState string       `json:"workerState"`
	CurrentJobs []TrackedJob `json:"currentJobs,omitempty"`
	HubEndpoint string       `json:"hubEndpoint"`
	Timestamp   string       `json:"timestamp"`
}

type HeartbeatPayload struct {
	Specs   StaticSpecs `json:"specs"`
	Metrics LiveMetrics `json:"metrics"`
}

type AgentCommand struct {
	ID        string                 `json:"id"`
	Action    string                 `json:"action"`
	Payload   map[string]interface{} `json:"payload"`
	CreatedAt string                 `json:"createdAt"`
}

type HeartbeatResponse struct {
	OK           bool           `json:"ok"`
	NodeID       string         `json:"nodeId,omitempty"`
	ServerTime   string         `json:"serverTime,omitempty"`
	DisplayName  string         `json:"displayName,omitempty"`
	Alias        string         `json:"alias,omitempty"`
	WorkerState  string         `json:"workerState,omitempty"`
	Paused       bool           `json:"paused,omitempty"`
	AgentVersion string         `json:"agentVersion,omitempty"`
	TotalNodes   int            `json:"totalNodes,omitempty"`
	OnlineNodes  int            `json:"onlineNodes,omitempty"`
	Commands     []AgentCommand `json:"commands"`
}

type CommandResult struct {
	CommandID  string                 `json:"commandId"`
	NodeID     string                 `json:"nodeId"`
	Action     string                 `json:"action"`
	OK         bool                   `json:"ok"`
	Error      string                 `json:"error,omitempty"`
	Data       map[string]interface{} `json:"data,omitempty"`
	DurationMs int64                  `json:"durationMs"`
	FinishedAt string                 `json:"finishedAt"`
}

type AgentConfig struct {
	NodeID  string   `json:"nodeId"`
	HubURLs []string `json:"hubUrls"`
	Token   string   `json:"token"`
}

var (
	cachedSpecs     StaticSpecs
	specsMutex      sync.RWMutex
	activeJobsCount int32
	httpClient      *http.Client
	longPollClient  *http.Client
	transferClient  *http.Client
	currentEndpoint string
	endpointMutex   sync.RWMutex
	executedCmds    sync.Map
	agentCfg        AgentConfig
)

func initHTTPClients() {
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		DialContext: (&net.Dialer{
			Timeout:   4 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          20,
		IdleConnTimeout:       60 * time.Second,
		TLSHandshakeTimeout:   4 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	httpClient = &http.Client{
		Transport: tr,
		Timeout:   12 * time.Second,
	}
	longPollClient = &http.Client{
		Transport: tr,
		Timeout:   35 * time.Second,
	}
	transferClient = &http.Client{
		Transport: tr,
		Timeout:   30 * time.Minute,
	}
}

func loadOrInitConfig(installDir string, flagHub string, flagToken string, flagNodeID string) AgentConfig {
	cfgPath := filepath.Join(installDir, "agent-config.json")
	cfg := AgentConfig{}
	if data, err := os.ReadFile(cfgPath); err == nil {
		_ = json.Unmarshal(data, &cfg)
	}

	if envHub := strings.TrimSpace(os.Getenv("HOMELAB_HUB_URL")); envHub != "" {
		cfg.HubURLs = splitURLs(envHub)
	}
	if flagHub != "" {
		cfg.HubURLs = splitURLs(flagHub)
	}
	if len(cfg.HubURLs) == 0 {
		cfg.HubURLs = splitURLs(DefaultHubURLs)
	}

	if envTok := strings.TrimSpace(os.Getenv("HOMELAB_AGENT_TOKEN")); envTok != "" {
		cfg.Token = envTok
	}
	if flagToken != "" {
		cfg.Token = flagToken
	}
	if cfg.Token == "" {
		cfg.Token = DefaultToken
	}

	if flagNodeID != "" {
		cfg.NodeID = sanitizeNodeID(flagNodeID)
	}
	if cfg.NodeID == "" {
		host, _ := os.Hostname()
		if host == "" {
			host = "node-" + runtime.GOOS
		}
		cfg.NodeID = sanitizeNodeID(host)
	}

	_ = os.MkdirAll(installDir, 0755)
	if out, err := json.MarshalIndent(cfg, "", "  "); err == nil {
		_ = os.WriteFile(cfgPath, out, 0600)
	}
	return cfg
}

func splitURLs(raw string) []string {
	parts := strings.Split(raw, ",")
	var res []string
	seen := map[string]bool{}
	for _, p := range parts {
		u := strings.TrimRight(strings.TrimSpace(p), "/")
		if u != "" && !seen[u] {
			seen[u] = true
			res = append(res, u)
		}
	}
	return res
}

func sanitizeNodeID(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		} else if r == ' ' || r == '.' {
			b.WriteRune('-')
		}
	}
	res := strings.Trim(b.String(), "-")
	if res == "" {
		return "worker-node"
	}
	return res
}

func getLocalIPs() []string {
	var ips []string
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ips
	}
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ip4 := ipnet.IP.To4(); ip4 != nil {
				s := ip4.String()
				if strings.HasPrefix(s, "169.254.") {
					continue
				}
				ips = append(ips, s)
			}
		}
	}
	return ips
}

func detectBinaryPath(names ...string) string {
	for _, name := range names {
		if p, err := exec.LookPath(name); err == nil && p != "" {
			return p
		}
	}
	if runtime.GOOS == "windows" {
		home, _ := os.UserHomeDir()
		localAppData := os.Getenv("LOCALAPPDATA")
		progFiles := os.Getenv("ProgramFiles")
		candidates := []string{}
		for _, name := range names {
			ext := name
			if !strings.HasSuffix(strings.ToLower(ext), ".exe") {
				ext += ".exe"
			}
			candidates = append(candidates,
				filepath.Join(`C:\ffmpeg\bin`, ext),
				filepath.Join(`C:\tools\ffmpeg\bin`, ext),
				filepath.Join(progFiles, "ffmpeg", "bin", ext),
				filepath.Join(progFiles, "nodejs", ext),
				filepath.Join(progFiles, "Git", "cmd", ext),
				filepath.Join(localAppData, "Programs", "Blender", ext),
				filepath.Join(localAppData, "Programs", "Blender", "blender-4.3.2-windows-x64", ext),
				filepath.Join(progFiles, "Blender Foundation", "Blender 4.3", ext),
				filepath.Join(progFiles, "Blender Foundation", "Blender 4.2", ext),
				filepath.Join(`C:\tools\blender`, ext),
				filepath.Join(localAppData, "Microsoft", "WinGet", "Links", ext),
				filepath.Join(home, "scoop", "shims", ext),
				filepath.Join(`C:\ProgramData\chocolatey\bin`, ext),
			)
		}
		for _, c := range candidates {
			if st, err := os.Stat(c); err == nil && !st.IsDir() {
				return c
			}
		}
	}
	return ""
}

func refreshStaticSpecs(installDir string) StaticSpecs {
	host, _ := os.Hostname()
	user := os.Getenv("USERNAME")
	if user == "" {
		user = os.Getenv("USER")
	}
	exePath, _ := os.Executable()

	cpuModel, cpuCores, gpuModel, gpuVramMB, osCaption := collectPlatformStaticSpecs()
	if cpuCores <= 0 {
		cpuCores = runtime.NumCPU()
	}

	caps := []string{"remote-exec", "file-ops", "job-run"}
	hasNvidiaSmi := false
	if _, err := exec.LookPath("nvidia-smi"); err == nil {
		hasNvidiaSmi = true
		caps = append(caps, "nvidia-gpu")
	}

	ffmpegPath := detectBinaryPath("ffmpeg")
	hasNvenc := false
	if ffmpegPath != "" {
		caps = append(caps, "ffmpeg")
		cmd := exec.Command(ffmpegPath, "-hide_banner", "-encoders")
		cmd.SysProcAttr = hideWindowAttr()
		if out, err := cmd.Output(); err == nil {
			if strings.Contains(string(out), "h264_nvenc") {
				hasNvenc = true
				caps = append(caps, "ffmpeg-nvenc")
			}
		}
	}

	nodePath := detectBinaryPath("node")
	if nodePath != "" {
		caps = append(caps, "nodejs", "remotion-render")
	}
	pythonPath := detectBinaryPath("python", "python3")
	if pythonPath != "" {
		caps = append(caps, "python")
	}
	gitPath := detectBinaryPath("git")
	if gitPath != "" {
		caps = append(caps, "git")
	}
	blenderPath := detectBinaryPath("blender")
	if blenderPath != "" {
		caps = append(caps, "blender", "blender-3d")
	}

	specs := StaticSpecs{
		NodeID:       agentCfg.NodeID,
		Hostname:     host,
		OS:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		OSCaption:    osCaption,
		Username:     user,
		CPUModel:     cpuModel,
		CPUCores:     cpuCores,
		CPUThreads:   runtime.NumCPU(),
		GPUModel:     gpuModel,
		GPUVramMB:    gpuVramMB,
		HasNvidiaSmi: hasNvidiaSmi,
		HasNVENC:     hasNvenc,
		FFmpegPath:   ffmpegPath,
		BlenderPath:  blenderPath,
		NodePath:     nodePath,
		PythonPath:   pythonPath,
		GitPath:      gitPath,
		Capabilities: caps,
		IPs:          getLocalIPs(),
		InstallDir:   installDir,
		ExePath:      exePath,
		Version:      AgentVersion,
	}

	specsMutex.Lock()
	cachedSpecs = specs
	specsMutex.Unlock()
	return specs
}

func getSpecs() StaticSpecs {
	specsMutex.RLock()
	defer specsMutex.RUnlock()
	return cachedSpecs
}

func buildLiveMetrics() LiveMetrics {
	cpuPct, memTotal, memUsed, memFree, memPct, disks, uptimeSec, gpuTempC, gpuUtilPct := collectPlatformLiveMetrics()
	endpointMutex.RLock()
	ep := currentEndpoint
	endpointMutex.RUnlock()
	activeJobs := runtimeState.ActiveJobs()
	activeCount := atomic.LoadInt32(&activeJobsCount)
	if int32(len(activeJobs)) > activeCount {
		activeCount = int32(len(activeJobs))
	}
	return LiveMetrics{
		CPUPct:      cpuPct,
		MemTotal:    memTotal,
		MemUsed:     memUsed,
		MemFree:     memFree,
		MemPct:      memPct,
		Disks:       disks,
		UptimeSec:   uptimeSec,
		GPUTempC:    gpuTempC,
		GPUUtilPct:  gpuUtilPct,
		ActiveJobs:  activeCount,
		Paused:      runtimeState.IsPaused(),
		WorkerState: runtimeState.WorkerState(),
		CurrentJobs: activeJobs,
		HubEndpoint: ep,
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
	}
}

func doHubRequest(client *http.Client, method string, relPath string, bodyBytes []byte, contentType string) (*http.Response, string, error) {
	endpointMutex.RLock()
	activeEP := currentEndpoint
	endpointMutex.RUnlock()

	candidates := make([]string, 0, len(agentCfg.HubURLs)+1)
	if activeEP != "" {
		candidates = append(candidates, activeEP)
	}
	for _, u := range agentCfg.HubURLs {
		if u != activeEP {
			candidates = append(candidates, u)
		}
	}

	var lastErr error
	for _, base := range candidates {
		fullURL := base + relPath
		var bodyReader io.Reader
		if bodyBytes != nil {
			bodyReader = bytes.NewReader(bodyBytes)
		}
		req, err := http.NewRequest(method, fullURL, bodyReader)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("X-Agent-Token", agentCfg.Token)
		req.Header.Set("X-Agent-Node", agentCfg.NodeID)
		req.Header.Set("X-Agent-Version", AgentVersion)
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		} else if bodyBytes != nil {
			req.Header.Set("Content-Type", "application/json")
		}

		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode >= 502 && resp.StatusCode <= 504 {
			resp.Body.Close()
			lastErr = fmt.Errorf("gateway status %d from %s", resp.StatusCode, base)
			continue
		}

		endpointMutex.Lock()
		currentEndpoint = base
		endpointMutex.Unlock()
		return resp, base, nil
	}
	return nil, "", lastErr
}

func sendHeartbeat() error {
	payload := HeartbeatPayload{
		Specs:   getSpecs(),
		Metrics: buildLiveMetrics(),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		runtimeState.SetHeartbeatError(err.Error())
		return err
	}
	t0 := time.Now()
	resp, ep, err := doHubRequest(httpClient, "POST", "/api/agent-hub/agent/heartbeat", data, "application/json")
	rttMs := time.Since(t0).Milliseconds()
	if err != nil {
		runtimeState.SetHeartbeatError(err.Error())
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		hbErr := fmt.Errorf("heartbeat HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
		runtimeState.SetHeartbeatError(hbErr.Error())
		return hbErr
	}
	var hbResp HeartbeatResponse
	if err := json.NewDecoder(resp.Body).Decode(&hbResp); err == nil {
		runtimeState.SetHeartbeatSuccess(ep, rttMs, hbResp.Alias, hbResp.DisplayName, hbResp.AgentVersion)
		if hbResp.TotalNodes > 0 {
			runtimeState.SetHubClusterCounts(hbResp.TotalNodes, hbResp.OnlineNodes)
		}
		for _, cmd := range hbResp.Commands {
			dispatchCommandAsync(cmd)
		}
	} else {
		runtimeState.SetHeartbeatSuccess(ep, rttMs, "", "", "")
	}
	return nil
}

func pollLoop(stopCh <-chan struct{}) {
	for {
		select {
		case <-stopCh:
			runtimeState.SetLongPollConnected(false)
			return
		default:
		}
		path := fmt.Sprintf("/api/agent-hub/agent/poll?nodeId=%s&timeout=25", url.QueryEscape(agentCfg.NodeID))
		resp, _, err := doHubRequest(longPollClient, "GET", path, nil, "")
		if err != nil {
			runtimeState.SetLongPollConnected(false)
			select {
			case <-stopCh:
				return
			case <-time.After(3 * time.Second):
			}
			continue
		}
		runtimeState.SetLongPollConnected(true)
		var pollResp HeartbeatResponse
		err = json.NewDecoder(resp.Body).Decode(&pollResp)
		resp.Body.Close()
		if err != nil {
			runtimeState.SetLongPollConnected(false)
			select {
			case <-stopCh:
				return
			case <-time.After(2 * time.Second):
			}
			continue
		}
		for _, cmd := range pollResp.Commands {
			dispatchCommandAsync(cmd)
		}
	}
}

func dispatchCommandAsync(cmd AgentCommand) {
	if cmd.ID == "" {
		return
	}
	if _, loaded := executedCmds.LoadOrStore(cmd.ID, time.Now()); loaded {
		return
	}
	go func(c AgentCommand) {
		started := time.Now()
		data, err := executeCommand(c)
		res := CommandResult{
			CommandID:  c.ID,
			NodeID:     agentCfg.NodeID,
			Action:     c.Action,
			OK:         err == nil,
			Data:       data,
			DurationMs: time.Since(started).Milliseconds(),
			FinishedAt: time.Now().UTC().Format(time.RFC3339),
		}
		if err != nil {
			res.Error = err.Error()
		}
		body, _ := json.Marshal(res)
		resp, _, postErr := doHubRequest(httpClient, "POST", "/api/agent-hub/agent/result", body, "application/json")
		if postErr == nil && resp != nil {
			resp.Body.Close()
		}
	}(cmd)
}

func getString(m map[string]interface{}, key string, def string) string {
	if m == nil {
		return def
	}
	if v, ok := m[key]; ok && v != nil {
		if s, ok := v.(string); ok {
			return s
		}
		return fmt.Sprintf("%v", v)
	}
	return def
}

func getInt(m map[string]interface{}, key string, def int) int {
	if m == nil {
		return def
	}
	if v, ok := m[key]; ok && v != nil {
		switch val := v.(type) {
		case float64:
			return int(val)
		case int:
			return val
		case int64:
			return int(val)
		case string:
			var n int
			if _, err := fmt.Sscanf(val, "%d", &n); err == nil {
				return n
			}
		}
	}
	return def
}

func getBool(m map[string]interface{}, key string, def bool) bool {
	if m == nil {
		return def
	}
	if v, ok := m[key]; ok && v != nil {
		switch val := v.(type) {
		case bool:
			return val
		case string:
			return val == "true" || val == "1"
		case float64:
			return val != 0
		}
	}
	return def
}

func executeCommand(cmd AgentCommand) (map[string]interface{}, error) {
	switch cmd.Action {
	case "ping":
		return map[string]interface{}{
			"pong":      true,
			"nodeId":    agentCfg.NodeID,
			"version":   AgentVersion,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		}, nil

	case "sysinfo":
		specs := refreshStaticSpecs(getSpecs().InstallDir)
		metrics := buildLiveMetrics()
		return map[string]interface{}{
			"specs":    specs,
			"metrics":  metrics,
			"topProcs": getPlatformTopProcs(),
		}, nil

	case "exec":
		return handleExecCommand(cmd.Payload)

	case "fs.list":
		return handleFsList(cmd.Payload)

	case "fs.read":
		return handleFsRead(cmd.Payload)

	case "fs.write":
		return handleFsWrite(cmd.Payload)

	case "fs.edit":
		return handleFsEdit(cmd.Payload)

	case "fs.delete":
		return handleFsDelete(cmd.Payload)

	case "fs.mkdir":
		return handleFsMkdir(cmd.Payload)

	case "render.ffmpeg":
		return handleRenderFFmpeg(cmd.Payload)

	case "render.blender":
		return handleRenderBlender(cmd.Payload)

	case "render.remotion":
		return handleRenderRemotion(cmd.Payload)

	case "job.run":
		return handleJobRun(cmd.Payload)

	case "job.cancel":
		return handleJobCancel(cmd.Payload)

	case "self-update":
		return handleSelfUpdate(cmd.Payload)

	case "agent.status":
		return runtimeState.BuildLocalStatusSnapshot(), nil

	case "agent.set-pause":
		nextPaused := !runtimeState.IsPaused()
		if _, exists := cmd.Payload["paused"]; exists {
			nextPaused = getBool(cmd.Payload, "paused", nextPaused)
		}
		runtimeState.SetPaused(nextPaused, true)
		go func() {
			_ = sendHeartbeat()
		}()
		return map[string]interface{}{
			"paused":          nextPaused,
			"workerState":     runtimeState.WorkerState(),
			"workerStateThai": runtimeState.WorkerStateThai(),
		}, nil

	default:
		return nil, fmt.Errorf("unknown action: %s", cmd.Action)
	}
}

func handleExecCommand(p map[string]interface{}) (map[string]interface{}, error) {
	rawCmd := strings.TrimSpace(getString(p, "command", ""))
	if rawCmd == "" {
		rawCmd = strings.TrimSpace(getString(p, "cmd", ""))
	}
	if rawCmd == "" {
		return nil, fmt.Errorf("missing command")
	}
	shell := strings.ToLower(strings.TrimSpace(getString(p, "shell", "auto")))
	cwd := strings.TrimSpace(getString(p, "cwd", ""))
	timeoutSec := getInt(p, "timeoutSec", 300)
	if timeoutSec <= 0 || timeoutSec > 7200 {
		timeoutSec = 300
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	var execCmd *exec.Cmd
	if runtime.GOOS == "windows" {
		if shell == "cmd" {
			execCmd = exec.CommandContext(ctx, "cmd.exe", "/C", rawCmd)
		} else {
			wrapped := "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; " + rawCmd
			execCmd = exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", wrapped)
		}
	} else {
		if shell == "sh" {
			execCmd = exec.CommandContext(ctx, "/bin/sh", "-c", rawCmd)
		} else {
			execCmd = exec.CommandContext(ctx, "/bin/bash", "-c", rawCmd)
		}
	}

	execCmd.SysProcAttr = hideWindowAttr()
	if cwd != "" {
		if st, err := os.Stat(cwd); err == nil && st.IsDir() {
			execCmd.Dir = cwd
		}
	}
	if execCmd.Dir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			execCmd.Dir = home
		}
	}

	var stdoutBuf, stderrBuf bytes.Buffer
	execCmd.Stdout = &stdoutBuf
	execCmd.Stderr = &stderrBuf

	started := time.Now()
	err := execCmd.Run()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}

	stdoutStr := stdoutBuf.String()
	stderrStr := stderrBuf.String()
	if len(stdoutStr) > 512*1024 {
		stdoutStr = stdoutStr[:512*1024] + "\n...[truncated]..."
	}
	if len(stderrStr) > 256*1024 {
		stderrStr = stderrStr[:256*1024] + "\n...[truncated]..."
	}

	actualDir := execCmd.Dir
	return map[string]interface{}{
		"command":    rawCmd,
		"cwd":        actualDir,
		"exitCode":   exitCode,
		"stdout":     stdoutStr,
		"stderr":     stderrStr,
		"durationMs": time.Since(started).Milliseconds(),
		"timedOut":   ctx.Err() == context.DeadlineExceeded,
	}, nil
}

func handleFsList(p map[string]interface{}) (map[string]interface{}, error) {
	reqPath := strings.TrimSpace(getString(p, "path", ""))
	home, _ := os.UserHomeDir()

	if runtime.GOOS == "windows" && (reqPath == "" || reqPath == "/" || reqPath == "drives") {
		var items []map[string]interface{}
		for _, d := range buildLiveMetrics().Disks {
			items = append(items, map[string]interface{}{
				"name":  d.Mount + `\`,
				"path":  d.Mount + `\`,
				"isDir": true,
				"kind":  "drive",
				"size":  d.Total,
				"free":  d.Free,
			})
		}
		if home != "" {
			quickDirs := []struct{ label, rel string }{
				{"🏠 User Home (" + filepath.Base(home) + ")", ""},
				{"🖥️ Desktop", "Desktop"},
				{"📥 Downloads", "Downloads"},
				{"📄 Documents", "Documents"},
			}
			for _, q := range quickDirs {
				full := home
				if q.rel != "" {
					full = filepath.Join(home, q.rel)
				}
				if st, err := os.Stat(full); err == nil && st.IsDir() {
					items = append(items, map[string]interface{}{
						"name":  q.label,
						"path":  full,
						"isDir": true,
						"kind":  "shortcut",
					})
				}
			}
		}
		return map[string]interface{}{
			"path":    "ROOT",
			"parent":  "",
			"homeDir": home,
			"items":   items,
		}, nil
	}

	if reqPath == "" || reqPath == "~" {
		reqPath = home
	}
	absPath, err := filepath.Abs(reqPath)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(absPath)
	if err != nil {
		return nil, err
	}

	items := make([]map[string]interface{}, 0, len(entries))
	for _, e := range entries {
		info, _ := e.Info()
		var size int64
		var modTime string
		if info != nil {
			size = info.Size()
			modTime = info.ModTime().UTC().Format(time.RFC3339)
		}
		items = append(items, map[string]interface{}{
			"name":    e.Name(),
			"path":    filepath.Join(absPath, e.Name()),
			"isDir":   e.IsDir(),
			"size":    size,
			"modTime": modTime,
		})
		if len(items) >= 1000 {
			break
		}
	}

	parent := filepath.Dir(absPath)
	if parent == absPath {
		if runtime.GOOS == "windows" {
			parent = "drives"
		} else {
			parent = ""
		}
	}
	return map[string]interface{}{
		"path":    absPath,
		"parent":  parent,
		"homeDir": home,
		"items":   items,
	}, nil
}

func handleFsRead(p map[string]interface{}) (map[string]interface{}, error) {
	reqPath := strings.TrimSpace(getString(p, "path", ""))
	if reqPath == "" {
		return nil, fmt.Errorf("missing path")
	}
	encoding := strings.ToLower(getString(p, "encoding", "utf8"))
	maxBytes := getInt(p, "maxBytes", 2*1024*1024)
	if maxBytes <= 0 || maxBytes > 15*1024*1024 {
		maxBytes = 2 * 1024 * 1024
	}

	st, err := os.Stat(reqPath)
	if err != nil {
		return nil, err
	}
	if st.IsDir() {
		return nil, fmt.Errorf("path is a directory: %s", reqPath)
	}

	f, err := os.Open(reqPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	data, err := io.ReadAll(io.LimitReader(f, int64(maxBytes)+1))
	if err != nil {
		return nil, err
	}
	truncated := false
	if len(data) > maxBytes {
		data = data[:maxBytes]
		truncated = true
	}

	res := map[string]interface{}{
		"path":      reqPath,
		"size":      st.Size(),
		"modTime":   st.ModTime().UTC().Format(time.RFC3339),
		"truncated": truncated,
	}
	if encoding == "base64" {
		res["contentBase64"] = base64.StdEncoding.EncodeToString(data)
		res["encoding"] = "base64"
	} else {
		res["content"] = string(data)
		res["encoding"] = "utf8"
	}
	return res, nil
}

func handleFsWrite(p map[string]interface{}) (map[string]interface{}, error) {
	reqPath := strings.TrimSpace(getString(p, "path", ""))
	if reqPath == "" {
		return nil, fmt.Errorf("missing path")
	}
	encoding := strings.ToLower(getString(p, "encoding", "utf8"))
	appendMode := getBool(p, "append", false)
	createDirs := getBool(p, "createDirs", true)

	var rawBytes []byte
	if encoding == "base64" {
		b64 := getString(p, "contentBase64", getString(p, "content", ""))
		decoded, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return nil, fmt.Errorf("invalid base64 content: %w", err)
		}
		rawBytes = decoded
	} else {
		rawBytes = []byte(getString(p, "content", ""))
	}

	dir := filepath.Dir(reqPath)
	if createDirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, err
		}
	}

	if appendMode {
		f, err := os.OpenFile(reqPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
		if err != nil {
			return nil, err
		}
		_, err = f.Write(rawBytes)
		f.Close()
		if err != nil {
			return nil, err
		}
	} else {
		tmpPath := fmt.Sprintf("%s.tmp-%d", reqPath, time.Now().UnixNano())
		if err := os.WriteFile(tmpPath, rawBytes, 0644); err != nil {
			return nil, err
		}
		if err := os.Rename(tmpPath, reqPath); err != nil {
			_ = os.Remove(tmpPath)
			if err2 := os.WriteFile(reqPath, rawBytes, 0644); err2 != nil {
				return nil, err2
			}
		}
	}

	st, _ := os.Stat(reqPath)
	var finalSize int64
	if st != nil {
		finalSize = st.Size()
	}
	return map[string]interface{}{
		"path":         reqPath,
		"bytesWritten": len(rawBytes),
		"size":         finalSize,
	}, nil
}

func handleFsEdit(p map[string]interface{}) (map[string]interface{}, error) {
	reqPath := strings.TrimSpace(getString(p, "path", ""))
	target := getString(p, "target", "")
	replacement := getString(p, "replacement", "")
	if reqPath == "" || target == "" {
		return nil, fmt.Errorf("path and target are required")
	}

	raw, err := os.ReadFile(reqPath)
	if err != nil {
		return nil, err
	}
	content := string(raw)
	count := strings.Count(content, target)
	var updated string

	if count > 0 {
		updated = strings.ReplaceAll(content, target, replacement)
	} else {
		// Handle Windows CRLF vs LF differences seamlessly
		normContent := strings.ReplaceAll(content, "\r\n", "\n")
		normTarget := strings.ReplaceAll(target, "\r\n", "\n")
		normReplacement := strings.ReplaceAll(replacement, "\r\n", "\n")
		count = strings.Count(normContent, normTarget)
		if count == 0 {
			return nil, fmt.Errorf("target string not found in %s", reqPath)
		}
		updated = strings.ReplaceAll(normContent, normTarget, normReplacement)
		if strings.Contains(content, "\r\n") {
			updated = strings.ReplaceAll(updated, "\n", "\r\n")
		}
	}

	if err := os.WriteFile(reqPath, []byte(updated), 0644); err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"path":         reqPath,
		"replacements": count,
		"newSize":      len(updated),
	}, nil
}

func handleFsDelete(p map[string]interface{}) (map[string]interface{}, error) {
	reqPath := strings.TrimSpace(getString(p, "path", ""))
	if reqPath == "" {
		return nil, fmt.Errorf("missing path")
	}
	recursive := getBool(p, "recursive", false)
	var err error
	if recursive {
		err = os.RemoveAll(reqPath)
	} else {
		err = os.Remove(reqPath)
	}
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"path": reqPath, "deleted": true}, nil
}

func handleFsMkdir(p map[string]interface{}) (map[string]interface{}, error) {
	reqPath := strings.TrimSpace(getString(p, "path", ""))
	if reqPath == "" {
		return nil, fmt.Errorf("missing path")
	}
	if err := os.MkdirAll(reqPath, 0755); err != nil {
		return nil, err
	}
	return map[string]interface{}{"path": reqPath, "created": true}, nil
}

func reportJobProgress(jobID string, status string, pct float64, message string) {
	if jobID == "" {
		return
	}
	if status == "completed" || status == "failed" || status == "cancelled" || status == "timeout" {
		runtimeState.FinishJob(jobID, status, message)
	} else {
		runtimeState.UpdateJob(jobID, status, pct, message)
	}
	body, _ := json.Marshal(map[string]interface{}{
		"jobId":      jobID,
		"nodeId":     agentCfg.NodeID,
		"status":     status,
		"progress":   pct,
		"message":    message,
		"reportedAt": time.Now().UTC().Format(time.RFC3339),
	})
	resp, _, err := doHubRequest(httpClient, "POST", "/api/agent-hub/agent/job-progress", body, "application/json")
	if err == nil && resp != nil {
		resp.Body.Close()
	}
}

func handleRenderFFmpeg(p map[string]interface{}) (map[string]interface{}, error) {
	atomic.AddInt32(&activeJobsCount, 1)
	defer atomic.AddInt32(&activeJobsCount, -1)

	specs := getSpecs()
	if specs.FFmpegPath == "" {
		return nil, fmt.Errorf("ffmpeg is not installed on node %s", agentCfg.NodeID)
	}

	jobID := getString(p, "jobId", fmt.Sprintf("job-%d", time.Now().Unix()))
	outputName := getString(p, "outputName", jobID+".mp4")
	runtimeState.StartJob(jobID, outputName, "ffmpeg", "เตรียมเรนเดอร์ FFmpeg...", false)
	defer runtimeState.FinishJob(jobID, "failed", "งาน FFmpeg จบลงก่อนกำหนด")

	inputURL := getString(p, "inputUrl", "")
	useNvenc := getBool(p, "useNvenc", specs.HasNVENC)
	crf := getInt(p, "crf", 20)
	preset := getString(p, "preset", "")
	extraArgsRaw, _ := p["extraArgs"].([]interface{})

	workDir := filepath.Join(specs.InstallDir, "jobs", jobID)
	if err := os.MkdirAll(workDir, 0755); err != nil {
		return nil, err
	}
	defer os.RemoveAll(workDir)

	inFile := filepath.Join(workDir, "input_source.mp4")
	outFile := filepath.Join(workDir, outputName)

	if inputURL != "" {
		reportJobProgress(jobID, "downloading", 10, "กำลังดึงไฟล์ต้นฉบับจาก Homelab...")
		var resp *http.Response
		var err error
		if strings.HasPrefix(inputURL, "http://") || strings.HasPrefix(inputURL, "https://") {
			req, _ := http.NewRequest("GET", inputURL, nil)
			req.Header.Set("X-Agent-Token", agentCfg.Token)
			resp, err = transferClient.Do(req)
		} else {
			resp, _, err = doHubRequest(transferClient, "GET", inputURL, nil, "")
		}
		if err != nil {
			reportJobProgress(jobID, "failed", 0, "ดาวน์โหลดไฟล์ต้นฉบับไม่สำเร็จ: "+err.Error())
			return nil, err
		}
		if resp.StatusCode != 200 {
			resp.Body.Close()
			return nil, fmt.Errorf("input download returned HTTP %d", resp.StatusCode)
		}
		f, err := os.Create(inFile)
		if err != nil {
			resp.Body.Close()
			return nil, err
		}
		_, copyErr := io.Copy(f, resp.Body)
		f.Close()
		resp.Body.Close()
		if copyErr != nil {
			return nil, copyErr
		}
	} else if localInput := getString(p, "localInput", ""); localInput != "" {
		inFile = localInput
	} else {
		// Generate a synthetic benchmark/test video if testMode=true
		if getBool(p, "testMode", false) {
			inFile = ""
		} else {
			return nil, fmt.Errorf("missing inputUrl or localInput")
		}
	}

	encoder := "libx264"
	if useNvenc && specs.HasNVENC {
		encoder = "h264_nvenc"
	}

	reportJobProgress(jobID, "rendering", 35, fmt.Sprintf("กำลังเรนเดอร์ด้วย %s บน %s...", encoder, specs.NodeID))

	var args []string
	args = append(args, "-y", "-hide_banner")
	if inFile == "" {
		dur := getInt(p, "durationSec", 5)
		if dur <= 0 || dur > 60 {
			dur = 5
		}
		args = append(args, "-f", "lavfi", "-i", fmt.Sprintf("testsrc2=size=1080x1920:rate=30:duration=%d", dur))
		args = append(args, "-f", "lavfi", "-i", fmt.Sprintf("sine=frequency=440:duration=%d", dur))
	} else {
		args = append(args, "-i", inFile)
	}

	for _, a := range extraArgsRaw {
		if s, ok := a.(string); ok && s != "" {
			args = append(args, s)
		}
	}

	if encoder == "h264_nvenc" {
		if preset == "" {
			preset = "p4"
		}
		args = append(args, "-c:v", "h264_nvenc", "-preset", preset, "-rc", "vbr", "-cq", fmt.Sprintf("%d", crf), "-pix_fmt", "yuv420p")
	} else {
		if preset == "" {
			preset = "veryfast"
		}
		args = append(args, "-c:v", "libx264", "-preset", preset, "-crf", fmt.Sprintf("%d", crf), "-pix_fmt", "yuv420p")
	}
	args = append(args, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outFile)

	startedRender := time.Now()
	ffCmd := exec.Command(specs.FFmpegPath, args...)
	ffCmd.SysProcAttr = hideWindowAttr()
	outLog, err := ffCmd.CombinedOutput()
	if err != nil {
		// If NVENC failed (e.g. driver session limit), fallback to libx264 automatically
		if encoder == "h264_nvenc" {
			encoder = "libx264 (fallback)"
			var fbArgs []string
			fbArgs = append(fbArgs, "-y", "-hide_banner")
			if inFile == "" {
				dur := getInt(p, "durationSec", 5)
				fbArgs = append(fbArgs, "-f", "lavfi", "-i", fmt.Sprintf("testsrc2=size=1080x1920:rate=30:duration=%d", dur))
				fbArgs = append(fbArgs, "-f", "lavfi", "-i", fmt.Sprintf("sine=frequency=440:duration=%d", dur))
			} else {
				fbArgs = append(fbArgs, "-i", inFile)
			}
			fbArgs = append(fbArgs, "-c:v", "libx264", "-preset", "veryfast", "-crf", fmt.Sprintf("%d", crf), "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outFile)
			ffCmd2 := exec.Command(specs.FFmpegPath, fbArgs...)
			ffCmd2.SysProcAttr = hideWindowAttr()
			outLog, err = ffCmd2.CombinedOutput()
		}
		if err != nil {
			msg := string(outLog)
			if len(msg) > 2000 {
				msg = msg[len(msg)-2000:]
			}
			reportJobProgress(jobID, "failed", 0, "FFmpeg error: "+msg)
			return nil, fmt.Errorf("ffmpeg failed: %v (%s)", err, msg)
		}
	}
	renderDurationMs := time.Since(startedRender).Milliseconds()

	st, err := os.Stat(outFile)
	if err != nil {
		return nil, err
	}

	reportJobProgress(jobID, "uploading", 85, "เรนเดอร์เสร็จแล้ว กำลังส่งไฟล์ MP4 กลับไปยัง Homelab...")

	outBytes, err := os.ReadFile(outFile)
	if err != nil {
		return nil, err
	}

	var mpBuf bytes.Buffer
	mw := multipart.NewWriter(&mpBuf)
	_ = mw.WriteField("jobId", jobID)
	_ = mw.WriteField("nodeId", agentCfg.NodeID)
	_ = mw.WriteField("encoder", encoder)
	_ = mw.WriteField("renderDurationMs", fmt.Sprintf("%d", renderDurationMs))
	fw, err := mw.CreateFormFile("file", outputName)
	if err != nil {
		return nil, err
	}
	if _, err := fw.Write(outBytes); err != nil {
		return nil, err
	}
	mw.Close()

	upPath := fmt.Sprintf("/api/agent-hub/agent/job-upload?jobId=%s&nodeId=%s&filename=%s",
		url.QueryEscape(jobID), url.QueryEscape(agentCfg.NodeID), url.QueryEscape(outputName))
	upResp, _, upErr := doHubRequest(transferClient, "POST", upPath, mpBuf.Bytes(), mw.FormDataContentType())
	if upErr != nil {
		reportJobProgress(jobID, "failed", 85, "อัปโหลดไฟล์กลับไม่สำเร็จ: "+upErr.Error())
		return nil, upErr
	}
	defer upResp.Body.Close()
	var upData map[string]interface{}
	_ = json.NewDecoder(upResp.Body).Decode(&upData)

	reportJobProgress(jobID, "completed", 100, fmt.Sprintf("เรนเดอร์สำเร็จด้วย %s (%d ms)", encoder, renderDurationMs))

	return map[string]interface{}{
		"jobId":            jobID,
		"nodeId":           agentCfg.NodeID,
		"encoder":          encoder,
		"outputSize":       st.Size(),
		"renderDurationMs": renderDurationMs,
		"hubUpload":        upData,
	}, nil
}

const blenderLivePrelude = `# Homelab Blender Live Stream Prelude (auto-injected by homelab-agent)
import builtins
import os
import shutil
import sys
import time

try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

_LIVE_FILE = os.environ.get("BLENDER_LIVE_FILE", "")
_PREVIEW_FILE = os.environ.get("BLENDER_PREVIEW_FILE", "")
_LAST_LIVE_TS = 0.0


def lab_progress(pct, msg=""):
    try:
        p = int(max(0, min(100, float(pct))))
        text = f"LAB_PROGRESS {p} {msg}".strip()
        print(text, flush=True)
    except Exception:
        pass


def _atomic_copy(src, dst):
    if not src or not dst:
        return False
    try:
        if os.path.abspath(src) == os.path.abspath(dst):
            return os.path.isfile(dst) and os.path.getsize(dst) > 0
        if not os.path.isfile(src) or os.path.getsize(src) == 0:
            return False
        tmp = dst + ".tmp"
        shutil.copy2(src, tmp)
        os.replace(tmp, dst)
        return True
    except Exception:
        return False


def lab_capture_live(scene=None, force=False):
    global _LAST_LIVE_TS
    if not _LIVE_FILE:
        return False
    now = time.monotonic()
    if not force and (now - _LAST_LIVE_TS) < 1.0:
        return False
    try:
        import bpy

        if scene is None:
            scene = getattr(bpy.context, "scene", None)

        candidates = []
        if scene is not None and getattr(scene, "render", None) is not None:
            try:
                fp = bpy.path.abspath(scene.render.frame_path(frame=scene.frame_current))
                if fp:
                    candidates.append(fp)
            except Exception:
                pass
            try:
                raw_fp = bpy.path.abspath(scene.render.filepath)
                if raw_fp:
                    candidates.append(raw_fp)
                    if not raw_fp.lower().endswith(".png"):
                        candidates.append(raw_fp + ".png")
            except Exception:
                pass
        if _PREVIEW_FILE:
            candidates.append(_PREVIEW_FILE)

        for c in candidates:
            if c and os.path.isfile(c) and os.path.getsize(c) > 0:
                if _atomic_copy(c, _LIVE_FILE):
                    _LAST_LIVE_TS = now
                    return True

        img = bpy.data.images.get("Render Result")
        if img is not None and scene is not None:
            tmp = _LIVE_FILE + ".tmp.png"
            prev_fmt = scene.render.image_settings.file_format
            try:
                scene.render.image_settings.file_format = "PNG"
                img.save_render(tmp, scene=scene)
                if os.path.isfile(tmp) and os.path.getsize(tmp) > 0:
                    os.replace(tmp, _LIVE_FILE)
                    _LAST_LIVE_TS = now
                    return True
            finally:
                try:
                    scene.render.image_settings.file_format = prev_fmt
                except Exception:
                    pass
    except Exception:
        pass
    return False


builtins.lab_progress = lab_progress
builtins.lab_capture_live = lab_capture_live

try:
    import bpy
    from bpy.app.handlers import persistent

    @persistent
    def _lab_on_render_init(scene, depsgraph=None):
        frame = getattr(scene, "frame_current", 1) if scene is not None else 1
        lab_progress(40, f"Rendering frame {frame}")

    @persistent
    def _lab_on_render_write(scene, depsgraph=None):
        if lab_capture_live(scene, force=True):
            frame = getattr(scene, "frame_current", 1) if scene is not None else 1
            print(f"[lab_live] Captured live frame {frame}", flush=True)

    @persistent
    def _lab_on_render_complete(scene, depsgraph=None):
        now = time.monotonic()
        if not _LIVE_FILE:
            return
        if not os.path.isfile(_LIVE_FILE) or (now - _LAST_LIVE_TS) >= 0.5:
            if lab_capture_live(scene, force=True):
                print("[lab_live] Captured completed render frame", flush=True)

    if _lab_on_render_init not in bpy.app.handlers.render_init:
        bpy.app.handlers.render_init.append(_lab_on_render_init)
    if _lab_on_render_write not in bpy.app.handlers.render_write:
        bpy.app.handlers.render_write.append(_lab_on_render_write)
    if _lab_on_render_complete not in bpy.app.handlers.render_complete:
        bpy.app.handlers.render_complete.append(_lab_on_render_complete)
except Exception as _e:
    print(f"[lab_live_prelude] handler setup skipped: {_e}", flush=True)

lab_progress(26, "Blender live prelude ready")
`

var (
	reBlenderLabProgress = regexp.MustCompile(`(?i)\bLAB_PROGRESS\s+(\d+(?:\.\d+)?)(?:\s+(.*))?$`)
	reBlenderCycles      = regexp.MustCompile(`Fra:(\d+).*?Sample\s+(\d+)/(\d+)`)
	reBlenderGenSample   = regexp.MustCompile(`(?i)Rendering\s+(\d+)\s*/\s*(\d+)\s*samples?`)
	reBlenderFra         = regexp.MustCompile(`Fra:(\d+)`)
	reBlenderMem         = regexp.MustCompile(`Mem:(\d+(?:\.\d+)?)M`)
)

type blenderLogStats struct {
	Frame        int     `json:"frame,omitempty"`
	Sample       int     `json:"sample,omitempty"`
	TotalSamples int     `json:"totalSamples,omitempty"`
	MemMB        float64 `json:"memMb,omitempty"`
	ElapsedMs    int64   `json:"elapsedMs"`
}

type blenderJobLogPayload struct {
	JobID    string           `json:"jobId"`
	NodeID   string           `json:"nodeId"`
	Lines    []string         `json:"lines"`
	Progress float64          `json:"progress,omitempty"`
	Phase    string           `json:"phase,omitempty"`
	Stats    *blenderLogStats `json:"stats,omitempty"`
}

type watchFileState struct {
	path         string
	uploadName   string
	lastSeenSize int64
	lastSeenMod  time.Time
	stableTicks  int
	uploadedSize int64
	uploadedMod  time.Time
}

func truncateRunes(s string, maxRunes int) string {
	r := []rune(s)
	if len(r) <= maxRunes {
		return s
	}
	return string(r[:maxRunes])
}

func splitBlenderLines(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	for i, b := range data {
		if b == '\n' {
			return i + 1, data[:i], nil
		}
		if b == '\r' {
			if i+1 < len(data) && data[i+1] == '\n' {
				return i + 2, data[:i], nil
			}
			return i + 1, data[:i], nil
		}
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

func handleRenderBlender(p map[string]interface{}) (map[string]interface{}, error) {
	atomic.AddInt32(&activeJobsCount, 1)
	defer atomic.AddInt32(&activeJobsCount, -1)

	specs := refreshStaticSpecs(getSpecs().InstallDir)
	if specs.BlenderPath == "" {
		return nil, fmt.Errorf("blender is not installed on node %s", agentCfg.NodeID)
	}

	jobID := getString(p, "jobId", fmt.Sprintf("bjob-%d", time.Now().Unix()))
	script := getString(p, "script", "")
	if b64 := getString(p, "scriptBase64", ""); b64 != "" && script == "" {
		if dec, err := base64.StdEncoding.DecodeString(b64); err == nil {
			script = string(dec)
		}
	}
	if strings.TrimSpace(script) == "" {
		return nil, fmt.Errorf("missing python script for render.blender")
	}

	outputName := getString(p, "outputName", jobID+".glb")
	previewName := getString(p, "previewName", "")
	openGui := getBool(p, "openGui", false)

	runtimeState.StartJob(jobID, outputName, "blender-3d", "กำลังเตรียมงาน Blender 3D...", false)
	defer runtimeState.FinishJob(jobID, "failed", "งาน Blender จบลงก่อนกำหนด")

	workDir := filepath.Join(specs.InstallDir, "jobs", jobID)
	if err := os.MkdirAll(workDir, 0755); err != nil {
		return nil, err
	}
	if !openGui {
		defer os.RemoveAll(workDir)
	}

	preludeFile := filepath.Join(workDir, "lab_live_prelude.py")
	scriptFile := filepath.Join(workDir, "job_script.py")
	outFile := filepath.Join(workDir, outputName)
	liveFile := filepath.Join(workDir, "live_frame.png")
	previewFile := ""
	if previewName != "" {
		previewFile = filepath.Join(workDir, previewName)
	}
	blendSaveFile := filepath.Join(workDir, "scene.blend")

	if err := os.WriteFile(preludeFile, []byte(blenderLivePrelude), 0644); err != nil {
		return nil, err
	}
	if err := os.WriteFile(scriptFile, []byte(script), 0644); err != nil {
		return nil, err
	}

	reportJobProgress(jobID, "rendering", 25, fmt.Sprintf("กำลังประมวลผล 3D ด้วย Blender บน %s...", specs.NodeID))

	startedRender := time.Now()
	var finalRenderDurationMs int64

	uploadSingle := func(filePath string, fname string) (map[string]interface{}, error) {
		rawBytes, rErr := os.ReadFile(filePath)
		if rErr != nil {
			return nil, rErr
		}
		durMs := atomic.LoadInt64(&finalRenderDurationMs)
		if durMs <= 0 {
			durMs = time.Since(startedRender).Milliseconds()
		}
		var mpBuf bytes.Buffer
		mw := multipart.NewWriter(&mpBuf)
		_ = mw.WriteField("jobId", jobID)
		_ = mw.WriteField("nodeId", agentCfg.NodeID)
		_ = mw.WriteField("encoder", "blender-4.3")
		_ = mw.WriteField("renderDurationMs", fmt.Sprintf("%d", durMs))
		fw, cErr := mw.CreateFormFile("file", fname)
		if cErr != nil {
			return nil, cErr
		}
		if _, wErr := fw.Write(rawBytes); wErr != nil {
			return nil, wErr
		}
		mw.Close()

		upPath := fmt.Sprintf("/api/agent-hub/agent/job-upload?jobId=%s&nodeId=%s&filename=%s",
			url.QueryEscape(jobID), url.QueryEscape(agentCfg.NodeID), url.QueryEscape(fname))
		upResp, _, upErr := doHubRequest(transferClient, "POST", upPath, mpBuf.Bytes(), mw.FormDataContentType())
		if upErr != nil {
			return nil, upErr
		}
		defer upResp.Body.Close()
		var upData map[string]interface{}
		_ = json.NewDecoder(upResp.Body).Decode(&upData)
		if upResp.StatusCode >= 400 {
			return upData, fmt.Errorf("upload returned HTTP %d", upResp.StatusCode)
		}
		return upData, nil
	}

	args := []string{"-b", "--factory-startup", "-P", preludeFile, "-P", scriptFile}
	bCmd := exec.Command(specs.BlenderPath, args...)
	bCmd.Dir = workDir
	bCmd.SysProcAttr = hideWindowAttr()
	bCmd.Env = append(os.Environ(),
		"PYTHONUNBUFFERED=1",
		"BLENDER_JOB_ID="+jobID,
		"BLENDER_WORK_DIR="+workDir,
		"BLENDER_OUTPUT_FILE="+outFile,
		"BLENDER_PREVIEW_FILE="+previewFile,
		"BLENDER_LIVE_FILE="+liveFile,
		"BLENDER_SAVE_BLEND="+blendSaveFile,
		fmt.Sprintf("BLENDER_HAS_NVIDIA=%v", specs.HasNvidiaSmi),
	)

	pr, pw := io.Pipe()
	bCmd.Stdout = pw
	bCmd.Stderr = pw

	if err := bCmd.Start(); err != nil {
		_ = pw.Close()
		_ = pr.Close()
		reportJobProgress(jobID, "failed", 0, "Blender start error: "+err.Error())
		return nil, fmt.Errorf("blender start failed: %w", err)
	}

	waitErrCh := make(chan error, 1)
	go func() {
		wErr := bCmd.Wait()
		_ = pw.Close()
		waitErrCh <- wErr
	}()

	var (
		logMu        sync.Mutex
		pendingLines []string
		curProgress  float64 = 25
		curPhase     string  = "starting"
		curStats     blenderLogStats
	)

	setPctLocked := func(v float64) {
		if v < 0 {
			v = 0
		}
		if v > 100 {
			v = 100
		}
		v = math.Round(v*10) / 10
		if v > curProgress {
			curProgress = v
		}
	}

	parseLineLocked := func(line string) {
		if m := reBlenderFra.FindStringSubmatch(line); len(m) == 2 {
			if f, err := strconv.Atoi(m[1]); err == nil {
				curStats.Frame = f
			}
		}
		if m := reBlenderMem.FindStringSubmatch(line); len(m) == 2 {
			if mem, err := strconv.ParseFloat(m[1], 64); err == nil {
				curStats.MemMB = mem
			}
		}

		if m := reBlenderLabProgress.FindStringSubmatch(line); len(m) >= 2 {
			if v, err := strconv.ParseFloat(m[1], 64); err == nil {
				setPctLocked(v)
			}
			msgLower := ""
			if len(m) >= 3 {
				msgLower = strings.ToLower(strings.TrimSpace(m[2]))
			}
			if strings.Contains(msgLower, "export") || strings.Contains(msgLower, "gltf") {
				curPhase = "exporting"
			} else if strings.Contains(msgLower, "render") {
				if curPhase != "exporting" && curPhase != "uploading" {
					curPhase = "rendering"
				}
			} else if curPhase == "starting" {
				curPhase = "scripting"
			}
			return
		}

		if m := reBlenderCycles.FindStringSubmatch(line); len(m) == 4 {
			if f, err := strconv.Atoi(m[1]); err == nil {
				curStats.Frame = f
			}
			s, errS := strconv.Atoi(m[2])
			t, errT := strconv.Atoi(m[3])
			if errS == nil && errT == nil && t > 0 {
				curStats.Sample = s
				curStats.TotalSamples = t
				setPctLocked(40.0 + 45.0*float64(s)/float64(t))
			}
			curPhase = "rendering"
			return
		}

		if m := reBlenderGenSample.FindStringSubmatch(line); len(m) == 3 {
			s, errS := strconv.Atoi(m[1])
			t, errT := strconv.Atoi(m[2])
			if errS == nil && errT == nil && t > 0 {
				curStats.Sample = s
				curStats.TotalSamples = t
				setPctLocked(40.0 + 45.0*float64(s)/float64(t))
			}
			curPhase = "rendering"
			return
		}

		lower := strings.ToLower(line)
		if (strings.Contains(lower, "rendering") && strings.Contains(lower, "eevee")) || strings.Contains(line, "Saved:") {
			curPhase = "rendering"
			if strings.Contains(line, "Saved:") {
				setPctLocked(75.0)
			} else {
				setPctLocked(50.0)
			}
			return
		}

		if strings.Contains(lower, "gltf") || strings.Contains(lower, "export") {
			curPhase = "exporting"
			if strings.Contains(lower, "finished") || strings.Contains(lower, "done") {
				setPctLocked(90.0)
			} else {
				setPctLocked(85.0)
			}
			return
		}

		if curPhase == "starting" || curPhase == "scripting" {
			curPhase = "scripting"
			if curProgress < 40.0 {
				setPctLocked(math.Min(40.0, curProgress+1.0))
			}
		}
	}

	stopCh := make(chan struct{})
	var bgWG sync.WaitGroup

	// Goroutine 1: logFlusher (every 1500ms + final flush on stop)
	bgWG.Add(1)
	go func() {
		defer bgWG.Done()
		ticker := time.NewTicker(1500 * time.Millisecond)
		defer ticker.Stop()

		lastSentProgress := -1.0
		lastSentPhase := ""
		loggedWarn := false

		flush := func() {
			logMu.Lock()
			var batch []string
			if len(pendingLines) > 200 {
				batch = append([]string(nil), pendingLines[len(pendingLines)-200:]...)
			} else if len(pendingLines) > 0 {
				batch = append([]string(nil), pendingLines...)
			} else {
				batch = []string{}
			}
			pendingLines = nil
			pct := curProgress
			phase := curPhase
			stats := curStats
			logMu.Unlock()

			if len(batch) == 0 && pct == lastSentProgress && phase == lastSentPhase {
				return
			}

			stats.ElapsedMs = time.Since(startedRender).Milliseconds()
			payload := blenderJobLogPayload{
				JobID:    jobID,
				NodeID:   agentCfg.NodeID,
				Lines:    batch,
				Progress: pct,
				Phase:    phase,
				Stats:    &stats,
			}
			body, mErr := json.Marshal(payload)
			if mErr != nil {
				return
			}
			resp, _, reqErr := doHubRequest(httpClient, "POST", "/api/agent-hub/agent/job-log", body, "application/json")
			if reqErr != nil {
				if !loggedWarn {
					fmt.Printf("[blender:%s] job-log post failed: %v\n", jobID, reqErr)
					loggedWarn = true
				}
				return
			}
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if resp.StatusCode >= 400 {
				if !loggedWarn {
					fmt.Printf("[blender:%s] job-log endpoint returned HTTP %d\n", jobID, resp.StatusCode)
					loggedWarn = true
				}
				return
			}
			lastSentProgress = pct
			lastSentPhase = phase
			runtimeState.UpdateJob(jobID, "rendering", pct, fmt.Sprintf("Blender (%s) %.0f%%", phase, pct))
		}

		for {
			select {
			case <-ticker.C:
				flush()
			case <-stopCh:
				flush()
				return
			}
		}
	}()

	// Goroutine 2: liveWatcher (every 1s, uploads live_frame.png & previewFile after 2 stable ticks)
	var watchMu sync.Mutex
	watched := []*watchFileState{
		{path: liveFile, uploadName: "live_frame.png"},
	}
	if previewFile != "" && previewName != "" {
		watched = append(watched, &watchFileState{path: previewFile, uploadName: previewName})
	}

	bgWG.Add(1)
	go func() {
		defer bgWG.Done()
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()

		var uploadBusy int32

		for {
			select {
			case <-ticker.C:
				if atomic.LoadInt32(&uploadBusy) != 0 {
					continue
				}
				type uploadTarget struct {
					state *watchFileState
					size  int64
					mod   time.Time
				}
				var ready []uploadTarget

				watchMu.Lock()
				for _, w := range watched {
					st, err := os.Stat(w.path)
					if err != nil || st.IsDir() || st.Size() == 0 {
						w.stableTicks = 0
						continue
					}
					sz := st.Size()
					mod := st.ModTime()
					if sz == w.uploadedSize && mod.Equal(w.uploadedMod) {
						continue
					}
					if sz == w.lastSeenSize && mod.Equal(w.lastSeenMod) {
						w.stableTicks++
					} else {
						w.lastSeenSize = sz
						w.lastSeenMod = mod
						w.stableTicks = 1
					}
					if w.stableTicks >= 2 {
						ready = append(ready, uploadTarget{state: w, size: sz, mod: mod})
					}
				}
				watchMu.Unlock()

				if len(ready) == 0 {
					continue
				}
				if !atomic.CompareAndSwapInt32(&uploadBusy, 0, 1) {
					continue
				}
				bgWG.Add(1)
				go func(targets []uploadTarget) {
					defer bgWG.Done()
					defer atomic.StoreInt32(&uploadBusy, 0)
					for _, t := range targets {
						if _, err := uploadSingle(t.state.path, t.state.uploadName); err != nil {
							fmt.Printf("[blender:%s] live upload (%s) failed: %v\n", jobID, t.state.uploadName, err)
							continue
						}
						watchMu.Lock()
						t.state.uploadedSize = t.size
						t.state.uploadedMod = t.mod
						watchMu.Unlock()
					}
				}(ready)

			case <-stopCh:
				return
			}
		}
	}()

	// Stream stdout+stderr line by line (supports both \n and \r) and keep a 2500-char ring buffer
	var tailBuf []byte
	appendTail := func(line string) {
		if len(tailBuf) > 0 {
			tailBuf = append(tailBuf, '\n')
		}
		tailBuf = append(tailBuf, line...)
		if len(tailBuf) > 16384 {
			tailBuf = append([]byte(nil), tailBuf[len(tailBuf)-8192:]...)
		}
	}
	getTail := func() string {
		r := []rune(string(tailBuf))
		if len(r) > 2500 {
			r = r[len(r)-2500:]
		}
		return string(r)
	}

	scanner := bufio.NewScanner(pr)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	scanner.Split(splitBlenderLines)

	for scanner.Scan() {
		rawLine := strings.TrimSpace(scanner.Text())
		if rawLine == "" {
			continue
		}
		appendTail(rawLine)
		shortLine := truncateRunes(rawLine, 400)
		logMu.Lock()
		pendingLines = append(pendingLines, shortLine)
		if len(pendingLines) > 1000 {
			pendingLines = append([]string(nil), pendingLines[len(pendingLines)-400:]...)
		}
		parseLineLocked(shortLine)
		logMu.Unlock()
	}
	_, _ = io.Copy(io.Discard, pr)
	_ = pr.Close()

	err := <-waitErrCh
	renderDurationMs := time.Since(startedRender).Milliseconds()
	atomic.StoreInt64(&finalRenderDurationMs, renderDurationMs)

	close(stopCh)
	bgWG.Wait()

	if err != nil {
		msg := getTail()
		reportJobProgress(jobID, "failed", 0, "Blender error: "+msg)
		return nil, fmt.Errorf("blender failed: %v (%s)", err, msg)
	}

	st, statErr := os.Stat(outFile)
	if statErr != nil {
		msg := getTail()
		reportJobProgress(jobID, "failed", 0, "ไม่พบไฟล์ผลลัพธ์ 3D จาก Blender: "+msg)
		return nil, fmt.Errorf("blender output file missing (%s): %s", outputName, msg)
	}

	// Ensure latest live_frame.png is uploaded even if Blender exited within <2s of writing it
	if lSt, lErr := os.Stat(liveFile); lErr == nil && !lSt.IsDir() && lSt.Size() > 0 {
		w := watched[0]
		if lSt.Size() != w.uploadedSize || !lSt.ModTime().Equal(w.uploadedMod) {
			_, _ = uploadSingle(liveFile, "live_frame.png")
		}
	}

	logMu.Lock()
	uploadPct := curProgress
	logMu.Unlock()
	if uploadPct < 80 {
		uploadPct = 80
	}
	if uploadPct > 99 {
		uploadPct = 99
	}
	reportJobProgress(jobID, "uploading", uploadPct, "สร้าง 3D Object เสร็จแล้ว กำลังส่งไฟล์กลับไปยัง Homelab...")

	if previewFile != "" {
		if _, pErr := os.Stat(previewFile); pErr == nil {
			_, _ = uploadSingle(previewFile, previewName)
		}
	}

	upData, upErr := uploadSingle(outFile, outputName)
	if upErr != nil {
		reportJobProgress(jobID, "failed", uploadPct, "อัปโหลดไฟล์ 3D กลับไม่สำเร็จ: "+upErr.Error())
		return nil, upErr
	}

	if openGui {
		targetGuiFile := blendSaveFile
		if _, bErr := os.Stat(targetGuiFile); bErr != nil {
			targetGuiFile = outFile
		}
		guiCmd := exec.Command(specs.BlenderPath, targetGuiFile)
		guiCmd.Dir = workDir
		_ = guiCmd.Start()
	}

	reportJobProgress(jobID, "completed", 100, fmt.Sprintf("สร้าง 3D สำเร็จบน %s (%d ms)", specs.NodeID, renderDurationMs))

	return map[string]interface{}{
		"jobId":            jobID,
		"nodeId":           agentCfg.NodeID,
		"blenderPath":      specs.BlenderPath,
		"outputName":       outputName,
		"outputSize":       st.Size(),
		"renderDurationMs": renderDurationMs,
		"hubUpload":        upData,
	}, nil
}

var (
	reRemotionRendered = regexp.MustCompile(`Rendered\s+(\d+)\s*/\s*(\d+)`)
	remotionSetupMu    sync.Mutex
)

func detectNodeTool(tool string, nodePath string) string {
	var names []string
	if runtime.GOOS == "windows" {
		names = []string{tool + ".cmd", tool + ".exe", tool}
	} else {
		names = []string{tool}
	}
	for _, n := range names {
		if p, err := exec.LookPath(n); err == nil && p != "" {
			return p
		}
	}
	var dirs []string
	if nodePath != "" {
		dirs = append(dirs, filepath.Dir(nodePath))
	}
	if runtime.GOOS == "windows" {
		home, _ := os.UserHomeDir()
		localAppData := os.Getenv("LOCALAPPDATA")
		progFiles := os.Getenv("ProgramFiles")
		dirs = append(dirs,
			filepath.Join(progFiles, "nodejs"),
			filepath.Join(localAppData, "Microsoft", "WinGet", "Links"),
			filepath.Join(home, "scoop", "shims"),
			`C:\ProgramData\chocolatey\bin`,
		)
	}
	for _, d := range dirs {
		if d == "" {
			continue
		}
		for _, n := range names {
			cand := filepath.Join(d, n)
			if st, err := os.Stat(cand); err == nil && !st.IsDir() {
				return cand
			}
		}
	}
	return ""
}

func buildRemotionEnv(paths ...string) []string {
	env := os.Environ()
	var extraDirs []string
	seen := map[string]bool{}
	for _, p := range paths {
		if p == "" {
			continue
		}
		d := filepath.Dir(p)
		key := d
		if runtime.GOOS == "windows" {
			key = strings.ToLower(d)
		}
		if d != "" && d != "." && !seen[key] {
			seen[key] = true
			extraDirs = append(extraDirs, d)
		}
	}
	if len(extraDirs) == 0 {
		return env
	}
	sep := string(os.PathListSeparator)
	prefix := strings.Join(extraDirs, sep)
	updated := false
	for i, kv := range env {
		idx := strings.IndexByte(kv, '=')
		if idx <= 0 {
			continue
		}
		k := kv[:idx]
		if strings.EqualFold(k, "PATH") {
			env[i] = k + "=" + prefix + sep + kv[idx+1:]
			updated = true
			break
		}
	}
	if !updated {
		env = append(env, "PATH="+prefix)
	}
	return env
}

func downloadHubToFile(rawURL string, destPath string) error {
	var resp *http.Response
	var err error
	if strings.HasPrefix(rawURL, "http://") || strings.HasPrefix(rawURL, "https://") {
		req, reqErr := http.NewRequest("GET", rawURL, nil)
		if reqErr != nil {
			return reqErr
		}
		req.Header.Set("X-Agent-Token", agentCfg.Token)
		req.Header.Set("X-Agent-Node", agentCfg.NodeID)
		req.Header.Set("X-Agent-Version", AgentVersion)
		resp, err = transferClient.Do(req)
	} else {
		resp, _, err = doHubRequest(transferClient, "GET", rawURL, nil, "")
	}
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("download %s returned HTTP %d: %s", rawURL, resp.StatusCode, strings.TrimSpace(string(snippet)))
	}
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return err
	}
	tmpPath := destPath + ".tmp"
	f, err := os.Create(tmpPath)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(f, resp.Body)
	closeErr := f.Close()
	if copyErr != nil {
		_ = os.Remove(tmpPath)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmpPath)
		return closeErr
	}
	if err := os.Rename(tmpPath, destPath); err != nil {
		_ = os.Remove(destPath)
		if err2 := os.Rename(tmpPath, destPath); err2 != nil {
			_ = os.Remove(tmpPath)
			return err2
		}
	}
	return nil
}

func extractTarGzSafe(tgzPath string, destDir string) error {
	absDest, err := filepath.Abs(destDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(absDest, 0755); err != nil {
		return err
	}

	f, err := os.Open(tgzPath)
	if err != nil {
		return err
	}
	defer f.Close()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)
	destPrefix := absDest + string(os.PathSeparator)

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if hdr.Typeflag == tar.TypeXHeader || hdr.Typeflag == tar.TypeXGlobalHeader {
			continue
		}

		rawName := strings.ReplaceAll(hdr.Name, "\\", "/")
		if rawName == "" {
			continue
		}
		if strings.HasPrefix(rawName, "/") || filepath.IsAbs(hdr.Name) || (len(rawName) >= 2 && rawName[1] == ':') {
			return fmt.Errorf("unsafe tar entry (absolute path): %s", hdr.Name)
		}
		for _, seg := range strings.Split(rawName, "/") {
			if seg == ".." {
				return fmt.Errorf("unsafe tar entry (path traversal): %s", hdr.Name)
			}
		}

		rel := filepath.Clean(filepath.FromSlash(rawName))
		if rel == "." {
			continue
		}
		if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
			return fmt.Errorf("unsafe tar entry (escapes dest): %s", hdr.Name)
		}
		if rel == "node_modules" || strings.HasPrefix(rel, "node_modules"+string(os.PathSeparator)) {
			continue
		}

		targetPath := filepath.Join(absDest, rel)
		absTarget, err := filepath.Abs(targetPath)
		if err != nil {
			return err
		}
		if absTarget != absDest && !strings.HasPrefix(absTarget, destPrefix) {
			return fmt.Errorf("unsafe tar entry (outside dest): %s", hdr.Name)
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(absTarget, 0755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(absTarget), 0755); err != nil {
				return err
			}
			mode := os.FileMode(0644)
			if hdr.Mode > 0 {
				mode = (os.FileMode(hdr.Mode) & 0777) | 0200
			}
			out, err := os.OpenFile(absTarget, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(out, tr)
			closeErr := out.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		}
	}
	return nil
}

func fileSHA256(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}

func tailString(s string, maxRunes int) string {
	r := []rune(s)
	if len(r) <= maxRunes {
		return s
	}
	return string(r[len(r)-maxRunes:])
}

func handleRenderRemotion(p map[string]interface{}) (map[string]interface{}, error) {
	atomic.AddInt32(&activeJobsCount, 1)
	defer atomic.AddInt32(&activeJobsCount, -1)

	specs := getSpecs()
	if specs.NodePath == "" {
		specs = refreshStaticSpecs(specs.InstallDir)
	}

	jobID := strings.TrimSpace(getString(p, "jobId", fmt.Sprintf("rjob-%d", time.Now().Unix())))
	if jobID == "" {
		jobID = fmt.Sprintf("rjob-%d", time.Now().Unix())
	}
	bundleURL := strings.TrimSpace(getString(p, "bundleUrl", ""))
	bundleHash := strings.TrimSpace(getString(p, "bundleHash", ""))
	propsURL := strings.TrimSpace(getString(p, "propsUrl", ""))
	compositionID := strings.TrimSpace(getString(p, "compositionId", "StudioEngine"))
	if compositionID == "" {
		compositionID = "StudioEngine"
	}
	outputName := strings.TrimSpace(getString(p, "outputName", jobID+".mp4"))
	if outputName == "" {
		outputName = jobID + ".mp4"
	}
	outputName = filepath.Base(outputName)
	runtimeState.StartJob(jobID, compositionID+" · "+outputName, "remotion", "เตรียมเรนเดอร์ Remotion...", false)
	defer runtimeState.FinishJob(jobID, "failed", "งาน Remotion จบลงก่อนกำหนด")
	concurrency := getInt(p, "concurrency", 4)
	if concurrency <= 0 {
		concurrency = 4
	}
	crf := getInt(p, "crf", 18)
	if crf <= 0 {
		crf = 18
	}

	npmPath := detectNodeTool("npm", specs.NodePath)
	npxPath := detectNodeTool("npx", specs.NodePath)
	if npmPath == "" || npxPath == "" {
		err := fmt.Errorf("nodejs/npm/npx is not installed on node %s (node=%q npm=%q npx=%q)", agentCfg.NodeID, specs.NodePath, npmPath, npxPath)
		reportJobProgress(jobID, "failed", 0, err.Error())
		return nil, err
	}
	if propsURL == "" {
		err := fmt.Errorf("missing propsUrl for render.remotion")
		reportJobProgress(jobID, "failed", 0, err.Error())
		return nil, err
	}

	cmdEnv := buildRemotionEnv(specs.NodePath, npmPath, npxPath)
	projDir := filepath.Join(specs.InstallDir, "remotion", "motion-studio")
	workDir := filepath.Join(specs.InstallDir, "jobs", jobID)
	if err := os.MkdirAll(workDir, 0755); err != nil {
		reportJobProgress(jobID, "failed", 0, "สร้างโฟลเดอร์งานไม่สำเร็จ: "+err.Error())
		return nil, err
	}
	defer os.RemoveAll(workDir)

	// Serialize project bundle extraction and npm ci across concurrent jobs
	if err := func() error {
		remotionSetupMu.Lock()
		defer remotionSetupMu.Unlock()

		if err := os.MkdirAll(projDir, 0755); err != nil {
			return err
		}

		hashFile := filepath.Join(projDir, ".bundle_hash")
		curBundleHash := ""
		if b, err := os.ReadFile(hashFile); err == nil {
			curBundleHash = strings.TrimSpace(string(b))
		}

		if bundleURL != "" && (bundleHash == "" || curBundleHash != bundleHash) {
			shortHash := bundleHash
			if len(shortHash) > 12 {
				shortHash = shortHash[:12]
			}
			reportJobProgress(jobID, "downloading", 5, fmt.Sprintf("กำลังดาวน์โหลด Remotion bundle (%s)...", shortHash))
			tgzPath := filepath.Join(workDir, "bundle.tar.gz")
			if err := downloadHubToFile(bundleURL, tgzPath); err != nil {
				return fmt.Errorf("bundle download failed: %w", err)
			}
			if err := extractTarGzSafe(tgzPath, projDir); err != nil {
				return fmt.Errorf("bundle extract failed: %w", err)
			}
			_ = os.Remove(tgzPath)
			if bundleHash != "" {
				_ = os.WriteFile(hashFile, []byte(bundleHash+"\n"), 0644)
			}
		}

		lockPath := filepath.Join(projDir, "package-lock.json")
		lockHash := fileSHA256(lockPath)
		if lockHash == "" {
			lockHash = fileSHA256(filepath.Join(projDir, "package.json"))
		}
		lockHashFile := filepath.Join(projDir, ".lock_hash")
		curLockHash := ""
		if b, err := os.ReadFile(lockHashFile); err == nil {
			curLockHash = strings.TrimSpace(string(b))
		}

		_, binErr := os.Stat(filepath.Join(projDir, "node_modules", ".bin"))
		needInstall := binErr != nil || (lockHash != "" && curLockHash != lockHash)
		if needInstall {
			reportJobProgress(jobID, "installing", 10, "npm ci ...")
			ciCtx, ciCancel := context.WithTimeout(context.Background(), 20*time.Minute)
			defer ciCancel()

			ciCmd := exec.CommandContext(ciCtx, npmPath, "ci", "--no-audit", "--no-fund")
			ciCmd.Dir = projDir
			ciCmd.Env = cmdEnv
			ciCmd.SysProcAttr = hideWindowAttr()
			ciOut, ciErr := ciCmd.CombinedOutput()
			if ciErr != nil {
				msg := tailString(strings.TrimSpace(string(ciOut)), 2000)
				return fmt.Errorf("npm ci failed: %v (%s)", ciErr, msg)
			}
			if lockHash != "" {
				_ = os.WriteFile(lockHashFile, []byte(lockHash+"\n"), 0644)
			}
		}

		browserReadyFile := filepath.Join(projDir, ".browser_ready")
		_, brReadyErr := os.Stat(browserReadyFile)
		if needInstall || brReadyErr != nil {
			reportJobProgress(jobID, "installing", 12, "กำลังเตรียม Remotion browser (chrome-headless-shell)...")
			brCtx, brCancel := context.WithTimeout(context.Background(), 10*time.Minute)
			defer brCancel()
			brCmd := exec.CommandContext(brCtx, npxPath, "remotion", "browser", "ensure")
			brCmd.Dir = projDir
			brCmd.Env = cmdEnv
			brCmd.SysProcAttr = hideWindowAttr()
			if brOut, brErr := brCmd.CombinedOutput(); brErr != nil {
				msg := tailString(strings.TrimSpace(string(brOut)), 1500)
				return fmt.Errorf("remotion browser ensure failed: %v (%s)", brErr, msg)
			}
			_ = os.WriteFile(browserReadyFile, []byte(time.Now().Format(time.RFC3339)+"\n"), 0644)
		}
		return nil
	}(); err != nil {
		reportJobProgress(jobID, "failed", 0, err.Error())
		return nil, err
	}

	propsFile := filepath.Join(workDir, "props.json")
	if err := downloadHubToFile(propsURL, propsFile); err != nil {
		reportJobProgress(jobID, "failed", 0, "ดาวน์โหลด props.json ไม่สำเร็จ: "+err.Error())
		return nil, fmt.Errorf("props download failed: %w", err)
	}

	outFile := filepath.Join(workDir, outputName)
	args := []string{
		"remotion", "render",
		"src/index.ts",
		compositionID,
		outFile,
		"--props=" + propsFile,
		"--codec=h264",
		"--pixel-format=yuv420p",
		fmt.Sprintf("--crf=%d", crf),
		fmt.Sprintf("--concurrency=%d", concurrency),
		"--gl=angle",
	}

	reportJobProgress(jobID, "rendering", 15, fmt.Sprintf("กำลังเรนเดอร์ Remotion (%s) บน %s...", compositionID, specs.NodeID))

	renderCtx, renderCancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer renderCancel()

	startedRender := time.Now()
	rCmd := exec.CommandContext(renderCtx, npxPath, args...)
	rCmd.Dir = projDir
	rCmd.Env = cmdEnv
	rCmd.SysProcAttr = hideWindowAttr()

	pr, pw := io.Pipe()
	rCmd.Stdout = pw
	rCmd.Stderr = pw

	if err := rCmd.Start(); err != nil {
		_ = pw.Close()
		_ = pr.Close()
		reportJobProgress(jobID, "failed", 0, "Remotion start error: "+err.Error())
		return nil, fmt.Errorf("remotion start failed: %w", err)
	}

	waitErrCh := make(chan error, 1)
	go func() {
		wErr := rCmd.Wait()
		_ = pw.Close()
		waitErrCh <- wErr
	}()

	var lastLines []string
	var lastReportAt time.Time
	lastReportedCur := -1

	scanner := bufio.NewScanner(pr)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	scanner.Split(splitBlenderLines)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		lastLines = append(lastLines, line)
		if len(lastLines) > 30 {
			lastLines = lastLines[len(lastLines)-30:]
		}
		if m := reRemotionRendered.FindStringSubmatch(line); len(m) == 3 {
			cur, errC := strconv.Atoi(m[1])
			total, errT := strconv.Atoi(m[2])
			if errC == nil && errT == nil && total > 0 {
				frac := float64(cur) / float64(total)
				if frac < 0 {
					frac = 0
				}
				if frac > 1 {
					frac = 1
				}
				pct := math.Round((15.0+frac*80.0)*10) / 10
				now := time.Now()
				if cur != lastReportedCur && (lastReportAt.IsZero() || now.Sub(lastReportAt) >= 1500*time.Millisecond || cur == total) {
					reportJobProgress(jobID, "rendering", pct, fmt.Sprintf("Rendered %d/%d", cur, total))
					lastReportAt = now
					lastReportedCur = cur
				}
			}
		}
	}
	_, _ = io.Copy(io.Discard, pr)
	_ = pr.Close()

	renderErr := <-waitErrCh
	renderDurationMs := time.Since(startedRender).Milliseconds()

	if renderErr != nil {
		errTail := tailString(strings.Join(lastLines, "\n"), 2500)
		reportJobProgress(jobID, "failed", 0, "Remotion error: "+errTail)
		return nil, fmt.Errorf("remotion render failed: %v (%s)", renderErr, errTail)
	}

	st, statErr := os.Stat(outFile)
	if statErr != nil || st.Size() == 0 {
		errTail := tailString(strings.Join(lastLines, "\n"), 2500)
		reportJobProgress(jobID, "failed", 0, "ไม่พบไฟล์ผลลัพธ์ MP4 จาก Remotion: "+errTail)
		return nil, fmt.Errorf("remotion output file missing (%s): %s", outputName, errTail)
	}

	reportJobProgress(jobID, "uploading", 95, "เรนเดอร์ Remotion เสร็จแล้ว กำลังส่งไฟล์ MP4 กลับไปยัง Homelab...")

	outBytes, err := os.ReadFile(outFile)
	if err != nil {
		reportJobProgress(jobID, "failed", 95, "อ่านไฟล์ผลลัพธ์ไม่สำเร็จ: "+err.Error())
		return nil, err
	}

	var mpBuf bytes.Buffer
	mw := multipart.NewWriter(&mpBuf)
	_ = mw.WriteField("jobId", jobID)
	_ = mw.WriteField("nodeId", agentCfg.NodeID)
	_ = mw.WriteField("encoder", "remotion")
	_ = mw.WriteField("renderDurationMs", fmt.Sprintf("%d", renderDurationMs))
	fw, err := mw.CreateFormFile("file", outputName)
	if err != nil {
		reportJobProgress(jobID, "failed", 95, "สร้าง multipart upload ไม่สำเร็จ: "+err.Error())
		return nil, err
	}
	if _, err := fw.Write(outBytes); err != nil {
		reportJobProgress(jobID, "failed", 95, "เขียนข้อมูลอัปโหลดไม่สำเร็จ: "+err.Error())
		return nil, err
	}
	mw.Close()

	upPath := fmt.Sprintf("/api/agent-hub/agent/job-upload?jobId=%s&nodeId=%s&filename=%s",
		url.QueryEscape(jobID), url.QueryEscape(agentCfg.NodeID), url.QueryEscape(outputName))
	upResp, _, upErr := doHubRequest(transferClient, "POST", upPath, mpBuf.Bytes(), mw.FormDataContentType())
	if upErr != nil {
		reportJobProgress(jobID, "failed", 95, "อัปโหลดไฟล์กลับไม่สำเร็จ: "+upErr.Error())
		return nil, upErr
	}
	defer upResp.Body.Close()
	var upData map[string]interface{}
	_ = json.NewDecoder(upResp.Body).Decode(&upData)
	if upResp.StatusCode >= 400 {
		err := fmt.Errorf("upload returned HTTP %d", upResp.StatusCode)
		reportJobProgress(jobID, "failed", 95, "อัปโหลดไฟล์กลับไม่สำเร็จ: "+err.Error())
		return nil, err
	}

	reportJobProgress(jobID, "completed", 100, fmt.Sprintf("เรนเดอร์ Remotion สำเร็จบน %s (%d ms)", specs.NodeID, renderDurationMs))

	return map[string]interface{}{
		"jobId":            jobID,
		"nodeId":           agentCfg.NodeID,
		"compositionId":    compositionID,
		"outputName":       outputName,
		"outputSize":       st.Size(),
		"renderDurationMs": renderDurationMs,
		"hubUpload":        upData,
	}, nil
}

const maxJobResultBytes int64 = 480 * 1024 * 1024

var errArchiveTooLarge = fmt.Errorf("result archive exceeds 480 MB limit")

type runningJobEntry struct {
	cancel    context.CancelFunc
	cancelled atomic.Bool
}

var (
	runningJobs sync.Map // jobId -> *runningJobEntry
	jobSetupMus sync.Map // cacheKey -> *sync.Mutex
)

type limitedWriter struct {
	w       io.Writer
	limit   int64
	written int64
}

func (lw *limitedWriter) Write(p []byte) (int, error) {
	if lw.written+int64(len(p)) > lw.limit {
		return 0, errArchiveTooLarge
	}
	n, err := lw.w.Write(p)
	lw.written += int64(n)
	return n, err
}

type jobLogPayload struct {
	JobID    string   `json:"jobId"`
	NodeID   string   `json:"nodeId"`
	Lines    []string `json:"lines"`
	Progress *float64 `json:"progress,omitempty"`
}

type jobLogStreamer struct {
	jobID       string
	logFile     *os.File
	mu          sync.Mutex
	pending     []string
	hasProgress bool
	progress    float64
	lastLines   []string
	flushCh     chan struct{}
	stopCh      chan struct{}
	doneCh      chan struct{}
	stopOnce    sync.Once
	loggedWarn  bool
}

func newJobLogStreamer(jobID string, logPath string) (*jobLogStreamer, error) {
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return nil, err
	}
	s := &jobLogStreamer{
		jobID:   jobID,
		logFile: f,
		flushCh: make(chan struct{}, 1),
		stopCh:  make(chan struct{}),
		doneCh:  make(chan struct{}),
	}
	go s.runLoop()
	return s, nil
}

func (s *jobLogStreamer) runLoop() {
	defer close(s.doneCh)
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.flush()
		case <-s.flushCh:
			s.flush()
		case <-s.stopCh:
			s.flush()
			return
		}
	}
}

func (s *jobLogStreamer) AddLine(line string) {
	s.mu.Lock()
	if s.logFile != nil {
		_, _ = s.logFile.WriteString(line + "\n")
	}
	shortLine := truncateRunes(line, 500)
	s.pending = append(s.pending, shortLine)
	if len(s.pending) > 1000 {
		s.pending = append([]string(nil), s.pending[len(s.pending)-500:]...)
	}
	s.lastLines = append(s.lastLines, shortLine)
	if len(s.lastLines) > 40 {
		s.lastLines = s.lastLines[len(s.lastLines)-40:]
	}
	shouldFlush := len(s.pending) >= 50
	s.mu.Unlock()

	if shouldFlush {
		select {
		case s.flushCh <- struct{}{}:
		default:
		}
	}
}

func (s *jobLogStreamer) SetProgress(pct float64) {
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	pct = math.Round(pct*10) / 10
	s.mu.Lock()
	s.progress = pct
	s.hasProgress = true
	s.mu.Unlock()
}

func (s *jobLogStreamer) Tail(maxRunes int) string {
	s.mu.Lock()
	lines := append([]string(nil), s.lastLines...)
	s.mu.Unlock()
	return tailString(strings.Join(lines, "\n"), maxRunes)
}

func (s *jobLogStreamer) flush() {
	s.mu.Lock()
	var batch []string
	if len(s.pending) > 200 {
		batch = append([]string(nil), s.pending[len(s.pending)-200:]...)
	} else if len(s.pending) > 0 {
		batch = append([]string(nil), s.pending...)
	}
	s.pending = nil
	var progPtr *float64
	if s.hasProgress {
		v := s.progress
		progPtr = &v
		s.hasProgress = false
	}
	s.mu.Unlock()

	if len(batch) == 0 && progPtr == nil {
		return
	}
	if batch == nil {
		batch = []string{}
	}

	payload := jobLogPayload{
		JobID:    s.jobID,
		NodeID:   agentCfg.NodeID,
		Lines:    batch,
		Progress: progPtr,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}
	resp, _, reqErr := doHubRequest(httpClient, "POST", "/api/agent-hub/agent/job-log", body, "application/json")
	if reqErr != nil {
		if !s.loggedWarn {
			fmt.Printf("[job:%s] job-log post failed: %v\n", s.jobID, reqErr)
			s.loggedWarn = true
		}
		return
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode >= 400 && !s.loggedWarn {
		fmt.Printf("[job:%s] job-log endpoint returned HTTP %d\n", s.jobID, resp.StatusCode)
		s.loggedWarn = true
	}
}

func (s *jobLogStreamer) Close() {
	s.stopOnce.Do(func() {
		close(s.stopCh)
		<-s.doneCh
		s.mu.Lock()
		if s.logFile != nil {
			_ = s.logFile.Sync()
			_ = s.logFile.Close()
			s.logFile = nil
		}
		s.mu.Unlock()
	})
}

func reportJobFinal(jobID string, status string, exitCode int, errMsg string, durationMs int64) {
	if jobID == "" {
		return
	}
	pct := 100.0
	if status != "completed" {
		pct = 0
	}
	msg := errMsg
	if msg == "" {
		switch status {
		case "completed":
			msg = fmt.Sprintf("Job completed on %s (%d ms)", agentCfg.NodeID, durationMs)
		case "cancelled":
			msg = "Job cancelled"
		case "timeout":
			msg = "Job timed out"
		default:
			msg = fmt.Sprintf("Job failed (exitCode=%d)", exitCode)
		}
	}
	payload := map[string]interface{}{
		"jobId":      jobID,
		"nodeId":     agentCfg.NodeID,
		"status":     status,
		"progress":   pct,
		"message":    msg,
		"exitCode":   exitCode,
		"durationMs": durationMs,
		"reportedAt": time.Now().UTC().Format(time.RFC3339),
	}
	runtimeState.FinishJob(jobID, status, msg)
	if errMsg != "" {
		payload["error"] = errMsg
	}
	body, _ := json.Marshal(payload)
	resp, _, err := doHubRequest(httpClient, "POST", "/api/agent-hub/agent/job-progress", body, "application/json")
	if err == nil && resp != nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}
}

func resolveOSCommand(raw interface{}, required bool) (string, error) {
	if raw == nil {
		if required {
			return "", fmt.Errorf("missing command for job.run")
		}
		return "", nil
	}
	switch v := raw.(type) {
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			if required {
				return "", fmt.Errorf("empty command for job.run")
			}
			return "", nil
		}
		return s, nil
	case map[string]interface{}:
		if len(v) == 0 {
			if required {
				return "", fmt.Errorf("empty command map for job.run")
			}
			return "", nil
		}
		if runtime.GOOS == "windows" {
			if s, ok := v["windows"].(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s), nil
			}
			return "", fmt.Errorf("no command provided for OS %s (expected command.windows)", runtime.GOOS)
		}
		if s, ok := v[runtime.GOOS].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s), nil
		}
		if s, ok := v["posix"].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s), nil
		}
		return "", fmt.Errorf("no command provided for OS %s (expected command.posix)", runtime.GOOS)
	default:
		return "", fmt.Errorf("unsupported command type %T", raw)
	}
}

func sanitizeCacheKey(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range raw {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
		if b.Len() >= 64 {
			break
		}
	}
	res := strings.Trim(b.String(), ".")
	if res == "" || res == "." || res == ".." {
		return "default"
	}
	return res
}

func getJobSetupMutex(key string) *sync.Mutex {
	if v, ok := jobSetupMus.Load(key); ok {
		return v.(*sync.Mutex)
	}
	mu := &sync.Mutex{}
	actual, _ := jobSetupMus.LoadOrStore(key, mu)
	return actual.(*sync.Mutex)
}

func buildJobEnv(workDir, inDir, outDir, cacheDir, jobID, jobName string, extra map[string]interface{}, specs StaticSpecs) []string {
	env := os.Environ()

	setEnv := func(k, val string) {
		if k == "" || strings.ContainsAny(k, "=\x00") {
			return
		}
		for i, kv := range env {
			idx := strings.IndexByte(kv, '=')
			if idx <= 0 {
				continue
			}
			existingKey := kv[:idx]
			match := existingKey == k
			if runtime.GOOS == "windows" {
				match = strings.EqualFold(existingKey, k)
			}
			if match {
				env[i] = k + "=" + val
				return
			}
		}
		env = append(env, k+"="+val)
	}

	// Ensure detected tool directories (e.g. on Windows) are available on PATH
	var extraDirs []string
	seenDir := map[string]bool{}
	for _, p := range []string{specs.PythonPath, specs.NodePath, specs.FFmpegPath, specs.GitPath, specs.BlenderPath} {
		if p == "" {
			continue
		}
		d := filepath.Dir(p)
		key := d
		if runtime.GOOS == "windows" {
			key = strings.ToLower(d)
		}
		if d != "" && d != "." && !seenDir[key] {
			seenDir[key] = true
			extraDirs = append(extraDirs, d)
		}
	}
	if len(extraDirs) > 0 {
		sep := string(os.PathListSeparator)
		updated := false
		for i, kv := range env {
			idx := strings.IndexByte(kv, '=')
			if idx <= 0 {
				continue
			}
			k := kv[:idx]
			if strings.EqualFold(k, "PATH") {
				curVal := kv[idx+1:]
				var toAppend []string
				for _, d := range extraDirs {
					if !strings.Contains(strings.ToLower(curVal), strings.ToLower(d)) {
						toAppend = append(toAppend, d)
					}
				}
				if len(toAppend) > 0 {
					env[i] = k + "=" + curVal + sep + strings.Join(toAppend, sep)
				}
				updated = true
				break
			}
		}
		if !updated {
			env = append(env, "PATH="+strings.Join(extraDirs, sep))
		}
	}

	setEnv("PYTHONUNBUFFERED", "1")
	setEnv("PYTHONIOENCODING", "utf-8")

	for k, v := range extra {
		if v == nil {
			continue
		}
		setEnv(strings.TrimSpace(k), fmt.Sprintf("%v", v))
	}

	setEnv("LAB_JOB_ID", jobID)
	if jobName != "" {
		setEnv("LAB_JOB_NAME", jobName)
	}
	setEnv("LAB_NODE_ID", agentCfg.NodeID)
	setEnv("LAB_WORK_DIR", workDir)
	setEnv("LAB_IN_DIR", inDir)
	setEnv("LAB_INPUT_DIR", inDir)
	setEnv("LAB_OUT_DIR", outDir)
	setEnv("LAB_OUTPUT_DIR", outDir)
	setEnv("LAB_CACHE_DIR", cacheDir)
	return env
}

func runShellWithStream(
	ctx context.Context,
	jobID string,
	command string,
	cwd string,
	env []string,
	linePrefix string,
	streamer *jobLogStreamer,
	parseProgress bool,
) (exitCode int, timedOut bool, err error) {
	if ctx.Err() != nil {
		return -1, ctx.Err() == context.DeadlineExceeded, ctx.Err()
	}

	cmd := newShellCmd(command)
	cmd.Dir = cwd
	cmd.Env = env

	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if startErr := cmd.Start(); startErr != nil {
		_ = pw.Close()
		_ = pr.Close()
		return -1, false, startErr
	}

	var procMu sync.Mutex
	procDone := false

	waitErrCh := make(chan error, 1)
	go func() {
		wErr := cmd.Wait()
		procMu.Lock()
		procDone = true
		procMu.Unlock()
		_ = pw.Close()
		waitErrCh <- wErr
	}()

	stopWatch := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			procMu.Lock()
			alreadyDone := procDone
			procMu.Unlock()
			if !alreadyDone {
				killProcessTree(cmd)
			}
		case <-stopWatch:
		}
	}()

	scanner := bufio.NewScanner(pr)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	scanner.Split(splitBlenderLines)

	for scanner.Scan() {
		rawLine := strings.TrimRight(scanner.Text(), "\r\n")
		if strings.TrimSpace(rawLine) == "" {
			continue
		}
		if streamer != nil {
			if linePrefix != "" {
				streamer.AddLine(linePrefix + rawLine)
			} else {
				streamer.AddLine(rawLine)
			}
		}
		if parseProgress {
			if m := reBlenderLabProgress.FindStringSubmatch(rawLine); len(m) >= 2 {
				if v, pErr := strconv.ParseFloat(m[1], 64); pErr == nil {
					if v < 0 {
						v = 0
					}
					if v > 100 {
						v = 100
					}
					v = math.Round(v*10) / 10
					msg := ""
					if len(m) >= 3 {
						msg = strings.TrimSpace(m[2])
					}
					if streamer != nil {
						streamer.SetProgress(v)
					}
					reportJobProgress(jobID, "running", v, msg)
				}
			}
		}
	}
	_, _ = io.Copy(io.Discard, pr)
	_ = pr.Close()

	wErr := <-waitErrCh
	close(stopWatch)

	if ctx.Err() == context.DeadlineExceeded {
		timedOut = true
	}

	if wErr != nil {
		if exitErr, ok := wErr.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
		return exitCode, timedOut, wErr
	}
	return 0, timedOut, nil
}

func runJobSetup(
	ctx context.Context,
	jobID string,
	setupCmd string,
	cacheKey string,
	cacheDir string,
	env []string,
	streamer *jobLogStreamer,
) (int, bool, error) {
	lockKey := cacheKey
	if lockKey == "" {
		lockKey = cacheDir
	}
	mu := getJobSetupMutex(lockKey)
	mu.Lock()
	defer mu.Unlock()

	if ctx.Err() != nil {
		return -1, ctx.Err() == context.DeadlineExceeded, ctx.Err()
	}
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return -1, false, err
	}

	sum := sha1.Sum([]byte(setupCmd))
	setupHash := hex.EncodeToString(sum[:])[:12]
	markerPath := filepath.Join(cacheDir, ".setup_"+setupHash+".done")

	if _, err := os.Stat(markerPath); err == nil {
		if streamer != nil {
			streamer.AddLine(fmt.Sprintf("[setup] cache hit (%s), skipping setup", setupHash))
		}
		return 0, false, nil
	}

	reportJobProgress(jobID, "installing", 10, fmt.Sprintf("กำลังรัน setup (%s)...", setupHash))
	if streamer != nil {
		streamer.AddLine(fmt.Sprintf("[setup] running setup (%s) in %s", setupHash, cacheDir))
	}

	setupCtx, setupCancel := context.WithTimeout(ctx, 30*time.Minute)
	defer setupCancel()

	exitCode, timedOut, err := runShellWithStream(setupCtx, jobID, setupCmd, cacheDir, env, "[setup] ", streamer, false)
	if err != nil {
		return exitCode, timedOut, err
	}

	if wErr := os.WriteFile(markerPath, []byte(time.Now().UTC().Format(time.RFC3339)+"\n"), 0644); wErr != nil {
		return -1, false, fmt.Errorf("failed to write setup marker: %w", wErr)
	}
	return 0, false, nil
}

func isPathWithinDir(baseDir string, targetPath string) bool {
	rel, err := filepath.Rel(baseDir, targetPath)
	if err != nil {
		return false
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) || filepath.IsAbs(rel) {
		return false
	}
	return true
}

func collectJobResult(workDir, outDir, logPath string, collectGlobs []string, destTarGz string) (int, int64, error) {
	absWork, err := filepath.Abs(workDir)
	if err != nil {
		return 0, 0, err
	}
	realWork, err := filepath.EvalSymlinks(absWork)
	if err != nil {
		realWork = absWork
	}
	absOut, err := filepath.Abs(outDir)
	if err != nil {
		return 0, 0, err
	}

	if err := os.MkdirAll(filepath.Dir(destTarGz), 0755); err != nil {
		return 0, 0, err
	}

	outFile, err := os.Create(destTarGz)
	if err != nil {
		return 0, 0, err
	}
	success := false
	defer func() {
		if !success {
			_ = outFile.Close()
			_ = os.Remove(destTarGz)
		}
	}()

	lw := &limitedWriter{w: outFile, limit: maxJobResultBytes}
	gzw := gzip.NewWriter(lw)
	tw := tar.NewWriter(gzw)

	seen := map[string]bool{}
	fileCount := 0

	addFile := func(srcPath string, archiveName string) error {
		cleanName := filepath.ToSlash(filepath.Clean(archiveName))
		cleanName = strings.TrimPrefix(cleanName, "./")
		if cleanName == "" || cleanName == "." || cleanName == ".." || strings.HasPrefix(cleanName, "/") || strings.HasPrefix(cleanName, "../") {
			return nil
		}
		if seen[cleanName] {
			return nil
		}

		linfo, lerr := os.Lstat(srcPath)
		if lerr != nil {
			return nil
		}
		actualPath := srcPath
		info := linfo
		if linfo.Mode()&os.ModeSymlink != 0 {
			resolved, rerr := filepath.EvalSymlinks(srcPath)
			if rerr != nil || !isPathWithinDir(realWork, resolved) {
				return nil
			}
			sinfo, serr := os.Stat(resolved)
			if serr != nil {
				return nil
			}
			actualPath = resolved
			info = sinfo
		} else {
			absSrc, aerr := filepath.Abs(srcPath)
			if aerr != nil || !isPathWithinDir(absWork, absSrc) {
				return nil
			}
		}

		if !info.Mode().IsRegular() {
			return nil
		}

		hdr := &tar.Header{
			Name:     cleanName,
			Size:     info.Size(),
			Mode:     int64(info.Mode().Perm()),
			ModTime:  info.ModTime(),
			Typeflag: tar.TypeReg,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		f, err := os.Open(actualPath)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(tw, f)
		_ = f.Close()
		if copyErr != nil {
			return copyErr
		}
		seen[cleanName] = true
		fileCount++
		return nil
	}

	// 1. Always collect out/** (archived relative to outDir so out/a.txt -> a.txt)
	if st, err := os.Stat(absOut); err == nil && st.IsDir() {
		if walkErr := filepath.WalkDir(absOut, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			rel, rerr := filepath.Rel(absOut, path)
			if rerr != nil {
				return nil
			}
			return addFile(path, rel)
		}); walkErr != nil {
			return 0, 0, walkErr
		}
	}

	// 2. Collect user-specified relative globs (no absolute paths or '..')
	for _, rawPat := range collectGlobs {
		pat := strings.TrimSpace(rawPat)
		if pat == "" {
			continue
		}
		normPat := strings.ReplaceAll(pat, "\\", "/")
		if filepath.IsAbs(pat) || strings.HasPrefix(normPat, "/") || (len(normPat) >= 2 && normPat[1] == ':') {
			return 0, 0, fmt.Errorf("unsafe collect pattern (absolute path): %s", pat)
		}
		for _, seg := range strings.Split(normPat, "/") {
			if seg == ".." {
				return 0, 0, fmt.Errorf("unsafe collect pattern (path traversal): %s", pat)
			}
		}

		matches, gerr := filepath.Glob(filepath.Join(absWork, filepath.FromSlash(normPat)))
		if gerr != nil {
			return 0, 0, fmt.Errorf("invalid collect glob %q: %w", pat, gerr)
		}
		for _, m := range matches {
			absM, aerr := filepath.Abs(m)
			if aerr != nil || !isPathWithinDir(absWork, absM) {
				continue
			}
			info, serr := os.Stat(absM)
			if serr != nil {
				continue
			}
			archiveRel := func(p string) string {
				if isPathWithinDir(absOut, p) && p != absOut {
					if rel, rerr := filepath.Rel(absOut, p); rerr == nil {
						return rel
					}
				}
				rel, _ := filepath.Rel(absWork, p)
				return rel
			}
			if info.IsDir() {
				if walkErr := filepath.WalkDir(absM, func(p string, d fs.DirEntry, err error) error {
					if err != nil || d.IsDir() {
						return nil
					}
					return addFile(p, archiveRel(p))
				}); walkErr != nil {
					return 0, 0, walkErr
				}
			} else {
				if err := addFile(absM, archiveRel(absM)); err != nil {
					return 0, 0, err
				}
			}
		}
	}

	// 3. Always include _job.log
	if _, serr := os.Stat(logPath); serr != nil {
		_ = os.WriteFile(logPath, []byte{}, 0644)
	}
	if err := addFile(logPath, "_job.log"); err != nil {
		return 0, 0, err
	}

	if err := tw.Close(); err != nil {
		return 0, 0, err
	}
	if err := gzw.Close(); err != nil {
		return 0, 0, err
	}
	if err := outFile.Close(); err != nil {
		return 0, 0, err
	}
	success = true
	return fileCount, lw.written, nil
}

func uploadJobResult(jobID string, tarPath string, exitCode int, durationMs int64) (map[string]interface{}, error) {
	st, err := os.Stat(tarPath)
	if err != nil {
		return nil, err
	}
	upPath := fmt.Sprintf("/api/agent-hub/agent/job-upload?jobId=%s&nodeId=%s&filename=%s",
		url.QueryEscape(jobID), url.QueryEscape(agentCfg.NodeID), url.QueryEscape("result.tar.gz"))

	// For archives <= 64 MB use in-memory multipart with automatic doHubRequest failover (same pattern as handleRenderRemotion)
	if st.Size() <= 64*1024*1024 {
		rawBytes, rerr := os.ReadFile(tarPath)
		if rerr != nil {
			return nil, rerr
		}
		var mpBuf bytes.Buffer
		mw := multipart.NewWriter(&mpBuf)
		_ = mw.WriteField("jobId", jobID)
		_ = mw.WriteField("nodeId", agentCfg.NodeID)
		_ = mw.WriteField("exitCode", fmt.Sprintf("%d", exitCode))
		_ = mw.WriteField("durationMs", fmt.Sprintf("%d", durationMs))
		fw, cerr := mw.CreateFormFile("file", "result.tar.gz")
		if cerr != nil {
			return nil, cerr
		}
		if _, werr := fw.Write(rawBytes); werr != nil {
			return nil, werr
		}
		mw.Close()

		upResp, _, upErr := doHubRequest(transferClient, "POST", upPath, mpBuf.Bytes(), mw.FormDataContentType())
		if upErr != nil {
			return nil, upErr
		}
		defer upResp.Body.Close()
		var upData map[string]interface{}
		_ = json.NewDecoder(upResp.Body).Decode(&upData)
		if upResp.StatusCode >= 400 {
			return upData, fmt.Errorf("upload returned HTTP %d", upResp.StatusCode)
		}
		return upData, nil
	}

	// For larger archives (64..480 MB) stream multipart via io.Pipe to avoid large RAM spikes
	endpointMutex.RLock()
	activeEP := currentEndpoint
	endpointMutex.RUnlock()

	candidates := make([]string, 0, len(agentCfg.HubURLs)+1)
	if activeEP != "" {
		candidates = append(candidates, activeEP)
	}
	for _, u := range agentCfg.HubURLs {
		if u != activeEP {
			candidates = append(candidates, u)
		}
	}

	var lastErr error
	for _, base := range candidates {
		pr, pw := io.Pipe()
		mw := multipart.NewWriter(pw)
		ct := mw.FormDataContentType()

		go func() {
			defer pw.Close()
			_ = mw.WriteField("jobId", jobID)
			_ = mw.WriteField("nodeId", agentCfg.NodeID)
			_ = mw.WriteField("exitCode", fmt.Sprintf("%d", exitCode))
			_ = mw.WriteField("durationMs", fmt.Sprintf("%d", durationMs))
			fw, cerr := mw.CreateFormFile("file", "result.tar.gz")
			if cerr != nil {
				_ = pw.CloseWithError(cerr)
				return
			}
			f, oerr := os.Open(tarPath)
			if oerr != nil {
				_ = pw.CloseWithError(oerr)
				return
			}
			_, copyErr := io.Copy(fw, f)
			_ = f.Close()
			if copyErr != nil {
				_ = pw.CloseWithError(copyErr)
				return
			}
			if closeErr := mw.Close(); closeErr != nil {
				_ = pw.CloseWithError(closeErr)
			}
		}()

		req, reqErr := http.NewRequest("POST", base+upPath, pr)
		if reqErr != nil {
			_ = pr.Close()
			lastErr = reqErr
			continue
		}
		req.Header.Set("X-Agent-Token", agentCfg.Token)
		req.Header.Set("X-Agent-Node", agentCfg.NodeID)
		req.Header.Set("X-Agent-Version", AgentVersion)
		req.Header.Set("Content-Type", ct)

		resp, doErr := transferClient.Do(req)
		if doErr != nil {
			_ = pr.Close()
			lastErr = doErr
			continue
		}
		if resp.StatusCode >= 502 && resp.StatusCode <= 504 {
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			lastErr = fmt.Errorf("gateway status %d from %s", resp.StatusCode, base)
			continue
		}
		endpointMutex.Lock()
		currentEndpoint = base
		endpointMutex.Unlock()

		var upData map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&upData)
		resp.Body.Close()
		if resp.StatusCode >= 400 {
			return upData, fmt.Errorf("upload returned HTTP %d", resp.StatusCode)
		}
		return upData, nil
	}
	return nil, lastErr
}

func handleJobCancel(p map[string]interface{}) (map[string]interface{}, error) {
	jobID := strings.TrimSpace(getString(p, "jobId", ""))
	if jobID == "" {
		return nil, fmt.Errorf("missing jobId")
	}
	v, ok := runningJobs.Load(jobID)
	if !ok {
		return nil, fmt.Errorf("not running")
	}
	entry := v.(*runningJobEntry)
	entry.cancelled.Store(true)
	entry.cancel()
	return map[string]interface{}{
		"jobId":     jobID,
		"cancelled": true,
	}, nil
}

func handleJobRun(p map[string]interface{}) (map[string]interface{}, error) {
	atomic.AddInt32(&activeJobsCount, 1)
	defer atomic.AddInt32(&activeJobsCount, -1)

	started := time.Now()
	specs := getSpecs()

	jobID := strings.TrimSpace(getString(p, "jobId", ""))
	if jobID == "" {
		jobID = fmt.Sprintf("job-%d", time.Now().Unix())
	}
	jobName := strings.TrimSpace(getString(p, "name", ""))
	displayJobName := jobName
	if displayJobName == "" {
		displayJobName = jobID
	}
	runtimeState.StartJob(jobID, displayJobName, "generic", "กำลังเตรียมงาน...", true)
	defer runtimeState.FinishJob(jobID, "failed", "งานจบลงก่อนกำหนด")
	inputURL := strings.TrimSpace(getString(p, "inputUrl", ""))
	cacheKey := sanitizeCacheKey(getString(p, "cacheKey", ""))
	timeoutSec := getInt(p, "timeoutSec", 1800)
	if timeoutSec <= 0 {
		timeoutSec = 1800
	}
	if timeoutSec > 86400 {
		timeoutSec = 86400
	}

	var collectGlobs []string
	if rawCollect, ok := p["collect"]; ok && rawCollect != nil {
		switch cv := rawCollect.(type) {
		case []interface{}:
			for _, item := range cv {
				if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
					collectGlobs = append(collectGlobs, strings.TrimSpace(s))
				}
			}
		case string:
			if strings.TrimSpace(cv) != "" {
				collectGlobs = append(collectGlobs, strings.TrimSpace(cv))
			}
		}
	}

	extraEnv, _ := p["env"].(map[string]interface{})

	finishEarly := func(status string, exitCode int, errMsg string) (map[string]interface{}, error) {
		durMs := time.Since(started).Milliseconds()
		reportJobFinal(jobID, status, exitCode, errMsg, durMs)
		data := map[string]interface{}{
			"jobId":      jobID,
			"exitCode":   exitCode,
			"status":     status,
			"durationMs": durMs,
		}
		if status == "completed" {
			return data, nil
		}
		return data, fmt.Errorf("%s", errMsg)
	}

	rawCmd := p["command"]
	if rawCmd == nil {
		rawCmd = p["cmd"]
	}
	mainCmd, cmdErr := resolveOSCommand(rawCmd, true)
	if cmdErr != nil {
		return finishEarly("failed", -1, cmdErr.Error())
	}

	setupCmd, setupResolveErr := resolveOSCommand(p["setup"], false)
	if setupResolveErr != nil {
		return finishEarly("failed", -1, "setup: "+setupResolveErr.Error())
	}

	workDir := filepath.Join(specs.InstallDir, "jobs", jobID)
	inDir := filepath.Join(workDir, "in")
	outDir := filepath.Join(workDir, "out")
	cacheDir := filepath.Join(workDir, "cache")
	if cacheKey != "" {
		cacheDir = filepath.Join(specs.InstallDir, "job-cache", cacheKey)
	}

	for _, d := range []string{workDir, inDir, outDir, cacheDir} {
		if err := os.MkdirAll(d, 0755); err != nil {
			return finishEarly("failed", -1, "สร้างโฟลเดอร์งานไม่สำเร็จ: "+err.Error())
		}
	}
	defer os.RemoveAll(workDir)

	cancelCtx, jobCancel := context.WithCancel(context.Background())
	defer jobCancel()
	entry := &runningJobEntry{cancel: jobCancel}
	runningJobs.Store(jobID, entry)
	defer runningJobs.Delete(jobID)

	logPath := filepath.Join(workDir, "_job.log")
	streamer, sErr := newJobLogStreamer(jobID, logPath)
	if sErr != nil {
		return finishEarly("failed", -1, "สร้างไฟล์ log ไม่สำเร็จ: "+sErr.Error())
	}
	defer streamer.Close()

	env := buildJobEnv(workDir, inDir, outDir, cacheDir, jobID, jobName, extraEnv, specs)

	// 1. Download & extract input bundle if provided
	if inputURL != "" {
		if entry.cancelled.Load() {
			streamer.Close()
			return finishEarly("cancelled", -1, "Job cancelled")
		}
		reportJobProgress(jobID, "downloading", 5, "กำลังดาวน์โหลดไฟล์อินพุตจาก Homelab...")
		inputTgz := filepath.Join(specs.InstallDir, "jobs", jobID+".input.tar.gz")
		defer os.Remove(inputTgz)
		if err := downloadHubToFile(inputURL, inputTgz); err != nil {
			if entry.cancelled.Load() {
				streamer.Close()
				return finishEarly("cancelled", -1, "Job cancelled")
			}
			streamer.AddLine("[error] input download failed: " + err.Error())
			streamer.Close()
			return finishEarly("failed", -1, "ดาวน์โหลดไฟล์อินพุตไม่สำเร็จ: "+err.Error())
		}
		if err := extractTarGzSafe(inputTgz, inDir); err != nil {
			streamer.AddLine("[error] input extract failed: " + err.Error())
			streamer.Close()
			return finishEarly("failed", -1, "แตกไฟล์อินพุตไม่สำเร็จ: "+err.Error())
		}
		_ = os.Remove(inputTgz)
	}

	// 2. Run optional setup command in cacheDir (cached via sha1 marker)
	exitCode := 0
	timedOut := false
	var runErr error
	setupFailed := false

	if setupCmd != "" {
		if entry.cancelled.Load() {
			streamer.Close()
			return finishEarly("cancelled", -1, "Job cancelled")
		}
		exitCode, timedOut, runErr = runJobSetup(cancelCtx, jobID, setupCmd, cacheKey, cacheDir, env, streamer)
		if entry.cancelled.Load() {
			streamer.Close()
			return finishEarly("cancelled", exitCode, "Job cancelled during setup")
		}
		if timedOut {
			streamer.Close()
			return finishEarly("timeout", exitCode, "Setup timed out after 30 minutes")
		}
		if runErr != nil {
			setupFailed = true
		}
	}

	// 3. Run main command if setup succeeded
	if !setupFailed {
		if entry.cancelled.Load() {
			streamer.Close()
			return finishEarly("cancelled", -1, "Job cancelled")
		}
		reportJobProgress(jobID, "running", 20, fmt.Sprintf("กำลังรันงานบน %s...", specs.NodeID))

		runCtx, runCancel := context.WithTimeout(cancelCtx, time.Duration(timeoutSec)*time.Second)
		exitCode, timedOut, runErr = runShellWithStream(runCtx, jobID, mainCmd, workDir, env, "", streamer, true)
		runCancel()
	}

	// Flush all buffered log lines and close _job.log before archiving or reporting final status
	streamer.Close()

	if entry.cancelled.Load() {
		return finishEarly("cancelled", exitCode, "Job cancelled")
	}
	if timedOut {
		return finishEarly("timeout", exitCode, fmt.Sprintf("Job timed out after %ds", timeoutSec))
	}

	// 4. Collect out/** + collect globs + _job.log and upload result.tar.gz (both on exit 0 and non-zero)
	reportJobProgress(jobID, "uploading", 95, "กำลังรวบรวมและอัปโหลดไฟล์ผลลัพธ์...")

	tarPath := filepath.Join(specs.InstallDir, "jobs", jobID+".result.tar.gz")
	defer os.Remove(tarPath)

	if _, _, collectErr := collectJobResult(workDir, outDir, logPath, collectGlobs, tarPath); collectErr != nil {
		return finishEarly("failed", exitCode, "รวบรวมไฟล์ผลลัพธ์ไม่สำเร็จ: "+collectErr.Error())
	}

	if _, upErr := uploadJobResult(jobID, tarPath, exitCode, time.Since(started).Milliseconds()); upErr != nil {
		return finishEarly("failed", exitCode, "อัปโหลดไฟล์ผลลัพธ์ไม่สำเร็จ: "+upErr.Error())
	}

	durMs := time.Since(started).Milliseconds()
	if setupFailed || exitCode != 0 || runErr != nil {
		var errMsg string
		if setupFailed {
			errMsg = fmt.Sprintf("Setup failed (exitCode=%d)", exitCode)
		} else {
			errMsg = fmt.Sprintf("Command exited with code %d", exitCode)
		}
		if tail := streamer.Tail(1500); tail != "" {
			errMsg += ": " + tail
		}
		reportJobFinal(jobID, "failed", exitCode, errMsg, durMs)
		return map[string]interface{}{
			"jobId":      jobID,
			"exitCode":   exitCode,
			"status":     "failed",
			"durationMs": durMs,
		}, fmt.Errorf("%s", errMsg)
	}

	reportJobFinal(jobID, "completed", 0, "", durMs)
	return map[string]interface{}{
		"jobId":      jobID,
		"exitCode":   0,
		"status":     "completed",
		"durationMs": durMs,
	}, nil
}

func handleSelfUpdate(p map[string]interface{}) (map[string]interface{}, error) {
	dlPath := getString(p, "downloadPath", "")
	if dlPath == "" {
		if runtime.GOOS == "windows" {
			dlPath = "/api/agent-hub/download/homelab-agent.exe"
		} else {
			dlPath = fmt.Sprintf("/api/agent-hub/download/homelab-agent-%s-%s", runtime.GOOS, runtime.GOARCH)
		}
	}

	resp, _, err := doHubRequest(transferClient, "GET", dlPath, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("download returned HTTP %d", resp.StatusCode)
	}

	newBin, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if len(newBin) < 100*1024 {
		return nil, fmt.Errorf("downloaded binary too small (%d bytes)", len(newBin))
	}

	exePath, err := os.Executable()
	if err != nil {
		return nil, err
	}
	exePath, _ = filepath.Abs(exePath)
	installDir := filepath.Dir(exePath)

	newTmp := exePath + ".new"
	oldBak := exePath + ".old"
	_ = os.Remove(oldBak)
	if err := os.WriteFile(newTmp, newBin, 0755); err != nil {
		return nil, err
	}

	if err := os.Rename(exePath, oldBak); err != nil {
		_ = os.Remove(newTmp)
		return nil, fmt.Errorf("failed to move current exe: %w", err)
	}
	if err := os.Rename(newTmp, exePath); err != nil {
		_ = os.Rename(oldBak, exePath)
		return nil, fmt.Errorf("failed to activate new exe: %w", err)
	}

	sum := sha256.Sum256(newBin)
	go func() {
		time.Sleep(1500 * time.Millisecond)
		stopSystemTray()
		_ = spawnBackgroundDaemon(exePath, installDir)
		os.Exit(0)
	}()

	return map[string]interface{}{
		"updated": true,
		"exePath": exePath,
		"size":    len(newBin),
		"sha256":  hex.EncodeToString(sum[:]),
	}, nil
}

func copyFile(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	closeErr := out.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func killExistingAgentOnWindows(targetExe string) {
	if runtime.GOOS != "windows" {
		return
	}
	myPID := os.Getpid()
	ps := fmt.Sprintf(`Get-Process -Name "homelab-agent*" -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne %d } | Stop-Process -Force -ErrorAction SilentlyContinue`, myPID)
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps)
	cmd.SysProcAttr = hideWindowAttr()
	_ = cmd.Run()
	time.Sleep(400 * time.Millisecond)
}

func main() {
	var (
		flagService    = flag.Bool("service", false, "Run in background daemon service mode")
		flagForeground = flag.Bool("foreground", false, "Run in foreground console mode")
		flagInstall    = flag.Bool("install", false, "Install agent to local system and start background service")
		flagHub        = flag.String("hub", "", "Comma-separated Homelab Hub URLs")
		flagToken      = flag.String("token", "", "Agent authentication token")
		flagNodeID     = flag.String("node-id", "", "Custom node ID (defaults to hostname)")
		flagOnce       = flag.Bool("once", false, "Send one heartbeat and exit (for self-test)")
		flagNoTray     = flag.Bool("no-tray", false, "Disable native system tray icon")
		flagUIPort     = flag.Int("ui-port", 18470, "Local status web app port on 127.0.0.1")
		flagOpenUI     = flag.Bool("ui", false, "Open the local status app window")
	)
	flag.Parse()

	initHTTPClients()
	initPlatformTimer()

	// If --ui is passed without --service/--foreground/--install/--once and an agent is already running, open its UI immediately.
	if *flagOpenUI && !*flagService && !*flagForeground && !*flagInstall && !*flagOnce {
		if existingURL := checkExistingLocalUI(*flagUIPort); existingURL != "" {
			openLocalStatusApp(existingURL)
			return
		}
	}

	targetDir := getDefaultInstallDir()
	exeName := "homelab-agent"
	if runtime.GOOS == "windows" {
		exeName = "homelab-agent.exe"
	}
	targetExe := filepath.Join(targetDir, exeName)
	currExe, _ := os.Executable()
	currExe, _ = filepath.Abs(currExe)
	targetExeAbs, _ := filepath.Abs(targetExe)

	// Cleaning up any .old binary from self-update
	_ = os.Remove(currExe + ".old")
	_ = os.Remove(targetExeAbs + ".old")

	// When user double-clicks homelab-agent.exe on Windows (no flags) or passes --install:
	isAutoInstall := (!*flagService && !*flagForeground && !*flagOnce && !*flagOpenUI && runtime.GOOS == "windows") || *flagInstall
	if isAutoInstall {
		fmt.Println("============================================================")
		fmt.Printf("  Homelab Worker Agent v%s — Zero-Config Installer\n", AgentVersion)
		fmt.Println("============================================================")
		_ = os.MkdirAll(targetDir, 0755)
		agentCfg = loadOrInitConfig(targetDir, *flagHub, *flagToken, *flagNodeID)
		runtimeState.SetInstallDir(targetDir)

		killExistingAgentOnWindows(targetExeAbs)

		if !strings.EqualFold(currExe, targetExeAbs) {
			fmt.Printf("[1/4] Installing binary to %s ...\n", targetExeAbs)
			if err := copyFile(currExe, targetExeAbs, 0755); err != nil {
				fmt.Printf("      Warning: copy failed (%v), running from current path\n", err)
				targetExeAbs = currExe
				targetDir = filepath.Dir(currExe)
			}
		} else {
			fmt.Printf("[1/4] Binary already in target directory: %s\n", targetExeAbs)
		}

		fmt.Println("[2/4] Registering auto-start on Windows login (Registry + Scheduled Task)...")
		_ = installPlatformAutoStart(targetDir, targetExeAbs)

		fmt.Println("[3/4] Collecting hardware telemetry & testing connection to Homelab Hub...")
		refreshStaticSpecs(targetDir)
		if err := sendHeartbeat(); err != nil {
			fmt.Printf("      Warning: initial heartbeat returned: %v (daemon will keep retrying)\n", err)
		} else {
			endpointMutex.RLock()
			ep := currentEndpoint
			endpointMutex.RUnlock()
			fmt.Printf("      Connected to Homelab Hub via %s (Node ID: %s)\n", ep, agentCfg.NodeID)
		}

		fmt.Println("[4/4] Starting silent background service with System Tray icon...")
		if err := spawnBackgroundDaemon(targetExeAbs, targetDir); err != nil {
			fmt.Printf("      Error spawning background daemon: %v\n", err)
		} else {
			fmt.Println("      Homelab Agent is now running in background with System Tray icon!")
		}
		fmt.Println("============================================================")
		return
	}

	installDir := filepath.Dir(currExe)
	if _, err := os.Stat(filepath.Join(targetDir, "agent-config.json")); err == nil {
		installDir = targetDir
	}
	agentCfg = loadOrInitConfig(installDir, *flagHub, *flagToken, *flagNodeID)
	runtimeState.SetInstallDir(installDir)
	refreshStaticSpecs(installDir)

	if *flagOnce {
		if err := sendHeartbeat(); err != nil {
			fmt.Fprintf(os.Stderr, "heartbeat failed: %v\n", err)
			os.Exit(1)
		}
		endpointMutex.RLock()
		ep := currentEndpoint
		endpointMutex.RUnlock()
		fmt.Printf("OK node=%s endpoint=%s\n", agentCfg.NodeID, ep)
		return
	}

	// Setup log file if running as background --service
	if *flagService {
		logPath := filepath.Join(installDir, "agent.log")
		if lf, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644); err == nil {
			os.Stdout = lf
			os.Stderr = lf
		}
	}

	stopCh := make(chan struct{})
	var stopOnce sync.Once
	requestShutdown := func() {
		stopOnce.Do(func() {
			close(stopCh)
		})
	}

	uiSrv, uiErr := startLocalUIServer(*flagUIPort, requestShutdown)
	if uiErr != nil {
		fmt.Printf("[%s] Warning: local status UI failed to start: %v\n", time.Now().Format(time.RFC3339), uiErr)
	} else {
		defer uiSrv.Close()
		runtimeState.RecordEvent("info", "เปิด Local Status App ที่ "+uiSrv.url)
	}

	if !*flagNoTray {
		startSystemTray(stopCh, requestShutdown)
	}
	if *flagOpenUI && uiSrv != nil {
		go openLocalStatusApp(uiSrv.url)
	}

	fmt.Printf("[%s] Homelab Agent v%s starting (node=%s, os=%s/%s, ui=%s)\n",
		time.Now().Format(time.RFC3339), AgentVersion, agentCfg.NodeID, runtime.GOOS, runtime.GOARCH, runtimeState.LocalUIURL())
	runtimeState.RecordEvent("info", fmt.Sprintf("เริ่มต้น Homelab Agent v%s (%s)", AgentVersion, agentCfg.NodeID))

	_ = sendHeartbeat()

	go pollLoop(stopCh)

	hbTicker := time.NewTicker(5 * time.Second)
	specTicker := time.NewTicker(2 * time.Minute)
	pruneTicker := time.NewTicker(5 * time.Minute)
	defer hbTicker.Stop()
	defer specTicker.Stop()
	defer pruneTicker.Stop()

	for {
		select {
		case <-stopCh:
			fmt.Printf("[%s] Homelab Agent shutting down...\n", time.Now().Format(time.RFC3339))
			stopSystemTray()
			if uiSrv != nil {
				uiSrv.Close()
			}
			time.Sleep(150 * time.Millisecond)
			return
		case <-hbTicker.C:
			_ = sendHeartbeat()
		case <-specTicker.C:
			refreshStaticSpecs(installDir)
		case <-pruneTicker.C:
			cutoff := time.Now().Add(-15 * time.Minute)
			executedCmds.Range(func(k, v interface{}) bool {
				if t, ok := v.(time.Time); ok && t.Before(cutoff) {
					executedCmds.Delete(k)
				}
				return true
			})
		}
	}
}
