#!/usr/bin/env bash
set -euo pipefail

MIRROR_DIR="/home/dev/storage/obsidian/Homelab-Vault/01-AI-Memory/_mirror"
GEMINI_SRC="/home/dev/.gemini/MEMORY.md"
CLAUDE_MEM_DIR="/home/dev/.claude/projects/-home-dev-projects/memory"

mkdir -p "$MIRROR_DIR"

declare -A EXPECTED_FILES=()

sync_one() {
    local src="$1"
    local dst_name="$2"
    local dst="$MIRROR_DIR/$dst_name"
    local tmp

    EXPECTED_FILES["$dst_name"]=1

    tmp="$(mktemp "${MIRROR_DIR}/.${dst_name}.tmp.XXXXXX")"
    {
        printf '> ⚠️ สำเนาอัตโนมัติ (อ่านอย่างเดียว) จาก %s — แก้ที่ต้นฉบับ\n\n' "$src"
        cat "$src"
    } > "$tmp"

    if [[ -f "$dst" ]] && cmp -s "$tmp" "$dst"; then
        rm -f "$tmp"
    else
        mv -f "$tmp" "$dst"
    fi
}

if [[ -f "$GEMINI_SRC" ]]; then
    sync_one "$GEMINI_SRC" "gemini-MEMORY.md"
fi

if [[ -d "$CLAUDE_MEM_DIR" ]]; then
    shopt -s nullglob
    for src_file in "$CLAUDE_MEM_DIR"/*.md; do
        base_name="$(basename "$src_file")"
        sync_one "$src_file" "claude-${base_name}"
    done
    shopt -u nullglob
fi

# Remove mirror files whose source no longer exists
shopt -s nullglob
for existing in "$MIRROR_DIR"/*.md; do
    existing_name="$(basename "$existing")"
    if [[ -z "${EXPECTED_FILES[$existing_name]+x}" ]]; then
        rm -f "$existing"
    fi
done
shopt -u nullglob
