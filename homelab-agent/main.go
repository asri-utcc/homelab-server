package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var (
	AgentVersion   = "1.0.0"
	DefaultHubURLs = "http://192.168.1.123:8090,https://192.168.1.123,http://100.93.214.79:8090,https://homelab.tail285279.ts.net"
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
	CPUPct     float64    `json:"cpuPct"`
	MemTotal   uint64     `json:"memTotal"`
	MemUsed    uint64     `json:"memUsed"`
	MemFree    uint64     `json:"memFree"`
	MemPct     float64    `json:"memPct"`
	Disks      []DiskInfo `json:"disks"`
	UptimeSec  uint64     `json:"uptimeSec"`
	GPUTempC   int        `json:"gpuTempC"`
	GPUUtilPct int        `json:"gpuUtilPct"`
	ActiveJobs int32      `json:"activeJobs"`
	HubEndpoint string    `json:"hubEndpoint"`
	Timestamp  string     `json:"timestamp"`
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
	OK       bool           `json:"ok"`
	Commands []AgentCommand `json:"commands"`
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

	caps := []string{"remote-exec", "file-ops"}
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
		ActiveJobs:  atomic.LoadInt32(&activeJobsCount),
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
		return err
	}
	resp, _, err := doHubRequest(httpClient, "POST", "/api/agent-hub/agent/heartbeat", data, "application/json")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("heartbeat HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var hbResp HeartbeatResponse
	if err := json.NewDecoder(resp.Body).Decode(&hbResp); err == nil {
		for _, cmd := range hbResp.Commands {
			dispatchCommandAsync(cmd)
		}
	}
	return nil
}

func pollLoop(stopCh <-chan struct{}) {
	for {
		select {
		case <-stopCh:
			return
		default:
		}
		path := fmt.Sprintf("/api/agent-hub/agent/poll?nodeId=%s&timeout=25", url.QueryEscape(agentCfg.NodeID))
		resp, _, err := doHubRequest(longPollClient, "GET", path, nil, "")
		if err != nil {
			time.Sleep(3 * time.Second)
			continue
		}
		var pollResp HeartbeatResponse
		err = json.NewDecoder(resp.Body).Decode(&pollResp)
		resp.Body.Close()
		if err != nil {
			time.Sleep(2 * time.Second)
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

	case "self-update":
		return handleSelfUpdate(cmd.Payload)

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
	inputURL := getString(p, "inputUrl", "")
	outputName := getString(p, "outputName", jobID+".mp4")
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
	)
	flag.Parse()

	initHTTPClients()
	initPlatformTimer()

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
	isAutoInstall := (!*flagService && !*flagForeground && !*flagOnce && runtime.GOOS == "windows") || *flagInstall
	if isAutoInstall {
		fmt.Println("============================================================")
		fmt.Printf("  Homelab Worker Agent v%s — Zero-Config Installer\n", AgentVersion)
		fmt.Println("============================================================")
		_ = os.MkdirAll(targetDir, 0755)
		agentCfg = loadOrInitConfig(targetDir, *flagHub, *flagToken, *flagNodeID)

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

		fmt.Println("[4/4] Starting silent background service...")
		if err := spawnBackgroundDaemon(targetExeAbs, targetDir); err != nil {
			fmt.Printf("      Error spawning background daemon: %v\n", err)
		} else {
			fmt.Println("      Homelab Agent is now running silently in the background!")
		}
		fmt.Println("============================================================")
		return
	}

	installDir := filepath.Dir(currExe)
	if _, err := os.Stat(filepath.Join(targetDir, "agent-config.json")); err == nil {
		installDir = targetDir
	}
	agentCfg = loadOrInitConfig(installDir, *flagHub, *flagToken, *flagNodeID)
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

	fmt.Printf("[%s] Homelab Agent v%s starting (node=%s, os=%s/%s)\n",
		time.Now().Format(time.RFC3339), AgentVersion, agentCfg.NodeID, runtime.GOOS, runtime.GOARCH)

	_ = sendHeartbeat()

	stopCh := make(chan struct{})
	go pollLoop(stopCh)

	hbTicker := time.NewTicker(5 * time.Second)
	specTicker := time.NewTicker(2 * time.Minute)
	pruneTicker := time.NewTicker(5 * time.Minute)
	defer hbTicker.Stop()
	defer specTicker.Stop()
	defer pruneTicker.Stop()

	for {
		select {
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
