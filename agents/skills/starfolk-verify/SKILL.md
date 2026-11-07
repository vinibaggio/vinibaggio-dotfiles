---
name: starfolk-verify
description: USE THIS whenever reproducing a bug, verifying a UI or browser-visible change, or taking screenshots of the clay-base app. Vinny always wants this done on a Starfolk box, never on laptop dev servers and never skipped. Covers waking a box, a per-task worktree on it, the gitignored configs the app needs there, dev servers, sign-in, seeding Terracotta data, Playwright on the box, and copying screenshots back.
---

# Verify and reproduce on a Starfolk box

Do every browser check and bug repro for clay-base on Vinny's Starfolk box, not on the laptop. Don't skip the check because local ports are busy. Load the `starfolk` skill for general `sfk` rules (cost, authorization, credentials). This skill is the tested clay-base recipe on top of it.

Helpers live in `~/.agents/skills/starfolk-verify/scripts/`:

- `box-run.sh <box> <script-file|->`: runs a local bash script on the box in a login shell.
- `box-fetch.sh <box> <remote> <local>`: copies a file (a screenshot, a log) back to the laptop.
- `verify.template.mjs`: Playwright sign-in and screenshot template, run on the box.

## Hard rules learned the hard way

- **Never pass a multi-word command as separate arguments after `--`.** `sfk box connect <box> -- bash -lc 'set -e; …'` is re-split on the box: it runs `set` and prints the box's entire environment, API keys and tokens included, into the transcript. Always use `box-run.sh`: it base64-encodes the script into one quoted remote command. If that happens anyway, tell Vinny which secrets were exposed.
- Always pass the no-credential flags (`box-run.sh` does): `--no-copy-agent-credentials --env none --no-ssh-agent-forwarding --no-git-config --no-copy --no-script`. The "no Claude credential on this box" line is expected noise.
- Use a login shell (`bash -l`) or `node`/`yarn` are not on PATH (mise).
- Don't drive the box app from the laptop's managed or cmux browser. React inputs ignore its typing, and pages stall without showing why. Run Playwright on the box.

## 1. Pick the box

```bash
sfk box list --json | jq -c '.devboxes[] | {name, status, description, session_count}'
```

Reuse Vinny's existing box (one `clay-run/clay-base` box, private, `session_count` 0). Connecting wakes a stopped box in about 30 s. Create a new box only when none exists, and say so (it costs money). The box hostname is `<name>.box.starfolk.ai`.

## 2. Worktree on the box

The box's main checkout is `/workspace/clay-base`. Leave its branch and files alone; make a per-task worktree:

```bash
cd /workspace/clay-base
git fetch -q origin <branch>
git worktree add -q /workspace/worktrees/<topic>/clay-base -b <branch>-verify FETCH_HEAD
cd /workspace/worktrees/<topic>/clay-base
bash infrastructure/scripts/setup-worktree.sh   # if yarn's link step fails with EEXIST, rerun `yarn install`
```

`setup-worktree.sh` copies `.env` files but **not** the Starfolk configs. Copy both, or the app is unusable:

```bash
cp /workspace/clay-base/apps/frontend/config/starfolk-local.js apps/frontend/config/
cp /workspace/clay-base/apps/api/config/starfolk-local.yml apps/api/config/
```

- Missing `starfolk-local.js`: Vite answers `Blocked request. This host ("<box>.box.starfolk.ai") is not allowed`.
- Missing `starfolk-local.yml`: requests to `:3001` fail with `net::ERR_FAILED`, and login shows "Unable to connect to the server".
- Both are read at startup, so restart the dev servers after copying.

Databases and Docker services are shared by every checkout on the box. Running migrations there only affects the box.

```bash
yarn migrate:dev:all
yarn tsx infrastructure/scripts/src/seed_dev_user.ts devs@clay.com   # devs@clay.com / claytest, workspace 1
```

## 3. Dev servers

On wake the box starts `yarn dev:terracotta` from `/workspace/clay-base` (the wrong branch), holding ports 8090 and 3001. Stop it before starting the worktree's:

```bash
pkill -f 'turbo dev'; sleep 3
pkill -f '/workspace/clay-base/node_modules'; pkill -f '/workspace/worktrees/<topic>'; sleep 4
cd /workspace/worktrees/<topic>/clay-base
nohup yarn dev:terracotta > /tmp/dev.log 2>&1 < /dev/null &   # frontend + API + Terracotta + ClickHouse watcher
```

- Use `dev:web` when Terracotta isn't involved.
- The API took about 5 minutes to come up. Wait inside the same remote script rather than polling from the laptop:

```bash
for i in $(seq 1 90); do
  curl -sk -o /dev/null -w '%{http_code}' --resolve <box>.box.starfolk.ai:3001:127.0.0.1 \
    https://<box>.box.starfolk.ai:3001/v3/me | grep -q 401 && break
  sleep 5
done
```

- `sfk ps --json` lists the box's ports and status codes. Errors are in `/tmp/dev.log`.

## 4. Data

Terracotta Postgres (note that `workspace_id` is text):

```bash
docker exec -e PGPASSWORD=claypassword clay-base-postgres-terracotta-1 \
  psql -h localhost -p 5435 -U clayuser -d terracotta -At -c "select id, name from tc_workflows where workspace_id = '1' and deleted_at is null"
```

Seed terminal runs without executing anything. The ClickHouse watcher in `dev:terracotta` mirrors them within seconds:

```bash
cd services/terracotta-service
NODE_ENV=development yarn seed:alert-runs --workflow <wf_id> --completed 3 --failed 2 --minutes-ago 20 --duration-minutes 90
```

Run the script with no arguments to see its options (`--dispatch`, `--credits-per-run`, `--cancelled`, `--trigger`).

## 5. Browser check with Playwright on the box

1. Copy `scripts/verify.template.mjs` to `<worktree>/apps/frontend/verify.tmp.mjs` (it must live there to resolve `@playwright/test`) and edit its CHECKS block. In a `box-run.sh` script, write it with a quoted heredoc (`cat > … <<'EOF'`).
2. Run it with `URLS='{"name":"https://<box>.box.starfolk.ai:8090/…"}' node ./verify.tmp.mjs`, then delete the file.
3. Things the template already handles:
   - The repo's Playwright may expect a browser build that isn't downloaded. The template uses the `chromium-<n>` already in `~/.cache/ms-playwright` through `executablePath`.
   - It launches with `--host-resolver-rules=MAP <box-host> <tailscale ip -4>`. Without it, API calls fail with `ERR_SSL_PROTOCOL_ERROR` and the app shows "Something unexpected happened".
   - Sign-in uses `getByPlaceholder('Email address')`, Continue, `getByPlaceholder('Password')`, Continue.
4. Workflow pages live at `/workspaces/1/terracotta/tc-workflows/<wf_id>?section=runs`, which redirects to `/workspaces/1/workflows/tc-workflows/…`. Deep links carry `runsView` as URL-encoded JSON.
5. Copy each screenshot back and look at it before claiming anything:

```bash
~/.agents/skills/starfolk-verify/scripts/box-fetch.sh <box> /tmp/shot-<name>.png /tmp/box-shots/<name>.png
```

## 6. Finish

- Report what was exercised, with the screenshots, and say what wasn't covered.
- Leave the box running unless Vinny asks to shut it down (`sfk box shutdown` needs his authorization).
- Remove the worktree when the task is done: `git worktree remove` on the box.
