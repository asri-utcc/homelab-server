---
name: obsidian-vault
description: Manage, search, and write structured Markdown knowledge, incidents, runbooks, and daily notes in the Homelab Obsidian Vault (/home/dev/storage/obsidian/Homelab-Vault) and operate the lab-obsidian container. Use whenever the user asks to record/look up system history, incidents, decisions, runbooks, or Obsidian notes.
---

# Obsidian Vault (Homelab Second Brain)

Centralized Markdown knowledge base for Homelab operations, AI memory, projects, and daily notes, accessible via Web UI and local filesystem.

## Paths & Access
- **Host Vault Path:** `/home/dev/storage/obsidian/Homelab-Vault` (owner `1000:1000` / `dev:dev`)
- **Container Vault Path:** `/vaults/Homelab-Vault` (inside `lab-obsidian`)
- **Web UI:** `https://homelab.tail285279.ts.net/obsidian/` (requires Lab Dashboard login via Caddy `forward_auth`)
- **Container:** `lab-obsidian` (`lscr.io/linuxserver/obsidian`, managed in `/home/dev/projects/lab-stack/compose.yaml`)

## Vault Folder Structure
- `00-Inbox/` — Quick captures and unsorted notes
- `01-AI-Memory/` — AI-curated facts (`Facts.md`), architectural decisions (`Decisions.md`), and `_mirror/` (read-only mirror of `~/.gemini/MEMORY.md` & `CLAUDE.md`)
- `02-Homelab/` — Infrastructure docs, `Incidents/`, and `Runbooks/`
- `03-Projects/` — Project-specific notes (`lab-dashboard`, `OnePercentBotTrade`, `iot-dashboard`, etc.)
- `04-Daily/` — Daily logs (`YYYY-MM-DD.md`)
- `05-Knowledge/` — General technical references and guides
- `99-Templates/` — Note templates
- `Home.md` — Vault entry/index note

## Writing & Formatting Rules
- All notes must be `.md` files with YAML frontmatter:
  ```yaml
  ---
  tags: [homelab, incident]
  created: YYYY-MM-DD
  source: ai
  ---
  ```
- Use Obsidian wikilinks `[[Note]]` to connect related notes.
- Filenames may be in Thai or English, but **MUST NOT** contain `/`, `:`, `?`, or `*`.
- Always write files with UID/GID `1000:1000` (`dev:dev`).

## Common AI Tasks
- **Log an Incident:** Create `/home/dev/storage/obsidian/Homelab-Vault/02-Homelab/Incidents/YYYY-MM-DD-<slug>.md` with root cause, impact, resolution, and links to affected services.
- **Add/Update Runbook:** Save operational procedures under `02-Homelab/Runbooks/`.
- **Update Daily Note:** Append to `04-Daily/YYYY-MM-DD.md` (**append only — never overwrite** existing daily note content).
- **Record New Knowledge / Decisions:** Append or update `01-AI-Memory/Facts.md` or `01-AI-Memory/Decisions.md`.
- **Search Vault:**
  ```bash
  grep -rn --include="*.md" "<คำค้น>" /home/dev/storage/obsidian/Homelab-Vault
  ```

## Safety & Sync Rules
- **NEVER edit files inside `01-AI-Memory/_mirror/`:** These files are one-way copies synced automatically every 10 minutes by `/home/dev/projects/obsidian-memory-sync.sh`. The source of truth remains `/home/dev/.gemini/MEMORY.md` (and `CLAUDE.md`).
- **NEVER store secrets:** Do not write passwords, API keys, tokens, or credentials into any vault note.

## Container Maintenance
- View logs: `docker logs lab-obsidian`
- Restart container: `cd /home/dev/projects/lab-stack && docker compose restart obsidian`
- Update image: `cd /home/dev/projects/lab-stack && docker compose pull obsidian && docker compose up -d obsidian`

