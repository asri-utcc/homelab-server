---
name: crypto-trade-bot
description: Monitor, diagnose, and maintain the OnePercentBotTrade crypto spot trading bot, its Binance integration, MongoDB positions, and logs.
---

# Crypto Trade Bot Skill

This skill handles monitoring, log inspection, error triage, and maintenance for `OnePercentBotTrade`.

## Service Specs
- **PM2 Name:** `onepercentbot` (ID 2)
- **Directory:** `/home/dev/projects/OnePercentBotTrade`
- **Exchange:** Binance Spot
- **Log Files:**
  - Standard/Output: `/home/dev/projects/OnePercentBotTrade/logs/pm2-out.log`
  - Error: `/home/dev/projects/OnePercentBotTrade/logs/pm2-error.log`

## Common Issues & Handling
1. **Filter failure: NOTIONAL (-1013):**
   - Occurs when position size remaining is below Binance minimum trade notional (~$5 USDT).
   - In `positionWatchdog`, scan logs to identify symbols failing NOTIONAL checks.
2. **Log Bloat (> 100MB):**
   - Rotate/truncate log safely using:
     ```bash
     tail -n 5000 /home/dev/projects/OnePercentBotTrade/logs/pm2-out.log > /tmp/pm2-out.tmp && cat /tmp/pm2-out.tmp > /home/dev/projects/OnePercentBotTrade/logs/pm2-out.log && rm /tmp/pm2-out.tmp
     ```
3. **Health Check:**
   - Verify PM2 status, CPU, memory heap, and event loop latency.
