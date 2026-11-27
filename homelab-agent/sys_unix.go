//go:build !windows

package main

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

var (
	cpuSampleMu   sync.Mutex
	lastUnixIdle  uint64
	lastUnixTotal uint64
	lastUnixPct   float64
)

func hideWindowAttr() *syscall.SysProcAttr {
	return nil
}

func newShellCmd(command string) *exec.Cmd {
	cmd := exec.Command("/bin/sh", "-c", command)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}
	return cmd
}

func killProcessTree(c *exec.Cmd) {
	if c == nil || c.Process == nil {
		return
	}
	pid := c.Process.Pid
	if pid <= 0 {
		return
	}
	_ = syscall.Kill(-pid, syscall.SIGKILL)
	_ = c.Process.Kill()
}

func sampleLinuxCPU() float64 {
	cpuSampleMu.Lock()
	defer cpuSampleMu.Unlock()

	f, err := os.Open("/proc/stat")
	if err != nil {
		return lastUnixPct
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	if !scanner.Scan() {
		return lastUnixPct
	}
	fields := strings.Fields(scanner.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return lastUnixPct
	}
	var total, idle uint64
	for i, s := range fields[1:] {
		v, _ := strconv.ParseUint(s, 10, 64)
		total += v
		if i == 3 || i == 4 { // idle + iowait
			idle += v
		}
	}
	if lastUnixTotal == 0 {
		lastUnixTotal = total
		lastUnixIdle = idle
		return 0
	}
	if total < lastUnixTotal || idle < lastUnixIdle {
		lastUnixTotal = total
		lastUnixIdle = idle
		return lastUnixPct
	}
	dTotal := total - lastUnixTotal
	dIdle := idle - lastUnixIdle
	lastUnixTotal = total
	lastUnixIdle = idle
	if dTotal == 0 {
		return lastUnixPct
	}
	busy := uint64(0)
	if dTotal > dIdle {
		busy = dTotal - dIdle
	}
	pct := (float64(busy) / float64(dTotal)) * 100.0
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	lastUnixPct = pct
	return lastUnixPct
}

func collectPlatformStaticSpecs() (cpuModel string, cpuCores int, gpuModel string, gpuVramMB int, osCaption string) {
	cpuCores = runtime.NumCPU()
	osCaption = runtime.GOOS + "/" + runtime.GOARCH

	if f, err := os.Open("/etc/os-release"); err == nil {
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				osCaption = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"'`)
				break
			}
		}
	}

	if f, err := os.Open("/proc/cpuinfo"); err == nil {
		defer f.Close()
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "model name") {
				parts := strings.SplitN(line, ":", 2)
				if len(parts) == 2 {
					cpuModel = strings.TrimSpace(parts[1])
					break
				}
			}
		}
	}
	if cpuModel == "" && runtime.GOOS == "darwin" {
		if out, err := exec.Command("sysctl", "-n", "machdep.cpu.brand_string").Output(); err == nil {
			cpuModel = strings.TrimSpace(string(out))
		}
	}

	if out, err := exec.Command("nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits").Output(); err == nil {
		line := strings.TrimSpace(strings.Split(string(out), "\n")[0])
		parts := strings.Split(line, ",")
		if len(parts) >= 1 {
			gpuModel = strings.TrimSpace(parts[0])
		}
		if len(parts) >= 2 {
			fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &gpuVramMB)
		}
	}
	return
}

func collectPlatformLiveMetrics() (cpuPct float64, memTotal, memUsed, memFree uint64, memPct float64, disks []DiskInfo, uptimeSec uint64, gpuTempC int, gpuUtilPct int) {
	cpuPct = sampleLinuxCPU()

	if f, err := os.Open("/proc/meminfo"); err == nil {
		defer f.Close()
		var totalKB, availKB uint64
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			fields := strings.Fields(sc.Text())
			if len(fields) >= 2 {
				val, _ := strconv.ParseUint(fields[1], 10, 64)
				switch fields[0] {
				case "MemTotal:":
					totalKB = val
				case "MemAvailable:":
					availKB = val
				}
			}
		}
		memTotal = totalKB * 1024
		memFree = availKB * 1024
		if memTotal > memFree {
			memUsed = memTotal - memFree
		}
		if memTotal > 0 {
			memPct = (float64(memUsed) / float64(memTotal)) * 100.0
		}
	}

	if data, err := os.ReadFile("/proc/uptime"); err == nil {
		fields := strings.Fields(string(data))
		if len(fields) > 0 {
			if v, err := strconv.ParseFloat(fields[0], 64); err == nil {
				uptimeSec = uint64(v)
			}
		}
	}

	var st syscall.Statfs_t
	if syscall.Statfs("/", &st) == nil && st.Blocks > 0 {
		total := st.Blocks * uint64(st.Bsize)
		free := st.Bavail * uint64(st.Bsize)
		used := uint64(0)
		if total > free {
			used = total - free
		}
		pct := (float64(used) / float64(total)) * 100.0
		disks = append(disks, DiskInfo{
			Mount:   "/",
			Total:   total,
			Used:    used,
			Free:    free,
			UsedPct: pct,
		})
	}

	if cachedSpecs.HasNvidiaSmi {
		if out, err := exec.Command("nvidia-smi", "--query-gpu=temperature.gpu,utilization.gpu", "--format=csv,noheader,nounits").Output(); err == nil {
			line := strings.TrimSpace(strings.Split(string(out), "\n")[0])
			parts := strings.Split(line, ",")
			if len(parts) >= 2 {
				fmt.Sscanf(strings.TrimSpace(parts[0]), "%d", &gpuTempC)
				fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &gpuUtilPct)
			}
		}
	}
	return
}

func installPlatformAutoStart(targetDir string, targetExe string) error {
	return nil
}

func spawnBackgroundDaemon(targetExe string, targetDir string) error {
	cmd := exec.Command(targetExe, "--service")
	cmd.Dir = targetDir
	return cmd.Start()
}

func getDefaultInstallDir() string {
	home, _ := os.UserHomeDir()
	if home == "" {
		return "/tmp/homelab-agent"
	}
	return filepath.Join(home, ".local", "share", "homelab-agent")
}

func getPlatformTopProcs() string {
	out, err := exec.Command("ps", "-eo", "pid,comm,pcpu,pmem", "--sort=-%cpu").Output()
	if err != nil {
		return ""
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) > 15 {
		lines = lines[:15]
	}
	return strings.Join(lines, "\n")
}

func initPlatformTimer() {
	go func() {
		for {
			time.Sleep(2 * time.Second)
			sampleLinuxCPU()
		}
	}()
}
