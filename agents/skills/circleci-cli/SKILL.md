---
name: circleci-cli
description: Use for any CircleCI task — failing PR checks, CI logs, failed tests, flaky tests, reruns, watching runs, artifacts, config validation. Uses the `circleci` CLI (v1) instead of the CircleCI MCP, which is disabled; also applies when another skill (e.g. fix-pr-checks) names `mcp__circleci__*` tools.
---

# CircleCI CLI

The CircleCI MCP servers are disabled for Vinny. Use the `circleci` CLI v1 (`/opt/homebrew/bin/circleci`) for all CircleCI work.

Docs: https://circleci.com/docs/guides/toolkit/circleci-cli/ · full reference: https://cli.circleci.com/reference/. The installed binary is the source of truth: `circleci <cmd> --help`, or `circleci help reference` for every command and flag.

## Setup per shell

```bash
export CIRCLE_NO_INTERACTIVE=1 CIRCLE_NO_PAGER=1
circleci auth me --json --jq .login || export CIRCLE_TOKEN=$CIRCLECI_TOKEN
```

- The CLI reads `CIRCLE_TOKEN`, not `CIRCLECI_TOKEN`. Without a token or a keyring login (`circleci auth login`, browser OAuth) every API command fails with an auth suggestion.
- `CIRCLE_NO_INTERACTIVE` stops `run get` from opening its picker/TUI; `CIRCLE_NO_PAGER` prints long output directly.
- Run from a clay-base checkout or worktree: the project (`gh/clay-run/clay-base`) and branch are inferred from the git remote and checked-out branch. Elsewhere pass `--project gh/clay-run/clay-base` (with `--project`, `run get` defaults to branch `main` unless `--branch` is given).

## Object model

Run (one pipeline execution, has a run number and UUID) → workflows (e.g. `lint-test-build-deploy-verify`) → jobs (UUID) → steps (`num`). Commands take UUIDs; get them via `--json`.

## Output

- Every command prints a markdown report; add `--json` for data, `--jq '<expr>'` to filter inline (no separate `jq` needed).
- `testresult list --json` emits JSONL, one object per test; `--jq` runs per record. Aggregate with `--jq '[.,inputs] | length'`.

### Status-field gotchas (verified against clay-base, CLI 1.0.51932)

- Runs (`run list`, `run get`): `outcome` is often `null`; use `current_outcome` (`succeeded` | `failed` | `canceled` | `not_run` | `null` while running) together with `phase` (`started` | `ended`).
- Workflows and jobs inside `run get --json` / `workflow get --json`: `outcome` is set once ended; `current_outcome` is often `null`. Filter with `(.outcome // .current_outcome)`.
- `job get --json`: there is no `status` field despite the help text; use `outcome`. Steps carry `num`, `name`, `outcome` — no `exit_code`.
- `job output list --json`: steps carry `num`, `name`, `outcome`, `exit_code`, `output` (full output).

## Diagnose failing checks (PR or branch)

```bash
# 1. Branch for a PR
branch=$(gh pr view <pr> --json headRefName --jq .headRefName)

# 2. Latest run on that branch, failed jobs only
circleci run get --branch "$branch" --no-interactive --json \
  --jq '{id, current_outcome, failed: [.workflows[] | {workflow: .name, wf_id: .id, jobs: [.jobs[] | select((.outcome // .current_outcome) == "failed") | {id, name}]} | select(.jobs | length > 0)]}'

# 3a. One-shot condensed output of every failed step (slow: ~20s; best first look)
circleci run get <run-id> --failure-report

# 3b. Or per job: failing step numbers, then that step's output
circleci job output list <job-id> --json --jq '[.steps[] | select((.exit_code // 0) != 0) | {num, name, exit_code}]'
circleci job output get <job-id> --step-num <num> --condensed   # error-relevant lines only
circleci job output get <job-id> --step-num <num> > step.log      # full raw output
# parallel jobs (e.g. api-tests has 4 executions): add --execution <index>

# 4. Failed tests (defaults to failures only)
circleci testresult list <job-id>
circleci testresult get <job-id> "<exact test name>" --plain        # raw failure message
```

`run get` without `--branch` uses the current branch; `run get --mine` limits to your runs. `circleci my runs` lists your runs across projects.

Flake signals for clay-base: infrastructure errors in setup steps (apt mirror size mismatch, network fetch failures, exit 129, HTTP 504s, fixture timeouts) rather than assertion failures in changed code. Check whether a test is a known flake (below) before rerunning.

## Flaky tests

No dedicated command; call the Insights v2 API through `circleci api` (a path starting with `api` is sent as given):

```bash
circleci api api/v2/insights/gh/clay-run/clay-base/flaky-tests \
  --jq '.flaky_tests[] | select(.test_name | test("<substring>")) | {test_name, job_name, times_flaked}'
```

## Rerun, trigger, cancel (mutations — only when the user asked)

```bash
circleci workflow rerun <workflow-id> --from-failed --json   # failed jobs only; JSON has workflow_id of the new workflow
circleci workflow rerun <workflow-id>                                           # all jobs from scratch
circleci run trigger --branch <branch> [--parameter key=value]
circleci workflow cancel <workflow-id> --force
circleci run cancel <run-number-or-id> --force
```

Reruns create a new workflow; follow it with `circleci workflow get <new-id>` or `circleci run watch`. `workflow rerun` rejects `--jq` (its help example is wrong); pipe `--json` to `jq -r .workflow_id`. Cancels without `--force` error out in non-interactive mode, so pass `--force` once the user has asked for the cancel.

## Watch until done

```bash
circleci run watch --sha "$(git rev-parse HEAD)" --failfast   # waits up to 2m for the run to appear after a push
circleci run watch <run-id> --timeout 45m
```

Exit codes: 0 succeeded, 1 failed, 6 cancelled, 7 config rejected, 8 timed out. Run it async/background; it blocks.

## Other commands

| Need | Command |
| --- | --- |
| Recent runs | `circleci run list [--current-branch \| --branch <b>] [--limit N]` |
| Workflows for a run | `circleci workflow list <run-number-or-id>` / `circleci workflow get <workflow-id>` |
| Artifacts | `circleci job artifact <job-id> [--output ./dir]` |
| CPU/memory vs resource class | `circleci job resource-usage get <job-id> --json` |
| Validate / expand config | `circleci config validate` · `circleci config process .circleci/config.yml` |
| Raw REST (v3 default; prefix `api/v2/...` for v2) | `circleci api <path> [-X METHOD] [-f key=value]` (exit 4 on 4xx/5xx) |
| Open in browser (user-facing only) | `circleci job open <id>` · `circleci workflow open <id>` · `circleci run open` |

## Replacing CircleCI MCP tools

| MCP tool | CLI |
| --- | --- |
| `get_build_failure_logs` | `run get --branch <b> --no-interactive --failure-report`, or `job output get --condensed` |
| `get_job_test_results` | `testresult list <job-id>` (`--all`, `--filter result=failure`) |
| `get_latest_pipeline_status` | `run get --branch <b> --no-interactive` |
| `find_flaky_tests` | `circleci api api/v2/insights/gh/clay-run/clay-base/flaky-tests` |
| `rerun_workflow` (`fromFailed`) | `workflow rerun <workflow-id> --from-failed` |
| `list_artifacts` | `job artifact <job-id>` |
| `config_helper` | `config validate` / `config process` |
| `run_pipeline` | `run trigger --branch <b>` |

Do not run `circleci mcp ... enable`; it re-registers the MCP server in editor configs.
