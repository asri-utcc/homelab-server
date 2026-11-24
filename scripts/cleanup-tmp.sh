#!/bin/bash
# Remove stale remotion bundles / core dumps from tmpfs /tmp (they eat RAM+swap)
find /tmp -maxdepth 1 \( -name 'remotion-*' -o -name 'core.*' -o -name 'puppeteer_dev_*' \) -mmin +120 -exec rm -rf {} + 2>/dev/null
