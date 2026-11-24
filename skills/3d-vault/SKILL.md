---
name: 3d-vault
description: Save, version, search, inspect, and export 3D assets (GLB/OBJ/STL/FBX/PLY/BLEND models, Blender .py scripts, previews, and metadata) in the Homelab 3D Asset Vault via `/home/dev/.local/bin/vault3d`. Use automatically right after any Blender 3D job completes (`agent-ctl blender ... --wait` or `blender-studio`) to archive the model/script/preview and return a `/3d-vault#asset=<id>` link, or whenever the user asks to store, browse, compare versions, or convert/export 3D models.
---

# 3D Asset Vault

Stores versioned 3D assets locally on this homelab (`~/.gemini/3d-vault`) with GLB geometry, Blender `.py` scripts, preview images, bounding-box dimensions, SHA-256 checksums, and tags — viewable in the web dashboard at `/3d-vault`.

## Tool
- CLI: always call by full path `/home/dev/.local/bin/vault3d` (PM2 PATH lacks `~/.local/bin`) → `/home/dev/projects/homelab-server/3d-vault/vault3d.js`
- Backend module: `/home/dev/projects/lab-dashboard/asset-vault-manager.js` (direct module access, no HTTP login required)
- Vault root: `/home/dev/.gemini/3d-vault` (override with `VAULT_DIR` or `--vault <dir>`)
- Web Viewer URL: `https://homelab.tail285279.ts.net/3d-vault`
- Supported model formats: `.glb`, `.gltf`, `.obj`, `.stl`, `.fbx`, `.ply`, `.blend` (non-GLB models are automatically converted to `model.glb` via `/usr/bin/blender`, keeping `original.<ext>`)
- Categories: `building`, `furniture`, `device`, `part`, `scene`, `other`

## Mandatory Workflow After Every Blender Job (`agent-ctl blender ... --wait`)

Every time a Blender job finishes building or modifying a `.glb` model, **automatically archive it into the 3D Asset Vault** before giving the final reply:

1. Run your Blender job (or local script) and verify the generated `.glb`, `.py` script, and `_preview.png` exist:
   ```bash
   /home/dev/.local/bin/agent-ctl blender --script /path/to/script.py --live-session <bv_session> --wait
   ```
   (Outputs typically land in `/home/dev/.gemini/outputs/3d/`.)

2. Check whether this model already has an asset entry in the vault:
   ```bash
   /home/dev/.local/bin/vault3d list --q "<keyword>" --json
   ```

3. **If it is a new asset** (no matching `id` yet), add it as `v1`:
   ```bash
   /home/dev/.local/bin/vault3d add /path/to/model.glb \
     --name "<ชื่อโมเดล>" \
     --category <building|furniture|device|part|scene|other> \
     --tags "<tag1,tag2,blender>" \
     --source /path/to/script.py \
     --preview /path/to/preview.png \
     --note "ต้นแบบแรก" \
     --json
   ```

4. **If updating an existing asset**, append a new version (`v+1`) with a concise Thai note describing what changed:
   ```bash
   /home/dev/.local/bin/vault3d add-version <asset-id> /path/to/model.glb \
     --source /path/to/script.py \
     --preview /path/to/preview.png \
     --note "<สิ่งที่แก้>" \
     --json
   ```

5. Read `asset.id`, version number (`v`), dimensions, and `url` from the JSON output, then reply to the user with the clickable vault link:
   `https://homelab.tail285279.ts.net/3d-vault#asset=<id>`

## Common Commands

- **List / search assets:**
  ```bash
  /home/dev/.local/bin/vault3d list --json
  /home/dev/.local/bin/vault3d list --q "swiftlet" --tag "blender" --category building --json
  ```
- **Inspect asset metadata & all versions:**
  ```bash
  /home/dev/.local/bin/vault3d show <id> --json
  ```
- **Export ZIP bundle (all versions or specific `--v N`) or convert format (`glb`, `stl`, `obj`, `fbx`, `ply`):**
  ```bash
  /home/dev/.local/bin/vault3d export <id> --v all --format zip --out /tmp/<id>.zip
  /home/dev/.local/bin/vault3d export <id> --v 3 --format stl --out /tmp/<id>_v3.stl
  ```
- **Import exported ZIP bundle or standalone 3D file:**
  ```bash
  /home/dev/.local/bin/vault3d import /tmp/<bundle>.zip --json
  ```
- **Seed existing outputs from `/home/dev/.gemini/outputs/3d` (idempotent):**
  ```bash
  /home/dev/.local/bin/vault3d import-outputs --json
  ```
- **Check vault stats & Blender/ZIP availability:**
  ```bash
  /home/dev/.local/bin/vault3d stats --json
  ```

## Rules & Safety
- Always invoke `/home/dev/.local/bin/vault3d` by full path (PM2 PATH does not include `~/.local/bin`).
- Local files passed to `add`, `add-version`, and `import` must live inside `/home/dev/.gemini`, `/home/dev/projects`, or `/tmp`.
- `vault3d` only copies source files into `~/.gemini/3d-vault/` — it never moves or deletes originals in `/home/dev/.gemini/outputs/3d/`.
- Deletions (`vault3d delete <id>`) are soft-deleted to `~/.gemini/3d-vault/.trash/`.
