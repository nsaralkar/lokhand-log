#!/usr/bin/env bash
# Playwright's Chromium needs X/ATK/GBM/ALSA libs a bare Ubuntu 24.04 lacks. Without
# root: download the .debs and unpack them into a user cache; driver.mjs adds the
# result to LD_LIBRARY_PATH automatically. (With sudo, `npx playwright install-deps
# chromium` is the normal fix and this script is unnecessary.)
set -euo pipefail
L="${CHROME_LIBS:-$HOME/.cache/lokhand-log-chrome-libs}"
mkdir -p "$L/debs"
cd "$L/debs"
apt-get download libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libxrender1 libxi6 libgbm1 libasound2t64
for d in *.deb; do dpkg -x "$d" "$L/root"; done

EXE="$(ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell | tail -1)"
missing="$(LD_LIBRARY_PATH="$L/root/usr/lib/x86_64-linux-gnu" ldd "$EXE" | grep 'not found' || true)"
if [ -n "$missing" ]; then echo "still missing:"; echo "$missing"; exit 1; fi
echo "ok: $EXE resolves all libs with $L/root/usr/lib/x86_64-linux-gnu"
