#!/usr/bin/env bash
# Run a local bash script on a Starfolk box in a login shell (so mise puts node/yarn on PATH).
#
#   box-run.sh <box-name> <script-file>
#   box-run.sh <box-name> - <<'EOF' ... EOF
#
# The script travels base64-encoded inside ONE quoted remote command. Passing `bash -lc '...'` as
# separate arguments after `--` gets re-split on the box: `bash -lc set -e; ...` runs `set`, which
# prints the box's whole environment, secrets included.
set -euo pipefail
box="$1"
script_file="${2:--}"
b64=$(base64 < "$script_file" | tr -d '\n')
sfk box connect "$box" \
  --no-copy-agent-credentials --env none --no-ssh-agent-forwarding --no-git-config --no-copy --no-script \
  -- "echo $b64 | base64 -d | bash -l" 2>&1 |
  grep -v -e '^Connecting to ' -e 'no Claude credential on this box'
