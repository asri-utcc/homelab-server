---
name: docker-stack-ops
description: Operations, diagnostics, DNS fixes, container lifecycle management, and disaster recovery for the 13 homelab docker containers.
---

# Docker Stack Operations Skill

This skill provides procedures for maintaining and troubleshooting the `lab-stack` Docker infrastructure.

## Stack Overview (`/home/dev/projects/lab-stack/compose.yaml`)
- **Key Containers:**
  - `lab-caddy`: Reverse proxy with Let's Encrypt TLS (80, 443)
  - `lab-homeassistant`: Smart home core (host network mode, DNS 8.8.8.8, 1.1.1.1)
  - `lab-zigbee2mqtt`: Zigbee bridge on `/dev/ttyACM0` (port 8099)
  - `lab-emqx`: MQTT Broker (1883, 8883, 18083)
  - `lab-wireguard`: Remote VPN gateway (51820/udp)
  - `lab-mongodb`, `lab-mongo-express`, `omsin-db`, `omsin-app`, `lab-uptime-kuma`, `lab-portainer`, `lab-filebrowser`, `lab-dockerproxy`

## Common Recovery Steps
1. **Zigbee2MQTT failed to connect to MQTT:**
   - If `lab-zigbee2mqtt` fails with `ECONNREFUSED` after host reboot:
     ```bash
     docker start lab-zigbee2mqtt
     ```
2. **Container DNS failure (e.g. Home Assistant):**
   - Ensure `compose.yaml` has explicit DNS:
     ```yaml
     dns:
       - 8.8.8.8
       - 1.1.1.1
     ```
3. **Container Health & Status Inspection:**
   ```bash
   docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
   ```
