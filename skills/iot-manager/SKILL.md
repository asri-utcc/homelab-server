---
name: iot-manager
description: Control and monitor smart home devices including Sonoff Direct LAN, Tuya cloud/LAN, and Xiaomi 360 cameras integrated via iot-dashboard.
---

# IoT Manager Skill

This skill handles smart home device operations, direct local LAN toggling, and dashboard health monitoring.

## Ecosystem Overview
- **IoT Dashboard:** Standalone Express/WebSocket app at port `8095` (PM2 process `iot-dashboard`), reverse-proxied via Caddy under `/iot/`.
- **Sonoff Switches:** 7 devices (22 channels) controlled locally via LAN mDNS (`_ewelink._tcp`) + AES-128 encryption.
  - Config: `/home/dev/projects/iot-dashboard/sonoff-direct.js` and `.sonoff.json`
- **Tuya Switches:** Controlled via Home Assistant bridge (`switch.aifphuuenaim_switch_1..3`).
- **Xiaomi Cameras:** `chuangmi.camera.046a01` (หน้าบ้าน, ห้องครัว, ห้องทำงาน, ร้าน) and `mxiang.camera.c301` via Home Assistant camera proxy snapshot.

## Operational Actions
1. **Toggle Switch via Local API:**
   ```bash
   curl -s -X POST http://127.0.0.1:8095/api/device/toggle \
     -H "Content-Type: application/json" \
     -d '{"entity_id":"<entity_id>"}'
   ```
2. **List All Devices:**
   ```bash
   curl -s http://127.0.0.1:8095/api/devices
   ```
3. **If Tuya entities become unavailable:**
   - Reload Tuya entry via Home Assistant API or check `lab-homeassistant` DNS configuration (`8.8.8.8`, `1.1.1.1`).
