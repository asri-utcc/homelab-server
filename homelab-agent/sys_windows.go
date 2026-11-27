//go:build windows

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	procGlobalMemoryStatusEx = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetSystemTimes       = kernel32.NewProc("GetSystemTimes")
	procGetDiskFreeSpaceExW  = kernel32.NewProc("GetDiskFreeSpaceExW")
	procGetTickCount64       = kernel32.NewProc("GetTickCount64")
)

type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

type fileTime struct {
	LowDateTime  uint32
	HighDateTime uint32
}

func fileTimeToUint64(ft fileTime) uint64 {
	return (uint64(ft.HighDateTime) << 32) | uint64(ft.LowDateTime)
}

var (
	cpuSampleMu    sync.Mutex
	lastIdleTime   uint64
	lastKernelTime uint64
	lastUserTime   uint64
	lastCpuPct     float64
)

func init() {
	sampleWindowsCPU()
}

func sampleWindowsCPU() float64 {
	cpuSampleMu.Lock()
	defer cpuSampleMu.Unlock()

	var idle, kernel, user fileTime
	r, _, _ := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idle)),
		uintptr(unsafe.Pointer(&kernel)),
		uintptr(unsafe.Pointer(&user)),
	)
	if r == 0 {
		return lastCpuPct
	}
	i := fileTimeToUint64(idle)
	k := fileTimeToUint64(kernel)
	u := fileTimeToUint64(user)

	if lastKernelTime == 0 && lastUserTime == 0 {
		lastIdleTime = i
		lastKernelTime = k
		lastUserTime = u
		return 0
	}

	if i < lastIdleTime || k < lastKernelTime || u < lastUserTime {
		lastIdleTime = i
		lastKernelTime = k
		lastUserTime = u
		return lastCpuPct
	}

	dIdle := i - lastIdleTime
	dKernel := k - lastKernelTime
	dUser := u - lastUserTime
	lastIdleTime = i
	lastKernelTime = k
	lastUserTime = u

	total := dKernel + dUser
	if total == 0 {
		return lastCpuPct
	}
	busy := uint64(0)
	if total > dIdle {
		busy = total - dIdle
	}
	pct := (float64(busy) / float64(total)) * 100.0
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	lastCpuPct = pct
	return pct
}

func getWindowsMemory() (total uint64, used uint64, free uint64, pct float64) {
	var mem memoryStatusEx
	mem.Length = uint32(unsafe.Sizeof(mem))
	r, _, _ := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&mem)))
	if r == 0 {
		return 0, 0, 0, 0
	}
	total = mem.TotalPhys
	free = mem.AvailPhys
	if total > free {
		used = total - free
	}
	if total > 0 {
		pct = (float64(used) / float64(total)) * 100.0
	}
	return total, used, free, pct
}

func getWindowsUptimeSec() uint64 {
	r, _, _ := procGetTickCount64.Call()
	return uint64(r) / 1000
}

func getWindowsDisks() []DiskInfo {
	var disks []DiskInfo
	for c := 'C'; c <= 'Z'; c++ {
		drive := fmt.Sprintf("%c:\\", c)
		drivePtr, err := syscall.UTF16PtrFromString(drive)
		if err != nil {
			continue
		}
		var freeBytesAvailable, totalNumberOfBytes, totalNumberOfFreeBytes uint64
		r, _, _ := procGetDiskFreeSpaceExW.Call(
			uintptr(unsafe.Pointer(drivePtr)),
			uintptr(unsafe.Pointer(&freeBytesAvailable)),
			uintptr(unsafe.Pointer(&totalNumberOfBytes)),
			uintptr(unsafe.Pointer(&totalNumberOfFreeBytes)),
		)
		if r == 0 || totalNumberOfBytes == 0 {
			continue
		}
		used := uint64(0)
		if totalNumberOfBytes > totalNumberOfFreeBytes {
			used = totalNumberOfBytes - totalNumberOfFreeBytes
		}
		pct := (float64(used) / float64(totalNumberOfBytes)) * 100.0
		disks = append(disks, DiskInfo{
			Mount:   fmt.Sprintf("%c:", c),
			Total:   totalNumberOfBytes,
			Used:    used,
			Free:    totalNumberOfFreeBytes,
			UsedPct: pct,
		})
	}
	return disks
}

func hideWindowAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}

func newShellCmd(command string) *exec.Cmd {
	cmd := exec.Command("cmd.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CmdLine:       `cmd.exe /S /C "` + command + `"`,
		CreationFlags: 0x00000200, // CREATE_NEW_PROCESS_GROUP
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
	tk := exec.Command("taskkill.exe", "/T", "/F", "/PID", fmt.Sprintf("%d", pid))
	tk.SysProcAttr = hideWindowAttr()
	_ = tk.Run()
	_ = c.Process.Kill()
}

func collectPlatformStaticSpecs() (cpuModel string, cpuCores int, gpuModel string, gpuVramMB int, osCaption string) {
	psScript := `$ErrorActionPreference='SilentlyContinue';
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name, NumberOfCores, NumberOfLogicalProcessors;
$gpus = @(Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM);
$os = Get-CimInstance Win32_OperatingSystem | Select-Object -First 1 Caption, Version;
@{ cpu=$cpu; gpus=$gpus; os=$os } | ConvertTo-Json -Compress -Depth 3`

	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psScript)
	cmd.SysProcAttr = hideWindowAttr()
	out, err := cmd.Output()
	if err == nil && len(out) > 0 {
		var parsed struct {
			CPU struct {
				Name          string `json:"Name"`
				NumberOfCores int    `json:"NumberOfCores"`
			} `json:"cpu"`
			GPUs []struct {
				Name       string `json:"Name"`
				AdapterRAM int64  `json:"AdapterRAM"`
			} `json:"gpus"`
			OS struct {
				Caption string `json:"Caption"`
				Version string `json:"Version"`
			} `json:"os"`
		}
		if json.Unmarshal(bytes.TrimSpace(out), &parsed) == nil {
			cpuModel = strings.TrimSpace(parsed.CPU.Name)
			cpuCores = parsed.CPU.NumberOfCores
			osCaption = strings.TrimSpace(parsed.OS.Caption)
			for _, g := range parsed.GPUs {
				name := strings.TrimSpace(g.Name)
				if name == "" {
					continue
				}
				// Prefer discrete NVIDIA/AMD GPU over Microsoft Basic Display
				if gpuModel == "" || strings.Contains(strings.ToUpper(name), "NVIDIA") || strings.Contains(strings.ToUpper(name), "RADEON") || strings.Contains(strings.ToUpper(name), "ARC") {
					gpuModel = name
					if g.AdapterRAM > 0 {
						gpuVramMB = int(g.AdapterRAM / (1024 * 1024))
					}
				}
			}
		}
	}

	// Check nvidia-smi for exact GPU model and VRAM
	nvCmd := exec.Command("nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits")
	nvCmd.SysProcAttr = hideWindowAttr()
	if nvOut, err := nvCmd.Output(); err == nil {
		line := strings.TrimSpace(strings.Split(string(nvOut), "\n")[0])
		parts := strings.Split(line, ",")
		if len(parts) >= 1 && strings.TrimSpace(parts[0]) != "" {
			gpuModel = strings.TrimSpace(parts[0])
		}
		if len(parts) >= 2 {
			var vram int
			fmt.Sscanf(strings.TrimSpace(parts[1]), "%d", &vram)
			if vram > 0 {
				gpuVramMB = vram
			}
		}
	}
	return
}

