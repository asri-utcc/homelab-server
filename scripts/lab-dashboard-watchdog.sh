#!/usr/bin/env bash
# lab-dashboard watchdog (cron ทุก 1 นาที)
#
# ทำไมต้องมี: ตอน `pm2 restart lab-dashboard` ถ้าโปรเซสเดิมตายไม่ทันใน kill_timeout x2
# PM2 จะขึ้น "could not be stopped" -> ตั้งสถานะ errored แล้ว "ไม่ start ใหม่อีกเลย"
# แม้โปรเซสเดิมจะตายตามมาในอีกไม่กี่วินาที (เกิด 2026-11-24 22:00 และ 2026-11-28 20:56)
# สคริปต์นี้จึงคอยดึงกลับขึ้นมาเองและแจ้ง Telegram
#
# - errored/stopped              -> restart ทันที
# - online แต่ HTTP ไม่ตอบ 3 รอบติด (≈3 นาที) -> restart
# - หยุดโดยตั้งใจ: touch ~/.pm2/lab-dashboard.hold  (ลบไฟล์เพื่อเปิด watchdog คืน)
set -u
export PATH="/home/dev/.local/pm2/node_modules/.bin:/usr/local/bin:/usr/bin:/bin"
export HOME=/home/dev PM2_HOME=/home/dev/.pm2

APP=lab-dashboard
ECO=/home/dev/projects/lab-dashboard/ecosystem.config.js
URL=http://172.17.0.1:8090/api/summary
HOLD=/home/dev/.pm2/lab-dashboard.hold
STATE=/tmp/lab-dashboard-watchdog.fails
LOG=/home/dev/projects/lab-dashboard/cron-logs/lab_dashboard_watchdog.log
NOTIFY=/home/dev/projects/notify-telegram.py

exec 9>/tmp/lab-dashboard-watchdog.lock
flock -n 9 || exit 0
[ -f "$HOLD" ] && exit 0

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

info=$(pm2 jlist 2>/dev/null | python3 -c '
import json, sys, time
try:
    apps = json.load(sys.stdin)
except Exception:
    print("unknown 0"); sys.exit()
for p in apps:
    if p.get("name") == "lab-dashboard":
        e = p["pm2_env"]
        up = int(time.time() - e.get("pm_uptime", 0) / 1000) if e.get("pm_uptime") else 0
        print(e.get("status", "unknown"), up); break
else:
    print("missing 0")
')
status=${info% *}; uptime=${info#* }

restart() {
    local reason=$1
    log "RESTART ($reason)"
    pm2 restart "$ECO" --update-env >> "$LOG" 2>&1
    sleep 8
    local code
    code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$URL")
    log "after restart: http=$code"
    rm -f "$STATE"
    python3 "$NOTIFY" "🩺 <b>lab-dashboard watchdog</b>
พบปัญหา: <code>$reason</code>
สั่ง restart อัตโนมัติแล้ว -> HTTP <code>$code</code>" >/dev/null 2>&1
}

case "$status" in
    errored|stopped|missing)
        restart "pm2 status=$status"
        ;;
    online)
        [ "$uptime" -lt 90 ] && { rm -f "$STATE"; exit 0; }
        code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$URL")
        if [ "$code" = "000" ] || [ "${code:0:1}" = "5" ]; then
            fails=$(( $(cat "$STATE" 2>/dev/null || echo 0) + 1 ))
            echo "$fails" > "$STATE"
            log "health fail #$fails (http=$code)"
            [ "$fails" -ge 3 ] && restart "online but HTTP $code x$fails"
        else
            rm -f "$STATE"
        fi
        ;;
    *)  # launching / stopping / unknown: ปล่อยให้ PM2 ทำงานต่อ รอบหน้าค่อยดู
        ;;
esac
