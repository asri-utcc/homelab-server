#!/usr/bin/env bash
# AI chat รันอยู่ใต้โปรเซส lab-dashboard — restart ตรงๆ จะฆ่าตัวเองกลางคำตอบ
# จึงส่งต่อให้ safe-restart-dashboard แบบ setsid (หลุดจาก process tree ที่ PM2 จะ kill)
# ซึ่งรอ AI ตอบจบ, restart ผ่าน ecosystem, แล้วเช็ค HTTP ซ้ำ ถ้า errored จะ restart ใหม่ให้
if [[ "$1" == "restart" || "$1" == "reload" ]] && [[ "$2" == "lab-dashboard" || "$2" == "1" || "$2" == "all" ]]; then
  if [[ "$2" == "all" ]]; then
    setsid nohup bash -c '
      for i in {1..30}; do pgrep -f "/home/dev/.local/bin/agy" >/dev/null 2>&1 || break; sleep 1; done
      sleep 1
      /usr/local/bin/pm2 "$@"
    ' _ "$@" >/dev/null 2>&1 < /dev/null &
  else
    setsid nohup /home/dev/.local/bin/safe-restart-dashboard >/dev/null 2>&1 < /dev/null &
  fi
  echo "[PM2 Safe-Wrapper] Deferred $1 of $2 until AI chat finishes; health-checked by safe-restart-dashboard"
  exit 0
fi
exec /usr/local/bin/pm2 "$@"
