# 3D Asset Vault CLI (`vault3d`)

CLI สำหรับจัดการคลังโมเดล 3 มิติแบบแยกเวอร์ชันของ Homelab (`~/.gemini/3d-vault`) โดยเรียกใช้งานโมดูล [`asset-vault-manager.js`](file:///home/dev/projects/lab-dashboard/asset-vault-manager.js) โดยตรง (ไม่ต้องผ่าน HTTP cookie/login และไม่มี dependency ภายนอก)

## การติดตั้ง (Symlink)

```bash
chmod +x /home/dev/projects/homelab-server/3d-vault/vault3d.js
ln -sf /home/dev/projects/homelab-server/3d-vault/vault3d.js /home/dev/.local/bin/vault3d
```

- **Vault Directory:** `~/.gemini/3d-vault` (override ได้ด้วย `VAULT_DIR=/path` หรือ `--vault /path`)
- **Web UI:** `https://homelab.tail285279.ts.net/3d-vault`
- **Dependencies:** Node.js + ระบบ `/usr/bin/blender`, `/usr/bin/zip`, `/usr/bin/unzip`

## คำสั่งทั้งหมด

ทุกคำสั่งรองรับ `--json` เพื่อพิมพ์ผลลัพธ์เป็น JSON บน stdout

| คำสั่ง | ตัวอย่างการใช้งาน |
|---|---|
| `list` | `/home/dev/.local/bin/vault3d list --q swiftlet --tag blender --json` |
| `show` | `/home/dev/.local/bin/vault3d show <id> --json` |
| `add` | `/home/dev/.local/bin/vault3d add model.glb --name "ชื่อโมเดล" --category building --tags a,b --source build.py --preview preview.png --note "ต้นแบบแรก"` |
| `add-version` | `/home/dev/.local/bin/vault3d add-version <id> model_v2.glb --source build_v2.py --preview preview_v2.png --note "แก้ขนาดประตู"` |
| `export` | `/home/dev/.local/bin/vault3d export <id> --v all --format zip --out /tmp/model.zip` (รองรับ `zip\|glb\|stl\|obj\|fbx\|ply`) |
| `import` | `/home/dev/.local/bin/vault3d import /tmp/model.zip` |
| `import-outputs` | `/home/dev/.local/bin/vault3d import-outputs --json` (seed งาน 3D เดิมจาก `~/.gemini/outputs/3d` แบบ idempotent) |
| `stats` | `/home/dev/.local/bin/vault3d stats --json` |
| `update` | `/home/dev/.local/bin/vault3d update <id> --tags a,b,c --fav` |
| `duplicate` | `/home/dev/.local/bin/vault3d duplicate <id> --name "สำเนา"` |
| `delete` | `/home/dev/.local/bin/vault3d delete <id> [--v 2]` (soft delete ย้ายเข้า `.trash`) |

## ข้อกำหนดด้านความปลอดภัย

- การนำเข้าไฟล์จากเครื่องจำกัดเฉพาะ path ภายใต้ `/home/dev/.gemini`, `/home/dev/projects`, และ `/tmp`
- ป้องกัน path traversal (`..`), ไฟล์ซ่อนที่ขึ้นต้นด้วย `.`, และ symlink escape
- การเขียน `index.json` / `meta.json` เป็นแบบ atomic (`.tmp` + rename) ภายใต้ write mutex
