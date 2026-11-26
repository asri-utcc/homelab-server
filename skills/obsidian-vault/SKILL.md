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
