#!/usr/bin/env bash
set -euo pipefail

SRC="/home/dev/.local/share/motion-studio/"
DST="/home/dev/projects/homelab-server/motion-studio/"

mkdir -p "$DST"
rsync -a --delete \
  --exclude node_modules \
  --exclude venv \
  --exclude 'core.*' \
  --exclude '*.bak*' \
  --exclude '__pycache__' \
  --exclude 'style-thumbs.bak*' \
  --exclude out \
  "$SRC" "$DST"

du -sh "$DST"