## Auto Daily Note
- **Script:** `/home/dev/projects/obsidian-daily-note.py` (Python 3 stdlib only; generates/updates `04-Daily/YYYY-MM-DD.md` using `99-Templates/Daily.md`)
- **Cron Schedule:** Runs daily at **23:55** (`55 23 * * *`) via `dev` crontab
- **Cron Log:** `/home/dev/projects/lab-dashboard/cron-logs/obsidian_daily_note.log`
- **Marker Rule (`AUTO:START` / `AUTO:END`):** Automated summaries (PZEM-01 energy, server health, PM2, Docker, git commits) are placed strictly between `<!-- AUTO:START -->` and `<!-- AUTO:END -->`. Both AI and users **MUST write only outside these markers** — anything inside the `AUTO` block is overwritten on the next run.
- **Managed Frontmatter Keys:** The script updates only `energy_kwh`, `cost_thb`, `month_kwh`, `month_cost_thb`, `cpu_avg`, `ram_max`, and `pm2_down` while preserving all other frontmatter keys (e.g., `tags`, `created`).
- **Backfill / Manual Run:**
  ```bash
  # Update today's note
  /usr/bin/python3 /home/dev/projects/obsidian-daily-note.py

  # Backfill or regenerate a specific date
  /usr/bin/python3 /home/dev/projects/obsidian-daily-note.py --date YYYY-MM-DD

  # Preview output without writing to disk
  /usr/bin/python3 /home/dev/projects/obsidian-daily-note.py --date YYYY-MM-DD --dry-run
  ```

## Dataview
- **Source & Installation:** Installed from the official GitHub Releases of [`blacksmithgu/obsidian-dataview`](https://github.com/blacksmithgu/obsidian-dataview/releases/latest) into `/home/dev/storage/obsidian/Homelab-Vault/.obsidian/plugins/dataview/` (`main.js`, `manifest.json`, `styles.css`) and listed in `.obsidian/community-plugins.json` (`["dataview"]`). Used by `Home.md` for live Daily Notes, Incidents, and Runbooks queries.
- **First-Time Web UI Enablement:** If Dataview blocks render as raw code, open Obsidian **Settings → Community plugins → Turn on community plugins** and enable **Dataview**.
- **How to Update:**
  ```bash
  # Download latest release assets (main.js, manifest.json, styles.css) into the plugin folder
  cd /home/dev/storage/obsidian/Homelab-Vault/.obsidian/plugins/dataview
  curl -fsSLO https://github.com/blacksmithgu/obsidian-dataview/releases/latest/download/main.js
  curl -fsSLO https://github.com/blacksmithgu/obsidian-dataview/releases/latest/download/manifest.json
  curl -fsSLO https://github.com/blacksmithgu/obsidian-dataview/releases/latest/download/styles.css
  chown -R dev:dev /home/dev/storage/obsidian/Homelab-Vault/.obsidian/plugins/dataview
  docker restart lab-obsidian
  ```

## แนวทางให้ AI (AI Workflow Guidelines)
- **Incident Logging:** When resolving a system problem or outage, create an Incident note at `02-Homelab/Incidents/YYYY-MM-DD-<slug>.md` following `99-Templates/Incident.md` (with `tags: [incident, homelab]`, `created: YYYY-MM-DD`, impact, root cause, resolution, and prevention).
- **Runbooks:** Whenever a procedure or fix is repeatable, document it as a Runbook under `02-Homelab/Runbooks/<slug>.md` following `99-Templates/Runbook.md` (prerequisites, steps, verification, rollback).
- **Daily Log Entries:** When recording work completed on a given day, write or append under the `## 📝 สิ่งที่ทำ / เหตุการณ์สำคัญ` heading of `04-Daily/YYYY-MM-DD.md` (**NEVER** write inside `<!-- AUTO:START -->` ... `<!-- AUTO:END -->`). If the daily note does not exist yet, initialize it first with `/usr/bin/python3 /home/dev/projects/obsidian-daily-note.py --date YYYY-MM-DD` or from `99-Templates/Daily.md`.
