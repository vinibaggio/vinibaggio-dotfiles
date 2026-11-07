#!/usr/bin/env bash
# Copy a file (screenshot, log) from a Starfolk box to the laptop.
#
#   box-fetch.sh <box-name> <remote-path> <local-path>
set -euo pipefail
box="$1"
remote="$2"
local_path="$3"
sfk box connect "$box" \
  --no-copy-agent-credentials --env none --no-ssh-agent-forwarding --no-git-config --no-copy --no-script \
  -- "base64 -w0 '$remote'" 2>/dev/null |
  grep -v -e '^Connecting to ' -e 'no Claude credential on this box' |
  base64 -d > "$local_path"
ls -la "$local_path"