func collectPlatformLiveMetrics() (cpuPct float64, memTotal, memUsed, memFree uint64, memPct float64, disks []DiskInfo, uptimeSec uint64, gpuTempC int, gpuUtilPct int) {
	cpuPct = sampleWindowsCPU()
	memTotal, memUsed, memFree, memPct = getWindowsMemory()
	disks = getWindowsDisks()
	uptimeSec = getWindowsUptimeSec()

	// Fast optional nvidia-smi check if NVIDIA GPU is present
	if cachedSpecs.HasNvidiaSmi {
		ctxCmd := exec.Command("nvidia-smi", "--query-gpu=temperature.gpu,utilization.gpu", "--format=csv,noheader,nounits")
		ctxCmd.SysProcAttr = hideWindowAttr()
		if out, err := ctxCmd.Output(); err == nil {
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
	// Create silent VBScript launcher so Windows login never flashes a console window
	vbsPath := filepath.Join(targetDir, "start-hidden.vbs")
	vbsContent := fmt.Sprintf(`Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "%s"
WshShell.Run """%s"" --service", 0, False
`, targetDir, targetExe)
	_ = os.WriteFile(vbsPath, []byte(vbsContent), 0644)

	// 1. Register in HKCU\Software\Microsoft\Windows\CurrentVersion\Run
	regValue := fmt.Sprintf(`wscript.exe //B //Nologo "%s"`, vbsPath)
	regCmd := exec.Command("reg.exe", "add", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "HomelabAgent", "/t", "REG_SZ", "/d", regValue, "/f")
	regCmd.SysProcAttr = hideWindowAttr()
	_ = regCmd.Run()

	// 2. Also try creating a Scheduled Task on logon
	taskCmd := exec.Command("schtasks.exe", "/Create", "/TN", "HomelabAgent", "/TR", regValue, "/SC", "ONLOGON", "/F")
	taskCmd.SysProcAttr = hideWindowAttr()
	_ = taskCmd.Run()

	// 3. Create convenient scripts in targetDir
	batPath := filepath.Join(targetDir, "restart-agent.bat")
	batContent := fmt.Sprintf("@echo off\r\nstart \"\" wscript.exe //B //Nologo \"%s\"\r\n", vbsPath)
	_ = os.WriteFile(batPath, []byte(batContent), 0644)

	uiBatPath := filepath.Join(targetDir, "open-status-app.bat")
	uiBatContent := fmt.Sprintf("@echo off\r\n\"%s\" --ui\r\n", targetExe)
	_ = os.WriteFile(uiBatPath, []byte(uiBatContent), 0644)

	return nil
}

func spawnBackgroundDaemon(targetExe string, targetDir string) error {
	vbsPath := filepath.Join(targetDir, "start-hidden.vbs")
	if _, err := os.Stat(vbsPath); err == nil {
		cmd := exec.Command("wscript.exe", "//B", "//Nologo", vbsPath)
		cmd.Dir = targetDir
		cmd.SysProcAttr = hideWindowAttr()
		return cmd.Start()
	}
	cmd := exec.Command(targetExe, "--service")
	cmd.Dir = targetDir
	cmd.SysProcAttr = hideWindowAttr()
	return cmd.Start()
}

func getDefaultInstallDir() string {
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		home, _ := os.UserHomeDir()
		if home != "" {
			localAppData = filepath.Join(home, "AppData", "Local")
		} else {
			localAppData = `C:\HomelabAgent`
		}
	}
	return filepath.Join(localAppData, "HomelabAgent")
}

func getPlatformTopProcs() string {
	ps := `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Process | Sort-Object CPU -Descending | Select-Object -First 15 Id, ProcessName, @{Name='CPU_s';Expression={[math]::Round($_.CPU,1)}}, @{Name='RAM_MB';Expression={[math]::Round($_.WorkingSet64/1MB,1)}} | ConvertTo-Json -Compress`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps)
	cmd.SysProcAttr = hideWindowAttr()
	out, err := cmd.Output()
	if err != nil {
		return "[]"
	}
	return strings.TrimSpace(string(out))
}

func initPlatformTimer() {
	go func() {
		for {
			time.Sleep(2 * time.Second)
			sampleWindowsCPU()
		}
	}()
}
