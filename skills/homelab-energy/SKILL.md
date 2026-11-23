---
name: homelab-energy
description: Manage and analyze home electricity consumption using the PZEM-01 AC meter via Home Assistant / ESPHome and dedicated CLI tools.
---

# Homelab Energy Skill

This skill provides operational procedures and analysis tools for electrical power and energy usage on the homelab server.

## Meter & Protocols
- **Meter:** PZEM-01 AC energy meter connected via ESPHome (`192.168.1.20`) and Home Assistant (`sensor.pezem01_*`).
- **Billing Cycle:** Cuts off every **17th of the month** (17th of previous month through 16th of current month).
- **Unit Rate:** 5.4044 THB / kWh.
- **Dedicated CLI Tool:** `/home/dev/projects/get-energy.py`

## Instructions
1. When asked to check electricity, power, or cost (e.g. "เช็คค่าไฟ", "ตรวจไฟ", "PZEM", "ใช้ไฟไปกี่หน่วย"):
   - Execute `/home/dev/projects/get-energy.py` immediately.
   - Report:
     - Real-time active load: Power (Watts), Voltage (V), Current (A), Power Factor.
     - Today's consumption: Energy (kWh) and Cost (THB).
     - Month-to-date cumulative consumption: Energy (kWh) and Cost (THB).
     - Projected end-of-month cost.
2. In case Home Assistant is down, fallback directly to `/home/dev/projects/iot-dashboard/pzem-history.json` or query `http://127.0.0.1:8095/api/devices`.
